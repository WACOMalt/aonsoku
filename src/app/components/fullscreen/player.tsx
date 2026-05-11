import { CloseFullscreenButton } from './buttons'
import { FullscreenControls } from './controls'
import { LikeButton } from './like-button'
import { FullscreenProgress } from './progress'
import { FullscreenSettings } from './settings'
import { VolumeContainer } from './volume-container'

export function FullscreenPlayer() {
  return (
    <div className="w-full">
      <FullscreenProgress />

      {/* Mobile layout: two rows */}
      <div className="flex flex-col md:hidden gap-1 mt-2">
        <div className="flex justify-center items-center gap-1">
          <FullscreenControls />
        </div>
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-1">
            <CloseFullscreenButton />
            <FullscreenSettings />
          </div>
          <div className="flex items-center gap-1">
            <LikeButton />
            <VolumeContainer />
          </div>
        </div>
      </div>

      {/* Desktop layout: single row */}
      <div className="hidden md:flex items-center justify-between gap-4 mt-5">
        <div className="w-[200px] flex items-center gap-2 justify-start">
          <CloseFullscreenButton />
          <FullscreenSettings />
        </div>

        <div className="flex flex-1 justify-center items-center gap-2">
          <FullscreenControls />
        </div>

        <div className="w-[200px] flex items-center gap-4 justify-end">
          <LikeButton />
          <VolumeContainer />
        </div>
      </div>
    </div>
  )
}
