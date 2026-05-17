import { useEffect, useLayoutEffect } from 'react'
import { useTheme } from '@/store/theme.store'
import { Theme } from '@/types/themeContext'
import {
  setDesktopTitleBarColors,
  updateCapacitorSystemBars,
  updateMetaThemeColor,
} from '@/utils/theme'

export const appThemes: Theme[] = Object.values(Theme)

export function ThemeObserver() {
  const { theme } = useTheme()

  useLayoutEffect(() => {
    const root = window.document.documentElement

    root.classList.remove(...appThemes)
    root.classList.add(theme)

    setDesktopTitleBarColors()

    // Update <meta name="theme-color"> for all platforms (web, Android, Electron)
    updateMetaThemeColor()
  }, [theme])

  // Update Android system bars (status bar + navigation bar) after CSS is applied.
  // Uses useEffect (not useLayoutEffect) so the DOM has been painted and
  // getComputedStyle returns the correct values for the new theme.
  useEffect(() => {
    updateCapacitorSystemBars()
  }, [theme])

  return null
}
