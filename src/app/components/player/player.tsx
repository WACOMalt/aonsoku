import { memo, useCallback, useEffect, useRef } from 'react'
import { getProxyURL } from '@/api/podcastClient'
import { MiniPlayerButton } from '@/app/components/mini-player/button'
import { RadioInfo } from '@/app/components/player/radio-info'
import { TrackInfo } from '@/app/components/player/track-info'
import { podcasts } from '@/service/podcasts'
import { useAppStore } from '@/store/app.store'
import { useCanOutputAudio } from '@/store/connect.store'
import {
  getVolume,
  useGaplessSettings,
  usePlayerActions,
  usePlayerIsPlaying,
  usePlayerMediaType,
  usePlayerRef,
  usePlayerSonglist,
  usePlayerStore,
} from '@/store/player.store'
import { hasPiPSupport } from '@/utils/browser'
import { logger } from '@/utils/logger'
import { usesNativeSongPlayer } from '@/utils/nativePlayer'
import { AudioPlayer } from './audio'
import { PlayerClearQueueButton } from './clear-queue-button'
import { ControllerBanner } from './controller-banner'
import { PlayerControls } from './controls'
import { DevicePicker } from './device-picker'
import { PlayerExpandButton } from './expand-button'
import { JamButton } from './jam-button'
import { PlayerLikeButton } from './like-button'
import { PlayerLyricsButton } from './lyrics-button'
import { MobilePlayer } from './mobile-player'
import { NativeSongAudio } from './native-song-audio'
import { PodcastInfo } from './podcast-info'
import { PodcastPlaybackRate } from './podcast-playback-rate'
import { PlayerProgress } from './progress'
import { PlayerQueueButton } from './queue-button'
import { SongAudio } from './song-audio'
import { PlayerVolume } from './volume'

const MemoTrackInfo = memo(TrackInfo)
const MemoRadioInfo = memo(RadioInfo)
const MemoPodcastInfo = memo(PodcastInfo)
const MemoPlayerControls = memo(PlayerControls)
const MemoPlayerProgress = memo(PlayerProgress)
const MemoPlayerLikeButton = memo(PlayerLikeButton)
const MemoPlayerQueueButton = memo(PlayerQueueButton)
const MemoPlayerClearQueueButton = memo(PlayerClearQueueButton)
const MemoPlayerVolume = memo(PlayerVolume)
const MemoJamButton = memo(JamButton)
const MemoDevicePicker = memo(DevicePicker)
const MemoControllerBanner = memo(ControllerBanner)
const MemoPlayerExpandButton = memo(PlayerExpandButton)
const MemoPodcastPlaybackRate = memo(PodcastPlaybackRate)
const MemoLyricsButton = memo(PlayerLyricsButton)
const MemoMiniPlayerButton = memo(MiniPlayerButton)
const MemoMobilePlayer = memo(MobilePlayer)

export function Player() {
  const hideFavoritesSection = useAppStore().pages.hideFavoritesSection
  // Points at whichever song element is playing (see SongAudio).
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const radioRef = useRef<HTMLAudioElement>(null)
  const podcastRef = useRef<HTMLAudioElement>(null)
  const {
    setAudioPlayerRef,
    setCurrentDuration,
    setProgress,
    setPlayingState,
    handleSongEnded,
    getCurrentProgress,
    getCurrentPodcastProgress,
  } = usePlayerActions()
  const { currentList, currentSongIndex, radioList, podcastList } =
    usePlayerSonglist()
  const isPlaying = usePlayerIsPlaying()
  const { isSong, isRadio, isPodcast } = usePlayerMediaType()
  const audioPlayerRef = usePlayerRef()
  const currentPlaybackRate = usePlayerStore().playerState.currentPlaybackRate
  const canOutputAudio = useCanOutputAudio()
  const { enabled: gaplessEnabled } = useGaplessSettings()
  // The Android app plays songs natively (see NativeSongAudio).
  const nativeSongs = usesNativeSongPlayer(canOutputAudio, gaplessEnabled)

  const song = currentList[currentSongIndex]
  const radio = radioList[currentSongIndex]
  const podcast = podcastList[currentSongIndex]

  const getAudioRef = useCallback(() => {
    if (isRadio) return radioRef
    if (isPodcast) return podcastRef

    return audioRef
  }, [isPodcast, isRadio])

  // biome-ignore lint/correctness/useExhaustiveDependencies: audioRef needed
  useEffect(() => {
    if (!isSong && !song) return

    if (audioPlayerRef === null && audioRef.current)
      setAudioPlayerRef(audioRef.current)
  }, [audioPlayerRef, audioRef, isSong, setAudioPlayerRef, song])

  useEffect(() => {
    const audio = podcastRef.current
    if (!audio || !isPodcast) return

    audio.playbackRate = currentPlaybackRate
  }, [currentPlaybackRate, isPodcast])

  const setupDuration = useCallback(() => {
    const audio = getAudioRef().current
    if (!audio) return

    const audioDuration = Math.floor(audio.duration)
    const infinityDuration = audioDuration === Infinity

    if (!infinityDuration) {
      setCurrentDuration(audioDuration)
    } else if (isSong && song?.duration) {
      setCurrentDuration(song.duration)
    }

    if (isPodcast && infinityDuration && podcast) {
      setCurrentDuration(podcast.duration)
    }

    if (isPodcast) {
      const podcastProgress = getCurrentPodcastProgress()

      logger.info('[Player] - Resuming episode from:', {
        seconds: podcastProgress,
      })

      setProgress(podcastProgress)
      audio.currentTime = podcastProgress
    } else {
      const progress = getCurrentProgress()
      audio.currentTime = progress
    }
  }, [
    getAudioRef,
    isPodcast,
    isSong,
    song,
    podcast,
    setCurrentDuration,
    getCurrentPodcastProgress,
    setProgress,
    getCurrentProgress,
  ])

  const setupProgress = useCallback(() => {
    const audio = getAudioRef().current
    if (!audio) return

    const currentProgress = Math.floor(audio.currentTime)
    setProgress(currentProgress)
  }, [getAudioRef, setProgress])

  const setupInitialVolume = useCallback(() => {
    const audio = getAudioRef().current
    if (!audio) return

    audio.volume = getVolume() / 100
  }, [getAudioRef])

  const sendFinishProgress = useCallback(() => {
    if (!isPodcast || !podcast) return

    podcasts
      .saveEpisodeProgress(podcast.id, podcast.duration)
      .then(() => {
        logger.info('Complete progress sent:', podcast.duration)
      })
      .catch((error) => {
        logger.error('Error sending complete progress', error)
      })
  }, [isPodcast, podcast])

  return (
    <>
      {/* On phones the player card says where Connect is playing instead. */}
      <div className="compact:hidden">
        <MemoControllerBanner />
      </div>
      <footer className="border-t h-[--player-height] w-full fixed bottom-0 left-0 right-0 z-40 bg-background compact:border-t-0 compact:bg-transparent compact:bottom-[--bottom-nav-height]">
        {/* Phone player: a floating card above the tab bar */}
        <div className="hidden compact:block h-full">
          <MemoMobilePlayer />
        </div>

        {/* Desktop player layout */}
        <div className="w-full h-full hidden md:grid compact:hidden grid-cols-player gap-2 px-4 items-center">
          {/* Track Info */}
          <div className="flex items-center gap-2 w-full">
            {isSong && <MemoTrackInfo song={song} />}
            {isRadio && <MemoRadioInfo radio={radio} />}
            {isPodcast && <MemoPodcastInfo podcast={podcast} />}
          </div>
          {/* Main Controls */}
          <div className="col-span-2 flex flex-col justify-center items-center px-4 gap-1">
            <MemoPlayerControls
              song={song}
              radio={radio}
              podcast={podcast}
              audioRef={getAudioRef()}
            />

            {(isSong || isPodcast) && (
              <MemoPlayerProgress audioRef={getAudioRef()} />
            )}
          </div>
          {/* Remain Controls and Volume */}
          <div className="flex items-center w-full justify-end">
            <div className="flex items-center gap-1">
              {isSong && !hideFavoritesSection && (
                <MemoPlayerLikeButton disabled={!song} />
              )}
              {isSong && (
                <>
                  <MemoLyricsButton disabled={!song} />
                  <MemoPlayerQueueButton disabled={!song} />
                </>
              )}
              {isPodcast && <MemoPodcastPlaybackRate />}
              {(isRadio || isPodcast) && (
                <MemoPlayerClearQueueButton disabled={!radio && !podcast} />
              )}

              <MemoJamButton />
              <MemoDevicePicker />

              <MemoPlayerVolume
                audioRef={getAudioRef()}
                disabled={!song && !radio && !podcast}
              />

              {isSong && <MemoPlayerExpandButton disabled={!song} />}
              {isSong && hasPiPSupport && <MemoMiniPlayerButton />}
            </div>
          </div>
        </div>

        {isSong &&
          song &&
          (nativeSongs ? (
            <NativeSongAudio audioRef={audioRef} />
          ) : (
            <SongAudio audioRef={audioRef} />
          ))}

        {isRadio && radio && (
          <AudioPlayer
            src={radio.streamUrl}
            autoPlay={isPlaying}
            audioRef={radioRef}
            onPlay={() => setPlayingState(true)}
            onPause={() => setPlayingState(false)}
            onLoadStart={setupInitialVolume}
            data-testid="player-radio-audio"
          />
        )}

        {isPodcast && podcast && (
          <AudioPlayer
            src={getProxyURL(podcast.audio_url)}
            autoPlay={isPlaying}
            audioRef={podcastRef}
            preload="auto"
            onPlay={() => setPlayingState(true)}
            onPause={() => setPlayingState(false)}
            onLoadedMetadata={setupDuration}
            onTimeUpdate={setupProgress}
            onEnded={() => {
              sendFinishProgress()
              handleSongEnded()
            }}
            onLoadStart={setupInitialVolume}
            data-testid="player-podcast-audio"
          />
        )}
      </footer>
    </>
  )
}
