import { useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { jamService } from '@/service/jam'
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

    // Join the session then redirect to home where the player lives
    jamService.joinSession(sessionId)
    navigate(ROUTES.LIBRARY.HOME, { replace: true })
  }, [sessionId, navigate])

  return null
}
