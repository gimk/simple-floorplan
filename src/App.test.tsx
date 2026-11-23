// Desktop Measuring Mode: the editor layout stays, only the right panel changes.
import { renderToString } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import { emptyDoc, useDoc, useUi } from './model/store'
import { demoRooms } from './features/measure/demo'
import App from './App'

// The toast host uses a portal into document.body, which the string renderer cannot draw.
vi.mock('./features/toast', async (orig) => ({ ...(await orig<object>()), ToastHost: () => null }))

const applyState = (store: unknown, patch: object) => {
  const s = store as { setState: (p: object) => void; getInitialState: () => object }
  s.setState(patch)
  Object.assign(s.getInitialState(), patch)
}

it('shows the measure panel and no tool bar in measure mode on desktop', () => {
  applyState(useDoc, { doc: { ...emptyDoc(), rooms: demoRooms() } })
  applyState(useUi, { mode: 'measure', selection: null, multi: [], tool: 'select' })
  const html = renderToString(<App />)
  expect(html).toContain('data-measure-panel')
  expect(html).toContain('aria-label="Exit Measuring Mode"')
  expect(html).not.toContain('aria-label="Tools"')
  expect(html).not.toContain('role="tablist"')
  expect(html).toContain('aria-label="Side panel"')
})

it('keeps the tool bar and the tabs in edit mode', () => {
  applyState(useUi, { mode: 'edit' })
  const html = renderToString(<App />)
  expect(html).toContain('aria-label="Tools"')
  expect(html).toContain('role="tablist"')
  expect(html).not.toContain('data-measure-panel')
  expect(html).toContain('aria-label="Switch to Measuring Mode"')
})
