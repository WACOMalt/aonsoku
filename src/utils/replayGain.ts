import type { ISong } from '@/types/responses/song'

export interface ReplayGainParams {
  gain: number
  peak: number
  preAmp: number
}

// https://wiki.hydrogenaud.io/index.php?title=ReplayGain_1.0_specification&section=19
export function calculateReplayGain({ gain, peak, preAmp }: ReplayGainParams) {
  const baseGain = Math.pow(10, (gain + preAmp) / 20)

  return Math.min(baseGain, 1 / peak)
}

interface ReplayGainSettings {
  type: 'track' | 'album'
  preAmp: number
  defaultGain: number
}

/** The ReplayGain values to apply to a track under the listener's settings. */
export function replayGainParamsFor(
  track: ISong,
  { type, preAmp, defaultGain }: ReplayGainSettings,
): ReplayGainParams {
  if (!track.replayGain) return { gain: defaultGain, peak: 1, preAmp }

  if (type === 'album') {
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
