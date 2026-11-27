import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { installAgentBridge } from './agent/bridge'
import { useDoc } from './model/store'
import { loadInitialDoc, startAutosave } from './sync/idb'
import { loadProjectFromCloud } from './sync/cloud'
import { markCloudSynced, startCloudAutosave } from './sync/cloudAutosave'
import { toast } from './features/toast'
import { applyInitialUiParams, parseUrlParams, unregisterServiceWorkersIfRequested } from './shell/urlParams'

async function boot() {
  const params = parseUrlParams(window.location.search)
  await unregisterServiceWorkersIfRequested(params.nosw)
  try {
    const doc = await loadInitialDoc()
    if (doc) useDoc.getState().hydrate(doc)
  } catch { /* start with the default project */ }
  applyInitialUiParams(params)
  startAutosave(useDoc)
  startCloudAutosave(useDoc)
  installAgentBridge()
  createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
  if (params.project) {
    try {
      useDoc.getState().hydrate(await loadProjectFromCloud(params.project))
      markCloudSynced(useDoc.getState().doc)
      applyInitialUiParams(params)
    } catch (err) {
      toast(`Could not load project "${params.project}": ${err instanceof Error ? err.message : 'unknown error'}`)
    }
  }
}

void boot()
