import { useEffect } from 'react'
import { connectService } from '@/service/connect'
import { useAppStore } from '@/store/app.store'

export function useConnect() {
  const username = useAppStore((s) => s.data.username)
  const isServerConfigured = useAppStore((s) => s.data.isServerConfigured)

  useEffect(() => {
    if (username && isServerConfigured) {
      connectService.connect()
    }

    return () => {
      // Don't disconnect on unmount — the connection should persist
      // Only disconnect on explicit logout
    }
  }, [username, isServerConfigured])
}
