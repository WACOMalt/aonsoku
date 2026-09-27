import { redirect } from 'react-router-dom'
import { ROUTES } from '@/routes/routesList'
import { subsonic } from '@/service/subsonic'
import { useAppStore } from '@/store/app.store'
import { requestJamJoin } from '@/utils/jamLinks'

/**
 * If the URL is a Jam invite, remember it so the join prompt appears right
 * after login. The pending invite is persisted, so it survives the redirect.
 */
function savePendingJamSessionId() {
  requestJamJoin(window.location.href)
}

export async function protectedLoader() {
  const { url, password, isServerConfigured } = useAppStore.getState().data
  const hasNoUrl = !url || url === ''
  const hasNoToken = !password || password === ''

  if (hasNoUrl || hasNoToken || !isServerConfigured) {
    // Save pending jam session ID before redirecting to login
    savePendingJamSessionId()
    return redirect(ROUTES.SERVER_CONFIG)
  }

  const isServerUp = await subsonic.ping.pingView()
  if (!isServerUp) return redirect(ROUTES.SERVER_CONFIG)

  return null
}

export async function podcastsLoader() {
  const { active } = useAppStore.getState().podcasts

  if (!active) {
    return redirect(ROUTES.LIBRARY.HOME)
  }

  return null
}
