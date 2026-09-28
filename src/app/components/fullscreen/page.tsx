import { memo } from 'react'
import { Drawer, DrawerContent, DrawerTitle } from '@/app/components/ui/drawer'
import { useAppWindow } from '@/app/hooks/use-app-window'
import { usePlayerFullscreen } from '@/store/player.store'
import { FullscreenBackdrop } from './backdrop'
import { FullscreenDragHandler } from './drag-handler'
import { FullscreenPlayer } from './player'
import { SongDetails } from './song-info'
import { FullscreenTabs } from './tabs'

const MemoFullscreenBackdrop = memo(FullscreenBackdrop)

export function FullscreenMode() {
  const { handleDrawerAnimationEnd } = useAppWindow()
  const { isFullscreen, setIsFullscreen } = usePlayerFullscreen()

  return (
    <Drawer
      open={isFullscreen}
      onOpenChange={setIsFullscreen}
      fixed={true}
      handleOnly={true}
      disablePreventScroll={true}
      dismissible={true}
      modal={false}
    >
      <DrawerTitle className="sr-only">Big Player</DrawerTitle>
      <DrawerContent
        onAnimationEnd={handleDrawerAnimationEnd}
        className="h-dvh w-screen rounded-t-none border-none select-none cursor-default mt-0"
        showHandle={false}
        aria-describedby={undefined}
      >
        <MemoFullscreenBackdrop />
        <FullscreenDragHandler />
        {/* Sideways phones (landscape-short) put the two rows side by side:
            tabs and artwork on the left, song details and controls on the
            right, since stacking them needs far more height than there is. */}
        <div className="absolute inset-0 flex flex-col landscape-short:flex-row p-0 2xl:p-8 pt-6 md:pt-10 2xl:pt-12 landscape-short:pt-3 w-full h-full gap-2 md:gap-4 bg-black/0 z-10 overflow-y-auto landscape-short:overflow-hidden">
          {/* First Row */}
          <div className="w-full flex-1 min-h-0 px-3 md:px-8 2xl:px-16 pt-2 md:pt-4 2xl:pt-8 landscape-short:w-[48%] landscape-short:flex-none landscape-short:h-full landscape-short:px-4 landscape-short:pt-0 landscape-short:pb-3">
            <div className="min-h-[200px] md:min-h-[300px] landscape-short:min-h-0 h-full max-h-full">
              <FullscreenTabs />
            </div>
          </div>

          {/* Second Row */}
          <div className="shrink-0 px-3 md:px-8 2xl:px-16 py-2 pb-4 md:pb-2 landscape-short:flex-1 landscape-short:min-w-0 landscape-short:flex landscape-short:flex-col landscape-short:justify-center landscape-short:px-4 landscape-short:py-3">
            <SongDetails className="hidden landscape-short:flex mb-2" />
            <div className="flex items-center">
              <FullscreenPlayer />
            </div>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  )
}
