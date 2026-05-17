import { useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import {
  usePlayerIsPlaying,
  usePlayerMediaType,
  usePlayerSonglist,
} from '@/store/player.store'
import {
  destroyAndroidMediaSession,
  isAndroidCapacitor,
  requestAndroidNotificationPermission,
  setupAndroidMediaSessionListeners,
  updateAndroidMediaSession,
  updateAndroidPlaybackState,
  updateAndroidPodcastMediaSession,
  updateAndroidRadioMediaSession,
} from '@/utils/androidMediaSession'
import { appName } from '@/utils/appName'
import { manageMediaSession } from '@/utils/setMediaSession'

export function MediaSessionObserver() {
  const { t } = useTranslation()
  const isPlaying = usePlayerIsPlaying()
  const { isRadio, isSong, isPodcast } = usePlayerMediaType()
  const { currentList, radioList, currentSongIndex, podcastList } =
    usePlayerSonglist()
  const radioLabel = t('radios.label')
  const androidListenerSetup = useRef(false)

  const song = currentList[currentSongIndex] ?? null
  const radio = radioList[currentSongIndex] ?? null
  const episode = podcastList[currentSongIndex] ?? null

  const hasNothingPlaying =
    currentList.length === 0 &&
    radioList.length === 0 &&
    podcastList.length === 0

  const resetAppTitle = useCallback(() => {
    document.title = appName
  }, [])

  // Proactively request notification permission on Android 13+ at startup
  useEffect(() => {
    if (isAndroidCapacitor()) {
      requestAndroidNotificationPermission()
    }
  }, [])

  // Set up Android native media session listeners once
  useEffect(() => {
    if (isAndroidCapacitor() && !androidListenerSetup.current) {
      androidListenerSetup.current = true
      setupAndroidMediaSessionListeners()
    }
  }, [])

  useEffect(() => {
    const isAndroid = isAndroidCapacitor()

    // Update playback state on both web and Android
    if (!isAndroid) {
      manageMediaSession.setPlaybackState(isPlaying)
    } else {
      updateAndroidPlaybackState(isPlaying ?? false)
    }

    if (hasNothingPlaying) {
      if (!isAndroid) {
        manageMediaSession.removeMediaSession()
      } else {
        destroyAndroidMediaSession()
      }
    }

    if (hasNothingPlaying || !isPlaying) {
      resetAppTitle()
      return
    }

    let title = ''

    if (isRadio && radio) {
      title = `${radioLabel} - ${radio.name}`
      if (!isAndroid) {
        manageMediaSession.setRadioMediaSession(radioLabel, radio.name)
      } else {
        updateAndroidRadioMediaSession(radioLabel, radio.name)
      }
    }
    if (isSong && song) {
      title = `${song.artist} - ${song.title}`
      if (!isAndroid) {
        manageMediaSession.setMediaSession(song)
      } else {
        updateAndroidMediaSession(song)
      }
    }
    if (isPodcast && episode) {
      title = `${episode.title} - ${episode.podcast.title}`
      if (!isAndroid) {
        manageMediaSession.setPodcastMediaSession(episode)
      } else {
        updateAndroidPodcastMediaSession(episode)
      }
    }

    document.title = title
  }, [
    episode,
    hasNothingPlaying,
    isPlaying,
    isPodcast,
    isRadio,
    isSong,
    radio,
    radioLabel,
    song,
    resetAppTitle,
  ])

  return null
}
