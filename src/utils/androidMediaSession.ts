/**
 * Android native MediaSession bridge via Capacitor plugin.
 *
 * This module communicates with the custom MediaSessionPlugin.java
 * to show Android media notifications, handle bluetooth media keys,
 * and keep audio playing when the app is backgrounded via a foreground service.
 *
 * The Web MediaSession API (navigator.mediaSession) does NOT work in
 * Android WebView, so this native bridge is required for Android builds.
 */

import { getSimpleCoverArtUrl } from '@/api/httpClient'
import { usePlayerStore } from '@/store/player.store'
import { EpisodeWithPodcast } from '@/types/responses/podcasts'
import { ISong } from '@/types/responses/song'

/**
 * Checks if the current environment is a Capacitor native app.
 */
function isCapacitor(): boolean {
  return (
    typeof window !== 'undefined' &&
    !!(window as { Capacitor?: unknown }).Capacitor
  )
}

interface MediaSessionPluginInterface {
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

let pluginInstance: MediaSessionPluginInterface | null = null
let listenerRemover: { remove: () => void } | null = null

/**
 * Lazily initializes and returns the MediaSession Capacitor plugin.
 */
async function getPlugin(): Promise<MediaSessionPluginInterface | null> {
  if (!isCapacitor()) return null

  if (pluginInstance) return pluginInstance

  try {
    const { registerPlugin } = await import('@capacitor/core')
    pluginInstance = registerPlugin<MediaSessionPluginInterface>('MediaSession')
    return pluginInstance
  } catch (error) {
    console.error('[AndroidMediaSession] Failed to load plugin:', error)
    return null
  }
}

/**
 * Updates the Android media notification with song metadata.
 */
export async function updateAndroidMediaSession(song: ISong) {
  const plugin = await getPlugin()
  if (!plugin) return

  const artworkUrl = song.coverArt
    ? getSimpleCoverArtUrl(song.coverArt, 'song', '512')
    : ''

  try {
    await plugin.updateMetadata({
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
) {
  const plugin = await getPlugin()
  if (!plugin) return

  try {
    await plugin.updateMetadata({
      title: episode.title,
      artist: episode.podcast.author || '',
      album: episode.podcast.title,
      artworkUrl: episode.image_url || '',
      duration: 0, // Podcast duration may not be available
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
) {
  const plugin = await getPlugin()
  if (!plugin) return

  try {
    await plugin.updateMetadata({
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
export async function updateAndroidPlaybackState(isPlaying: boolean) {
  const plugin = await getPlugin()
  if (!plugin) return

  try {
    await plugin.updatePlaybackState({
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
export async function destroyAndroidMediaSession() {
  const plugin = await getPlugin()
  if (!plugin) return

  try {
    await plugin.destroy()
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
export async function setupAndroidMediaSessionListeners() {
  const plugin = await getPlugin()
  if (!plugin) return

  // Remove any existing listener
  if (listenerRemover) {
    listenerRemover.remove()
    listenerRemover = null
  }

  try {
    listenerRemover = await plugin.addListener('mediaSessionAction', (data) => {
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
    })
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
