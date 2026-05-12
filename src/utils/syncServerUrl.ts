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
  // If the page was loaded over HTTP(S) from a real host (not localhost),
  // the sync server shares the origin (nginx reverse-proxies /jam-sync/).
  // Capacitor Android uses https://localhost, dev servers use http://localhost:PORT,
  // and neither hosts the sync server.
  const origin = window.location.origin
  const hostname = window.location.hostname
  if (
    (origin.startsWith('http://') || origin.startsWith('https://')) &&
    hostname !== 'localhost' &&
    hostname !== '127.0.0.1'
  ) {
    return origin
  }

  // Fall back to the user-configured sync server URL
  // (Electron / Capacitor / file:// / dev).
  const configured = useJamStore.getState().syncServerUrl
  if (configured) {
    return configured
  }

  // No usable URL — caller should surface an error to the user.
  return null
}
