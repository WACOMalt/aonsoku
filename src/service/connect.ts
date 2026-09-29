import { io, Socket } from 'socket.io-client'
import { useAppStore } from '@/store/app.store'
import { useConnectStore } from '@/store/connect.store'
import { useJamStore } from '@/store/jam.store'
import { usePlayerStore } from '@/store/player.store'
import { ISong } from '@/types/responses/song'
import { getDeviceId, getDeviceName } from '@/utils/deviceId'
import { describeSyncError, getSyncAuth } from '@/utils/syncAuth'
import { getSyncServerUrl } from '@/utils/syncServerUrl'

class ConnectService {
  private socket: Socket | null = null
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null
  private _isSyncing = false
  // See JamService: the queue is only sent when it changes.
  private lastSentQueue: ISong[] | null = null
  // What the active device last reported, as applied here. On a passive
  // device, a local change that differs from it is the listener using this
  // device as a remote.
  private remoteState: {
    songId: string
    isPlaying: boolean
    queue: ISong[]
  } | null = null

  get isSyncing() {
    return this._isSyncing
  }

  connect() {
    const { username } = useAppStore.getState().data
    // One socket at a time; a second call while connecting (e.g. a double
    // mount) would otherwise open another.
    if (!username || this.socket) return

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

    const auth = getSyncAuth()
    if (!auth) return

    setConnecting(true)

    console.log('[Connect] Connecting to sync server at:', syncUrl)

    const socket = io(syncUrl, {
      path: '/jam-sync/socket.io',
      // The server verifies `auth` and uses that identity; `username` is only
      // read by sync servers that predate authentication.
      query: {
        username,
        deviceName: getDeviceName(),
        // Stable across reconnects, so a brief network drop keeps control.
        deviceKey: getDeviceId(),
        sessionType: 'private',
      },
      auth,
    })
    this.socket = socket

    socket.on('connect', () => {
      // A socket that has since been replaced must not touch state.
      if (this.socket !== socket) return
      this.lastSentQueue = null
      setConnected(true)
      setConnecting(false)
      setThisDeviceId(socket.id!)
      console.log('[Connect] Connected to sync server, device:', socket.id)

      // Start heartbeat
      this.startHeartbeat()
    })

    socket.on('connect_error', (err) => {
      // A socket that has since been replaced must not touch state.
      if (this.socket !== socket) return
      setError(describeSyncError(err.message))
      setConnecting(false)
      console.error('[Connect] Connection error:', err.message)
    })

    socket.on('disconnect', () => {
      // A socket that has since been replaced must not touch state.
      if (this.socket !== socket) return
      // A passive device mirrors "playing" without sound. Once disconnected
      // it would be free to output audio, so stop it first.
      if (!useConnectStore.getState().isActivePlayer) {
        this.withSyncing(() =>
          usePlayerStore.getState().actions.setPlayingState(false),
        )
      }
      this.remoteState = null
      setConnected(false)
      this.stopHeartbeat()
      console.log('[Connect] Disconnected from sync server')
    })

    socket.on('devices_update', (devices) => {
      // A socket that has since been replaced must not touch state.
      if (this.socket !== socket) return
      // This device kept playing through a dropped connection (a phone can
      // freeze the page in the background), and control was released while
      // it was away. It is still the one playing, so it takes control back
      // rather than turning into a remote and going quiet.
      const wasPlayingHere =
        useConnectStore.getState().isActivePlayer &&
        usePlayerStore.getState().playerState.isPlaying
      const nobodyActive = !devices.some((device) => device.isActivePlayer)
      if (wasPlayingHere && nobodyActive) {
        setDevices(
          devices.map((device) =>
            device.id === socket.id
              ? { ...device, isActivePlayer: true }
              : device,
          ),
        )
        this.sendClaim()
        return
      }
      setDevices(devices)
      // Just became passive: what is shown now is the baseline that local
      // changes are compared against, until the active device reports.
      if (!useConnectStore.getState().isActivePlayer && !this.remoteState) {
        this.remoteState = this.snapshotLocalState()
      }
    })

    socket.on(
      'sync_playback',
      (data: {
        songId: string
        isPlaying: boolean
        progress: number
        timestamp: number
        queue?: ISong[]
      }) => {
        if (this.socket !== socket) return
        // Only sync if we're NOT the active player
        const { isActivePlayer } = useConnectStore.getState()
        if (isActivePlayer) return

        this.handleRemoteSync(data)
      },
    )

    socket.on('become_active_player', (playbackState) => {
      // A socket that has since been replaced must not touch state.
      if (this.socket !== socket) return
      useConnectStore.getState().actions.setIsActivePlayer(true)
      this.remoteState = null
      console.log('[Connect] This device is now the active player')

      if (playbackState) {
        this.handleRemoteSync(playbackState)
        this.withSyncing(() =>
          usePlayerStore
            .getState()
            .actions.setPlayingState(playbackState.isPlaying),
        )
      }
      // Changes made while syncing are not broadcast; announce the state
      // this device now owns once the flag clears.
      Promise.resolve().then(() => this.emitPlaybackState())
    })

    socket.on(
      'remote_command',
      ({ command, args }: { command: string; args?: unknown }) => {
        if (this.socket !== socket) return
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
    if (!isActivePlayer) {
      this.forwardLocalChange()
      return
    }

    const { songlist, playerState, playerProgress } = usePlayerStore.getState()
    const currentSong = songlist.currentSong
    if (!currentSong) return

    const queueChanged = songlist.currentList !== this.lastSentQueue

    this.socket.emit('playback_update', {
      songId: currentSong.id,
      isPlaying: playerState.isPlaying,
      progress: playerProgress.progress,
      ...(queueChanged ? { queue: songlist.currentList } : {}),
      timestamp: Date.now(),
    })

    if (queueChanged) this.lastSentQueue = songlist.currentList
  }

  transferPlayback(targetDeviceId: string) {
    if (!this.socket?.connected) return
    this.socket.emit('transfer_playback', { targetDeviceId })
  }

  /**
   * Makes this device the one that plays, keeping what it has queued now
   * (used when the listener starts something here and nothing else is
   * playing, and when joining a Jam).
   */
  claimControl() {
    if (!this.socket?.connected) return
    const { isActivePlayer, thisDeviceId } = useConnectStore.getState()
    if (isActivePlayer || !thisDeviceId) return
    this.sendClaim()
  }

  /** Asks the server to make this device the one that plays. */
  private sendClaim() {
    const thisDeviceId = this.socket?.id
    if (!this.socket?.connected || !thisDeviceId) return

    const { songlist, playerState, playerProgress } = usePlayerStore.getState()
    const song = songlist.currentSong
    this.socket.emit('transfer_playback', {
      targetDeviceId: thisDeviceId,
      state: song
        ? {
            songId: song.id,
            isPlaying: playerState.isPlaying,
            progress: playerProgress.progress,
            queue: songlist.currentList,
            timestamp: Date.now(),
          }
        : null,
    })
  }

  /**
   * On a passive device, seeking moves the active device instead.
   * Returns true when the seek was sent there.
   */
  forwardSeek(position: number): boolean {
    if (!this.socket?.connected) return false
    if (useConnectStore.getState().isActivePlayer) return false
    this.sendRemoteCommand('seek', { position })
    return true
  }

  /**
   * The listener changed playback on a passive device (play, pause, a new
   * song or queue). Ask the active device to do it, or take control when
   * nothing is playing anywhere.
   */
  private forwardLocalChange() {
    const { songlist, playerState } = usePlayerStore.getState()
    const song = songlist.currentSong
    if (!song) return

    const hasActiveDevice = useConnectStore
      .getState()
      .devices.some((device) => device.isActivePlayer)
    const remote = this.remoteState

    if (!hasActiveDevice) {
      if (playerState.isPlaying) this.claimControl()
      return
    }
    // Nothing reported yet, so no baseline to tell a change from.
    if (!remote) return

    const songChanged = song.id !== remote.songId
    const queueChanged = songlist.currentList !== remote.queue
    const playChanged = playerState.isPlaying !== remote.isPlaying
    if (!songChanged && !queueChanged && !playChanged) return

    this.remoteState = {
      songId: song.id,
      isPlaying: playerState.isPlaying,
      queue: songlist.currentList,
    }
    this.sendRemoteCommand('set_state', {
      songId: song.id,
      isPlaying: playerState.isPlaying,
      ...(queueChanged ? { queue: songlist.currentList } : {}),
      ...(songChanged ? { progress: 0 } : {}),
      timestamp: Date.now(),
    })
  }

  private snapshotLocalState() {
    const { songlist, playerState } = usePlayerStore.getState()
    return {
      songId: songlist.currentSong?.id ?? '',
      isPlaying: playerState.isPlaying,
      queue: songlist.currentList,
    }
  }

  /** Runs a player-store change without it being broadcast as our own. */
  private withSyncing(change: () => void) {
    this._isSyncing = true
    try {
      change()
    } finally {
      Promise.resolve().then(() => {
        this._isSyncing = false
      })
    }
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
    progress?: number
    timestamp: number
    queue?: ISong[]
  }) {
    this._isSyncing = true

    try {
      const { songlist, playerState } = usePlayerStore.getState()
      const previousSongId = songlist.currentSong?.id

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

      // A new track loads from the stored position, so start it where the
      // sender is rather than where the previous track was.
      if (
        usePlayerStore.getState().songlist.currentSong?.id !== previousSongId
      ) {
        usePlayerStore.setState(
          (state: ReturnType<typeof usePlayerStore.getState>) => {
            state.playerProgress.progress = data.progress ?? 0
          },
        )
      }

      // Sync play/pause
      if (playerState.isPlaying !== data.isPlaying) {
        usePlayerStore.getState().actions.setPlayingState(data.isPlaying)
      }

      // Sync progress (drift correction). A passive device's audio is
      // silent, so it can follow exactly and its progress bar stays smooth.
      const { syncThreshold } = useJamStore.getState()
      const isPassive = !useConnectStore.getState().isActivePlayer
      const audio = playerState.audioPlayerRef
      if (audio && typeof data.progress === 'number') {
        const drift = Math.abs(audio.currentTime - data.progress)
        if (drift > (isPassive ? 0.5 : syncThreshold)) {
          audio.currentTime = data.progress
        }
      }

      if (isPassive) {
        this.remoteState = {
          songId: data.songId,
          isPlaying: data.isPlaying,
          queue: usePlayerStore.getState().songlist.currentList,
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
      case 'set_state':
        // A passive device asked for this (see forwardLocalChange). Apply
        // it, then broadcast so every device, the sender too, follows.
        if (args && typeof args === 'object' && 'songId' in args) {
          this.handleRemoteSync(
            args as Parameters<typeof this.handleRemoteSync>[0],
          )
          Promise.resolve().then(() => this.emitPlaybackState())
        }
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
