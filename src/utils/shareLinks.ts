import { toast } from 'react-toastify'
import i18n from '@/i18n'
import {
  SHARED_ITEM_TYPES,
  SharedItem,
  SharedItemType,
  useShareLinkStore,
} from '@/store/share-link.store'
import { isDesktop } from '@/utils/desktop'
import { JAM_LINK_SCHEME } from '@/utils/jamLinks'
import { isCapacitor } from '@/utils/platform'
import { getSyncServerUrl } from '@/utils/syncServerUrl'

// Subsonic servers each mint ids their own way (hex, base62, UUIDs, "al-12").
const ITEM_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/

const SHARED_PATH_PATTERN = new RegExp(
  `(?:^|/)(${SHARED_ITEM_TYPES.join('|')})/([^/?#]+)/?$`,
)

/**
 * Pulls a shared item out of a link:
 *   https://host/album/<id>        (shareable link)
 *   https://host/#/album/<id>      (after the web redirect)
 *   aonsoku://album/<id>           (app link)
 */
export function parseSharedItem(input: string): SharedItem | null {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    return null
  }

  const candidates = [url.pathname, url.hash.replace(/^#/, '')]
  // aonsoku://album/<id> parses with "album" as the host.
  if (url.protocol === `${JAM_LINK_SCHEME}:`) {
    candidates.unshift(`${url.host}${url.pathname}`)
  }

  for (const candidate of candidates) {
    const match = candidate.match(SHARED_PATH_PATTERN)
    if (!match) continue

    let id: string
    try {
      id = decodeURIComponent(match[2])
    } catch {
      continue
    }
    if (ITEM_ID_PATTERN.test(id)) {
      return { type: match[1] as SharedItemType, id }
    }
  }
  return null
}

/** The in-app route a shared item lands on, e.g. /album/<id>. */
export function sharedItemPath({ type, id }: SharedItem): string {
  return `/${type}/${encodeURIComponent(id)}`
}

/**
 * Where share links point. The web app shares its own address. The apps have
 * no public address of their own, so they share the web app that hosts the
 * sync server, and fall back to an app-only link when none is known.
 */
function getShareBaseUrl(): string | null {
  if (isCapacitor() || isDesktop()) {
    return getSyncServerUrl()?.replace(/\/+$/, '') ?? null
  }
  const { origin, pathname } = window.location
  return `${origin}${pathname}`.replace(/\/+$/, '')
}

export function buildShareLink(item: SharedItem): string {
  const base = getShareBaseUrl()
  if (!base) return `${JAM_LINK_SCHEME}:/${sharedItemPath(item)}`
  return `${base}${sharedItemPath(item)}`
}

/**
 * Records a shared item from an incoming link. The layout opens it once the
 * listener is signed in, so a link that arrives before login is not lost.
 */
export function requestOpenSharedItem(input: string): boolean {
  const item = parseSharedItem(input)
  if (!item) return false
  useShareLinkStore.getState().setPending(item)
  return true
}

function isShareCancel(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return /cancel/i.test(message)
}

/**
 * Hands a link to the system share sheet where there is one (the Android app,
 * phone browsers) and copies it to the clipboard everywhere else.
 */
export async function shareUrl({
  url,
  title,
  copiedMessage = i18n.t('share.copied'),
  note,
}: {
  url: string
  title: string
  copiedMessage?: string
  /** A caveat for the sharer, e.g. that the item is private. */
  note?: string
}) {
  if (isCapacitor()) {
    try {
      const { Share } = await import('@capacitor/share')
      await Share.share({ title, text: title, url, dialogTitle: title })
      if (note) toast.info(note)
      return
    } catch (error) {
      if (isShareCancel(error)) return
      console.error('[Share] Share sheet failed, copying instead:', error)
    }
  } else if (
    !isDesktop() &&
    typeof navigator.share === 'function' &&
    window.matchMedia('(pointer: coarse)').matches
  ) {
    try {
      await navigator.share({ title, url })
      if (note) toast.info(note)
      return
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
    }
  }

  try {
    await navigator.clipboard.writeText(url)
    toast.success(note ? `${copiedMessage} ${note}` : copiedMessage)
  } catch {
    toast.error(i18n.t('share.failed'))
  }
}

export function shareItem(item: SharedItem, title: string, note?: string) {
  return shareUrl({ url: buildShareLink(item), title, note })
}
