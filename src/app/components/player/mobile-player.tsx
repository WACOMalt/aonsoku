import clsx from 'clsx'
import {
  AudioLines,
  Heart,
  Pause,
  Play,
  RadioIcon,
  SkipBack,
  SkipForward,
  Speaker,
} from 'lucide-react'
import { TouchEvent, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ImageLoader } from '@/app/components/image-loader'
import { useSwipe } from '@/app/hooks/use-swipe'
import { useAppStore } from '@/store/app.store'
import { useConnectState } from '@/store/connect.store'
import {
  usePlayerActions,
  usePlayerDuration,
  usePlayerFullscreen,
  usePlayerIsPlaying,
  usePlayerLoop,
  usePlayerMediaType,
  usePlayerPrevAndNext,
  usePlayerProgress,
  usePlayerSonglist,
  usePlayerSongStarred,
  useSongColor,
} from '@/store/player.store'
import { LoopState } from '@/types/playerContext'
import { getAverageColor, hexToRgb } from '@/utils/getAverageColor'
import { logger } from '@/utils/logger'

/**
 * A hint of the album color mixed into the theme's own surface color, so the
 * card follows the selected theme (light or dark) and the theme's text color
 * stays readable on it.
 */
function cardBackground(hex: string | null) {
  if (!hex || !hexToRgb(hex)) return undefined
  return `color-mix(in srgb, ${hex} 30%, hsl(var(--accent)))`
}

/**
 * The phone player: a floating card above the tab bar with the artwork,
 * title, a like button, previous, play/pause and next. Tap it to open the
 * full player, swipe it sideways to change track. Everything else lives in
 * the full player.
 */
export function MobilePlayer() {
  const { t } = useTranslation()
  const hideFavoritesSection = useAppStore().pages.hideFavoritesSection
  const { currentList, currentSongIndex, radioList, podcastList } =
    usePlayerSonglist()
  const { isSong, isRadio, isPodcast } = usePlayerMediaType()
  const isPlaying = usePlayerIsPlaying()
  const loopState = usePlayerLoop()
  const { hasPrev, hasNext } = usePlayerPrevAndNext()
  const progress = usePlayerProgress()
  const duration = usePlayerDuration()
  const isStarred = usePlayerSongStarred()
  const { setIsFullscreen } = usePlayerFullscreen()
  const { currentSongColor, setCurrentSongColor } = useSongColor()
  const { togglePlayPause, playNextSong, playPrevSong, starCurrentSong } =
    usePlayerActions()
  const { isConnected, isActivePlayer, devices } = useConnectState()

  const song = isSong ? currentList[currentSongIndex] : undefined
  const radio = isRadio ? radioList[currentSongIndex] : undefined
  const podcast = isPodcast ? podcastList[currentSongIndex] : undefined
  const hasMedia = Boolean(song || radio || podcast)

  const progressPercent = duration > 0 ? (progress / duration) * 100 : 0
  const canGoNext = hasNext || loopState === LoopState.All

  // Another of the listener's devices is playing (Connect).
  const playingOn =
    isConnected && !isActivePlayer
      ? devices.find((device) => device.isActivePlayer)?.name
      : undefined

  const background = useMemo(
    () => (song ? cardBackground(currentSongColor) : undefined),
    [song, currentSongColor],
  )

  const handleImageLoad = useCallback(
    async (event: React.SyntheticEvent<HTMLImageElement>) => {
      try {
        const color = (await getAverageColor(event.currentTarget)).hex
        if (color !== currentSongColor) setCurrentSongColor(color)
      } catch {
        logger.error('[MobilePlayer] - Unable to get image average color.')
      }
    },
    [currentSongColor, setCurrentSongColor],
  )

  const swipe = useSwipe({
    onSwipeLeft: () => canGoNext && playNextSong(),
    onSwipeRight: () => hasPrev && playPrevSong(),
    onSwipeUp: () => song && setIsFullscreen(true),
    threshold: 50,
  })
  // Keep the page's own swipe (opening the menu) from seeing this one.
  const touchHandlers = {
    onTouchStart: (event: TouchEvent) => {
      event.stopPropagation()
      swipe.onTouchStart(event)
    },
    onTouchEnd: (event: TouchEvent) => {
      event.stopPropagation()
      swipe.onTouchEnd(event)
    },
  }

  const title = song?.title ?? radio?.name ?? podcast?.title
  const subtitle =
    song?.artist ?? (radio ? 'Radio' : undefined) ?? podcast?.podcast.title

  return (
    <div className="h-full px-2 pb-1.5">
      <div
        {...touchHandlers}
        role="button"
        tabIndex={-1}
        onClick={(event) => {
          if ((event.target as HTMLElement).closest('button')) return
          if (song) setIsFullscreen(true)
        }}
        // bg-accent stays as the fallback where color-mix is unsupported.
        className="relative h-full flex items-center gap-2.5 pl-1.5 pr-1 rounded-lg overflow-hidden shadow-lg cursor-pointer transition-colors duration-500 bg-accent text-foreground"
        style={background ? { backgroundColor: background } : undefined}
        data-testid="mobile-player"
      >
        <div className="size-10 rounded overflow-hidden shrink-0 bg-foreground/10 flex items-center justify-center">
          {song ? (
            <ImageLoader id={song.coverArt} type="song" size={120}>
              {(src) => (
                <img
                  key={song.id}
                  src={src}
                  crossOrigin="anonymous"
                  onLoad={handleImageLoad}
                  className="size-full object-cover"
                  alt={`${song.artist} - ${song.title}`}
                />
              )}
            </ImageLoader>
          ) : radio ? (
            <RadioIcon className="size-5" strokeWidth={1} />
          ) : podcast ? (
            <img
              src={podcast.image_url}
              className="size-full object-cover"
              alt={podcast.title}
            />
          ) : (
            <AudioLines className="size-5" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          {title ? (
            <>
              <p className="text-sm font-semibold truncate leading-tight">
                {title}
              </p>
              {playingOn ? (
                <p className="text-xs text-primary font-medium truncate flex items-center gap-1 mt-0.5">
                  <Speaker className="size-3 shrink-0" />
                  {t('player.playingOn', { device: playingOn })}
                </p>
              ) : (
                <p className="text-xs truncate mt-0.5 text-foreground/70">
                  {subtitle}
                </p>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              {t('player.noSongPlaying')}
            </p>
          )}
        </div>

        {/* A button that cannot do anything right now is left out, not
            greyed out, so the title keeps as much room as possible. */}
        <div className="flex items-center shrink-0">
          {song && !hideFavoritesSection && (
            <button
              type="button"
              onClick={starCurrentSong}
              aria-label={t('player.like')}
              className="size-9 flex items-center justify-center rounded-full"
            >
              <Heart
                className={clsx(
                  'size-5',
                  isStarred && 'text-primary fill-primary',
                )}
              />
            </button>
          )}
          {hasMedia && hasPrev && (
            <button
              type="button"
              onClick={playPrevSong}
              aria-label={t('player.tooltips.previous')}
              className="size-9 flex items-center justify-center rounded-full"
            >
              <SkipBack className="size-5 fill-current" />
            </button>
          )}
          {hasMedia && (
            <button
              type="button"
              onClick={togglePlayPause}
              aria-label={
                isPlaying
                  ? t('player.tooltips.pause')
                  : t('player.tooltips.play')
              }
              className="size-10 flex items-center justify-center rounded-full"
            >
              {isPlaying ? (
                <Pause className="size-6 fill-current" strokeWidth={0} />
              ) : (
                <Play className="size-6 fill-current" strokeWidth={0} />
              )}
            </button>
          )}
          {hasMedia && canGoNext && (
            <button
              type="button"
              onClick={playNextSong}
              aria-label={t('player.tooltips.next')}
              className="size-9 flex items-center justify-center rounded-full"
            >
              <SkipForward className="size-5 fill-current" />
            </button>
          )}
        </div>

        {(song || podcast) && (
          <div className="absolute left-2 right-2 bottom-0 h-[2px] rounded-full bg-foreground/20 overflow-hidden">
            <div
              className="h-full bg-foreground transition-[width] duration-300"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        )}
      </div>
    </div>
  )
}
