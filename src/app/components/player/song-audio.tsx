import {
  MutableRefObject,
  SyntheticEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { getSongStreamUrl } from '@/api/httpClient'
import { useAppMediaCache } from '@/store/app.store'
import { isPassiveConnectDevice } from '@/store/connect.store'
import {
  getVolume,
  useGaplessSettings,
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
import { ReplayGainParams } from '@/utils/replayGain'
import { AudioPlayer } from './audio'

/**
 * How long before a track ends the next one is started, to cover the time
 * the next element takes to actually start. That delay differs between
 * devices (a desktop browser is much quicker than an Android WebView), so
 * the lead calibrates itself after each handoff toward a tiny overlap.
 */
const TARGET_OVERLAP_SECONDS = 0.01
const MAX_LEAD_SECONDS = 0.25
let handoffLead = 0.05

function adjustLead(error: number) {
  handoffLead = Math.min(
    MAX_LEAD_SECONDS,
    Math.max(0, handoffLead + error * 0.5),
  )
}

/** Only start early when the stream length agrees with the track's. */
const DURATION_TOLERANCE_SECONDS = 2

type Slot = { song: ISong; url: string }
type SlotIndex = 0 | 1

function other(index: SlotIndex): SlotIndex {
  return index === 0 ? 1 : 0
}

interface SongAudioProps {
  /** Always points at the element that is playing (the active slot). */
  audioRef: MutableRefObject<HTMLAudioElement | null>
}

/**
 * Song playback with gapless transitions. Two audio elements take turns:
 * while one plays, the other loads the next track, and just before the
 * current one ends the next one starts, so there is no silence to load it.
 * With gapless off, or for repeat-one, only one element is used.
 */
export function SongAudio({ audioRef }: SongAudioProps) {
  const { currentList, currentSongIndex } = usePlayerSonglist()
  const isPlaying = usePlayerIsPlaying()
  const loopState = usePlayerLoop()
  const { enabled: gaplessEnabled } = useGaplessSettings()
  const mediaCacheEnabled = useAppMediaCache()
  const { replayGainType, replayGainPreAmp, replayGainDefaultGain } =
    useReplayGainState()
  const {
    setAudioPlayerRef,
    setCurrentDuration,
    setProgress,
    setPlayingState,
    handleSongEnded,
    getCurrentProgress,
  } = usePlayerActions()

  const firstSlot = useRef<HTMLAudioElement>(null)
  const secondSlot = useRef<HTMLAudioElement>(null)
  const slotRefs = useMemo(() => [firstSlot, secondSlot] as const, [])
  const [slots, setSlots] = useState<[Slot | null, Slot | null]>([null, null])
  const [active, setActive] = useState<SlotIndex>(0)
  const handoffTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // The slot a handoff just left, and when each slot last ended, to measure
  // how well the handoff lined up.
  const handoffFrom = useRef<SlotIndex | null>(null)
  const endedAt = useRef<[number, number]>([0, 0])

  // Set when the browser refuses to start the standby element; from then
  // on this session plays everything on the one element it allows.
  const [standbyBlocked, setStandbyBlocked] = useState(false)

  const song = currentList[currentSongIndex] as ISong | undefined
  const nextSong = getNextSong(currentList, currentSongIndex, loopState)
  const useStandby =
    gaplessEnabled && !standbyBlocked && loopState !== LoopState.One

  // Latest values for event handlers and timers.
  const live = useRef({ active, slots, song, nextSong, useStandby, isPlaying })
  live.current = { active, slots, song, nextSong, useStandby, isPlaying }

  const makeSlot = useCallback(
    (track: ISong): Slot => ({
      song: track,
      url: getSongStreamUrl(
        track.id,
        undefined,
        ensureSupportForAlac(track.suffix),
        mediaCacheEnabled ? undefined : Date.now().toString(),
      ),
    }),
    [mediaCacheEnabled],
  )

  const cancelHandoff = useCallback(() => {
    if (handoffTimer.current) clearTimeout(handoffTimer.current)
    handoffTimer.current = null
  }, [])

  // Keep the shared reference (seeking, sync, media controls) on the slot
  // that is playing.
  const pointAt = useCallback(
    (index: SlotIndex) => {
      const element = slotRefs[index].current
      if (!element) return
      audioRef.current = element
      // The store's copy is cleared when the queue ends; restore it too.
      if (usePlayerStore.getState().playerState.audioPlayerRef !== element) {
        setAudioPlayerRef(element)
      }
    },
    [audioRef, setAudioPlayerRef, slotRefs],
  )

  // The current track changed: play it from the standby slot when that
  // already has it loaded, otherwise load it into the active slot.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the track
  useEffect(() => {
    cancelHandoff()
    if (!song) return

    const { active: current, slots: currentSlots } = live.current
    if (currentSlots[current]?.song.id === song.id) return

    const standby = other(current)
    if (currentSlots[standby]?.song.id === song.id) {
      const element = slotRefs[standby].current
      if (element) {
        // A skip (not a handoff) starts the preloaded track from the top.
        if (element.paused) element.currentTime = 0
        element.volume = getVolume() / 100
        setCurrentDuration(
          Number.isFinite(element.duration)
            ? Math.floor(element.duration)
            : song.duration,
        )
        setProgress(Math.floor(element.currentTime))
      }
      setActive(standby)
      return
    }

    setSlots((previous) => {
      const updated: [Slot | null, Slot | null] = [...previous]
      updated[current] = makeSlot(song)
      return updated
    })
  }, [song?.id])

  // Point the shared reference at the active slot once it is rendered (its
  // element only exists once the slot has a track).
  const activeUrl = slots[active]?.url
  useEffect(() => {
    if (activeUrl) pointAt(active)
  }, [active, activeUrl, pointAt])

  // Preload the next track into the standby slot.
  useEffect(() => {
    const standby = other(active)
    if (!useStandby || !nextSong || nextSong.id === song?.id) return
    // Wait until the switch to the current track has happened; until then
    // the "standby" slot may be the one about to become active.
    if (slots[active]?.song.id !== song?.id) return
    if (slots[standby]?.song.id === nextSong.id) return

    const assign = () =>
      setSlots((previous) => {
        const updated: [Slot | null, Slot | null] = [...previous]
        updated[standby] = makeSlot(nextSong)
        return updated
      })

    // Right after a handoff the standby element is still finishing the old
    // track; give it a moment rather than cutting its last notes.
    const element = slotRefs[standby].current
    if (element && !element.paused) {
      const timer = setTimeout(assign, 1500)
      return () => clearTimeout(timer)
    }
    assign()
  }, [active, nextSong, useStandby, song?.id, slots, makeSlot, slotRefs])

  // Pausing stops both elements, including a tail still finishing.
  useEffect(() => {
    if (isPlaying) return
    cancelHandoff()
    for (const ref of slotRefs) ref.current?.pause()
  }, [isPlaying, cancelHandoff, slotRefs])

  useEffect(() => cancelHandoff, [cancelHandoff])

  const isActive = (index: SlotIndex) => live.current.active === index

  function handleLoadedMetadata(index: SlotIndex, element: HTMLAudioElement) {
    if (!isActive(index)) return
    const track = live.current.song
    setCurrentDuration(
      Number.isFinite(element.duration)
        ? Math.floor(element.duration)
        : (track?.duration ?? 0),
    )
    // Resume where the track was (after a reload, or a synced position).
    element.currentTime = getCurrentProgress()
  }

  function handleTimeUpdate(index: SlotIndex, element: HTMLAudioElement) {
    if (!isActive(index)) return
    setProgress(Math.floor(element.currentTime))
    scheduleHandoff(index, element)
  }

  // Near the end of the track, start the next one from the standby slot.
  function scheduleHandoff(index: SlotIndex, element: HTMLAudioElement) {
    const { slots: currentSlots, song: track, nextSong: next } = live.current
    if (handoffTimer.current || !live.current.useStandby) return
    if (!track || !next || !live.current.isPlaying) return
    if (isPassiveConnectDevice()) return

    const standbyElement = slotRefs[other(index)].current
    if (currentSlots[other(index)]?.song.id !== next.id) return
    if (!standbyElement || standbyElement.readyState < 3) return

    const { duration, currentTime, playbackRate } = element
    if (!Number.isFinite(duration)) return
    // A transcoded stream can report an estimated length; starting early
    // on a wrong estimate would cut off the end of the song.
    if (
      track.duration &&
      Math.abs(duration - track.duration) > DURATION_TOLERANCE_SECONDS
    ) {
      return
    }

    const remaining = (duration - currentTime) / (playbackRate || 1)
    if (remaining <= 0 || remaining > 1.2) return

    const trackId = track.id
    handoffTimer.current = setTimeout(
      () => {
        handoffTimer.current = null
        const state = usePlayerStore.getState()
        const { currentList: list, currentSongIndex: at } = state.songlist
        if (list[at]?.id !== trackId) return
        // Paused or sought back in the meantime.
        if (element.paused || element.duration - element.currentTime > 0.5) {
          return
        }
        handoffFrom.current = index
        state.actions.playNextSong()
      },
      Math.max(0, (remaining - handoffLead) * 1000),
    )
  }

  // Once the new track is audible, silence the one it took over from: at
  // once after a skip, but a handoff lets the last few milliseconds of the
  // old track play out rather than cutting them.
  function handlePlaying(index: SlotIndex) {
    if (!isActive(index)) return
    const previousIndex = other(index)
    const previous = slotRefs[previousIndex].current

    if (handoffFrom.current === previousIndex && previous) {
      handoffFrom.current = null
      if (previous.ended) {
        // Started after the old track had already ended: start earlier. The
        // "ended" event can arrive late (about 80 ms in an Android WebView),
        // so one measurement only moves the lead a little.
        const gap = (performance.now() - endedAt.current[previousIndex]) / 1000
        if (gap < 1) adjustLead(Math.min(gap, 0.05) + TARGET_OVERLAP_SECONDS)
      } else {
        // Started while the old one still had this much left.
        const overlap = previous.duration - previous.currentTime
        adjustLead(-(overlap - TARGET_OVERLAP_SECONDS))
      }
    }

    if (!previous || previous.paused) return
    if (previous.duration - previous.currentTime > 0.3) previous.pause()
  }

  // The browser would not start this slot's element (some only allow an
  // element a tap has started). Play the track on the other element, which
  // has played before, and stop using a standby slot.
  function handlePlayBlocked(index: SlotIndex) {
    const track = live.current.song
    if (!isActive(index) || !track) return
    const fallback = other(index)
    setStandbyBlocked(true)
    setSlots((previous) => {
      const updated: [Slot | null, Slot | null] = [...previous]
      updated[fallback] = makeSlot(track)
      updated[index] = null
      return updated
    })
    setActive(fallback)
  }

  function replayGainFor(track: ISong): ReplayGainParams {
    const preAmp = replayGainPreAmp
    const defaultGain = replayGainDefaultGain
    if (!track.replayGain) return { gain: defaultGain, peak: 1, preAmp }

    if (replayGainType === 'album') {
      const { albumGain = defaultGain, albumPeak = 1 } = track.replayGain
      return {
        gain: albumGain === 0 ? defaultGain : albumGain,
        peak: albumPeak,
        preAmp,
      }
    }

    const { trackGain = defaultGain, trackPeak = 1 } = track.replayGain
    return {
      gain: trackGain === 0 ? defaultGain : trackGain,
      peak: trackPeak,
      preAmp,
    }
  }

  return (
    <>
      {([0, 1] as const).map((index) => {
        const slot = slots[index]
        if (!slot) return null
        const slotIsActive = active === index

        return (
          <AudioPlayer
            key={index}
            active={slotIsActive}
            audioRef={slotRefs[index]}
            replayGain={replayGainFor(slot.song)}
            src={slot.url}
            preload="auto"
            autoPlay={isPlaying}
            loop={slotIsActive && loopState === LoopState.One}
            onPlay={() => setPlayingState(true)}
            onPause={() => setPlayingState(false)}
            onEnded={handleSongEnded}
            onPlaying={() => handlePlaying(index)}
            onPlayBlocked={
              standbyBlocked ? undefined : () => handlePlayBlocked(index)
            }
            onEndedCapture={() => {
              endedAt.current[index] = performance.now()
            }}
            onLoadedMetadata={(event: SyntheticEvent<HTMLAudioElement>) =>
              handleLoadedMetadata(index, event.currentTarget)
            }
            onTimeUpdate={(event: SyntheticEvent<HTMLAudioElement>) =>
              handleTimeUpdate(index, event.currentTarget)
            }
            onLoadStart={(event: SyntheticEvent<HTMLAudioElement>) => {
              event.currentTarget.volume = getVolume() / 100
            }}
            data-testid={
              slotIsActive ? 'player-song-audio' : 'player-song-audio-next'
            }
          />
        )
      })}
    </>
  )
}

/** The track that plays after the current one, if any. */
function getNextSong(
  list: ISong[],
  index: number,
  loopState: LoopState,
): ISong | undefined {
  if (loopState === LoopState.One) return undefined
  if (index + 1 < list.length) return list[index + 1]
  if (loopState === LoopState.All && list.length > 1) return list[0]
  return undefined
}
