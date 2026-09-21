import { screen } from 'electron'

export const NativeIconVariant = {
  Size16: { size: 16, scaleFactor: 1 },
  Size32: { size: 32, scaleFactor: 2 },
  Size48: { size: 48, scaleFactor: 3 },
  Size256: { size: 256, scaleFactor: 16 },
} as const

export const NativeIconVariants = Object.values(NativeIconVariant)

export function getDisplaysMaxScaleFactor(): number {
  const displays = screen.getAllDisplays()
  const scaleFactors = displays
    .map((display) => display.scaleFactor)
    .filter((scaleFactor) => Number.isFinite(scaleFactor) && scaleFactor > 1.0)
  return Math.max(1.0, ...scaleFactors)
}

export function getVariantForScaleFactor(scaleFactor: number) {
  const match = NativeIconVariants.find((variant) => {
    return variant.scaleFactor >= scaleFactor
  })

  return match ?? NativeIconVariant.Size32
}

/**
 * Linux tray slots are sized by the panel, not by the display scale factor,
 * and commonly land anywhere between 22 and 48 logical pixels. Electron
 * cannot attach several representations to a Linux tray icon, so it gets one
 * bitmap; picking by scale factor alone handed a 16px image to a 22px slot
 * and the upscale looked blurry. Asking for an asset at least as large as the
 * biggest slot we expect keeps the toolkit downscaling, which stays sharp.
 */
const LINUX_TRAY_SLOT_SIZE = 48

export function getLinuxTrayVariant(scaleFactor: number) {
  const target = LINUX_TRAY_SLOT_SIZE * Math.max(1, scaleFactor)

  const match = NativeIconVariants.find((variant) => variant.size >= target)

  return match ?? NativeIconVariant.Size256
}
