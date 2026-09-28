import { useEffect, useState } from 'react'

// The phone layout: narrow screens, and phones turned sideways (wide but far
// too short for the desktop layout). Keep in sync with the "compact" screen
// in tailwind.config.js and the media query in index.css.
export const COMPACT_MEDIA_QUERY =
  '(max-width: 767px), (orientation: landscape) and (max-height: 500px) and (min-width: 640px) and (pointer: coarse)'

function matchesCompact() {
  return typeof window !== 'undefined'
    ? window.matchMedia(COMPACT_MEDIA_QUERY).matches
    : false
}

export function useIsMobile() {
  // Read it right away so the first render already uses the right layout,
  // instead of flashing the desktop one.
  const [isMobile, setIsMobile] = useState<boolean>(matchesCompact)

  useEffect(() => {
    const mql = window.matchMedia(COMPACT_MEDIA_QUERY)
    const onChange = () => setIsMobile(mql.matches)
    mql.addEventListener('change', onChange)
    setIsMobile(mql.matches)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  return isMobile
}
