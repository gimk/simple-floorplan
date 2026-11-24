// Tests of the measurements of the exported plan (docs/measurements-plan.md): the wall lengths as
// dimension lines (or the old text), the room tag rows, and the outside chains of a v2 document.
import { describe, expect, it } from 'vitest'
import { emptyDoc } from '../../model/store'
import type { PlanDoc, Room } from '../../model/types'
import { ensureV2 } from '../../model/v2/ensure'
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
