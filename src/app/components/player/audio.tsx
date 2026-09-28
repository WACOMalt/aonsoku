import {
  ComponentPropsWithoutRef,
  RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'react-toastify'
import { useAudioContext } from '@/app/hooks/use-audio-context'
import {
  isPassiveConnectDevice,
  useCanOutputAudio,
} from '@/store/connect.store'
import {
  usePlayerActions,
  usePlayerIsPlaying,
  usePlayerMediaType,
  usePlayerVolume,
  useReplayGainActions,
  useReplayGainState,
} from '@/store/player.store'
import { logger } from '@/utils/logger'
import { calculateReplayGain, ReplayGainParams } from '@/utils/replayGain'

type AudioPlayerProps = ComponentPropsWithoutRef<'audio'> & {
  audioRef: RefObject<HTMLAudioElement>
  replayGain?: ReplayGainParams
  /**
   * False for the gapless player's standby slot, which only preloads the
   * next track: it never starts itself and its events are ignored.
   */
  active?: boolean
  /**
   * The browser refused to start this element (it was never started by a
   * tap, as some mobile browsers require). Handled by the caller instead of
   * treating it as a broken song.
   */
  onPlayBlocked?: () => void
}

export function AudioPlayer({
  audioRef,
  replayGain,
  active = true,
  onPlayBlocked,
  ...props
}: AudioPlayerProps) {
  const { t } = useTranslation()
  const [previousGain, setPreviousGain] = useState(1)
  const { replayGainEnabled, replayGainError } = useReplayGainState()
  const { isSong, isRadio, isPodcast } = usePlayerMediaType()
  const { setPlayingState } = usePlayerActions()
  const { setReplayGainEnabled, setReplayGainError } = useReplayGainActions()
  const { volume } = usePlayerVolume()
  const isPlaying = usePlayerIsPlaying()
  // Only one of the listener's devices plays audio (Connect). On the others
  // "playing" mirrors that device, so it must never start this element.
  const canOutputAudio = useCanOutputAudio()
  const shouldPlay = isPlaying && canOutputAudio
  // Read through a ref so a new callback each render does not re-run the
  // play/pause effect.
  const onPlayBlockedRef = useRef(onPlayBlocked)
  onPlayBlockedRef.current = onPlayBlocked

  const gainValue = useMemo(() => {
    const audioVolume = volume / 100

    if (!replayGain || !replayGainEnabled) {
      return audioVolume * 1
    }
    const gain = calculateReplayGain(replayGain)

    return audioVolume * gain
  }, [replayGain, replayGainEnabled, volume])

  const { resumeContext, setupGain } = useAudioContext(audioRef.current)

  const ignoreGain = !isSong || replayGainError

  useEffect(() => {
    if (ignoreGain || !audioRef.current) return

    if (gainValue === previousGain) return

    setupGain(gainValue, replayGain)
    setPreviousGain(gainValue)
  }, [audioRef, ignoreGain, gainValue, previousGain, replayGain, setupGain])

  const handleSongError = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return

    logger.error('Audio load error', {
      src: audio.src,
      networkState: audio.networkState,
      readyState: audio.readyState,
      error: audio.error,
    })

    toast.error(t('warnings.songError'))

    if (replayGainEnabled || !replayGainError) {
      setReplayGainEnabled(false)
      setReplayGainError(true)
      window.location.reload()
    }
  }, [
    audioRef,
    replayGainEnabled,
    replayGainError,
    setReplayGainEnabled,
    setReplayGainError,
    t,
  ])

  const handleRadioError = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return

    toast.error(t('radios.error'))
    setPlayingState(false)
  }, [audioRef, setPlayingState, t])

  useEffect(() => {
    async function handleSong() {
      const audio = audioRef.current
      if (!audio || !active) return

      try {
        if (shouldPlay) {
          if (isSong) await resumeContext()
          await audio.play()
        } else {
          audio.pause()
        }
      } catch (error) {
        // A newer load or pause replaced this play request (quick skips, or
        // the gapless player swapping tracks). The song itself is fine.
        if (error instanceof DOMException && error.name === 'AbortError') {
          return
        }
        const blocked = onPlayBlockedRef.current
        if (
          blocked &&
          error instanceof DOMException &&
          error.name === 'NotAllowedError'
        ) {
          blocked()
          return
        }
        logger.error('Audio playback failed', error)
        handleSongError()
      }
    }
    if (isSong || isPodcast) handleSong()
  }, [
    audioRef,
    active,
    handleSongError,
    shouldPlay,
    isSong,
    isPodcast,
    resumeContext,
  ])

  useEffect(() => {
    async function handleRadio() {
      const audio = audioRef.current
      if (!audio) return

      if (shouldPlay) {
        audio.load()
        await audio.play()
      } else {
        audio.pause()
      }
    }
    if (isRadio) handleRadio()
  }, [audioRef, shouldPlay, isRadio])

  const handleError = useMemo(() => {
    if (isSong) return handleSongError
    if (isRadio) return handleRadioError

    return undefined
  }, [handleRadioError, handleSongError, isRadio, isSong])

  const crossOrigin = useMemo(() => {
    if (!isSong || replayGainError) return undefined

    return 'anonymous'
  }, [isSong, replayGainError])

  const { autoPlay, onPlay, onPause, onEnded, ...audioProps } = props

  // On a passive device the element is only paused because another device
  // is playing; that must not read as the listener pausing. A standby slot
  // (gapless preloading) never speaks for the player either.
  const onlyWhenOutputting =
    <E,>(handler?: (event: E) => void) =>
    (event: E) => {
      if (active && !isPassiveConnectDevice()) handler?.(event)
    }

  return (
    <audio
      ref={audioRef}
      {...audioProps}
      autoPlay={active && autoPlay && canOutputAudio}
      onPlay={onlyWhenOutputting(onPlay)}
      onPause={onlyWhenOutputting(onPause)}
      onEnded={onlyWhenOutputting(onEnded)}
      crossOrigin={crossOrigin}
      // A preload that fails is retried when its track actually plays.
      onError={active ? handleError : undefined}
    />
  )
}
