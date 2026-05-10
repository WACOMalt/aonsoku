import { useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useJamStore } from '@/store/jam.store'
import { ROUTES } from '@/routes/routesList'

export default function JamJoin() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const navigate = useNavigate()

  useEffect(() => {
    if (!sessionId) {
      navigate(ROUTES.LIBRARY.HOME, { replace: true })
      return
    }

    // If already in this session, just go home
    const currentId = useJamStore.getState().id
    if (currentId === sessionId) {
      navigate(ROUTES.LIBRARY.HOME, { replace: true })
      return
    }

    // Set the pending session ID — the JamJoinPrompt will show the confirmation dialog
    useJamStore.getState().actions.setPendingJamSessionId(sessionId)
    navigate(ROUTES.LIBRARY.HOME, { replace: true })
  }, [sessionId, navigate])

  return null
}
