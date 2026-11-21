// Screen Wake Lock while Measuring Mode is open: keeps the phone screen on during a survey.
import { useEffect } from 'react'

type WakeLockSentinelLike = { release: () => Promise<void> }

const supportsWakeLock = () =>
  typeof navigator !== 'undefined' && 'wakeLock' in navigator

/**
 * Holds a screen wake lock while `enabled`. Re-acquires it when the page becomes
 * visible again (the browser releases the lock automatically on tab hide).
 */
export function useWakeLock(enabled: boolean) {
  useEffect(() => {
    if (!enabled || !supportsWakeLock()) return
    let lock: WakeLockSentinelLike | null = null
    const request = async () => {
      try {
        lock = await (navigator as unknown as { wakeLock: { request: (t: 'screen') => Promise<WakeLockSentinelLike> } }).wakeLock.request('screen')
      } catch { /* denied or unsupported at runtime: measuring still works */ }
    }
    const onVisibility = () => { if (document.visibilityState === 'visible') void request() }
    void request()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      if (lock) void lock.release().catch(() => {})
      lock = null
    }
  }, [enabled])
}

export { supportsWakeLock }
