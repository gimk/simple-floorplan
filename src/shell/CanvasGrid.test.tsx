// The background grid is hidden in Design mode and drawn in Plan mode.
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const ui = vi.hoisted(() => ({ mode: 'design' as 'plan' | 'design', showGrid: true }))

vi.mock('./uiStore', () => {
  const state = () => ({ mode: ui.mode, showGrid: ui.showGrid, activeArtboardId: null, view: { x: 0, y: 0, zoom: 1 } })
  type State = ReturnType<typeof state>
  const useUi = (sel: (s: State) => unknown) => sel(state())
  useUi.getState = state
  return { useUi }
})
vi.mock('../canvas/Viewport', () => ({
  useViewport: () => ({ zoom: 1, px: (n: number) => n, svg: null, subscribeLive: () => () => {} }),
}))
vi.mock('../model/store', () => ({
  useDoc: (sel: (s: { doc: { artboards: never[] } }) => unknown) => sel({ doc: { artboards: [] } }),
}))

const { CanvasGrid } = await import('./CanvasGrid')

describe('CanvasGrid', () => {
  it('renders nothing in Design mode', () => {
    ui.mode = 'design'
    expect(renderToStaticMarkup(<CanvasGrid />)).toBe('')
  })
  it('renders the grid pattern in Plan mode', () => {
    ui.mode = 'plan'
    ui.showGrid = true
    expect(renderToStaticMarkup(<CanvasGrid />)).toContain('canvas-grid-pattern')
  })
  it('renders nothing when Cmd/Ctrl+\' hid the grid', () => {
    ui.mode = 'plan'
    ui.showGrid = false
    expect(renderToStaticMarkup(<CanvasGrid />)).toBe('')
  })
})
