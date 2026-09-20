import { isCapacitor } from './platform'

/**
 * The Android app already ships every asset inside the APK, so a precaching
 * service worker adds nothing there and can keep serving files from an older
 * build after the app updates. Register it only on the web, and actively tear
 * down any worker left behind by a previous native build.
 */
export function setupServiceWorker() {
  if (!('serviceWorker' in navigator)) return

  if (isCapacitor()) {
    unregisterServiceWorkers()
    return
  }

  // Registered directly rather than through virtual:pwa-register so the
  // build does not need workbox-window. The generated worker is built with
  // registerType 'autoUpdate', so it claims clients and skips waiting on
  // its own.
  window.addEventListener('load', () => {
    const url = new URL('sw.js', document.baseURI).href
    navigator.serviceWorker.register(url).catch((error) => {
      console.error('[ServiceWorker] Registration failed:', error)
    })
  })
}

async function unregisterServiceWorkers() {
  try {
    const registrations = await navigator.serviceWorker.getRegistrations()
    if (registrations.length === 0) return

    await Promise.all(registrations.map((r) => r.unregister()))

    if ('caches' in window) {
      const keys = await caches.keys()
      await Promise.all(keys.map((key) => caches.delete(key)))
    }

    // The page is still being served by the old worker, so reload once to
    // pick up the assets shipped with the current build.
    window.location.reload()
  } catch (error) {
    console.error('[ServiceWorker] Failed to unregister:', error)
  }
}
