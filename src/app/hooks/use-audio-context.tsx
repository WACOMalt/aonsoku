import { RefObject, useCallback, useEffect, useRef } from 'react'
import {
  AudioContext,
  type IAudioContext,
  type IGainNode,
  type IMediaElementAudioSourceNode,
} from 'standardized-audio-context'
import { usePlayerMediaType, useReplayGainState } from '@/store/player.store'
import { logger } from '@/utils/logger'
import { ReplayGainParams } from '@/utils/replayGain'

type IAudioSource = IMediaElementAudioSourceNode<IAudioContext>

// One context for every song element. With two elements taking turns
// (gapless), a context per element meant the next track had to start its own
// audio output at the join, which came out as a gap of ~60 ms. A shared one
// is already running, so the next track's samples go straight out.
let sharedContext: IAudioContext | null = null

export function getSharedAudioContext() {
  if (!sharedContext || sharedContext.state === 'closed') {
    // The default (interactive) latency keeps output buffers small; the next
    // track can only start on a buffer boundary, so large ones add jitter.
    sharedContext = new AudioContext()
  }
  return sharedContext
}

// Each song element's fade control (between its source and its gain), so
// the gapless player can crossfade two elements at a join.
const fadeNodes = new WeakMap<HTMLMediaElement, IGainNode<IAudioContext>>()

// An element can only ever get one source node, so it is created once and
// reused; a second createMediaElementSource on it throws.
const sourceNodes = new WeakMap<HTMLMediaElement, IAudioSource>()

function getSourceNode(context: IAudioContext, element: HTMLMediaElement) {
  let node = sourceNodes.get(element)
  if (!node) {
    node = context.createMediaElementSource(element)
    sourceNodes.set(element, node)
  }
  return node
}

/**
 * Crossfade two song elements around `joinAt` (seconds from now): the old
 * one fades out and the new one in over `duration`, both on the audio clock.
 * Does nothing for an element that is not routed through the context.
 */
export function crossfadeElements(
  from: HTMLMediaElement,
  to: HTMLMediaElement,
  joinAt: number,
  duration: number,
) {
  const context = sharedContext
  const fadeOut = fadeNodes.get(from)
  const fadeIn = fadeNodes.get(to)
  if (!context || !fadeOut || !fadeIn) return

  const now = context.currentTime
  const start = now + Math.max(0, joinAt - duration / 2)
  const end = start + duration

  fadeOut.gain.cancelScheduledValues(now)
  fadeOut.gain.setValueAtTime(1, now)
  fadeOut.gain.setValueAtTime(1, start)
  fadeOut.gain.linearRampToValueAtTime(0, end)
  // Ready for its next track, long after this one has ended.
  fadeOut.gain.setValueAtTime(1, end + 1)

  fadeIn.gain.cancelScheduledValues(now)
  fadeIn.gain.setValueAtTime(0, now)
  fadeIn.gain.setValueAtTime(0, start)
  fadeIn.gain.linearRampToValueAtTime(1, end)
}

/** The element's source node, if it is routed through the shared context. */
export function getElementSource(element: HTMLMediaElement) {
  return sourceNodes.get(element)
}

/**
 * Silences the element from context time `at` on: it ends exactly where the
 * next track, scheduled on the same clock, begins.
 */
export function cutElementAt(element: HTMLMediaElement, at: number) {
  const fade = fadeNodes.get(element)
  if (!sharedContext || !fade) return
  fade.gain.cancelScheduledValues(sharedContext.currentTime)
  fade.gain.setValueAtTime(1, sharedContext.currentTime)
  fade.gain.setValueAtTime(0, at)
}

/** Full level at once (a skip, or anything that is not a handoff). */
export function resetElementFade(element: HTMLMediaElement) {
  const fade = fadeNodes.get(element)
  if (!sharedContext || !fade) return
  fade.gain.cancelScheduledValues(sharedContext.currentTime)
  fade.gain.setValueAtTime(1, sharedContext.currentTime)
}

export function useAudioContext(audioRef: RefObject<HTMLAudioElement>) {
  const { isSong } = usePlayerMediaType()
  const { replayGainError, replayGainEnabled } = useReplayGainState()

  const audioContextRef = useRef<IAudioContext | null>(null)
  const sourceNodeRef = useRef<IAudioSource | null>(null)
  const gainNodeRef = useRef<IGainNode<IAudioContext> | null>(null)
  const fadeNodeRef = useRef<IGainNode<IAudioContext> | null>(null)
  const elementRef = useRef<HTMLAudioElement | null>(null)

  const setupAudioContext = useCallback(() => {
    // Read the element now: at render time it may not exist yet.
    const audio = audioRef.current
    if (!audio || !isSong || replayGainError) return
    elementRef.current = audio

    if (!audioContextRef.current) {
      audioContextRef.current = getSharedAudioContext()
    }

    const audioContext = audioContextRef.current

    if (!sourceNodeRef.current) {
      sourceNodeRef.current = getSourceNode(audioContext, audio)
    }

    if (!gainNodeRef.current) {
      // source -> fade (gapless crossfades) -> gain (ReplayGain) -> output
      fadeNodeRef.current = audioContext.createGain()
      gainNodeRef.current = audioContext.createGain()
      sourceNodeRef.current.connect(fadeNodeRef.current)
      fadeNodeRef.current.connect(gainNodeRef.current)
      gainNodeRef.current.connect(audioContext.destination)
      fadeNodes.set(audio, fadeNodeRef.current)
    }
  }, [audioRef, isSong, replayGainError])

  const resumeContext = useCallback(async () => {
    const audioContext = audioContextRef.current
    if (!audioContext || !isSong) return

    logger.info('AudioContext State', { state: audioContext.state })

    if (audioContext.state === 'suspended') {
      await audioContext.resume()
    }
    if (audioContext.state === 'closed') {
      setupAudioContext()
    }
  }, [isSong, setupAudioContext])

  const setupGain = useCallback(
    (gainValue: number, replayGain?: ReplayGainParams) => {
      setupAudioContext()

      if (!audioContextRef.current || !gainNodeRef.current) {
        return
      }

      if (!gainValue || Number.isNaN(gainValue)) {
        logger.error('Invalid gain value', { gainValue })
        return
      }

      const currentTime = audioContextRef.current.currentTime

      logger.info('Replay Gain Status', {
        enabled: replayGainEnabled,
        gainValue,
        ...replayGain,
      })

      gainNodeRef.current.gain.setValueAtTime(gainValue, currentTime)
    },
    [replayGainEnabled, setupAudioContext],
  )

  const resetRefs = useCallback(() => {
    if (sourceNodeRef.current) {
      sourceNodeRef.current.disconnect()
      sourceNodeRef.current = null
    }
    if (gainNodeRef.current) {
      gainNodeRef.current.disconnect()
      gainNodeRef.current = null
    }
    if (fadeNodeRef.current) {
      fadeNodeRef.current.disconnect()
      fadeNodeRef.current = null
    }
    if (elementRef.current) {
      fadeNodes.delete(elementRef.current)
      elementRef.current = null
    }
    // The context is shared with the other song element; only let go of it.
    audioContextRef.current = null
  }, [])

  useEffect(() => {
    if (replayGainError) resetRefs()
  }, [replayGainError, resetRefs])

  // biome-ignore lint/correctness/useExhaustiveDependencies: clear state after unmount
  useEffect(() => {
    return () => resetRefs()
  }, [])

  return {
    audioContextRef,
    sourceNodeRef,
    gainNodeRef,
    setupAudioContext,
    resumeContext,
    setupGain,
    resetRefs,
  }
}
