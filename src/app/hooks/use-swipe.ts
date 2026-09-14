import { TouchEvent, useCallback, useRef } from 'react'

interface UseSwipeOptions {
  onSwipeLeft?: () => void
  onSwipeRight?: () => void
  /** Minimum horizontal distance in pixels to count as a swipe. */
  threshold?: number
  /** Maximum time in milliseconds for the gesture to count as a swipe. */
  maxDuration?: number
}

/**
 * Elements that own horizontal touch gestures themselves. A swipe starting
 * inside one of these is ignored so we never steal a drag from a slider,
 * a link, or a bottom sheet. Dialogs are deliberately not listed: the mobile
 * sidebar is itself a dialog and needs to catch its own close swipe.
 */
const INTERACTIVE_SELECTOR = [
  'button',
  'a[href]',
  'input',
  'textarea',
  'select',
  '[role="slider"]',
  '[draggable="true"]',
  '[data-vaul-drawer]',
  '[data-vaul-overlay]',
  '[data-no-swipe]',
].join(',')

/**
 * True when the touch started inside something that scrolls sideways, such
 * as a carousel, so its own scrolling keeps working.
 */
function startedInHorizontalScroller(target: HTMLElement | null) {
  let node: HTMLElement | null = target

  while (node && node !== document.body) {
    if (node.scrollWidth > node.clientWidth + 1) {
      const overflowX = window.getComputedStyle(node).overflowX
      if (overflowX === 'auto' || overflowX === 'scroll') return true
    }
    node = node.parentElement
  }

  return false
}

/**
 * Horizontal swipe detection for touch devices, meant to be spread onto a
 * full-screen container. Vertical-dominant movements are ignored so page
 * scrolling is never mistaken for a swipe.
 */
export function useSwipe({
  onSwipeLeft,
  onSwipeRight,
  threshold = 70,
  maxDuration = 600,
}: UseSwipeOptions) {
  const start = useRef<{ x: number; y: number; time: number } | null>(null)

  const onTouchStart = useCallback((event: TouchEvent) => {
    start.current = null

    // Ignore multi-touch, which is usually a pinch or zoom.
    if (event.touches.length !== 1) return

    const touch = event.touches[0]
    if (!touch) return

    const target = event.target as HTMLElement | null
    if (target?.closest(INTERACTIVE_SELECTOR)) return
    if (startedInHorizontalScroller(target)) return

    start.current = { x: touch.clientX, y: touch.clientY, time: Date.now() }
  }, [])

  const onTouchEnd = useCallback(
    (event: TouchEvent) => {
      const origin = start.current
      start.current = null
      if (!origin) return

      const touch = event.changedTouches[0]
      if (!touch) return

      if (Date.now() - origin.time > maxDuration) return

      const dx = touch.clientX - origin.x
      const dy = touch.clientY - origin.y

      // Require a clearly horizontal movement.
      if (Math.abs(dx) < threshold) return
      if (Math.abs(dx) < Math.abs(dy) * 1.5) return

      if (dx < 0) onSwipeLeft?.()
      else onSwipeRight?.()
    },
    [onSwipeLeft, onSwipeRight, threshold, maxDuration],
  )

  return { onTouchStart, onTouchEnd }
}
