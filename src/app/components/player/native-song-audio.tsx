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
type Entry = { key: string; songId: string; item: NativeItem }

/** The tracks the native player holds: the current one and its neighbours. */
type Held = {
  previous: Entry | null
  current: Entry | null
  next: Entry | null
}

const NOTHING_HELD: Held = { previous: null, current: null, next: null }

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
 * current track and its neighbours, preloads the next and joins onto it
 * without a gap, even with the screen off. The queue stays here: whenever
 * the native player moves (by itself, or from the notification or a
 * headset, which it handles without waiting for this page), the queue
 * follows and the new neighbours are sent.
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
  const prevSong =
    currentSongIndex > 0 ? currentList[currentSongIndex - 1] : undefined

  const held = useRef<Held>(NOTHING_HELD)
  const clock = useRef<Clock>({
    key: '',
    positionMs: 0,
    durationMs: -1,
    playing: false,
    at: 0,
  })
  const seekGuard = useRef({ until: 0, targetMs: 0 })

  // Latest values for the one-time listeners and the load effect.
  const live = useRef({ isPlaying, loopState, song, nextSong, prevSong })
  live.current = { isPlaying, loopState, song, nextSong, prevSong }

  const shim = useMemo(() => createElementShim(clock, seekGuard), [])

  const makeEntry = useCallback(
    (track: ISong): Entry => {
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
      const key = `${track.id}#${++keyCounter}`
      const item: NativeItem = {
        key,
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
      return { key, songId: track.id, item }
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
      held.current = NOTHING_HELD
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

      // The native player moved to a neighbour by itself (the end of a
      // track, or the notification or a headset); follow it in the queue.
      // A skip made here has already moved the queue.
      NativePlayer.addListener('transition', ({ key }) => {
        const { previous, current, next } = held.current
        const { currentList: list, currentSongIndex: at } =
          usePlayerStore.getState().songlist
        if (next?.key === key) {
          held.current = { previous: current, current: next, next: null }
          restartClock(key, 0)
          if (list[at]?.id !== next.songId) playNextSong()
        } else if (previous?.key === key) {
          held.current = { previous: null, current: previous, next: current }
          restartClock(key, 0)
          if (list[at]?.id !== previous.songId) playPrevSong()
        }
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
        held.current = NOTHING_HELD
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
        held.current = NOTHING_HELD
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
    const { song: track, nextSong: following, prevSong: before } = live.current
    if (!track || !NativePlayer) return

    held.current = {
      previous: before ? makeEntry(before) : null,
      current: makeEntry(track),
      next: following ? makeEntry(following) : null,
    }
    const { previous, current, next } = held.current
    // Resume where the track was (after a reload, or a synced position).
    const positionMs = getCurrentProgress() * 1000
    restartClock(current!.key, positionMs)
    setCurrentDuration(track.duration)
    NativePlayer.load({
      previous: previous?.item,
      current: current!.item,
      next: next?.item,
      positionMs,
      playWhenReady: live.current.isPlaying,
      repeatOne: live.current.loopState === LoopState.One,
      volume: getVolume() / 100,
    })
  }, [getCurrentProgress, makeEntry, restartClock, setCurrentDuration])
  const loadRef = useRef(loadCurrent)
  loadRef.current = loadCurrent

  // The current track changed: move to a neighbour the native player
  // already holds when it is the one, otherwise load it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the track
  useEffect(() => {
    if (!song || !NativePlayer) return
    if (usePlayerStore.getState().playerState.audioPlayerRef !== shim) {
      setAudioPlayerRef(shim)
    }

    const { previous, current, next } = held.current
    if (current?.songId === song.id) return

    let target: Entry
    if (next?.songId === song.id) {
      target = next
      held.current = { previous: current, current: next, next: null }
    } else if (previous?.songId === song.id) {
      target = previous
      held.current = { previous: null, current: previous, next: current }
    } else {
      loadCurrent()
      return
    }

    restartClock(target.key, 0)
    setCurrentDuration(song.duration)
    NativePlayer.skipTo({ key: target.key }).then(({ skipped }) => {
      if (!skipped) logger.warn('Native player skip missed', target.key)
    })
  }, [song?.id])

  // Keep the neighbours of the current track loaded: the next one preloads
  // for a gapless join, and both let the notification and headset buttons
  // move without this page.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the tracks
  useEffect(() => {
    if (!song || !NativePlayer) return
    const { previous, current, next } = held.current
    // The current track is still being loaded.
    if (current?.songId !== song.id) return

    const samePrevious = (previous?.songId ?? null) === (prevSong?.id ?? null)
    const sameNext = (next?.songId ?? null) === (nextSong?.id ?? null)
    if (samePrevious && sameNext) return

    held.current = {
      previous: samePrevious ? previous : prevSong ? makeEntry(prevSong) : null,
      current,
      next: sameNext ? next : nextSong ? makeEntry(nextSong) : null,
    }
    NativePlayer.setAdjacent({
      previous: held.current.previous?.item,
      next: held.current.next?.item,
    })
  }, [song?.id, prevSong?.id, nextSong?.id])

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
