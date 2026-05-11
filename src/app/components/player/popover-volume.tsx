import { ReactNode } from 'react'
import { VolumeIcon } from '@/app/components/icons/volume-icon'
import { Button } from '@/app/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/app/components/ui/popover'
import { usePlayerVolume } from '@/store/player.store'
import { MuteButton, VolumeSlider } from './volume'

interface PopoverVolumeProps {
  children: ReactNode
  vertical?: boolean
}

export function PopoverVolume({
  children,
  vertical = false,
}: PopoverVolumeProps) {
  const { volume } = usePlayerVolume()

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          className="rounded-full w-10 h-10 p-2 text-secondary-foreground data-[state=open]:bg-accent"
        >
          {children}
        </Button>
      </PopoverTrigger>
      {vertical ? (
        <PopoverContent
          className="w-10 px-0 py-2 flex flex-col items-center gap-1 rounded-full"
          side="top"
          align="center"
        >
          <VolumeSlider orientation="vertical" className="h-24" />
          <MuteButton className="w-7 h-7 p-1">
            <div className="text-secondary-foreground">
              <VolumeIcon volume={volume} size={14} />
            </div>
          </MuteButton>
        </PopoverContent>
      ) : (
        <PopoverContent
          className="w-fit h-10 px-4 py-0 flex items-center rounded-full"
          side="left"
          align="center"
        >
          <VolumeSlider className="w-24" />
        </PopoverContent>
      )}
    </Popover>
  )
}
