import { LayoutGrid, List } from 'lucide-react'
import { ComponentPropsWithoutRef, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { SimpleTooltip } from '@/app/components/ui/simple-tooltip'
import { cn } from '@/lib/utils'
import { PageViewType } from '@/types/serverConfig'

type MainGridProps = ComponentPropsWithoutRef<'div'>

export function MainGrid({ className, ...props }: MainGridProps) {
  return (
    <div
      className={cn(
        'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 2xl:grid-cols-8 gap-4 h-full',
        className,
      )}
      {...props}
    />
  )
}

type MainViewTypeSelectorProps = {
  viewType: PageViewType
  setViewType: (type: PageViewType) => void
}

export function MainViewTypeSelector({
  viewType,
  setViewType,
}: MainViewTypeSelectorProps) {
  const { t } = useTranslation()

  return (
    <div
      role="group"
      aria-label={t('generic.viewMode.label')}
      className="inline-flex h-9 items-center overflow-hidden rounded-md border border-input bg-background"
    >
      <ViewTypeOption
        label={t('generic.viewMode.modes.list')}
        active={viewType === 'table'}
        onClick={() => setViewType('table')}
      >
        <List className="size-4" />
      </ViewTypeOption>

      <ViewTypeOption
        label={`${t('generic.viewMode.modes.poster')} (${t('generic.beta')})`}
        active={viewType === 'grid'}
        onClick={() => setViewType('grid')}
        className="border-l border-input"
      >
        <LayoutGrid className="size-4" />
      </ViewTypeOption>
    </div>
  )
}

type ViewTypeOptionProps = {
  label: string
  active: boolean
  onClick: () => void
  className?: string
  children: ReactNode
}

function ViewTypeOption({
  label,
  active,
  onClick,
  className,
  children,
}: ViewTypeOptionProps) {
  return (
    <SimpleTooltip text={label}>
      <button
        type="button"
        aria-label={label}
        aria-pressed={active}
        onClick={onClick}
        className={cn(
          'inline-flex h-full w-9 items-center justify-center transition-colors',
          'ring-offset-background focus-visible:outline-none focus-visible:ring-2',
          'focus-visible:ring-ring focus-visible:ring-inset',
          active
            ? 'bg-accent text-accent-foreground'
            : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
          className,
        )}
      >
        {children}
      </button>
    </SimpleTooltip>
  )
}
