import clsx from 'clsx'
import {
  AudioLines,
  Pause,
  Play,
  RadioIcon,
  Repeat,
  Shuffle,
  SkipBack,
  SkipForward,
} from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useRef } from 'react'
import { LazyLoadImage } from 'react-lazy-load-image-component'
import { getSongStreamUrl } from '@/api/httpClient'
import { getProxyURL } from '@/api/podcastClient'
import RepeatOne from '@/app/components/icons/repeat-one'
import { ImageLoader } from '@/app/components/image-loader'
import { MiniPlayerButton } from '@/app/components/mini-player/button'
import { RadioInfo } from '@/app/components/player/radio-info'
import { TrackInfo } from '@/app/components/player/track-info'
import { podcasts } from '@/service/podcasts'
import {
  getVolume,
  usePlayerActions,
  usePlayerDuration,
  usePlayerFullscreen,
  usePlayerIsPlaying,
  usePlayerLoop,
  usePlayerMediaType,
  usePlayerPrevAndNext,
  usePlayerProgress,
  usePlayerRef,
  usePlayerShuffle,
  usePlayerSonglist,
  usePlayerStore,
  useReplayGainState,
} from '@/store/player.store'
import { LoopState } from '@/types/playerContext'
import { hasPiPSupport } from '@/utils/browser'
import { logger } from '@/utils/logger'
import { ReplayGainParams } from '@/utils/replayGain'
import { AudioPlayer } from './audio'
import { PlayerClearQueueButton } from './clear-queue-button'
import { ControllerBanner } from './controller-banner'
import { PlayerControls } from './controls'
import { DevicePicker } from './device-picker'
import { PlayerExpandButton } from './expand-button'
import { JamButton } from './jam-button'
import { PlayerLikeButton } from './like-button'
import { PlayerLyricsButton } from './lyrics-button'
import { PodcastInfo } from './podcast-info'
import { PodcastPlaybackRate } from './podcast-playback-rate'
import { PlayerProgress } from './progress'
import { PlayerQueueButton } from './queue-button'
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

export function Player() {
  const audioRef = useRef<HTMLAudioElement>(null)
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
    togglePlayPause,
    playPrevSong,
    playNextSong,
    isPlayingOneSong,
    toggleShuffle,
    toggleLoop,
  } = usePlayerActions()
  const { currentList, currentSongIndex, radioList, podcastList } =
    usePlayerSonglist()
  const isPlaying = usePlayerIsPlaying()
  const { isSong, isRadio, isPodcast } = usePlayerMediaType()
  const loopState = usePlayerLoop()
  const isShuffleActive = usePlayerShuffle()
  const { hasPrev, hasNext } = usePlayerPrevAndNext()
  const audioPlayerRef = usePlayerRef()
  const currentPlaybackRate = usePlayerStore().playerState.currentPlaybackRate
  const { replayGainType, replayGainPreAmp, replayGainDefaultGain } =
    useReplayGainState()
  const progress = usePlayerProgress()
  const currentDuration = usePlayerDuration()
  const { setIsFullscreen } = usePlayerFullscreen()

  const song = currentList[currentSongIndex]
  const radio = radioList[currentSongIndex]
  const podcast = podcastList[currentSongIndex]

  const progressPercent =
    currentDuration > 0 ? (progress / currentDuration) * 100 : 0

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

  const trackReplayGain = useMemo<ReplayGainParams>(() => {
    const preAmp = replayGainPreAmp
    const defaultGain = replayGainDefaultGain

    if (!song || !song.replayGain) {
      return { gain: defaultGain, peak: 1, preAmp }
    }

    if (replayGainType === 'album') {
      let { albumGain = defaultGain, albumPeak = 1 } = song.replayGain

      if (albumGain === 0) {
        albumGain = defaultGain
      }

      return { gain: albumGain, peak: albumPeak, preAmp }
    }

    let { trackGain = defaultGain, trackPeak = 1 } = song.replayGain

    if (trackGain === 0) {
      trackGain = defaultGain
    }
    return { gain: trackGain, peak: trackPeak, preAmp }
  }, [song, replayGainDefaultGain, replayGainPreAmp, replayGainType])

  return (
    <>
      <MemoControllerBanner />
      <footer className="border-t h-[--player-height] w-full fixed bottom-0 left-0 right-0 z-40 bg-background">
        {/* Mobile player - two rows */}
        <div className="flex flex-col md:hidden h-[calc(var(--player-height)-1px)]">
          {/* Progress bar */}
          <div className="h-1 bg-secondary shrink-0">
            <div
              className="h-full bg-primary transition-all duration-300"
              style={{ width: `${progressPercent}%` }}
            />
          </div>

          {/* Row 1: Main controls */}
          {/* biome-ignore lint: mobile-only tap handler, no keyboard needed */}
          <div
            className="flex items-center gap-2 px-3 h-12 shrink-0 cursor-pointer"
            onClick={(e) => {
              if ((e.target as HTMLElement).closest('button')) return
              if (isSong && song) setIsFullscreen(true)
            }}
          >
            {/* Cover art thumbnail */}
            <div className="w-10 h-10 rounded overflow-hidden shrink-0 bg-muted flex items-center justify-center">
              {isSong && song ? (
                <ImageLoader id={song.coverArt} type="song" size={80}>
                  {(src) => (
                    <LazyLoadImage
                      src={src}
                      width="100%"
                      height="100%"
                      className="aspect-square object-cover w-full h-full text-transparent"
                      alt={`${song.artist} - ${song.title}`}
                    />
                  )}
                </ImageLoader>
              ) : isRadio ? (
                <RadioIcon className="w-5 h-5" strokeWidth={1} />
              ) : isPodcast && podcast ? (
                <LazyLoadImage
                  src={podcast.image_url}
                  width="100%"
                  height="100%"
                  className="aspect-square object-cover w-full h-full text-transparent"
                  alt={podcast.title}
                />
              ) : (
                <AudioLines className="w-5 h-5" />
              )}
            </div>

            {/* Title/Artist */}
            <div className="flex-1 min-w-0">
              {isSong && song ? (
                <>
                  <p className="text-sm font-medium truncate">{song.title}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {song.artist}
                  </p>
                </>
              ) : isRadio && radio ? (
                <>
                  <p className="text-sm font-medium truncate">{radio.name}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    Radio
                  </p>
                </>
              ) : isPodcast && podcast ? (
                <>
                  <p className="text-sm font-medium truncate">
                    {podcast.title}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {podcast.podcast.title}
                  </p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">No song playing</p>
              )}
            </div>

            {/* Transport controls */}
            <div
              className="flex items-center gap-0.5"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={playPrevSong}
                disabled={!hasPrev || (!song && !radio && !podcast)}
                className="size-8 flex items-center justify-center rounded-full text-muted-foreground hover:bg-accent disabled:opacity-50"
              >
                <SkipBack className="size-4 fill-current" />
              </button>
              <button
                onClick={togglePlayPause}
                disabled={!song && !radio && !isPodcast}
                className="size-9 flex items-center justify-center rounded-full hover:bg-accent disabled:opacity-50"
              >
                {isPlaying ? (
                  <Pause className="size-5 fill-foreground" />
                ) : (
                  <Play className="size-5 fill-foreground" />
                )}
              </button>
              <button
                onClick={playNextSong}
                disabled={
                  (!hasNext && loopState !== LoopState.All) ||
                  (!song && !radio && !podcast)
                }
                className="size-8 flex items-center justify-center rounded-full text-muted-foreground hover:bg-accent disabled:opacity-50"
              >
                <SkipForward className="size-4 fill-current" />
              </button>
              <div className="[&_button]:!size-7 [&_button]:!p-0 [&_button_svg]:!size-3.5">
                <MemoPlayerVolume
                  audioRef={getAudioRef()}
                  disabled={!song && !radio && !podcast}
                />
              </div>
            </div>
          </div>

          {/* Row 2: Secondary controls - smaller */}
          <div className="flex items-center justify-around px-3 h-8 shrink-0 [&_button]:!size-7 [&_button]:!p-0 [&_button_svg]:!size-3.5">
            {isSong && <MemoPlayerLikeButton disabled={!song} />}
            {isSong && <MemoPlayerQueueButton disabled={!song} />}
            {isSong && <MemoLyricsButton disabled={!song} />}
            <MemoJamButton />
            <MemoDevicePicker />
            {isSong && (
              <button
                disabled={!song || isPlayingOneSong() || !hasNext}
                onClick={toggleShuffle}
                className={clsx(
                  'size-7 flex items-center justify-center rounded-full relative',
                  isShuffleActive ? 'text-primary' : 'text-muted-foreground',
                  (!song || isPlayingOneSong() || !hasNext) && 'opacity-50',
                )}
              >
                <Shuffle className="size-3.5" />
              </button>
            )}
            {isSong && (
              <button
                disabled={!song}
                onClick={toggleLoop}
                className={clsx(
                  'size-7 flex items-center justify-center rounded-full relative',
                  loopState !== LoopState.Off
                    ? 'text-primary'
                    : 'text-muted-foreground',
                  !song && 'opacity-50',
                )}
              >
                {loopState === LoopState.One ? (
                  <RepeatOne className="size-3.5" size={14} />
                ) : (
                  <Repeat className="size-3.5" />
                )}
              </button>
            )}
          </div>
        </div>

        {/* Desktop player layout */}
        <div className="w-full h-full hidden md:grid grid-cols-player gap-2 px-4 items-center">
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
              {isSong && (
                <>
                  <MemoPlayerLikeButton disabled={!song} />
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

        {isSong && song && (
          <AudioPlayer
            replayGain={trackReplayGain}
            src={getSongStreamUrl(song.id)}
            autoPlay={isPlaying}
            audioRef={audioRef}
            loop={loopState === LoopState.One}
            onPlay={() => setPlayingState(true)}
            onPause={() => setPlayingState(false)}
            onLoadedMetadata={setupDuration}
            onTimeUpdate={setupProgress}
            onEnded={handleSongEnded}
            onLoadStart={setupInitialVolume}
            data-testid="player-song-audio"
          />
        )}

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
