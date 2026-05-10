import { useEffect } from 'react'
import { connectService } from '@/service/connect'
import { useAppStore } from '@/store/app.store'

export function useConnect() {
  const username = useAppStore((s) => s.data.username)

  useEffect(() => {
    if (username) {
      connectService.connect()
    }

    return () => {
      // Don't disconnect on unmount — the connection should persist
      // Only disconnect on explicit logout
    }
  }, [username])
}
