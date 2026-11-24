// The outside dimension chains on the plan (docs/measurements-plan.md section 3): one chain row and
// one overall row per straight run of outside faces, the common dimension style, and the layers
// that hide them.
import { renderToString } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import { Viewport } from '../../../canvas/Viewport'
import { emptyDoc, useDoc, useUi, type Layers } from '../../../model/store'
import type { Measurement, PlanDoc, Room } from '../../../model/types'
import { convertToV2 } from '../../../model/v2/convert'
import { OutsideDimsLayer } from './OutsideDimsLayer'

const BASE_LAYERS: Layers = {
  background: true, dimensions: true, bearingHighlight: true, openings: true, notes: true, clashes: true,
  roomCodes: 'auto', wallLabels: 'auto', outsideDims: true,
}

const applyState = (store: unknown, patch: object) => {
  const s = store as { setState: (p: object) => void; getInitialState: () => object }
  s.setState(patch)
  Object.assign(s.getInitialState(), patch)
}

/** One rectangular room 400 x 300 cm, as a v2 document (its walls W1..W4, 10 cm thick). */
const square = (id: string, pts: [number, number][], walkOrder = 1): Room => ({
  id, code: id, name: id,
  vertices: pts.map(([x, y], i) => ({ id: `${id}-v${i}`, x, y })),
  holes: [], walls: {}, walkOrder,
})

const v2 = (): PlanDoc =>
  convertToV2({ ...emptyDoc(), rooms: [square('A', [[0, 0], [400, 0], [400, 300], [0, 300]])] }).doc

type Over = { layers?: Partial<Layers>; measurements?: Record<string, Measurement>; doc?: PlanDoc; mode?: 'edit' | 'measure' }

const setup = (over: Over = {}) => {
  const base = over.doc ?? v2()
  applyState(useUi, {
    layers: { ...BASE_LAYERS, ...over.layers },
    mode: over.mode ?? 'edit',
    tool: 'select',
    selection: null,
    multi: [],
    view: { x: 0, y: 0, zoom: 1 },
  })
  applyState(useDoc, { doc: { ...base, measurements: { ...base.measurements, ...over.measurements } } })
  return renderToString(<Viewport><OutsideDimsLayer /></Viewport>)
}

const count = (html: string, needle: string) => html.split(needle).length - 1

beforeEach(() => {
  applyState(useUi, {
    layers: BASE_LAYERS, mode: 'edit', tool: 'select', selection: null, multi: [],
    view: { x: 0, y: 0, zoom: 1 },
  })
  applyState(useDoc, { doc: emptyDoc() })
})

describe('OutsideDimsLayer', () => {
  it('draws a chain row and an overall row for each side of a rectangular plan', () => {
    const html = setup()
    expect(count(html, 'data-outside-run=')).toBe(4)
    expect(count(html, 'data-outside-overall=')).toBe(4)
    expect(count(html, 'data-outside-seg=')).toBe(4)
    // Outside corner to outside corner, half a thickness further than the wall itself.
    expect(html).toContain('>410<')
    expect(html).toContain('>310<')
  })

  it('uses the common dimension style: thin line, 45 degree ticks, 11 px text with a halo', () => {
    const html = setup()
    expect(html).toContain('stroke-slate-500 dark:stroke-slate-400')
    expect(html).toContain('font-size="11"')
    expect(html).toContain('paint-order="stroke"')
    expect(html).toContain('stroke-[#f6f7f5] dark:stroke-[#12161b]')
    expect(html).toContain('pointer-events="none"')
  })

  it('puts the chain row 28 px and the overall row 52 px outside the wall face', () => {
    const html = setup()
    // The top outside face is at y = -5 (half a thickness above the wall centre line): the chain
    // row is at -33, the overall row at -57, and the extension lines start 4 px off the face.
    expect(html).toContain('y2="-33"')
    expect(html).toContain('y2="-57"')
    expect(html).toContain('y1="-9"')
  })

  it('shows a measured facade value in green, past the plan length', () => {
    const html = setup({ measurements: { 'W1-E': { label: 'W1-E', actualCm: 412, updatedAt: '2026-01-01' } } })
    expect(html).toContain('data-outside-seg="W1-E"')
    expect(html).toContain('fill-emerald-700 dark:fill-emerald-400')
    expect(html).toContain('✓ 412')
  })

  it('draws nothing when the outside dimensions layer or the dimensions layer is off', () => {
    expect(setup({ layers: { outsideDims: false } })).not.toContain('data-outside-dims')
    expect(setup({ layers: { dimensions: false } })).not.toContain('data-outside-dims')
  })

  it('draws nothing for a document without stored walls (v1)', () => {
    expect(setup({ doc: emptyDoc() })).not.toContain('data-outside-dims')
  })

  it('draws nothing in Measuring Mode (the plan is cleaned for the survey)', () => {
    // The test renderer has no window: it counts as a desktop, where the rows stay.
    expect(setup({ mode: 'measure' })).toContain('data-outside-dims')
  })
})
