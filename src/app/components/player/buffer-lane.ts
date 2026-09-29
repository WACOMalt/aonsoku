import {
  AudioWorkletNode,
  type IAudioBuffer,
  type IAudioBufferSourceNode,
  type IAudioContext,
  type IGainNode,
} from 'standardized-audio-context'
import {
  getElementSource,
  getSharedAudioContext,
} from '@/app/hooks/use-audio-context'
import { logger } from '@/utils/logger'

/**
 * Sample-accurate gapless playback for desktop and web.
 *
 * Tracks are decoded whole into memory and played on the audio clock, each
 * one scheduled to start on the exact sample where the one before it ends.
 * The first track of a run still plays on an audio element (it starts at
 * once, while decoding would make the listener wait); to join onto it, the
 * element's own output is recorded briefly and matched against the decoded
 * copy of the same track, which gives the audio-clock time of its last
 * sample.
 */

/** Longer tracks are not decoded: a minute of audio takes ~23 MB. */
export const MAX_BUFFER_SECONDS = 600

// Recording of the element's output to locate it in the decoded track.
const CAPTURE_SECONDS = 0.2
// How far the element may be from where its currentTime says.
const SEARCH_SECONDS = 0.5
// Normalised correlation a match needs; the same audio scores ~0.99.
const MIN_MATCH = 0.95
// Below this mean square the recording is too quiet to match.
const MIN_ENERGY = 1e-7

const CAPTURE_PROCESSOR = `
class AonsokuCapture extends AudioWorkletProcessor {
  constructor() {
    super()
    this.wanted = 0
    this.port.onmessage = (event) => {
      this.wanted = event.data.frames
      this.samples = new Float32Array(this.wanted)
      this.filled = 0
      this.startFrame = -1
    }
  }
  process(inputs) {
    const input = inputs[0]
    if (!this.wanted || !input || input.length === 0) return true
    if (this.startFrame < 0) this.startFrame = currentFrame
    const length = input[0].length
    for (let i = 0; i < length && this.filled < this.wanted; i++) {
      let sum = 0
      for (let channel = 0; channel < input.length; channel++) sum += input[channel][i]
      this.samples[this.filled++] = sum / input.length
    }
    if (this.filled >= this.wanted) {
      this.port.postMessage({ startFrame: this.startFrame, samples: this.samples }, [this.samples.buffer])
      this.wanted = 0
    }
    return true
  }
}
registerProcessor('aonsoku-capture', AonsokuCapture)
`

type Decoding = {
  abort: AbortController
  promise: Promise<IAudioBuffer | null>
  /** undefined while decoding; null when it failed or was not attempted. */
  buffer?: IAudioBuffer | null
}

export type Voice = {
  key: string
  buffer: IAudioBuffer
  source: IAudioBufferSourceNode<IAudioContext>
  gain: IGainNode<IAudioContext>
  /** Context time at which the buffer's position 0 plays. */
  origin: number
}

/** Where an element is: at context frame `frame` it plays buffer frame `position`. */
export type ElementClock = { frame: number; position: number }

export class BufferLane {
  readonly context: IAudioContext = getSharedAudioContext()
  private master: IGainNode<IAudioContext>
  private decodings = new Map<string, Decoding>()
  private worklet: Promise<boolean> | null = null

  current: Voice | null = null
  next: Voice | null = null

  constructor() {
    this.master = this.context.createGain()
    this.master.connect(this.context.destination)
  }

  static isSupported() {
    return typeof window !== 'undefined' && 'AudioWorkletNode' in window
  }

  setVolume(volume: number) {
    this.master.gain.setValueAtTime(volume, this.context.currentTime)
  }

  /** Starts downloading and decoding a track, once per key. */
  prepare(key: string, url: string, duration: number) {
    const existing = this.decodings.get(key)
    if (existing) return existing.promise

    const abort = new AbortController()
    const decoding: Decoding = { abort, promise: Promise.resolve(null) }
    if (!duration || duration > MAX_BUFFER_SECONDS) {
      decoding.buffer = null
    } else {
      decoding.promise = fetch(url, { signal: abort.signal })
        .then((response) => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          return response.arrayBuffer()
        })
        .then((data) => this.context.decodeAudioData(data))
        .then((buffer) => {
          decoding.buffer = buffer
          return buffer
        })
        .catch((error) => {
          if (!abort.signal.aborted) {
            logger.info('[Gapless] Could not decode a track', error)
          }
          decoding.buffer = null
          return null
        })
    }
    this.decodings.set(key, decoding)
    return decoding.promise
  }

  /** The decoded track, null if it cannot be, undefined while decoding. */
  buffer(key: string) {
    const decoding = this.decodings.get(key)
    return decoding ? decoding.buffer : null
  }

  isPreparing(key: string) {
    return this.decodings.has(key)
  }

  /** Drops decoded tracks other than these (and those playing). */
  keepOnly(keys: string[]) {
    const keep = new Set(keys)
    if (this.current) keep.add(this.current.key)
    if (this.next) keep.add(this.next.key)
    for (const [key, decoding] of this.decodings) {
      if (keep.has(key)) continue
      decoding.abort.abort()
      this.decodings.delete(key)
    }
  }

  /**
   * Where the element playing this track is on the audio clock, found by
   * recording a moment of its output and matching it against the decoded
   * track. Null when that is not possible (quiet passage, no match).
   */
  async locateElement(
    element: HTMLMediaElement,
    key: string,
  ): Promise<ElementClock | null> {
    const buffer = this.buffer(key)
    const source = getElementSource(element)
    if (!buffer || !source || !AudioWorkletNode) return null
    if (!(await this.loadWorklet())) return null

    const node = new AudioWorkletNode(this.context, 'aonsoku-capture', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    })
    // Kept silent, but connected so the graph processes the node.
    const sink = this.context.createGain()
    sink.gain.value = 0
    source.connect(node)
    node.connect(sink)
    sink.connect(this.context.destination)

    const sampleRate = this.context.sampleRate
    const guess = element.currentTime * sampleRate
    const captured = await new Promise<{
      startFrame: number
      samples: Float32Array
    } | null>((resolve) => {
      const timeout = setTimeout(() => resolve(null), 2000)
      node.port.onmessage = (event) => {
        clearTimeout(timeout)
        resolve(event.data)
      }
      node.port.postMessage({
        frames: Math.round(CAPTURE_SECONDS * sampleRate),
      })
    })

    source.disconnect(node)
    node.disconnect()
    sink.disconnect()
    if (!captured) return null

    const position = locate(captured.samples, buffer, guess)
    if (position === null) return null
    return { frame: captured.startFrame, position }
  }

  /**
   * Plays a decoded track: from `offset` seconds into it, starting at
   * context time `at` (at once if that has passed).
   */
  start(key: string, at: number, offset: number, gain: number): Voice | null {
    const buffer = this.buffer(key)
    if (!buffer) return null
    const source = this.context.createBufferSource()
    source.buffer = buffer
    const gainNode = this.context.createGain()
    gainNode.gain.value = gain
    source.connect(gainNode)
    gainNode.connect(this.master)
    const when = Math.max(at, this.context.currentTime)
    source.start(when, offset)
    source.onended = () => {
      source.disconnect()
      gainNode.disconnect()
    }
    return { key, buffer, source, gain: gainNode, origin: when - offset }
  }

  stop(voice: Voice | null) {
    if (!voice) return
    try {
      voice.source.stop()
    } catch {
      // Never started or already stopped.
    }
  }

  stopAll() {
    this.stop(this.current)
    this.stop(this.next)
    this.current = null
    this.next = null
  }

  /** Seconds into the voice's track. */
  position(voice: Voice) {
    const elapsed = this.context.currentTime - voice.origin
    const { duration } = voice.buffer
    if (voice.source.loop) return ((elapsed % duration) + duration) % duration
    return Math.min(Math.max(elapsed, 0), duration)
  }

  /** Context time at which the voice's track ends. */
  endTime(voice: Voice) {
    return voice.origin + voice.buffer.duration
  }

  /** Repeats the current track, or stops repeating it. */
  setLoop(voice: Voice, loop: boolean) {
    if (voice.source.loop === loop) return
    const { duration } = voice.buffer
    // Count from the start of the lap in progress, so the end is right.
    const laps = Math.floor(
      (this.context.currentTime - voice.origin) / duration,
    )
    if (laps > 0) voice.origin += laps * duration
    voice.source.loop = loop
  }

  private loadWorklet() {
    if (!this.worklet) {
      const url = URL.createObjectURL(
        new Blob([CAPTURE_PROCESSOR], { type: 'text/javascript' }),
      )
      const worklet = this.context.audioWorklet
      this.worklet = worklet
        ? worklet.addModule(url).then(
            () => true,
            (error) => {
              logger.info('[Gapless] Capture worklet unavailable', error)
              return false
            },
          )
        : Promise.resolve(false)
    }
    return this.worklet
  }
}

/**
 * Buffer frame where the captured audio starts, searched near `guess`, or
 * null without a clear match. A coarse search on downsampled audio, then a
 * sample-exact one around its result.
 */
function locate(
  captured: Float32Array,
  buffer: IAudioBuffer,
  guess: number,
): number | null {
  const length = captured.length
  let energy = 0
  for (const sample of captured) energy += sample * sample
  if (energy / length < MIN_ENERGY) return null

  const search = Math.round(SEARCH_SECONDS * buffer.sampleRate)
  const from = Math.max(0, Math.round(guess) - search)
  const to = Math.min(buffer.length - length, Math.round(guess) + search)
  if (to <= from) return null

  const region = mixdown(buffer, from, to + length)
  const step = 8
  const coarseCaptured = decimate(captured, step)
  const coarseRegion = decimate(region, step)
  let best = 0
  let bestScore = -1
  for (let lag = 0; lag + coarseCaptured.length <= coarseRegion.length; lag++) {
    const score = correlation(coarseCaptured, coarseRegion, lag)
    if (score > bestScore) {
      bestScore = score
      best = lag
    }
  }

  let exact = best * step
  let exactScore = -1
  const low = Math.max(0, exact - 2 * step)
  const high = Math.min(region.length - length, exact + 2 * step)
  for (let lag = low; lag <= high; lag++) {
    const score = correlation(captured, region, lag)
    if (score > exactScore) {
      exactScore = score
      exact = lag
    }
  }
  if (exactScore < MIN_MATCH) return null
  return from + exact
}

function mixdown(buffer: IAudioBuffer, from: number, to: number) {
  const out = new Float32Array(to - from)
  const channels = buffer.numberOfChannels
  for (let channel = 0; channel < channels; channel++) {
    const data = buffer.getChannelData(channel)
    for (let i = 0; i < out.length; i++) out[i] += data[from + i] / channels
  }
  return out
}

function decimate(samples: Float32Array, step: number) {
  const out = new Float32Array(Math.floor(samples.length / step))
  for (let i = 0; i < out.length; i++) {
    let sum = 0
    for (let j = 0; j < step; j++) sum += samples[i * step + j]
    out[i] = sum / step
  }
  return out
}

function correlation(a: Float32Array, b: Float32Array, lag: number) {
  let dot = 0
  let energyA = 0
  let energyB = 0
  for (let i = 0; i < a.length; i++) {
    const x = a[i]
    const y = b[lag + i]
    dot += x * y
    energyA += x * x
    energyB += y * y
  }
  return dot / (Math.sqrt(energyA * energyB) + 1e-12)
}
