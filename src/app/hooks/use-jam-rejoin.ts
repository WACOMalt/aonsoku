import { useEffect } from 'react'
import { jamService } from '@/service/jam'

/**
 * The Jam the listener was in is remembered across reloads, but the socket
 * is not. Reconnect once on startup so they land back in it, or learn it
 * has ended, instead of seeing a Jam with nobody in it.
 */
export function useJamRejoin() {
  useEffect(() => {
    jamService.rejoinPersistedSession()
  }, [])
}
