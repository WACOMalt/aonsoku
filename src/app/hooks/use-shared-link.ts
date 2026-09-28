import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useShareLinkStore } from '@/store/share-link.store'
import { sharedItemPath } from '@/utils/shareLinks'

/**
 * Opens a shared item that arrived as an app link, or before the listener
 * signed in. Mounted in the signed-in layout, so it waits for login.
 */
export function useSharedLinkOpener() {
  const pending = useShareLinkStore((state) => state.pending)
  const navigate = useNavigate()

  useEffect(() => {
    if (!pending) return
    useShareLinkStore.getState().setPending(null)
    navigate(sharedItemPath(pending))
  }, [pending, navigate])
}
