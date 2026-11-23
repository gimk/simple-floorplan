// Shared access to the service worker update (vite-plugin-pwa). UpdateToast registers the service
// worker and gives its update function here, so other code (the "update required" answer of the
// server, docs/walls-plan.md phase 5c) can install the new app version before it reloads.

type Updater = (reloadPage?: boolean) => Promise<void>

let updater: Updater | null = null

/** Called once by UpdateToast after registerSW. */
export function setServiceWorkerUpdater(fn: Updater): void {
  updater = fn
}

/**
 * Get the newest app version, then reload. With a service worker: ask it to check for a new
 * version, activate the waiting one and reload (updateSW(true)). Without one (dev, tests, an old
 * browser): a plain reload.
 */
export async function updateAppAndReload(): Promise<void> {
  try {
    const reg = typeof navigator !== 'undefined' && 'serviceWorker' in navigator
      ? await navigator.serviceWorker.getRegistration()
      : undefined
    await reg?.update()
    if (updater && reg?.waiting) {
      await updater(true)
      return
    }
  } catch {
    // fall through to a plain reload
  }
  window.location.reload()
}
