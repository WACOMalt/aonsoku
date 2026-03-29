import { useEffect, useState } from 'react'
import { LazyLoadImage } from 'react-lazy-load-image-component'
import { Actions } from '@/app/components/actions'
import { ImageLoader } from '@/app/components/image-loader'
import { useAlbumColor } from '@/app/hooks/use-album-color'
import { cn } from '@/lib/utils'
import { useIsAlbumPlaying, usePlayerActions } from '@/store/player.store'
import { PlaybackSource } from '@/types/playerContext'
import { SingleAlbum } from '@/types/responses/album'
import { getMainScrollElement } from '@/utils/scrollPageToTop'

interface StickyAlbumHeaderProps {
  album: SingleAlbum
}

export function StickyAlbumHeader({ album }: StickyAlbumHeaderProps) {
  const [opacity, setOpacity] = useState(0)
  const [contentOpacity, setContentOpacity] = useState(0)
  const { bgColor, handleLoadImage, handleError } = useAlbumColor(
    'sticky-cover-art-image',
  )

  const { isAlbumActive, isAlbumPlaying } = useIsAlbumPlaying(album.id)
  const { setSongList, togglePlayPause } = usePlayerActions()

  useEffect(() => {
    const scrollContainer = getMainScrollElement()
    if (!scrollContainer) return

    const handleScroll = (e: Event) => {
      const target = e.target as HTMLElement
      const scrollTop = target.scrollTop

      const startFade = 100
      const endFade = 300

      if (scrollTop <= startFade) {
        setOpacity(0)
        setContentOpacity(0)
      } else if (scrollTop >= endFade) {
        setOpacity(1)
        setContentOpacity(1)
      } else {
        const calculatedOpacity =
          (scrollTop - startFade) / (endFade - startFade)
        setOpacity(calculatedOpacity)
      }
    }

    scrollContainer.addEventListener('scroll', handleScroll, { passive: true })

    handleScroll({ target: scrollContainer } as unknown as Event)

    return () => {
      scrollContainer.removeEventListener('scroll', handleScroll)
    }
  }, [])

  function handlePlayButton() {
    if (isAlbumActive) {
      togglePlayPause()
    } else {
      const playbackSource: PlaybackSource = {
        id: album.id,
        name: album.name,
        type: 'album',
      }
      setSongList(album.song, 0, false, playbackSource)
    }
  }

  const isHidden = opacity === 0

  return (
    <div className="sticky top-0 z-10 h-0 w-full">
      <div
        className={cn(
          'absolute top-0 left-0 w-full h-shadow-header',
          'transition-opacity shadow-sm',
          isHidden && 'pointer-events-none',
        )}
        style={{ opacity, backgroundColor: bgColor }}
      >
        <div className="w-full h-shadow-header bg-background/50">
          <div
            className="flex items-center gap-4 w-full h-shadow-header px-8 transition-opacity duration-500 delay-150"
            style={{ opacity: contentOpacity }}
          >
            <Actions.Button
              buttonStyle="primary"
              onClick={handlePlayButton}
              className="w-10 h-10 min-w-10 min-h-10 shrink-0 p-3 m-0"
            >
              {isAlbumPlaying ? <Actions.PauseIcon /> : <Actions.PlayIcon />}
            </Actions.Button>

            <div className="flex items-center gap-2">
              <ImageLoader id={album.coverArt} type="album" size="80">
                {(src) => (
                  <div className="w-10 h-10 min-w-10 min-h-10 shrink-0 bg-skeleton rounded overflow-hidden shadow-md">
                    {src ? (
                      <LazyLoadImage
                        src={src}
                        alt={album.name}
                        effect="opacity"
                        crossOrigin="anonymous"
                        id="sticky-cover-art-image"
                        className="w-full h-full object-cover"
                        onLoad={handleLoadImage}
                        onError={handleError}
                      />
                    ) : null}
                  </div>
                )}
              </ImageLoader>

              <div className="flex flex-col justify-center overflow-hidden">
                <span className="text-sm font-semibold truncate">
                  {album.name}
                </span>
                {album.artist && (
                  <span className="text-xs text-foreground opacity-80 truncate">
                    {album.artist}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
