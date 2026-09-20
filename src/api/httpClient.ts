import omit from 'lodash/omit'
import { getCachedImage } from '@/cache/image'
import { useAppStore } from '@/store/app.store'
import { CoverArt } from '@/types/coverArtType'
import { AuthType } from '@/types/serverConfig'
import { appName } from '@/utils/appName'
import { saltWord } from '@/utils/salt'

export type QueryType = Record<string, string | number | undefined>

export interface FetchOptions extends RequestInit {
  query?: QueryType
}

type AuthParams = { u: string; t: string; s: string } | { u: string; p: string }

export function authQueryParams(
  username: string,
  password: string,
  authType: AuthType | null,
): AuthParams {
  if (authType === AuthType.TOKEN) {
    return {
      u: username ?? '',
      t: password ?? '',
      s: saltWord,
    }
  } else if (authType === AuthType.PASSWORD) {
    return {
      u: username ?? '',
      p: password ?? '',
    }
  }
  throw new Error('Invalid/unspecified auth type')
}

function queryParams() {
  const { username, password, authType, protocolVersion } =
    useAppStore.getState().data

  return {
    ...authQueryParams(username, password, authType),
    v: protocolVersion || '1.16.0',
    c: appName,
    f: 'json',
  }
}

function getUrl(path: string, options?: QueryType) {
  const serverUrl = useAppStore.getState().data.url
  const params = new URLSearchParams(queryParams())

  if (options) {
    Object.keys(options).forEach((key) => {
      const query = options[key]

      if (query !== undefined) {
        params.append(key, query.toString())
      }
    })
  }

  const queries = params.toString()
  const pathWithoutSlash = path.startsWith('/') ? path.substring(1) : path
  let url = `${serverUrl}/rest/${pathWithoutSlash}`
  url += path.includes('?') ? '&' : '?'
  url += queries

  return url
}

async function browserFetch<T>(
  url: string,
  options: RequestInit,
): Promise<{ count: number; data: T } | undefined> {
  try {
    const response = await fetch(url, options)

    if (response.ok) {
      const data = await response.json()
      return {
        count: parseInt(response.headers.get('x-total-count') || '0', 10),
        data: data['subsonic-response'] as T,
      }
    }

    return undefined
  } catch (error) {
    console.error('Error on browserFetch request', error)
    return undefined
  }
}

export async function httpClient<T>(
  path: string,
  options: FetchOptions,
): Promise<{ count: number; data: T } | undefined> {
  try {
    const url = getUrl(path, options.query)
    const init = omit(options, 'query')

    return await browserFetch<T>(url, init)
  } catch (error) {
    console.error('Error on httpClient request', error)
    return undefined
  }
}

/**
 * The server resizes and re-encodes artwork on demand, and caches the result
 * per requested pixel size. Asking for a dozen slightly different sizes means
 * a dozen resize jobs and a dozen cache entries for one cover, which thrashes
 * the server cache and is slow on modest hardware. Every request is therefore
 * snapped to one of a few buckets.
 */
const COVER_ART_SIZES = [128, 300, 512, 768]

export function normalizeCoverArtSize(size: string | number): string {
  const requested = Number(size)

  if (!Number.isFinite(requested) || requested <= 0) {
    return String(COVER_ART_SIZES[1])
  }

  const bucket =
    COVER_ART_SIZES.find((value) => value >= requested) ??
    COVER_ART_SIZES[COVER_ART_SIZES.length - 1]

  return String(bucket)
}

export function getSimpleCoverArtUrl(
  id?: string,
  type: CoverArt = 'album',
  size = '300',
): string {
  if (!id) {
    // everything except artists uses the same default cover art
    const resolvedType = type === 'artist' ? 'artist' : 'album'
    return `/default_${resolvedType}_art.png`
  }

  return getUrl('getCoverArt', { id, size: normalizeCoverArtSize(size) })
}

export async function getCoverArtUrl(
  id?: string,
  type: CoverArt = 'album',
  size = '300',
): Promise<string> {
  const url = getSimpleCoverArtUrl(id, type, size)

  if (!id) {
    return url
  }

  const { imagesCacheLayerEnabled } = useAppStore.getState().pages

  if (!imagesCacheLayerEnabled) {
    return url
  }

  return getCachedImage(url)
}

export function getSongStreamUrl(
  id: string,
  maxBitRate?: string,
  format?: string,
  cacheBustToken?: string,
) {
  return getUrl('stream', {
    id,
    maxBitRate,
    format,
    estimateContentLength: 'true',
    ...(cacheBustToken ? { _cb: cacheBustToken } : {}),
  })
}

export function getDownloadUrl(id: string, maxBitRate = '0', format = 'raw') {
  return getUrl('download', {
    id,
    maxBitRate,
    format,
  })
}
