import { renderToString } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import { emptyDoc, useDoc, useUi } from '../model/store'
import { convertToV2 } from '../model/v2/convert'
import type { Room } from '../model/types'
import { useToast } from '../features/toast'
import { ToolHints, ToolHintsView } from './ToolHints'

const room: Room = {
  id: 'A', code: 'A', name: 'A', holes: [], walls: {}, walkOrder: 1,
  vertices: [{ id: 'v0', x: 0, y: 0 }, { id: 'v1', x: 300, y: 0 }, { id: 'v2', x: 300, y: 300 }, { id: 'v3', x: 0, y: 300 }],
}

const applyState = (store: unknown, patch: object) => {
  const s = store as { setState: (p: object) => void; getInitialState: () => object }
  s.setState(patch)
  Object.assign(s.getInitialState(), patch)
}

beforeEach(() => {
  applyState(useUi, { mode: 'edit', tool: 'select' })
  applyState(useDoc, { doc: { ...emptyDoc(), rooms: [room] } })
  applyState(useToast, { toasts: [] })
})

describe('ToolHints', () => {
  it('shows v1 select hint for v1 documents and v2 select hint for v2 documents', () => {
    const v1Html = renderToString(<ToolHints />)
    expect(v1Html).toContain('this room only')
    expect(v1Html).not.toContain('box add to selection')

    applyState(useDoc, { doc: convertToV2({ ...emptyDoc(), rooms: [room] }).doc })
    const v2Html = renderToString(<ToolHints />)
    expect(v2Html).toContain('Shift+drag on floor = box add to selection')
    expect(v2Html).toContain('Shift+click = add or remove room/wall')
    expect(v2Html).not.toContain('this room only')
  })

  it('hides the hint bar on phone widths while a toast is visible', () => {
    expect(renderToString(<ToolHints />)).not.toContain('max-md:hidden')
    applyState(useToast, { toasts: [{ id: 1, message: 'Notice', durationMs: 5000 }] })
    expect(renderToString(<ToolHints />)).toContain('max-md:hidden')
  })

  it('keeps one line on a phone, with a button that opens the full text', () => {
    const hint = 'Drag room to move · Shift+click = add to selection · a long hint that does not fit'
    const compact = renderToString(<ToolHintsView hint={hint} compact />)
    // One line, cut with an ellipsis, and a tap target with aria-expanded.
    expect(compact).toContain('truncate')
    expect(compact).toContain('<button')
    expect(compact).toContain('aria-expanded="false"')
    expect(compact).toContain('aria-label="Tool hints"')
    expect(compact).toContain('pointer-events-auto')
    // Nothing is hidden from the text: the full hint is in the DOM (the CSS cuts it).
    expect(compact).toContain('a long hint that does not fit')

    // Desktop: the plain bar, no button, no ellipsis.
    const desktop = renderToString(<ToolHintsView hint={hint} compact={false} />)
    expect(desktop).not.toContain('<button')
    expect(desktop).not.toContain('truncate')
    expect(desktop).toContain('pointer-events-none')
  })

  it('hides the bar on phone widths while a toast is visible (compact view too)', () => {
    expect(renderToString(<ToolHintsView hint="x" compact hiddenWhileToast />)).toContain('max-md:hidden')
    expect(renderToString(<ToolHintsView hint="x" compact />)).not.toContain('max-md:hidden')
  })

  it('gives the wall hint the typed length and the alignment key', () => {
    applyState(useUi, { tool: 'wall' })
    const html = renderToString(<ToolHints />)
    expect(html).toContain('type a length')
    expect(html).toContain('S = centre / side A / side B')
  })

  it('gives the select hint the double-click on a length', () => {
    applyState(useUi, { tool: 'select' })
    expect(renderToString(<ToolHints />)).toContain('double-click a length to type the measured value')
  })
})
