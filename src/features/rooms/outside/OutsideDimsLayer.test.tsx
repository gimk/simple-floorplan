// The outside dimension chains on the plan (docs/measurements-plan.md section 3): one chain row and
// one overall row per straight run of outside faces, the common dimension style, and the layers
// that hide them.
import { renderToString } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import { Viewport } from '../../../canvas/Viewport'
import { emptyDoc, useDoc, useUi, type Layers } from '../../../model/store'
import type { Measurement, PlanDoc, Room, RoomFace, StoredNode, StoredWall } from '../../../model/types'
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

/** Two rooms side by side, so that the top and the bottom facades are cut by a T junction. */
const v2split = (): PlanDoc =>
  convertToV2({
    ...emptyDoc(),
    rooms: [
      square('A', [[0, 0], [200, 0], [200, 300], [0, 300]], 1),
      square('B', [[200, 0], [400, 0], [400, 300], [200, 300]], 2),
    ],
  }).doc

const node = (id: string, x: number, y: number): StoredNode => ({ id, x, y })
const wall = (id: string, a: string, b: string): StoredWall => ({ id, a, b, faces: [], type: 'partition', thicknessCm: 10 })
const face = (wallId: string, side: 'L' | 'R', from: number, to: number, cornerId: string): RoomFace =>
  ({ wallId, side, from, to, cornerId })
const bare = (id: string, cycle: RoomFace[], walkOrder = 1): Room =>
  ({ id, code: id, name: id, vertices: [], holes: [], walls: {}, walkOrder, cycle })

/**
 * A rectangle 600 x 400 whose top facade is cut 15 cm from the left corner: the first segment of
 * that chain is 20 cm long, too short for its text between the ticks (round 1 suggestion 4).
 */
const v2short = (): PlanDoc => ({
  ...emptyDoc(),
  schemaVersion: 2,
  nodes: [node('N1', 0, 0), node('N2', 600, 0), node('N3', 600, 400), node('N4', 0, 400), node('T', 15, 0), node('U', 15, 200)],
  walls: [wall('W1', 'N1', 'N2'), wall('W2', 'N2', 'N3'), wall('W3', 'N3', 'N4'), wall('W4', 'N4', 'N1'), wall('W5', 'T', 'U')],
  rooms: [
    bare('SE', [face('W1', 'L', 0, 600, 'v1'), face('W2', 'L', 0, 400, 'v2'), face('W3', 'L', 0, 600, 'v3'), face('W4', 'L', 0, 400, 'v4')]),
    bare('CO', [face('W5', 'L', 0, 200, 'c1'), face('W5', 'R', 0, 200, 'c2')], 2),
  ],
})

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
    // Two rooms side by side: the top facade is cut in two by the T junction of the shared wall.
    const html = setup({ doc: v2split() })
    // The top outside face is at y = -5 (half a thickness above the wall centre line): the chain
    // row is at -33, the overall row at -57, and the extension lines start 4 px off the face.
    expect(html).toContain('y2="-33"')
    expect(html).toContain('y2="-57"')
    expect(html).toContain('y1="-9"')
  })

  it('draws ONE row for a run with one segment (no duplicate chain row)', () => {
    // The plain square: every run is one whole side of one wall, so the chain row would repeat the
    // overall row between the same two points (round 1 finding R1-6).
    const html = setup()
    expect(count(html, 'data-outside-run=')).toBe(4)
    expect(count(html, 'data-outside-overall=')).toBe(4)
    // One dimension line per run, and its segment is the overall row itself.
    expect(count(html, 'data-dim="outside"')).toBe(4)
    expect(html).toContain('data-outside-overall=""><g data-outside-seg="W1-E"')
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

  it('puts the text of a short segment past the outer end of its row, clear of the ticks (suggestion 4)', () => {
    const html = setup({ doc: v2short() })
    // The first segment of the top run is 20 cm: its text does not fit between the ticks, so it
    // goes past its START end (the first half of the row), one step further from the row.
    const first = /<g data-outside-seg="0">([\s\S]*?)<\/g>/.exec(html)![1]
    expect(first).toContain('data-dim-outside=""')
    const t = /<text x="([-\d.]+)" y="([-\d.]+)"/.exec(first)!
    // Past the outside corner at x = -5, and 13 px instead of 7 px off the chain row at y = -33.
    expect(Number(t[1])).toBeLessThan(-5)
    expect(Number(t[2])).toBeCloseTo(-33 - 13, 6)
    // A segment that holds its text keeps it centred between the ticks.
    const second = /<g data-outside-seg="1">([\s\S]*?)<\/g>/.exec(html)![1]
    expect(Number(/<text x="[-\d.]+" y="([-\d.]+)"/.exec(second)![1])).toBeCloseTo(-33 - 7, 6)
  })
})
