import { toast } from 'react-toastify'
import i18n from '@/i18n'
import { ROUTES } from '@/routes/routesList'
import { isPassiveConnectDevice } from '@/store/connect.store'
import { usePlayerStore } from '@/store/player.store'
import { isCapacitor } from '@/utils/platform'

type BackHandler = {
  /** Returns true when it handled the press. */
  handle: () => boolean
  /** Higher runs first, e.g. leaving the queue before closing the player. */
  priority: number
}

const handlers = new Set<BackHandler>()

/**
 * Lets an open screen claim the Android back button (the full player, its
 * queue and lyrics views). Returns a function that removes the handler.
 */
export function pushBackHandler(handle: () => boolean, priority = 0) {
  const handler = { handle, priority }
  handlers.add(handler)
  return () => {
    handlers.delete(handler)
  }
}

const EXIT_WINDOW_MS = 2000
const EXIT_TOAST_ID = 'press-back-again'
let lastHomeBackAt = 0

// Radix closes its topmost layer (menu, popover, dialog, sheet) on Escape.
function pressEscape() {
  document.body.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'Escape',
      code: 'Escape',
      bubbles: true,
    }),
  )
}

const OPEN_MENU_SELECTOR =
  '[data-radix-popper-content-wrapper] :is([role="menu"], [role="dialog"], [role="listbox"])'
const OPEN_DIALOG_SELECTOR =
  ':is([role="dialog"], [role="alertdialog"])[data-state="open"]'

function isHome() {
  const path = window.location.hash.replace(/^#/, '').split('?')[0]
  return path === '' || path === ROUTES.LIBRARY.HOME
}

function handleBack() {
  // 1. A menu or popover, even one opened inside the full player.
  if (document.querySelector(OPEN_MENU_SELECTOR)) {
    pressEscape()
    return
  }

  // 2. Screens that know what back means for them.
  const ordered = [...handlers].sort((a, b) => b.priority - a.priority)
  for (const handler of ordered) {
    if (handler.handle()) return
  }

  // 3. Any other dialog, sheet or drawer (settings, the menu, search).
  if (document.querySelector(OPEN_DIALOG_SELECTOR)) {
    pressEscape()
    return
  }

  // 4. Previous page, or home when the app was opened straight onto a page.
  if (!isHome()) {
    lastHomeBackAt = 0
    const historyIndex = (window.history.state as { idx?: number } | null)?.idx
    // The hash router follows the browser history, so this avoids importing
    // the router (whose pages import this module).
    if (historyIndex && historyIndex > 0) {
      window.history.back()
    } else {
      window.location.replace(`#${ROUTES.LIBRARY.HOME}`)
    }
    return
  }

  // 5. Home: a second press shortly after the first leaves the app. While
  //    music plays here it only goes to the background, so it keeps playing.
  const now = Date.now()
  if (now - lastHomeBackAt < EXIT_WINDOW_MS) {
    lastHomeBackAt = 0
    toast.dismiss(EXIT_TOAST_ID)
    leaveApp()
    return
  }
  lastHomeBackAt = now
  toast.info(i18n.t('generic.pressBackAgainToExit'), {
    toastId: EXIT_TOAST_ID,
    autoClose: EXIT_WINDOW_MS,
  })
}

async function leaveApp() {
  const { App } = await import('@capacitor/app')
  const { isPlaying } = usePlayerStore.getState().playerState
  if (isPlaying && !isPassiveConnectDevice()) {
    await App.minimizeApp()
  } else {
    await App.exitApp()
  }
}

/** Takes over the Android back button (no-op elsewhere). */
export function initAndroidBackButton() {
  if (!isCapacitor()) return

  import('@capacitor/app')
    .then(({ App }) => App.addListener('backButton', handleBack))
    .catch((error) => {
      console.error('[BackButton] Could not listen for the back button:', error)
    })
}
