import { isDesktop } from '@/utils/desktop'
import { requestJamJoin } from '@/utils/jamLinks'
import { isCapacitor } from '@/utils/platform'
import { requestOpenSharedItem } from '@/utils/shareLinks'

/**
 * Receives links the operating system hands to the app: https links to the
 * web app or aonsoku:// links on Android, and aonsoku:// links on desktop.
 * A Jam invite becomes a pending invite for the join prompt; a shared song,
 * album, artist or playlist opens once the listener is signed in.
 */
function openLink(url: string) {
  if (!requestJamJoin(url)) requestOpenSharedItem(url)
}

export function initDeepLinks() {
  if (isCapacitor()) {
    initAndroidLinks().catch((error) => {
      console.error('[DeepLinks] Could not listen for app links:', error)
    })
  } else if (isDesktop()) {
    initDesktopLinks()
  }
}

async function initAndroidLinks() {
  const { App } = await import('@capacitor/app')
  // Links that arrive while the app is running.
  await App.addListener('appUrlOpen', ({ url }) => openLink(url))
  // The link that launched the app, if any.
  const launch = await App.getLaunchUrl()
  if (launch?.url) openLink(launch.url)
}

function initDesktopLinks() {
  const takePending = () => {
    window.api
      .getPendingDeepLink()
      .then((url) => {
        if (url) openLink(url)
      })
      .catch(() => {})
  }
  // The main process holds each link until the renderer takes it, so one
  // that arrived before this ran (a cold start) is not lost.
  window.api.onDeepLink(takePending)
  takePending()
}
