import { ReactNode, useEffect, useRef, useState } from 'react'
import { getSimpleCoverArtUrl } from '@/api/httpClient'
import { getCachedImage } from '@/cache/image'
import { useAppImageCache } from '@/store/app.store'
import { CoverArt } from '@/types/coverArtType'

interface ImageLoaderProps {
  id?: string
  type: CoverArt
  size?: string | number
  children: (src: string | undefined, isLoading: boolean) => ReactNode
}

export function ImageLoader({
  id,
  type,
  size = 300,
  children,
}: ImageLoaderProps) {
  const cacheLayerEnabled = useAppImageCache()

  // The plain URL is known synchronously, so the image element can start
  // downloading on the very first render. The server marks artwork immutable,
  // which lets the browser and service worker cache it without any help here.
  const url = getSimpleCoverArtUrl(id, type, size.toString())

  if (!cacheLayerEnabled) {
    return <>{children(url, false)}</>
  }

  return (
    <CachedImageLoader url={url} enabled={!!id}>
      {children}
    </CachedImageLoader>
  )
}

interface CachedImageLoaderProps {
  url: string
  enabled: boolean
  children: (src: string | undefined, isLoading: boolean) => ReactNode
}

/**
 * Reads the image through the Cache API so it survives offline, which the
 * native app relies on. Object URLs created here are revoked when they are
 * replaced or the component unmounts; leaking them grew memory steadily while
 * scrolling long lists.
 */
function CachedImageLoader({ url, enabled, children }: CachedImageLoaderProps) {
  const [src, setSrc] = useState(url)
  const [isLoading, setIsLoading] = useState(enabled)
  const objectUrlRef = useRef<string | null>(null)

  useEffect(() => {
    const releaseObjectUrl = () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current)
        objectUrlRef.current = null
      }
    }

    if (!enabled) {
      releaseObjectUrl()
      setSrc(url)
      setIsLoading(false)
      return
    }

    let active = true
    setIsLoading(true)

    getCachedImage(url)
      .then((resolved) => {
        if (!active) {
          if (resolved.startsWith('blob:')) URL.revokeObjectURL(resolved)
          return
        }

        releaseObjectUrl()
        if (resolved.startsWith('blob:')) objectUrlRef.current = resolved

        setSrc(resolved)
        setIsLoading(false)
      })
      .catch(() => {
        if (!active) return
        setSrc(url)
        setIsLoading(false)
      })

    return () => {
      active = false
    }
  }, [url, enabled])

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current)
        objectUrlRef.current = null
      }
    }
  }, [])

  return <>{children(src, isLoading)}</>
}
