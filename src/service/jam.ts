import { io, Socket } from 'socket.io-client'
import { useAppStore } from '@/store/app.store'
import { useJamStore } from '@/store/jam.store'
import { usePlayerStore } from '@/store/player.store'
import { ISong } from '@/types/responses/song'
import { getSyncServerUrl } from '@/utils/syncServerUrl'

class JamService {
  private socket: Socket | null = null
  private initialized = false
  // Suppresses both the drift-correction subscriber AND the emit subscriber
  // while we are applying a remote sync, preventing feedback loops
  private _isSyncing = false

  get isSyncing() {
    return this._isSyncing
  }

  private init() {
    if (this.initialized) return
    this.initialized = true

    // Watch for guest drift: if a non-controlling guest manually changes song, snap them back.
    // Guard with _isSyncing so we don't create a feedback loop when handleRemoteSync itself
    // changes the song.
    usePlayerStore.subscribe(
      (state) => state.songlist.currentSong?.id,
      (currentSongId) => {
        // Never snap back while we are in the middle of applying a remote sync
        if (this._isSyncing) return

        const { isConnected, isLead, canGuestsControl, lastLeadState } =
          useJamStore.getState()
        // Only act for connected guests who don't have control permission
        if (!isConnected || isLead || canGuestsControl) return
        // If there's a known lead state and the guest has drifted to a different song, snap back
        if (
          lastLeadState &&
          currentSongId &&
          currentSongId !== lastLeadState.songId
        ) {
          console.log('[Jam] Guest drifted from lead song — snapping back')
          this.handleRemoteSync(lastLeadState)
        }
      },
    )
  }

  connect() {
    this.init()

    const { id: sessionId, isLead } = useJamStore.getState()
    const { username } = useAppStore.getState().data
    const { setConnected, setConnecting, setError, setParticipants } =
      useJamStore.getState().actions

    if (!sessionId || this.socket?.connected) return

    const syncUrl = getSyncServerUrl()
    if (!syncUrl) {
      setError(
        'No sync server URL configured. In Electron, set it via Settings → Content → Jam / Connect.',
      )
      console.error(
        '[Jam] No sync server URL available. In Electron, configure it via Settings → Content → Jam / Connect.',
      )
      return
    }

    setConnecting(true)

    console.log('[Jam] Connecting to sync server at:', syncUrl)

    this.socket = io(syncUrl, {
      path: '/jam-sync/socket.io', // Proxy-compatible path
      query: { sessionId, username, isLead: String(isLead) },
    })

    this.socket.on('connect', () => {
      setConnected(true)
      setConnecting(false)
      console.log('[Jam] Connected to sync server')
    })

    this.socket.on('connect_error', (err) => {
      setError(err.message)
      setConnecting(false)
    })

    this.socket.on('participants_update', (participants) => {
      setParticipants(participants)
    })

    this.socket.on(
      'sync_playback',
      (data: {
        songId: string
        isPlaying: boolean
        progress: number
        timestamp: number
        queue?: ISong[]
      }) => {
        const { isLead, canGuestsControl } = useJamStore.getState()
        // Lead only syncs from guests when canGuestsControl is enabled
        if (isLead && !canGuestsControl) return

        this.handleRemoteSync(data)
      },
    )

    this.socket.on(
      'guest_control_update',
      ({ canGuestsControl }: { canGuestsControl: boolean }) => {
        useJamStore.getState().actions.setCanGuestsControl(canGuestsControl)
      },
    )

    this.socket.on('session_ended', () => {
      this.socket?.disconnect()
      this.socket = null
      useJamStore.getState().actions.reset()
      // Use a custom event to avoid circular deps with toast
      window.dispatchEvent(new CustomEvent('jam:session_ended'))
    })
  }

  emitPlaybackState() {
    const { isLead, canGuestsControl } = useJamStore.getState()
    if (!this.socket?.connected) return
    if (!isLead && !canGuestsControl) return

    const { songlist, playerState, playerProgress } = usePlayerStore.getState()
    const currentSong = songlist.currentSong

    if (!currentSong) return

    this.socket.emit('playback_update', {
      songId: currentSong.id,
      isPlaying: playerState.isPlaying,
      progress: playerProgress.progress,
      queue: songlist.currentList,
      timestamp: Date.now(),
    })
  }

  disconnect() {
    if (this.socket) {
      this.socket.emit('leave_session')
      this.socket.disconnect()
      this.socket = null
    }
    useJamStore.getState().actions.reset()
  }

  endSession() {
    if (this.socket) {
      this.socket.emit('end_session')
      this.socket.disconnect()
      this.socket = null
    }
    useJamStore.getState().actions.reset()
  }

  setGuestControl(canControl: boolean) {
    if (this.socket?.connected) {
      this.socket.emit('set_guest_control', { canControl })
    }
  }

  private handleRemoteSync(data: {
    songId: string
    isPlaying: boolean
    progress: number
    timestamp: number
    queue?: ISong[]
  }) {
    // Set flag so both the drift-correction subscriber AND the emit subscriber
    // ignore changes we make here, preventing feedback loops
    this._isSyncing = true

    try {
      const { actions, songlist, playerState } = usePlayerStore.getState()

      // Save the lead's last known state so we can re-sync guests who drift
      useJamStore.getState().actions.setLastLeadState({
        songId: data.songId,
        isPlaying: data.isPlaying,
        progress: data.progress,
        timestamp: data.timestamp,
        queue: data.queue,
      })

      // 1. Sync Queue if provided and different
      if (
        data.queue &&
        JSON.stringify(data.queue.map((s: ISong) => s.id)) !==
          JSON.stringify(songlist.currentList.map((s: ISong) => s.id))
      ) {
        console.log('[Jam] Syncing shared queue')
        const newIndex = data.queue.findIndex(
          (s: ISong) => s.id === data.songId,
        )
        if (newIndex !== -1) {
          usePlayerStore.setState(
            (state: ReturnType<typeof usePlayerStore.getState>) => {
              state.songlist.currentList = data.queue!
              state.songlist.currentSongIndex = newIndex
              state.songlist.currentSong = data.queue![newIndex]
            },
          )
        }
      } else if (songlist.currentSong?.id !== data.songId) {
        // Same queue but different song (e.g. host skipped to next/prev track)
        console.log('[Jam] Syncing song change within existing queue')
        const newIndex = songlist.currentList.findIndex(
          (s: ISong) => s.id === data.songId,
        )
        if (newIndex !== -1) {
          usePlayerStore.setState(
            (state: ReturnType<typeof usePlayerStore.getState>) => {
              state.songlist.currentSongIndex = newIndex
              state.songlist.currentSong = state.songlist.currentList[newIndex]
            },
          )
        } else if (data.queue) {
          // Song not found in current list at all — use the provided queue
          const queueIndex = data.queue.findIndex(
            (s: ISong) => s.id === data.songId,
          )
          if (queueIndex !== -1) {
            usePlayerStore.setState(
              (state: ReturnType<typeof usePlayerStore.getState>) => {
                state.songlist.currentList = data.queue!
                state.songlist.currentSongIndex = queueIndex
                state.songlist.currentSong = data.queue![queueIndex]
              },
            )
          }
        }
      }

      // Sync play/pause
      if (playerState.isPlaying !== data.isPlaying) {
        actions.setPlayingState(data.isPlaying)
      }

      // Sync progress if drift exceeds the configurable threshold
      const { syncThreshold } = useJamStore.getState()
      const audio = playerState.audioPlayerRef
      if (audio) {
        const drift = Math.abs(audio.currentTime - data.progress)
        if (drift > syncThreshold) {
          audio.currentTime = data.progress
        }
      }
    } finally {
      // Always clear the flag, even if an error occurs
      // Use a microtask so Zustand's synchronous subscriber fires first
      Promise.resolve().then(() => {
        this._isSyncing = false
      })
    }
  }

  createSession() {
    const sessionId = Math.random().toString(36).substring(2, 9)
    useJamStore.getState().actions.setSession(sessionId, true)
    this.connect()
    return sessionId
  }

  joinSession(sessionId: string) {
    // Handle full invite URLs in both formats:
    //   https://mus.bsums.xyz/#/jam/abc123  (hash router — hash contains the path)
    //   https://mus.bsums.xyz/jam/abc123    (plain path)
    let resolvedId = sessionId.trim()
    try {
      const url = new URL(resolvedId)
      // Hash router: hash is like "#/jam/abc123"
      const hashPath = url.hash.replace(/^#\/?/, '') // strip leading "#" or "#/"
      const hashParts = hashPath.split('/')
      const hashJamIndex = hashParts.indexOf('jam')
      if (hashJamIndex !== -1 && hashParts[hashJamIndex + 1]) {
        resolvedId = hashParts[hashJamIndex + 1]
      } else {
        // Plain path: pathname is like "/jam/abc123"
        const pathParts = url.pathname.split('/')
        const pathJamIndex = pathParts.indexOf('jam')
        if (pathJamIndex !== -1 && pathParts[pathJamIndex + 1]) {
          resolvedId = pathParts[pathJamIndex + 1]
        }
      }
    } catch {
      // Not a URL, use as-is
    }
    useJamStore.getState().actions.setSession(resolvedId, false)
    this.connect()
  }
}

export const jamService = new JamService()
