// Tests of the measurements of the exported plan (docs/measurements-plan.md): the wall lengths as
// dimension lines (or the old text), the room tag rows, and the outside chains of a v2 document.
import { beforeEach, describe, expect, it } from 'vitest'
import { emptyDoc, useDoc } from '../../model/store'
import type { PlanDoc, Room } from '../../model/types'
import { ensureV2 } from '../../model/v2/ensure'
import { loadDemoApartment } from '../measure/demo'
import { boxHit } from '../rooms/dims/dimBoxes'
import { buildPlanSvg, DEFAULT_TAG_FIELDS } from './svgExport'

const now = '2026-01-01T00:00:00Z'

/** A rectangle room of w x h cm on its centre line; walls are the default 10 cm partition. */
const room = (w: number, h: number, over: Partial<Room> = {}): Room => ({
  id: 'r1',
  code: 'SE',
  name: 'Living',
  walkOrder: 1,
  vertices: [
    { id: 'v1', x: 0, y: 0 },
    { id: 'v2', x: w, y: 0 },
    { id: 'v3', x: w, y: h },
    { id: 'v4', x: 0, y: h },
  ],
  holes: [],
  walls: {},
  ...over,
})

const docOf = (r: Room, over: Partial<PlanDoc> = {}): PlanDoc => ({ ...emptyDoc(), rooms: [r], ...over })

/** 422 x 312 centre line: the inside faces are 412 x 302 (each wall moves in 5 cm). */
const square = () => docOf(room(422, 312))

const count = (svg: string, text: string) => svg.split(text).length - 1

describe('buildPlanSvg', () => {
  it('skips elements with missing or non-positive widthCm', () => {
    const doc = emptyDoc()
    doc.rooms.push(room(400, 300))
    doc.elements.push(
      {
        id: 'e-zero',
        roomId: 'r1',
        wallStart: 'v1',
        kind: 'door',
        offsetCm: 50,
        widthCm: 0,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
      {
        id: 'e-valid',
        roomId: 'r1',
        wallStart: 'v1',
        kind: 'window',
        offsetCm: 100,
        widthCm: 120,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    )
    const { svg } = buildPlanSvg(doc)
    expect(svg).not.toContain('NaN')
    expect(svg).toContain('matrix(1 0 0 1 100 0)')
    expect(svg).not.toContain('matrix(1 0 0 1 50 0)')
  })
})

describe('buildPlanSvg: wall lengths', () => {
  it('writes one dimension line with ticks per wall in the Lines style (default)', () => {
    const { svg } = buildPlanSvg(square())
    expect(count(svg, 'data-dim-line="wall"')).toBe(4)
    expect(count(svg, 'data-dim-ticks="wall"')).toBe(4)
    // The value is the INSIDE face of the wall, and the survey label goes in front of it.
    expect(svg).toContain('>SE-1</tspan> 412<')
    expect(svg).toContain('>SE-2</tspan> 302<')
  })

  it('uses the light paper colours: line #475569, text #334155, white halo', () => {
    const { svg } = buildPlanSvg(square())
    expect(svg).toContain('stroke="#475569"')
    expect(svg).toContain('fill="#334155"')
    expect(svg).toContain('stroke="#ffffff"')
    // No dark mode class or colour in the export.
    expect(svg).not.toContain('dark:')
  })

  it('writes a measured wall in green and bold with ✓', () => {
    const d = square()
    d.measurements = { 'SE-1': { label: 'SE-1', actualCm: 414, updatedAt: now } }
    const { svg } = buildPlanSvg(d)
    expect(svg).toMatch(/fill="#15803d" font-weight="600"/)
    expect(svg).toContain('✓ 414 · 412')
  })

  it('the Text style keeps the old output: a text only, no line and no tick', () => {
    const { svg } = buildPlanSvg(square(), { dimStyle: 'text' })
    expect(svg).not.toContain('data-dim-line')
    expect(svg).not.toContain('data-dim-ticks')
    // The old text writes the CENTRE line length, as before this round.
    expect(svg).toContain('>SE-1</tspan>  422</text>')
    expect(svg).toContain('data-dim="SE-1"')
  })

  it('drops the survey label when the option is off', () => {
    const on = buildPlanSvg(square()).svg
    const off = buildPlanSvg(square(), { surveyLabels: false }).svg
    expect(on).toContain('>SE-1</tspan>')
    expect(off).not.toContain('>SE-1</tspan>')
    // The data attribute stays, so a test can still find the face.
    expect(off).toContain('data-dim="SE-1"')
  })
})

describe('buildPlanSvg: units', () => {
  it('writes metres with a comma decimal and two decimals', () => {
    const { svg } = buildPlanSvg(square(), { units: { unit: 'm', decimals: 2 } })
    expect(svg).toContain('>SE-1</tspan> 4,12<')
    expect(svg).toContain('>SE-2</tspan> 3,02<')
  })

  it('writes millimetres without decimals', () => {
    const { svg } = buildPlanSvg(square(), { units: { unit: 'mm', decimals: 0 } })
    expect(svg).toContain('>SE-1</tspan> 4120<')
  })

  it('keeps centimetres with one decimal by default', () => {
    const { svg } = buildPlanSvg(square())
    expect(svg).toContain('>SE-1</tspan> 412<')
  })
})

describe('buildPlanSvg: room tag', () => {
  it('writes the code, the name and the area by default (as the plan)', () => {
    const { svg } = buildPlanSvg(square())
    expect(svg).toContain('data-room-label="r1"')
    expect(svg).toContain('data-room-code-text="SE"')
    expect(svg).toContain('12,44 m²') // 412 x 302 cm
    expect(svg).not.toContain('data-room-tag-row="1"')
  })

  it('writes the rows the View menu turns on', () => {
    const d = docOf(room(422, 312, { ceilingCm: 250 }))
    d.measurements = { 'SE-1': { label: 'SE-1', actualCm: 412, updatedAt: now } }
    const { svg } = buildPlanSvg(d, {
      roomTag: { code: true, name: true, area: true, perimeter: true, ceiling: true, progress: true, areaDecimals: 2 },
    })
    expect(svg).toContain('data-room-tag-row="0"')
    expect(svg).toContain('P 14,28 m') // 2 x (412 + 302) cm
    expect(svg).toContain('H 2,50 m')
    expect(svg).toContain('1/4 walls')
  })

  it('shows the code alone in a room too small for a tag', () => {
    // 20 x 20 cm: less than 50 screen px on the paper (about 27 cm at this font size).
    const svg = buildPlanSvg(docOf(room(20, 20))).svg
    expect(svg).toContain('data-room-code-only="r1"')
    expect(svg).not.toContain('data-room-tag="r1"')
  })

  it('keeps the name only when the code is off', () => {
    const { svg } = buildPlanSvg(square(), { roomTag: { ...DEFAULT_TAG_FIELDS, code: false } })
    expect(svg).not.toContain('data-room-code-text')
    expect(svg).toContain('data-room-label="r1"')
  })
})

describe('buildPlanSvg: outside chains', () => {
  it('writes outside rows for a v2 document and grows the image', () => {
    const v2 = ensureV2(square())
    expect(v2.schemaVersion).toBe(2)
    const on = buildPlanSvg(v2, { outside: true })
    const off = buildPlanSvg(v2, { outside: false })
    // One run per side of the rectangle, one row each (chain = overall on a single span).
    expect(count(on.svg, 'data-dim-line="outside"')).toBe(4)
    expect(on.svg).toContain('data-dim-ext="')
    // One segment per side: the chain segment and the overall row are the same line, so it keeps
    // the facade survey label of the wall.
    expect(on.svg).toMatch(/data-dim="W\d-E"/)
    // Outside corner to outside corner: 422 cm between the centre lines + 2 x 5 cm of wall.
    expect(on.svg).toContain(' 432<')
    expect(on.svg).toContain(' 322<')
    expect(off.svg).not.toContain('data-dim-line="outside"')
    // The rows are outside the wall band: the image must be bigger to keep them.
    expect(on.height).toBeGreaterThan(off.height)
    expect(on.width).toBeGreaterThanOrEqual(off.width)
  })

  it('writes no outside row for a v1 document (no stored walls)', () => {
    const { svg } = buildPlanSvg(square(), { outside: true })
    expect(svg).not.toContain('data-dim-line="outside"')
  })
})

describe('room schedule in the export', () => {
  it('adds the table under the legend only when the option is on, and grows the image', () => {
    const doc = {
      projectId: 'p', title: 't', rooms: [{
        id: 'r1', code: 'SE', name: 'Séjour', walkOrder: 1, holes: [], walls: {},
        vertices: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 400, y: 0 }, { id: 'c', x: 400, y: 300 }, { id: 'd', x: 0, y: 300 }],
      }],
      elements: [], measurements: {}, roomNotes: {}, tapes: [],
    } as unknown as Parameters<typeof buildPlanSvg>[0]
    const off = buildPlanSvg(doc, { date: '2026-11-24' })
    const on = buildPlanSvg(doc, { date: '2026-11-24', schedule: true })
    expect(off.svg).not.toContain('id="schedule"')
    expect(on.svg).toContain('id="schedule"')
    expect(on.svg).toContain('Room schedule')
    expect(on.svg).toContain('Séjour')
    expect(on.height).toBeGreaterThan(off.height)
  })
})

// Built-in storage (docs/storage-plan.md, step 4): the storage room is drawn like a room, in the
// light amber fill and hatch of the Edit Mode canvas, with a small label and the legend entry.
describe('built-in storage in the export', () => {
  /** The sample rectangle plus a storage room of 60 x 40 outside its wall 4 (above y = 0). */
  const storageRoom = (over: Partial<Room> = {}): Room => ({
    id: 'r2',
    code: 'R1',
    name: 'Storage',
    walkOrder: 2,
    vertices: [
      { id: 's1', x: 97.5, y: 0 },
      { id: 's2', x: 162.5, y: 0 },
      { id: 's3', x: 162.5, y: -45 },
      { id: 's4', x: 97.5, y: -45 },
    ],
    holes: [],
    walls: { s1: { type: 'partition', thicknessCm: 10 }, s2: { type: 'partition', thicknessCm: 5 }, s3: { type: 'partition', thicknessCm: 5 }, s4: { type: 'partition', thicknessCm: 5 } },
    storage: { parentRoomId: 'r1' },
    ...over,
  })
  const withStorage = () => ({ ...docOf(room(422, 312)), rooms: [room(422, 312), storageRoom()] })

  it('fills the storage in the light amber of the plan and hatches it', () => {
    const { svg } = buildPlanSvg(withStorage(), { date: '2026-11-24' })
    expect(svg).toContain('data-room-storage="true"')
    expect(svg).toContain('fill="#fffbeb"')
    expect(svg).toContain('url(#storage-hatch)')
    expect(svg).toContain('id="storage-hatch"')
  })

  it('writes a small label with the name and the area of the storage', () => {
    const { svg } = buildPlanSvg(withStorage(), { date: '2026-11-24' })
    expect(svg).toContain('data-room-storage-label="r2"')
    expect(svg).toContain('>Storage</tspan>')
    // The area of the inside ring follows the name.
    const label = /data-room-storage-label="r2"[^>]*>(.*?)<\/text>/.exec(svg)![1]
    expect(label).toMatch(/m²/)
  })

  it('adds the legend entry only when the plan has a storage', () => {
    const without = buildPlanSvg(square(), { date: '2026-11-24' })
    const withSt = buildPlanSvg(withStorage(), { date: '2026-11-24' })
    expect(without.svg).not.toContain('Built-in storage')
    expect(withSt.svg).toContain('Built-in storage')
  })
})

// The export writes the room wall values with the rules of the plan (visual review V-1, V-2, V-3,
// V-6, V-7): one declutter pass over the whole plan, at the paper zoom.
describe('buildPlanSvg: the declutter rules of the plan', () => {
  beforeEach(() => {
    useDoc.setState({ doc: emptyDoc() })
  })

  it('the demo apartment shows no two values that overlap, and no value past a line end', () => {
    loadDemoApartment()
    const doc = useDoc.getState().doc
    const res = buildPlanSvg(doc)
    const layout = res.layout!
    const entries = layout.rooms.flatMap((x) => x.entries)
    const drawn = entries.filter((e) => e.box)
    // The plan is dense: most faces keep a value, and some lose it to the pass.
    expect(drawn.length).toBeGreaterThan(10)
    expect(drawn.length).toBeLessThan(entries.length)
    for (const e of entries) {
      // Rule 2: a value never goes past the end of its line (the line keeps its length, the text or
      // nothing). So no wall line is marked "outside".
      expect(e.line?.outside ?? false).toBe(false)
    }
    // Rule 1 of the pass: no two drawn values have boxes that overlap.
    for (let i = 0; i < drawn.length; i++) {
      for (let j = i + 1; j < drawn.length; j++) {
        expect(boxHit(drawn[i].box!, drawn[j].box!)).toBe(false)
      }
    }
    // And no drawn value touches a room tag or an outside row text.
    expect(layout.blockers.length).toBeGreaterThan(0)
    for (const e of drawn) {
      for (const b of layout.blockers) expect(boxHit(e.box!, b)).toBe(false)
    }
    // The image itself: the outside rows are off, so nothing at all goes past a line end.
    expect(res.svg).not.toContain('data-dim-outside')
  })

  it('a room too small on the paper shows no wall dimension (V-2)', () => {
    const big = room(600, 500)
    // 45 x 35 cm on the centre line: under px(60) in both directions at this font size.
    const tiny: Room = {
      id: 'r2', code: 'WC', name: 'Wc', walkOrder: 2, holes: [], walls: {},
      vertices: [
        { id: 'w1', x: 700, y: 0 },
        { id: 'w2', x: 745, y: 0 },
        { id: 'w3', x: 745, y: 35 },
        { id: 'w4', x: 700, y: 35 },
      ],
    }
    const res = buildPlanSvg(docOf(big, { rooms: [big, tiny] }))
    const layout = res.layout!
    // No line and no value for the tiny room ...
    expect(layout.rooms.find((x) => x.room.id === 'r2')!.entries).toEqual([])
    expect(res.svg).not.toContain('data-dim="WC-')
    // ... and the big room keeps its four values.
    expect(layout.rooms.find((x) => x.room.id === 'r1')!.entries.filter((e) => e.box)).toHaveLength(4)
    expect(res.svg).toContain('data-dim="SE-1"')
  })
})
