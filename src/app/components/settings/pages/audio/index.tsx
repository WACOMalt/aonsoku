import { GaplessConfig } from './gapless'
import { LyricsSettings } from './lyrics'
import { ReplayGainConfig } from './replay-gain'

export function Audio() {
  return (
    <div className="space-y-4">
      <GaplessConfig />
      <ReplayGainConfig />
      <LyricsSettings />
    </div>
  )
}
