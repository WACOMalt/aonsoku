import clsx from 'clsx'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from '@/app/components/ui/drawer'
import { ISidebarItem, libraryItems, SidebarItems } from '@/app/layout/sidebar'
import { useAppStore } from '@/store/app.store'

// The order the phone grid shows them in. Podcasts and radios follow when
// enabled, so they stay reachable without the side menu.
const GRID_ORDER: string[] = [
  SidebarItems.Artists,
  SidebarItems.Albums,
  SidebarItems.Songs,
  SidebarItems.Genres,
  SidebarItems.Favorites,
  SidebarItems.Playlists,
  SidebarItems.Podcasts,
  SidebarItems.Radios,
]

function useVisibleLibraryItems(): ISidebarItem[] {
  const pages = useAppStore().pages
  const isPodcastsActive = useAppStore().podcasts.active

  const hidden: Record<string, boolean> = {
    [SidebarItems.Artists]: pages.hideArtistsSection,
    [SidebarItems.Albums]: pages.hideAlbumsSection,
    [SidebarItems.Songs]: pages.hideSongsSection,
    [SidebarItems.Genres]: pages.hideGenresSection,
    [SidebarItems.Favorites]: pages.hideFavoritesSection,
    [SidebarItems.Playlists]: pages.hidePlaylistsSection,
    [SidebarItems.Podcasts]: !isPodcastsActive,
    [SidebarItems.Radios]: pages.hideRadiosSection,
  }

  return GRID_ORDER.flatMap((id) => {
    const item = libraryItems.find((entry) => entry.id === id)
    return item && !hidden[id] ? [item] : []
  })
}

interface LibrarySheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * The Library tab on phones: a panel that slides up from the tab bar with
 * the library pages as large touch targets. It replaces the side menu there.
 */
export function LibrarySheet({ open, onOpenChange }: LibrarySheetProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const items = useVisibleLibraryItems()

  function openPage(route: string) {
    onOpenChange(false)
    navigate(route)
  }

  // The panel rests on top of the tab bar but slides in from underneath it:
  // the bar (z-45) stays above the panel (z-42) and its backdrop (z-41), so
  // Home, Search and Library remain visible and usable while it is open.
  // Not modal, because a modal drawer would block taps on the tab bar.
  return (
    <>
      <div
        aria-hidden="true"
        onClick={() => onOpenChange(false)}
        className={clsx(
          'fixed inset-x-0 top-0 bottom-[--bottom-nav-height] z-[41] bg-black/60 transition-opacity duration-300',
          open ? 'opacity-100' : 'opacity-0 pointer-events-none',
        )}
      />
      <Drawer
        open={open}
        onOpenChange={onOpenChange}
        shouldScaleBackground={false}
        modal={false}
      >
        <DrawerContent className="inset-x-0 bottom-[--bottom-nav-height] z-[42] pb-4 border-b-0">
          <DrawerTitle className="px-5 pt-4 pb-3 text-xl font-bold">
            {t('sidebar.library')}
          </DrawerTitle>
          <DrawerDescription className="sr-only">
            {t('sidebar.library')}
          </DrawerDescription>

          <div className="grid grid-cols-3 gap-3 px-4">
            {items.map(({ id, title, route, icon: Icon }) => {
              const isActive =
                pathname === route || pathname.startsWith(`${route}/`)

              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => openPage(route)}
                  aria-current={isActive ? 'page' : undefined}
                  className={clsx(
                    'flex flex-col items-center justify-center gap-2 h-24 rounded-xl transition-colors active:scale-95',
                    isActive
                      ? 'bg-primary/15 text-primary'
                      : 'bg-accent/60 text-foreground active:bg-accent',
                  )}
                >
                  <Icon className="size-7" />
                  <span className="text-sm font-medium">{t(title)}</span>
                </button>
              )
            })}
          </div>
        </DrawerContent>
      </Drawer>
    </>
  )
}
