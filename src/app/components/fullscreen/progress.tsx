import { useCallback, useState } from 'react'
import { ProgressSlider } from '@/app/components/ui/slider'
import { connectService } from '@/service/connect'
import {
  usePlayerActions,
  usePlayerDuration,
  usePlayerProgress,
  usePlayerRef,
} from '@/store/player.store'
import { convertSecondsToTime } from '@/utils/convertSecondsToTime'

let isSeeking = false

/** `stacked` puts the times under a full-width bar, as on phones. */
export function FullscreenProgress({
  layout = 'inline',
}: {
  layout?: 'inline' | 'stacked'
}) {
  const progress = usePlayerProgress()
  const [localProgress, setLocalProgress] = useState(progress)
  const audioPlayerRef = usePlayerRef()
  const currentDuration = usePlayerDuration()
  const { setProgress } = usePlayerActions()

  const updateAudioCurrentTime = useCallback(
    (value: number) => {
      isSeeking = false
      if (audioPlayerRef) {
        audioPlayerRef.currentTime = value
      }
      connectService.forwardSeek(value)
    },
    [audioPlayerRef],
  )

  const handleSeeking = useCallback((amount: number) => {
    isSeeking = true
    setLocalProgress(amount)
  }, [])

  const handleSeeked = useCallback(
    (amount: number) => {
      updateAudioCurrentTime(amount)
      setProgress(amount)
      setLocalProgress(amount)
    },
    [setProgress, updateAudioCurrentTime],
  )

  const handleSeekedFallback = useCallback(() => {
    if (localProgress !== progress) {
      updateAudioCurrentTime(localProgress)
      setProgress(localProgress)
    }
  }, [localProgress, progress, setProgress, updateAudioCurrentTime])

  const currentTime = convertSecondsToTime(isSeeking ? localProgress : progress)

  const slider = (
    <ProgressSlider
      variant="secondary"
      defaultValue={[0]}
      value={isSeeking ? [localProgress] : [progress]}
      tooltipTransformer={convertSecondsToTime}
      max={currentDuration}
      step={1}
      className="w-full h-4"
      onValueChange={([value]) => handleSeeking(value)}
      onValueCommit={([value]) => handleSeeked(value)}
      onPointerUp={handleSeekedFallback}
      onMouseUp={handleSeekedFallback}
    />
  )

  if (layout === 'stacked') {
    return (
      <div className="flex flex-col gap-1">
        {slider}
        <div className="flex justify-between text-xs text-foreground/70 tabular-nums drop-shadow-lg">
          <span>{currentTime}</span>
          <span>{convertSecondsToTime(currentDuration ?? 0)}</span>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2 md:gap-3">
      <div className="min-w-[40px] md:min-w-[50px] max-w-[50px] md:max-w-[60px] text-right drop-shadow-lg text-xs md:text-sm">
        {currentTime}
      </div>

      {slider}

      <div className="min-w-[40px] md:min-w-[50px] max-w-[50px] md:max-w-[60px] text-left drop-shadow-lg text-xs md:text-sm">
        {convertSecondsToTime(currentDuration ?? 0)}
      </div>
    </div>
  )
}
