import { useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ROUTES } from '@/routes/routesList'
import { requestJamJoin } from '@/utils/jamLinks'

/**
 * Landing route for invite links. Records the invite and moves on; the join
 * prompt in the layout decides what to ask for the listener's current state.
 */
export default function JamJoin() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const navigate = useNavigate()

  useEffect(() => {
    if (sessionId) requestJamJoin(sessionId)
    navigate(ROUTES.LIBRARY.HOME, { replace: true })
  }, [sessionId, navigate])

  return null
}
