/**
 * Android native MediaSession bridge via Capacitor plugin.
 *
 * This module communicates with the custom MediaSessionPlugin.java
 * to show Android media notifications, handle bluetooth media keys,
 * and keep audio playing when the app is backgrounded via a foreground service.
 *
 * The Web MediaSession API (navigator.mediaSession) does NOT work in
 * Android WebView, so this native bridge is required for Android builds.
 *
 * IMPORTANT: The plugin is registered synchronously at module load time
 * to avoid race conditions from multiple async registrations and to
 * prevent the Capacitor proxy's .then() trap from being triggered by await.
 */

import { registerPlugin } from '@capacitor/core'
import { getSimpleCoverArtUrl } from '@/api/httpClient'
import type { EpisodeWithPodcast } from '@/types/responses/podcasts'
import type { ISong } from '@/types/responses/song'

/**
 * Checks if the current environment is a Capacitor native app on Android.
 */
function isCapacitor(): boolean {
  return (
    typeof window !== 'undefined' &&
    !!(
      window as { Capacitor?: { getPlatform?: () => string } }
    ).Capacitor?.getPlatform?.() &&
    (
      window as { Capacitor?: { getPlatform?: () => string } }
    ).Capacitor?.getPlatform?.() === 'android'
  )
}

interface MediaSessionPluginInterface {
  requestNotificationPermission(): Promise<void>

  updateMetadata(options: {
    title: string
    artist: string
    album: string
    artworkUrl: string
    duration: number
  }): Promise<void>

  updatePlaybackState(options: {
    isPlaying: boolean
    position: number
    playbackRate: number
  }): Promise<void>

  destroy(): Promise<void>

  addListener(
    event: 'mediaSessionAction',
    callback: (data: { action: string; position?: number }) => void,
  ): Promise<{ remove: () => void }>
}

// Register plugin ONCE at module load time (synchronous, no await).
// This avoids the race condition from multiple async getPlugin() calls
// and prevents the .then() proxy trap issue when awaiting the plugin.
let MediaSession: MediaSessionPluginInterface | null = null
if (isCapacitor()) {
  try {
    MediaSession = registerPlugin<MediaSessionPluginInterface>('MediaSession')
  } catch (e) {
    console.error('[AndroidMediaSession] Failed to register plugin:', e)
  }
}

let listenerRemover: { remove: () => void } | null = null

/**
 * Proactively requests the POST_NOTIFICATIONS permission on Android 13+.
 * Should be called at app startup so the user sees the permission dialog
 * immediately (like Spotify), rather than waiting until the first song plays.
 */
export async function requestAndroidNotificationPermission(): Promise<void> {
  if (!MediaSession) return
  try {
    await MediaSession.requestNotificationPermission()
  } catch (error) {
    console.error('[AndroidMediaSession] requestPermission error:', error)
  }
}

/**
 * Updates the Android media notification with song metadata.
 */
export async function updateAndroidMediaSession(song: ISong): Promise<void> {
  if (!MediaSession) return

  const artworkUrl = song.coverArt
    ? getSimpleCoverArtUrl(song.coverArt, 'song', '512')
    : ''

  try {
    await MediaSession.updateMetadata({
      title: song.title,
      artist: song.artist,
      album: song.album,
      artworkUrl,
      duration: song.duration,
    })
  } catch (error) {
    console.error('[AndroidMediaSession] Failed to update metadata:', error)
  }
}

/**
 * Updates the Android media notification with podcast episode metadata.
 */
export async function updateAndroidPodcastMediaSession(
  episode: EpisodeWithPodcast,
): Promise<void> {
  if (!MediaSession) return

  try {
    await MediaSession.updateMetadata({
      title: episode.title,
      artist: episode.podcast.author || '',
      album: episode.podcast.title,
      artworkUrl: episode.image_url || '',
      duration: 0,
    })
  } catch (error) {
    console.error(
      '[AndroidMediaSession] Failed to update podcast metadata:',
      error,
    )
  }
}

/**
 * Updates the Android media notification with radio metadata.
 */
export async function updateAndroidRadioMediaSession(
  label: string,
  radioName: string,
): Promise<void> {
  if (!MediaSession) return

  try {
    await MediaSession.updateMetadata({
      title: radioName,
      artist: label,
      album: '',
      artworkUrl: '',
      duration: 0,
    })
  } catch (error) {
    console.error(
      '[AndroidMediaSession] Failed to update radio metadata:',
      error,
    )
  }
}

/**
 * Updates the playback state (playing/paused) on the Android notification.
 */
export async function updateAndroidPlaybackState(
  isPlaying: boolean,
): Promise<void> {
  if (!MediaSession) return

  try {
    await MediaSession.updatePlaybackState({
      isPlaying,
      position: 0,
      playbackRate: 1.0,
    })
  } catch (error) {
    console.error(
      '[AndroidMediaSession] Failed to update playback state:',
      error,
    )
  }
}

/**
 * Destroys the Android media session and stops the foreground service.
 */
export async function destroyAndroidMediaSession(): Promise<void> {
  if (!MediaSession) return

  try {
    await MediaSession.destroy()
  } catch (error) {
    console.error(
      '[AndroidMediaSession] Failed to destroy media session:',
      error,
    )
  }
}

/**
 * Sets up listeners for media button events from the native side.
 * These events come from bluetooth headphones, car headunits,
 * notification buttons, and lock screen controls.
 *
 * Should be called once on app initialization.
 */
export async function setupAndroidMediaSessionListeners(): Promise<void> {
  if (!MediaSession) return

  // Remove any existing listener
  if (listenerRemover) {
    listenerRemover.remove()
    listenerRemover = null
  }

  try {
    // Import player store lazily to avoid circular dependencies
    const { usePlayerStore } = await import('@/store/player.store')

    listenerRemover = await MediaSession.addListener(
      'mediaSessionAction',
      (data) => {
        const state = usePlayerStore.getState()
        const { togglePlayPause, playNextSong, playPrevSong } = state.actions

        console.log('[AndroidMediaSession] Action received:', data.action)

        switch (data.action) {
          case 'play':
          case 'pause':
            togglePlayPause()
            break
          case 'nexttrack':
            playNextSong()
            break
          case 'previoustrack':
            playPrevSong()
            break
          case 'stop':
            // Pause and destroy the session
            state.actions.setPlayingState(false)
            destroyAndroidMediaSession()
            break
          default:
            console.log('[AndroidMediaSession] Unhandled action:', data.action)
        }
      },
    )
  } catch (error) {
    console.error('[AndroidMediaSession] Failed to setup listeners:', error)
  }
}

/**
 * Checks if the current environment is a Capacitor native app.
 * Exported for use by the MediaSessionObserver.
 */
export function isAndroidCapacitor(): boolean {
  return isCapacitor()
}
