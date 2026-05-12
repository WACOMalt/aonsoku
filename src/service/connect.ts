import { io, Socket } from 'socket.io-client'
import { useAppStore } from '@/store/app.store'
import { useConnectStore } from '@/store/connect.store'
import { useJamStore } from '@/store/jam.store'
import { usePlayerStore } from '@/store/player.store'
import { ISong } from '@/types/responses/song'
import { getDeviceName } from '@/utils/deviceId'
import { getSyncServerUrl } from '@/utils/syncServerUrl'

class ConnectService {
  private socket: Socket | null = null
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null
  private _isSyncing = false

  get isSyncing() {
    return this._isSyncing
  }

  connect() {
    const { username } = useAppStore.getState().data
    if (!username || this.socket?.connected) return

    const syncUrl = getSyncServerUrl()
    if (!syncUrl) {
      console.warn(
        '[Connect] No sync server URL available. In Electron, configure it via Settings → Content → Jam / Connect.',
      )
      return
    }

    const {
      setConnected,
      setConnecting,
      setError,
      setDevices,
      setThisDeviceId,
    } = useConnectStore.getState().actions

    setConnecting(true)

    console.log('[Connect] Connecting to sync server at:', syncUrl)

    this.socket = io(syncUrl, {
      path: '/jam-sync/socket.io',
      query: {
        username,
        deviceName: getDeviceName(),
        sessionType: 'private',
      },
    })

    this.socket.on('connect', () => {
      setConnected(true)
      setConnecting(false)
      setThisDeviceId(this.socket!.id!)
      console.log(
        '[Connect] Connected to sync server, device:',
        this.socket!.id,
      )

      // Start heartbeat
      this.startHeartbeat()
    })

    this.socket.on('connect_error', (err) => {
      setError(err.message)
      setConnecting(false)
      console.error('[Connect] Connection error:', err.message)
    })

    this.socket.on('disconnect', () => {
      setConnected(false)
      this.stopHeartbeat()
      console.log('[Connect] Disconnected from sync server')
    })

    this.socket.on('devices_update', (devices) => {
      setDevices(devices)
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
        // Only sync if we're NOT the active player
        const { isActivePlayer } = useConnectStore.getState()
        if (isActivePlayer) return

        this.handleRemoteSync(data)
      },
    )

    this.socket.on('become_active_player', (playbackState) => {
      useConnectStore.getState().actions.setIsActivePlayer(true)
      console.log('[Connect] This device is now the active player')

      if (playbackState) {
        this.handleRemoteSync(playbackState)
        // After syncing, start playing
        const { actions } = usePlayerStore.getState()
        actions.setPlayingState(playbackState.isPlaying)
      }
    })

    this.socket.on(
      'remote_command',
      ({ command, args }: { command: string; args?: unknown }) => {
        // Only the active player executes remote commands
        const { isActivePlayer } = useConnectStore.getState()
        if (!isActivePlayer) return

        this.executeRemoteCommand(command, args)
      },
    )
  }

  disconnect() {
    this.stopHeartbeat()
    if (this.socket) {
      this.socket.disconnect()
      this.socket = null
    }
    useConnectStore.getState().actions.reset()
  }

  emitPlaybackState() {
    if (!this.socket?.connected) return

    const { isActivePlayer } = useConnectStore.getState()
    if (!isActivePlayer) return

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

  transferPlayback(targetDeviceId: string) {
    if (!this.socket?.connected) return
    this.socket.emit('transfer_playback', { targetDeviceId })
  }

  sendRemoteCommand(command: string, args?: unknown) {
    if (!this.socket?.connected) return
    this.socket.emit('remote_command', { command, args })
  }

  getSocket(): Socket | null {
    return this.socket
  }

  private startHeartbeat() {
    this.stopHeartbeat()
    this.heartbeatInterval = setInterval(() => {
      if (this.socket?.connected) {
        this.socket.emit('heartbeat')
      }
    }, 25000) // Every 25 seconds
  }

  private stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = null
    }
  }

  private handleRemoteSync(data: {
    songId: string
    isPlaying: boolean
    progress: number
    timestamp: number
    queue?: ISong[]
  }) {
    this._isSyncing = true

    try {
      const { songlist, playerState } = usePlayerStore.getState()

      // 1. Sync Queue if provided and different
      if (
        data.queue &&
        JSON.stringify(data.queue.map((s: ISong) => s.id)) !==
          JSON.stringify(songlist.currentList.map((s: ISong) => s.id))
      ) {
        console.log('[Connect] Syncing shared queue')
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
        // Same queue but different song
        console.log('[Connect] Syncing song change within existing queue')
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
        usePlayerStore.getState().actions.setPlayingState(data.isPlaying)
      }

      // Sync progress (drift correction)
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

  private executeRemoteCommand(command: string, args?: unknown) {
    const { actions } = usePlayerStore.getState()

    switch (command) {
      case 'play':
        actions.setPlayingState(true)
        break
      case 'pause':
        actions.setPlayingState(false)
        break
      case 'next':
        actions.playNextSong()
        break
      case 'previous':
        actions.playPrevSong()
        break
      case 'seek':
        if (
          args &&
          typeof args === 'object' &&
          'position' in args &&
          typeof (args as { position: number }).position === 'number'
        ) {
          const audio = usePlayerStore.getState().playerState.audioPlayerRef
          if (audio) audio.currentTime = (args as { position: number }).position
        }
        break
    }
  }
}

export const connectService = new ConnectService()
