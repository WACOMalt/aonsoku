import { ReactNode } from 'react'
import { Button } from '@/app/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/app/components/ui/popover'
import { VolumeSlider } from './volume'

interface PopoverVolumeProps {
  children: ReactNode
  vertical?: boolean
}

export function PopoverVolume({
  children,
  vertical = false,
}: PopoverVolumeProps) {
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
          className="w-10 h-28 px-0 py-3 flex items-center justify-center rounded-full"
          side="top"
          align="center"
        >
          <div className="h-full flex items-center justify-center -rotate-90">
            <VolumeSlider className="w-20" />
          </div>
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
