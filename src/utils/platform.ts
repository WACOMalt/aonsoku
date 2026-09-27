type CapacitorGlobal = {
  isNativePlatform?: () => boolean
  getPlatform?: () => string
}

function getCapacitor(): CapacitorGlobal | undefined {
  if (typeof window === 'undefined') return undefined
  return (window as { Capacitor?: CapacitorGlobal }).Capacitor
}

/**
 * True only inside the native Capacitor shell, i.e. the Android app.
 *
 * `@capacitor/core` installs a `window.Capacitor` global on every platform,
 * including the web build and Electron, where it reports the platform "web".
 * So the global merely existing says nothing; ask it whether it is native.
 */
export function isCapacitor(): boolean {
  return getCapacitor()?.isNativePlatform?.() === true
}

/** The native platform name ("android", "ios"), or null when not native. */
export function getNativePlatform(): string | null {
  if (!isCapacitor()) return null
  return getCapacitor()?.getPlatform?.() ?? null
}
