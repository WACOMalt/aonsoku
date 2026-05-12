import { useJamStore } from '@/store/jam.store'

/**
 * Returns the URL of the jam-sync WebSocket server.
 *
 * In a **web deployment** the jam-sync-server is reverse-proxied by nginx at
 * the same origin as the Aonsoku frontend, so `window.location.origin` works.
 *
 * In **Electron** (or any non-HTTP origin) the user must configure the URL
 * explicitly via Settings → Content → Jam / Connect because the Navidrome
 * server URL (`data.url`) is a *different* server that does not host the
 * jam-sync endpoint.
 */
export function getSyncServerUrl(): string | null {
  // 1. If the page was loaded over HTTP(S), the sync server shares the origin.
  const origin = window.location.origin
  if (origin.startsWith('http://') || origin.startsWith('https://')) {
    return origin
  }

  // 2. Fall back to the user-configured sync server URL (Electron / file://).
  const configured = useJamStore.getState().syncServerUrl
  if (configured) {
    return configured
  }

  // 3. No usable URL — caller should surface an error to the user.
  return null
}
