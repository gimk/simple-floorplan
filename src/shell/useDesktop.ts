// Width check for the desktop layout (Tailwind `md`: 768 px and wider).
import { useSyncExternalStore } from 'react'

export const DESKTOP_QUERY = '(min-width: 768px)'

/**
 * Pure part: is this media query result a desktop one?
 * Without a result (server render, test, old browser) the answer is "desktop".
 */
export const isDesktopMatch = (mq: { matches: boolean } | null | undefined): boolean => (mq ? mq.matches : true)

const getMedia = (): MediaQueryList | null =>
  typeof window === 'undefined' || typeof window.matchMedia !== 'function' ? null : window.matchMedia(DESKTOP_QUERY)

const subscribe = (onChange: () => void) => {
  const mq = getMedia()
  if (!mq) return () => {}
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}

/** True at 768 px and wider. Updates when the window is resized across the limit. */
export function useIsDesktop(): boolean {
  return useSyncExternalStore(subscribe, () => isDesktopMatch(getMedia()), () => true)
}

/** Reusable media query hook. Without matchMedia (server render, test) the result is false. */
export function useMediaQuery(query: string): boolean {
  const getMq = () =>
    typeof window === 'undefined' || typeof window.matchMedia !== 'function' ? null : window.matchMedia(query)
  return useSyncExternalStore(
    (onChange) => {
      const mq = getMq()
      if (!mq) return () => {}
      mq.addEventListener('change', onChange)
      return () => mq.removeEventListener('change', onChange)
    },
    () => getMq()?.matches ?? false,
    () => false,
  )
}
