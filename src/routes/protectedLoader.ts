import { redirect } from 'react-router-dom'
import { ROUTES } from '@/routes/routesList'
import { subsonic } from '@/service/subsonic'
import { useAppStore } from '@/store/app.store'
import { requestJamJoin } from '@/utils/jamLinks'
import { requestOpenSharedItem } from '@/utils/shareLinks'

/**
 * If the URL is a Jam invite or a shared item, remember it so it opens right
 * after login instead of being lost to the redirect.
 */
function savePendingLink() {
  const url = window.location.href
  if (!requestJamJoin(url)) requestOpenSharedItem(url)
}

export async function protectedLoader() {
  const { url, password, isServerConfigured } = useAppStore.getState().data
  const hasNoUrl = !url || url === ''
  const hasNoToken = !password || password === ''

  if (hasNoUrl || hasNoToken || !isServerConfigured) {
    savePendingLink()
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
