import { io, Socket } from 'socket.io-client'
import { useJamStore } from '@/store/jam.store'
import { useAppStore } from '@/store/app.store'
import { usePlayerStore } from '@/store/player.store'
import { ISong } from '@/types/responses/song'

class JamService {
  private socket: Socket | null = null
  // Uses the same domain as the frontend by default
  private syncServerUrl = window.location.origin 

  connect() {
    const { id: sessionId, isLead } = useJamStore.getState()
    const { username } = useAppStore.getState().data
    const { setConnected, setConnecting, setError, setParticipants } = useJamStore.getState().actions

    if (!sessionId || this.socket?.connected) return

    setConnecting(true)

    this.socket = io(this.syncServerUrl, {
      path: '/jam-sync/socket.io', // Proxy-compatible path
      query: { sessionId, username, isLead: String(isLead) }
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

    this.socket.on('sync_playback', (data: {
      songId: string,
      isPlaying: boolean,
      progress: number,
      timestamp: number,
      queue?: ISong[]
    }) => {
      if (useJamStore.getState().isLead) return 

      this.handleRemoteSync(data)
    })
  }

  emitPlaybackState() {
    if (!this.socket?.connected || !useJamStore.getState().isLead) return

    const { songlist, playerState, playerProgress } = usePlayerStore.getState()
    const currentSong = songlist.currentSong

    if (!currentSong) return

    this.socket.emit('playback_update', {
      songId: currentSong.id,
      isPlaying: playerState.isPlaying,
      progress: playerProgress.progress,
      queue: songlist.currentList, // Sync the full queue
      timestamp: Date.now()
    })
  }

  private handleRemoteSync(data: {
    songId: string,
    isPlaying: boolean,
    progress: number,
    timestamp: number,
    queue?: ISong[]
  }) {
    const { actions, songlist, playerState } = usePlayerStore.getState()
    
    // 1. Sync Queue if provided and different
    if (data.queue && JSON.stringify(data.queue.map(s => s.id)) !== JSON.stringify(songlist.currentList.map(s => s.id))) {
        console.log('[Jam] Syncing shared queue')
        // We find the index of the current song in the new queue
        const newIndex = data.queue.findIndex(s => s.id === data.songId)
        if (newIndex !== -1) {
            // Update the store without triggering an infinite loop
            usePlayerStore.setState(state => {
                state.songlist.currentList = data.queue!
                state.songlist.currentSongIndex = newIndex
                state.songlist.currentSong = data.queue![newIndex]
            })
        }
    }

    // Sync play/pause
    if (playerState.isPlaying !== data.isPlaying) {
        actions.setPlayingState(data.isPlaying)
    }

    // Sync progress if drift is > 2 seconds
    const audio = playerState.audioPlayerRef
    if (audio) {
        const drift = Math.abs(audio.currentTime - data.progress)
        if (drift > 2) {
            audio.currentTime = data.progress
        }
    }
  }

  createSession() {
    const sessionId = Math.random().toString(36).substring(2, 9)
    useJamStore.getState().actions.setSession(sessionId, true)
    this.connect()
    return sessionId
  }

  joinSession(sessionId: string) {
    useJamStore.getState().actions.setSession(sessionId, false)
    this.connect()
  }
}

export const jamService = new JamService()
