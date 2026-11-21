import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { hydrate } from './model/store'

// Load the saved doc from IndexedDB first, so the first paint is already correct.
void hydrate().finally(() => {
  createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
})
