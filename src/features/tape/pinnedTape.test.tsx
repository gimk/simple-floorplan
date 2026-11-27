// Tests of the PINNED Tape measurement (uiStore.pinnedTape + PinnedMeasurement markup).
//
// The pin is UI state: it lives in the UI store (never in the document, never in the undo history) and
// it outlives the Tape tool. Only its x button, or the start of a new measurement, removes it.
// Rendering goes through react-dom/server (no DOM in this repo): the viewport context defaults to
// px = cm, so the markup values are directly readable in cm.
import { beforeEach, describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { clearPinnedTape, pinTape, useUi } from '../../shell/uiStore'
import { PinnedMeasurement } from './TapeOverlay'
import type { TapeSnap } from './geometry'

const snap = (x: number, y: number, snapped = false): TapeSnap => ({ point: { x, y }, snapped })

const A = snap(0, 0, true)
const B = snap(300, 400)

beforeEach(() => {
  useUi.getState().set({ pinnedTape: null, tool: 'tape', mode: 'plan' })
})

describe('pinnedTape (UI store)', () => {
  it('starts empty', () => {
    expect(useUi.getState().pinnedTape).toBeNull()
  })

  it('is written by a locked measurement, with the final points', () => {
    pinTape(A, B)
    expect(useUi.getState().pinnedTape).toEqual({ a: A, b: B })
  })

  it('holds only one measurement: a new pin replaces the previous one', () => {
    pinTape(A, B)
    const c = snap(10, 10)
    const d = snap(10, 60)
    pinTape(c, d)
    expect(useUi.getState().pinnedTape).toEqual({ a: c, b: d })
  })

  it('is cleared by the start of a new measurement and by the x button', () => {
    pinTape(A, B)
    clearPinnedTape()
    expect(useUi.getState().pinnedTape).toBeNull()
    pinTape(A, B)
    clearPinnedTape()
    expect(useUi.getState().pinnedTape).toBeNull()
  })

  it('survives leaving the Tape tool (Esc, the M / V keys) and a mode switch', () => {
    pinTape(A, B)
    // Escape on the Tape overlay and the M / V shortcuts both just change the tool.
    useUi.getState().set({ tool: 'select' })
    expect(useUi.getState().pinnedTape).toEqual({ a: A, b: B })
    useUi.getState().set({ tool: 'tape' })
    useUi.getState().set({ tool: 'rect' })
    expect(useUi.getState().pinnedTape).toEqual({ a: A, b: B })
    // Design mode drops the placement tools but not the pinned measurement.
    useUi.getState().set({ mode: 'design', tool: 'select' })
    expect(useUi.getState().pinnedTape).toEqual({ a: A, b: B })
  })
})

describe('PinnedMeasurement markup', () => {
  it('renders nothing without a pinned measurement', () => {
    expect(renderToStaticMarkup(<PinnedMeasurement pinned={null} />)).toBe('')
  })

  it('draws the locked line, the copyable label and the x button', () => {
    const html = renderToStaticMarkup(<PinnedMeasurement pinned={{ a: A, b: B }} />)
    expect(html).toContain('data-testid="tape-measure"')
    expect(html).toContain('data-locked=""')
    // Solid line: no dash pattern.
    expect(html).not.toContain('stroke-dasharray')
    // A 300 x 400 measurement is 500 cm.
    expect(html).toContain('>500 cm</text>')
    expect(html).toContain('data-testid="tape-label"')
    expect(html).toContain('data-testid="tape-dismiss"')
    expect(html).toContain('aria-label="Dismiss measurement"')
  })

  it('never blocks canvas clicks: the line and the dots ignore pointer events', () => {
    const html = renderToStaticMarkup(<PinnedMeasurement pinned={{ a: A, b: B }} />)
    // The line + dots group opts out of hit-testing; only the label and the x take pointer events.
    expect(html).toContain('pointer-events="none"')
    expect(html.match(/pointer-events="none"/g)?.length).toBe(1)
    expect(html).toContain('cursor:copy')
  })

  it('draws nothing for a zero-length measurement', () => {
    expect(renderToStaticMarkup(<PinnedMeasurement pinned={{ a: A, b: snap(0, 0) }} />)).toBe('')
  })
})
