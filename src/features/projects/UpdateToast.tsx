// "Update available — reload" toast, shown when a new service worker is waiting.
import { useEffect, useState } from 'react'
import { registerSW } from 'virtual:pwa-register'

export function UpdateToast() {
  const [update, setUpdate] = useState<null | (() => Promise<void>)>(null)
  useEffect(() => {
    if (!import.meta.env.PROD) return // no service worker in dev
    const updateSW = registerSW({
      immediate: true,
      onNeedRefresh: () => setUpdate(() => () => updateSW(true)),
    })
  }, [])
  if (!update) return null
  return (
    <div role="status" className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-lg bg-neutral-900 px-4 py-2 text-sm text-white shadow-lg dark:bg-neutral-100 dark:text-neutral-900">
      <span>Update available</span>
      <button className="h-9 rounded-md bg-orange-600 px-3 font-semibold text-white" onClick={() => void update()}>Reload</button>
      <button className="h-9 px-2 opacity-70" onClick={() => setUpdate(null)}>Later</button>
    </div>
  )
}
