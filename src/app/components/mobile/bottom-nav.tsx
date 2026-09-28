import { Home, Library, Search } from 'lucide-react'
import { useCallback, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { LibrarySheet } from '@/app/components/mobile/library-sheet'
import { ROUTES } from '@/routes/routesList'
import { useAppStore } from '@/store/app.store'

export function MobileBottomNav() {
  const navigate = useNavigate()
  const location = useLocation()
  const [libraryOpen, setLibraryOpen] = useState(false)
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
    setLibraryOpen(true)
  }, [])

  return (
    // Below the floating player card, which sits on top of it.
    <nav className="hidden tabbar:block fixed left-0 right-0 bottom-0 z-40 bg-background/95 backdrop-blur-sm h-[--bottom-nav-height]">
      <div className="flex items-center justify-around h-full">
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
          active={isLibrary || libraryOpen}
          onClick={handleLibrary}
        />
      </div>
      <LibrarySheet open={libraryOpen} onOpenChange={setLibraryOpen} />
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
      <Icon className="size-6" />
      <span className="text-[11px] font-medium">{label}</span>
    </button>
  )
}
