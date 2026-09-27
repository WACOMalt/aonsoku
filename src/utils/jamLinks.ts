import { useJamStore } from '@/store/jam.store'
import { getSyncServerUrl } from '@/utils/syncServerUrl'

/** Custom URL scheme the apps register, e.g. aonsoku://jam/<id>. */
export const JAM_LINK_SCHEME = 'aonsoku'

const SESSION_ID_PATTERN = /^[a-z0-9]{6,32}$/i

/**
 * Pulls a Jam session id out of anything a user might paste or open:
 *   abc123def0
 *   https://host/jam/abc123def0        (shareable link)
 *   https://host/#/jam/abc123def0      (older links, hash router)
 *   aonsoku://jam/abc123def0           (app link)
 */
export function parseJamSessionId(input: string): string | null {
  const text = input.trim()
  if (SESSION_ID_PATTERN.test(text)) return text

  let url: URL
  try {
    url = new URL(text)
  } catch {
    return null
  }

  const candidates = [url.pathname, url.hash.replace(/^#/, '')]
  // aonsoku://jam/<id> parses with "jam" as the host.
  if (url.protocol === `${JAM_LINK_SCHEME}:`) {
    candidates.unshift(`${url.host}${url.pathname}`)
  }

  for (const candidate of candidates) {
    const match = candidate.match(/(?:^|\/)jam\/([^/?#]+)/)
    if (match && SESSION_ID_PATTERN.test(match[1])) return match[1]
  }
  return null
}

/** The shareable https link. Opens the app where installed, else the web app. */
export function buildJamInviteLink(sessionId: string): string {
  const base = (getSyncServerUrl() ?? window.location.origin).replace(
    /\/+$/,
    '',
  )
  return `${base}/jam/${sessionId}`
}

/** A link that opens the installed app directly. */
export function buildJamAppLink(sessionId: string): string {
  return `${JAM_LINK_SCHEME}://jam/${sessionId}`
}

/**
 * Entry point for every invite, whatever it came from: a pasted link, the
 * /jam/:id route, or an OS deep link. It only records the invite; the join
 * prompt decides what to ask based on login and current Jam state, and the
 * pending id survives a login in between because it is persisted.
 */
export function requestJamJoin(input: string): boolean {
  const sessionId = parseJamSessionId(input)
  if (!sessionId) return false
  useJamStore.getState().actions.setPendingJamSessionId(sessionId)
  return true
}
