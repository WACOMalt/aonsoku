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
import {
  crossfadeElements,
  resetElementFade,
} from '@/app/hooks/use-audio-context'
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
 * the next element takes to actually produce sound. That delay differs by
 * device, so the lead calibrates itself: after each handoff the real gap is
 * measured from the two elements' own playback clocks (which follow their
 * audio output, unlike the "playing" event) and the lead is corrected. The
 * result is remembered on the device.
 */
/**
 * Two separate elements can only be lined up to within a few milliseconds
 * (in Chromium the next one starts on ~21 ms steps), so the handoff aims for
 * a small overlap and crossfades across it: a hard cut would click, and a
 * gap would be audible on albums that run continuously.
 */
const CROSSFADE_SECONDS = 0.025
const TARGET_OVERLAP_SECONDS = 0.012

const LEAD_STORAGE_KEY = 'aonsoku-gapless-lead'
const DEFAULT_LEAD_SECONDS = 0.035
const MAX_LEAD_SECONDS = 0.5
let handoffLead = readStoredLead()

function readStoredLead() {
  try {
    const stored = Number(localStorage.getItem(LEAD_STORAGE_KEY))
    if (stored > 0 && stored <= MAX_LEAD_SECONDS) return stored
  } catch {
    // Storage unavailable; use the default.
  }
  return DEFAULT_LEAD_SECONDS
}

/** Positive: the join had a gap of that many seconds; negative: overlap. */
function correctLead(gapSeconds: number) {
  handoffLead = Math.min(
    MAX_LEAD_SECONDS,
    Math.max(0, handoffLead + gapSeconds * 0.8),
  )
  try {
    localStorage.setItem(LEAD_STORAGE_KEY, handoffLead.toFixed(4))
  } catch {
    // Not remembered; it recalibrates next session.
  }
}

/**
 * When, on the page clock, the element played position 0: its playback
 * clock follows the audio output, so this is when its sound started.
 * Averaged over a few readings; null when playback was interrupted.
 */
async function measureStart(element: HTMLAudioElement) {
  const starts: number[] = []
  for (let reading = 0; reading < 5; reading++) {
    if (element.paused || element.seeking) return null
    const rate = element.playbackRate || 1
    starts.push(performance.now() - (element.currentTime / rate) * 1000)
    await new Promise((resolve) => setTimeout(resolve, 40))
  }
  if (Math.max(...starts) - Math.min(...starts) > 20) return null
  return starts.reduce((sum, start) => sum + start, 0) / starts.length
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
  // A handoff in progress: when the old track ends (page clock) and the
  // slot taking over, to measure how well the two lined up.
  const handoff = useRef<{ oldEnd: number; to: SlotIndex } | null>(null)

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
        // A handoff has its crossfade scheduled; anything else plays at once.
        if (handoff.current?.to !== standby) resetElementFade(element)
        // A skip (not a handoff) starts the preloaded track from the top.
        // Only seek when needed: a seek flushes the decoder, which delays
        // the start and so adds a gap at a handoff.
        if (element.paused && element.currentTime > 0) element.currentTime = 0
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

    const element = slotRefs[current].current
    if (element) resetElementFade(element)
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
        const rate = element.playbackRate || 1
        const left = (element.duration - element.currentTime) / rate
        handoff.current = {
          oldEnd: performance.now() + left * 1000,
          to: other(index),
        }
        const nextElement = slotRefs[other(index)].current
        if (nextElement) {
          crossfadeElements(element, nextElement, left, CROSSFADE_SECONDS)
        }
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
    const previous = slotRefs[other(index)].current
    const element = slotRefs[index].current

    if (handoff.current?.to === index && element) {
      const { oldEnd } = handoff.current
      handoff.current = null
      // Measure once playback has settled, then correct the lead.
      setTimeout(async () => {
        const newStart = await measureStart(element)
        if (newStart === null) return
        const gap = (newStart - oldEnd) / 1000
        // Larger means a pause, seek or stall got in the way.
        if (Math.abs(gap) < 0.4) correctLead(gap + TARGET_OVERLAP_SECONDS)
      }, 800)
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
