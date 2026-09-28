import {
  MutableRefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'react-toastify'
import { getSimpleCoverArtUrl, getSongStreamUrl } from '@/api/httpClient'
import { useAppMediaCache } from '@/store/app.store'
import {
  getVolume,
  usePlayerActions,
  usePlayerIsPlaying,
  usePlayerLoop,
  usePlayerSonglist,
  usePlayerStore,
  useReplayGainState,
} from '@/store/player.store'
import { LoopState } from '@/types/playerContext'
import { ISong } from '@/types/responses/song'
import { ensureSupportForAlac } from '@/utils/alac'
import { logger } from '@/utils/logger'
import { NativeItem, NativePlayer } from '@/utils/nativePlayer'
import { calculateReplayGain, replayGainParamsFor } from '@/utils/replayGain'
import { getNextSong } from './song-audio'

/** An item the native player holds. */
type Entry = { key: string; songId: string }

/** The last position the native player reported, to extrapolate from. */
type Clock = {
  key: string
  positionMs: number
  durationMs: number
  playing: boolean
  at: number
}

// Ignore position reports this long after a seek (they can predate it),
// unless they already show the new position.
const SEEK_SETTLE_MS = 400

let keyCounter = 0

interface NativeSongAudioProps {
  /** Set to a stand-in for an audio element (see createElementShim). */
  audioRef: MutableRefObject<HTMLAudioElement | null>
}

/**
 * Song playback in the Android app, through the native player. It holds the
 * current track and preloads the next, joining them without a gap even with
 * the screen off; the queue stays here, and each time the native player
 * moves on, the next track is sent.
 */
export function NativeSongAudio({ audioRef }: NativeSongAudioProps) {
  const { t } = useTranslation()
  const { currentList, currentSongIndex } = usePlayerSonglist()
  const isPlaying = usePlayerIsPlaying()
  const loopState = usePlayerLoop()
  const mediaCacheEnabled = useAppMediaCache()
  const {
    replayGainEnabled,
    replayGainError,
    replayGainType,
    replayGainPreAmp,
    replayGainDefaultGain,
  } = useReplayGainState()
  const {
    setAudioPlayerRef,
    setCurrentDuration,
    setProgress,
    setPlayingState,
    handleSongEnded,
    getCurrentProgress,
    playNextSong,
    playPrevSong,
  } = usePlayerActions()

  const song = currentList[currentSongIndex] as ISong | undefined
  const nextSong = getNextSong(currentList, currentSongIndex, loopState)

  const held = useRef<{ current: Entry | null; next: Entry | null }>({
    current: null,
    next: null,
  })
  const clock = useRef<Clock>({
    key: '',
    positionMs: 0,
    durationMs: -1,
    playing: false,
    at: 0,
  })
  const seekGuard = useRef({ until: 0, targetMs: 0 })

  // Latest values for the one-time listeners and the load effect.
  const live = useRef({ isPlaying, loopState, song, nextSong })
  live.current = { isPlaying, loopState, song, nextSong }

  const shim = useMemo(() => createElementShim(clock, seekGuard), [])

  const makeItem = useCallback(
    (track: ISong): NativeItem => {
      const gain =
        replayGainEnabled && !replayGainError
          ? calculateReplayGain(
              replayGainParamsFor(track, {
                type: replayGainType,
                preAmp: replayGainPreAmp,
                defaultGain: replayGainDefaultGain,
              }),
            )
          : 1
      return {
        key: `${track.id}#${++keyCounter}`,
        url: getSongStreamUrl(
          track.id,
          undefined,
          ensureSupportForAlac(track.suffix),
          mediaCacheEnabled ? undefined : Date.now().toString(),
        ),
        title: track.title ?? '',
        artist: track.artist ?? '',
        album: track.album ?? '',
        artworkUrl: track.coverArt
          ? getSimpleCoverArtUrl(track.coverArt, 'song', '512')
          : '',
        durationMs: (track.duration ?? 0) * 1000,
        gain: Number.isFinite(gain) && gain > 0 ? gain : 1,
      }
    },
    [
      mediaCacheEnabled,
      replayGainEnabled,
      replayGainError,
      replayGainType,
      replayGainPreAmp,
      replayGainDefaultGain,
    ],
  )

  const restartClock = useCallback((key: string, positionMs: number) => {
    clock.current = {
      key,
      positionMs,
      durationMs: -1,
      playing: clock.current.playing,
      at: performance.now(),
    }
  }, [])

  // The shared reference (seeking, sync, lyrics) points at the stand-in.
  useEffect(() => {
    audioRef.current = shim
    setAudioPlayerRef(shim)
    return () => {
      if (audioRef.current === shim) audioRef.current = null
      if (usePlayerStore.getState().playerState.audioPlayerRef === shim) {
        setAudioPlayerRef(null as unknown as HTMLAudioElement)
      }
      // Loaded again from scratch if this mounts again.
      held.current = { current: null, next: null }
      NativePlayer?.stop()
    }
  }, [audioRef, setAudioPlayerRef, shim])

  // Events from the native player.
  // biome-ignore lint/correctness/useExhaustiveDependencies: listeners are registered once
  useEffect(() => {
    if (!NativePlayer) return
    const handles = [
      NativePlayer.addListener('progress', (data) => {
        if (data.key !== held.current.current?.key) return
        const now = performance.now()
        const guard = seekGuard.current
        if (
          now < guard.until &&
          Math.abs(data.positionMs - guard.targetMs) > 1000
        ) {
          return
        }
        clock.current = {
          key: data.key,
          positionMs: data.positionMs,
          durationMs: data.durationMs,
          playing: data.playing,
          at: now,
        }
        setProgress(Math.floor(data.positionMs / 1000))
        if (data.durationMs > 0) {
          setCurrentDuration(Math.floor(data.durationMs / 1000))
        }
      }),

      // The native player moved on to the preloaded track by itself; follow
      // it in the queue. (A skip here has already moved the queue.)
      NativePlayer.addListener('transition', ({ key }) => {
        const { next } = held.current
        if (!next || next.key !== key) return
        held.current = { current: next, next: null }
        restartClock(key, 0)
        const { currentList: list, currentSongIndex: at } =
          usePlayerStore.getState().songlist
        if (list[at]?.id !== next.songId) playNextSong()
      }),

      // Played or paused from the notification, a headset, or because
      // another app took over the audio.
      NativePlayer.addListener('playing', ({ playing }) => {
        if (usePlayerStore.getState().playerState.isPlaying !== playing) {
          setPlayingState(playing)
        }
      }),

      NativePlayer.addListener('ended', ({ key }) => {
        if (key && key !== held.current.current?.key) return
        held.current = { current: null, next: null }
        const endedId = live.current.song?.id
        handleSongEnded()
        // Repeating a one-track queue comes back to the same track, which
        // does not count as a change of track; start it again here.
        const state = usePlayerStore.getState()
        const { currentList: list, currentSongIndex: at } = state.songlist
        if (state.playerState.isPlaying && list[at]?.id === endedId) {
          loadRef.current()
        }
      }),

      NativePlayer.addListener('error', (data) => {
        if (data.key && data.key !== held.current.current?.key) return
        logger.error('Native playback error', data)
        toast.error(t('warnings.songError'))
        // Loading the track again (play, or picking it) retries it.
        held.current = { current: null, next: null }
        setPlayingState(false)
      }),

      NativePlayer.addListener('command', ({ action }) => {
        if (action === 'nexttrack') playNextSong()
        if (action === 'previoustrack') playPrevSong()
      }),
    ]
    return () => {
      for (const handle of handles) handle.then((h) => h.remove())
    }
  }, [])

  // Starts the current track from the queue's position.
  const loadCurrent = useCallback(() => {
    const { song: track, nextSong: following } = live.current
    if (!track || !NativePlayer) return

    const item = makeItem(track)
    const nextItem = following ? makeItem(following) : undefined
    held.current = {
      current: { key: item.key, songId: track.id },
      next:
        nextItem && following
          ? { key: nextItem.key, songId: following.id }
          : null,
    }
    // Resume where the track was (after a reload, or a synced position).
    const positionMs = getCurrentProgress() * 1000
    restartClock(item.key, positionMs)
    setCurrentDuration(track.duration)
    NativePlayer.load({
      current: item,
      next: nextItem,
      positionMs,
      playWhenReady: live.current.isPlaying,
      repeatOne: live.current.loopState === LoopState.One,
      volume: getVolume() / 100,
    })
  }, [getCurrentProgress, makeItem, restartClock, setCurrentDuration])
  const loadRef = useRef(loadCurrent)
  loadRef.current = loadCurrent

  // The current track changed: move on to the preloaded track when it is
  // the one, otherwise load it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the track
  useEffect(() => {
    if (!song || !NativePlayer) return
    if (usePlayerStore.getState().playerState.audioPlayerRef !== shim) {
      setAudioPlayerRef(shim)
    }

    const { current, next } = held.current
    if (current?.songId === song.id) return

    if (next?.songId === song.id) {
      held.current = { current: next, next: null }
      restartClock(next.key, 0)
      setCurrentDuration(song.duration)
      NativePlayer.skipToNext({ key: next.key }).then(({ skipped }) => {
        if (!skipped) logger.warn('Native player skip missed', next.key)
      })
      return
    }

    loadCurrent()
  }, [song?.id])

  // Keep the track after the current one preloaded.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the tracks
  useEffect(() => {
    if (!song || !NativePlayer) return
    const { current, next } = held.current
    // The current track is still being loaded.
    if (current?.songId !== song.id) return
    if ((next?.songId ?? null) === (nextSong?.id ?? null)) return

    const item = nextSong ? makeItem(nextSong) : undefined
    held.current = {
      current,
      next: item ? { key: item.key, songId: nextSong!.id } : null,
    }
    NativePlayer.setNext({ next: item })
  }, [song?.id, nextSong?.id])

  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on play state
  useEffect(() => {
    // After an error the track is loaded again when play is pressed.
    if (isPlaying && !held.current.current) {
      loadCurrent()
      return
    }
    NativePlayer?.setPlaying({ playing: isPlaying })
  }, [isPlaying])

  useEffect(() => {
    NativePlayer?.setRepeatOne({ enabled: loopState === LoopState.One })
  }, [loopState])

  return null
}

/**
 * Stands in for an audio element wherever the app reads or sets the
 * position (seek bars, lyrics, Jam and Connect sync), and the volume. The
 * position is extrapolated between the native player's reports.
 */
function createElementShim(
  clock: MutableRefObject<Clock>,
  seekGuard: MutableRefObject<{ until: number; targetMs: number }>,
) {
  const shim = {
    get currentTime() {
      const { positionMs, durationMs, playing, at } = clock.current
      let ms = positionMs + (playing ? performance.now() - at : 0)
      if (durationMs > 0) ms = Math.min(ms, durationMs)
      return Math.max(0, ms) / 1000
    },
    set currentTime(seconds: number) {
      if (!Number.isFinite(seconds)) return
      const positionMs = Math.max(0, seconds * 1000)
      const now = performance.now()
      clock.current = { ...clock.current, positionMs, at: now }
      seekGuard.current = { until: now + SEEK_SETTLE_MS, targetMs: positionMs }
      NativePlayer?.seekTo({ positionMs: Math.round(positionMs) })
    },
    get duration() {
      const { durationMs } = clock.current
      return durationMs > 0 ? durationMs / 1000 : Number.NaN
    },
    get paused() {
      return !usePlayerStore.getState().playerState.isPlaying
    },
    get volume() {
      return getVolume() / 100
    },
    set volume(value: number) {
      NativePlayer?.setVolume({ volume: value })
    },
    playbackRate: 1,
    play() {
      usePlayerStore.getState().actions.setPlayingState(true)
      return Promise.resolve()
    },
    pause() {
      usePlayerStore.getState().actions.setPlayingState(false)
    },
  }
  return shim as unknown as HTMLAudioElement
}
