import { ArrowLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/app/components/ui/breadcrumb'
import { Button } from '@/app/components/ui/button'
import { useIsMobile } from '@/app/hooks/use-mobile'
import { useAppSettings } from '@/store/app.store'

interface SettingsBreadcrumbProps {
  onBack?: () => void
}

export function SettingsBreadcrumb({ onBack }: SettingsBreadcrumbProps) {
  const { t } = useTranslation()
  const { currentPage } = useAppSettings()
  const isMobile = useIsMobile()

  return (
    <header className="flex h-14 md:h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12 border-b md:border-b-0">
      <div className="flex items-center gap-2 px-4">
        {isMobile && onBack && (
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={onBack}
          >
            <ArrowLeft className="size-4" />
          </Button>
        )}
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem className="hidden md:block">
              {t('settings.label')}
            </BreadcrumbItem>
            <BreadcrumbSeparator className="hidden md:block" />
            <BreadcrumbItem>
              <BreadcrumbPage>
                {t(`settings.options.${currentPage}`)}
              </BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </div>
    </header>
  )
}
