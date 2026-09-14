/**
 * Checks if the current environment is a Capacitor native app.
 */
export function isCapacitor(): boolean {
  return (
    typeof window !== 'undefined' &&
    !!(window as { Capacitor?: unknown }).Capacitor
  )
}
