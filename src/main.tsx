import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { hydrate } from './model/store'
import { setRepairNotifier } from './model/v2/ensure'
import { toast } from './features/toast'
import ShareViewer from './share/ShareViewer'
import { installMeasureRules } from './features/rooms/measureRules'
import { installOriginRule } from './features/rooms/originRule'

// One HTML entry for two pages: the editor and the read-only contractor viewer
// (docs/plan.md 7.4). Both are served from index.html by the assets layer
// (wrangler.toml not_found_handling = single-page-application) and by the service
// worker (navigateFallback in vite.config.ts), so /share survives a reload offline.
const isShareLink = location.pathname.replace(/\/+$/, '') === '/share'

if (isShareLink) {
  // The viewer never touches the local IndexedDB plans: no hydrate, no store, no App.
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ShareViewer />
    </StrictMode>,
  )
} else {
  // Measurements follow their wall, and a measured room follows its values (local edits only).
  installMeasureRules()
  installOriginRule()
  // A load that cleaned duplicate walls or points tells the user once.
  setRepairNotifier((_changes, removed) => toast(`Cleaned ${removed} duplicate walls/points`))
  // Load the saved doc from IndexedDB first, so the first paint is already correct.
  void hydrate().finally(() => {
    createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
  })
}
