import { ComponentPropsWithoutRef } from 'react'
import { cn } from '@/lib/utils'

type ContainerProps = ComponentPropsWithoutRef<'div'>

export function PodcastInfoContainer({
  className,
  children,
  ...rest
}: ContainerProps) {
  return (
    <div
      {...rest}
      className={cn(
        'w-full px-4 md:px-8 py-6 flex flex-col md:flex-row gap-4',
        className,
      )}
    >
      {children}
    </div>
  )
}
