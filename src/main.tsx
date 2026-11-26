import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { useDoc } from './model/store'
import { loadInitialDoc, startAutosave } from './sync/idb'

async function boot() {
  try {
    const doc = await loadInitialDoc()
    if (doc) useDoc.getState().hydrate(doc)
  } catch { /* start with the default project */ }
  startAutosave(useDoc)
  createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
}

void boot()
