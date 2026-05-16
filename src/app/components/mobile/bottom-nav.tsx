import { Home, Library, Search } from 'lucide-react'
import { useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useMainSidebar } from '@/app/components/ui/main-sidebar'
import { ROUTES } from '@/routes/routesList'
import { useAppStore } from '@/store/app.store'

export function MobileBottomNav() {
  const navigate = useNavigate()
  const location = useLocation()
  const { setOpenMobile } = useMainSidebar()
  const setCommandOpen = useAppStore((state) => state.command.setOpen)

  const isHome = location.pathname === '/' || location.pathname === ''
  const isLibrary = location.pathname.startsWith('/library')

  const handleHome = useCallback(() => {
    navigate(ROUTES.LIBRARY.HOME)
  }, [navigate])

  const handleSearch = useCallback(() => {
    setCommandOpen(true)
  }, [setCommandOpen])

  const handleLibrary = useCallback(() => {
    setOpenMobile(true)
  }, [setOpenMobile])

  return (
    <nav className="md:hidden fixed left-0 right-0 z-40 bg-background border-t border-border bottom-[--player-height]">
      <div className="flex items-center justify-around h-12">
        <NavItem
          icon={Home}
          label="Home"
          active={isHome}
          onClick={handleHome}
        />
        <NavItem
          icon={Search}
          label="Search"
          active={false}
          onClick={handleSearch}
        />
        <NavItem
          icon={Library}
          label="Library"
          active={isLibrary}
          onClick={handleLibrary}
        />
      </div>
    </nav>
  )
}

function NavItem({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center justify-center gap-0.5 flex-1 h-full min-h-[44px] ${
        active ? 'text-primary' : 'text-muted-foreground'
      }`}
    >
      <Icon className="size-5" />
      <span className="text-[10px]">{label}</span>
    </button>
  )
}
