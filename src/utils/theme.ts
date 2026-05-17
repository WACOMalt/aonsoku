import { Theme } from '@/types/themeContext'
import { isDesktop } from './desktop'
import { hslToHex, hslToHsla, isDarkColor } from './getAverageColor'

const DEFAULT_TITLE_BAR_COLOR = '#ff000000'
const DEFAULT_TITLE_BAR_SYMBOL = '#ffffff'

export function setDesktopTitleBarColors(transparent = false) {
  if (!isDesktop()) return

  let color = DEFAULT_TITLE_BAR_COLOR
  let symbol = DEFAULT_TITLE_BAR_SYMBOL

  const root = window.document.documentElement
  const styles = getComputedStyle(root)

  if (!transparent) {
    symbol = hslToHsla(styles.getPropertyValue('--foreground').trim())
    color = hslToHsla(styles.getPropertyValue('--background').trim())
  }

  const bgColor = hslToHex(styles.getPropertyValue('--background').trim())

  window.api.setTitleBarOverlayColors({
    color,
    symbol,
    bgColor,
  })
}

/**
 * Updates the <meta name="theme-color"> tag with the current theme's
 * background color. Works on all platforms (web, Android, Electron).
 */
export function updateMetaThemeColor() {
  const root = window.document.documentElement
  const styles = getComputedStyle(root)
  const bgHsl = styles.getPropertyValue('--background').trim()

  if (!bgHsl) return

  const hexColor = hslToHex(bgHsl)

  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) {
    meta.setAttribute('content', hexColor)
  }
}

/**
 * Updates the Android status bar color and style via the Capacitor StatusBar plugin.
 * Uses dynamic import() to avoid bundling issues on non-Capacitor platforms.
 */
export async function updateCapacitorStatusBar() {
  // Only run on Capacitor (Android/iOS)
  if (
    typeof window === 'undefined' ||
    !(window as { Capacitor?: unknown }).Capacitor
  ) {
    return
  }

  const root = window.document.documentElement
  const styles = getComputedStyle(root)
  const bgHsl = styles.getPropertyValue('--background').trim()

  if (!bgHsl) {
    console.warn('[StatusBar] No --background CSS variable found')
    return
  }

  const hexColor = hslToHex(bgHsl)
  const dark = isDarkColor(bgHsl)

  console.log(
    `[StatusBar] Setting color=${hexColor}, style=${dark ? 'Dark' : 'Light'}`,
  )

  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar')

    // Set status bar background color
    await StatusBar.setBackgroundColor({ color: hexColor })

    // Set status bar icon style: Light icons on dark backgrounds, Dark icons on light
    await StatusBar.setStyle({
      style: dark ? Style.Dark : Style.Light,
    })

    console.log('[StatusBar] Successfully updated status bar')
  } catch (error) {
    console.error('[StatusBar] Failed to update status bar:', error)
  }
}

export function getValidThemeFromEnv(): Theme | null {
  const { APP_THEME } = window

  if (APP_THEME && Object.values(Theme).includes(APP_THEME as Theme)) {
    return APP_THEME as Theme
  }

  return null
}
