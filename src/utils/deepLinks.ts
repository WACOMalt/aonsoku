import { isDesktop } from '@/utils/desktop'
import { requestJamJoin } from '@/utils/jamLinks'
import { isCapacitor } from '@/utils/platform'

/**
 * Receives Jam links the operating system hands to the app: an https invite
 * link or aonsoku://jam/<id> on Android, and aonsoku://jam/<id> on desktop.
 * Each one becomes a pending invite, which the join prompt picks up once the
 * listener is signed in.
 */
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
  await App.addListener('appUrlOpen', ({ url }) => {
    requestJamJoin(url)
  })
  // The link that launched the app, if any.
  const launch = await App.getLaunchUrl()
  if (launch?.url) requestJamJoin(launch.url)
}

function initDesktopLinks() {
  const takePending = () => {
    window.api
      .getPendingDeepLink()
      .then((url) => {
        if (url) requestJamJoin(url)
      })
      .catch(() => {})
  }
  // The main process holds each link until the renderer takes it, so one
  // that arrived before this ran (a cold start) is not lost.
  window.api.onDeepLink(takePending)
  takePending()
}
