// Rows, CSV and SVG table of the room schedule (docs/measurements-plan.md section 6):
// walk order, outdoor rooms out of the totals, ceiling height from the apartment default,
// volume, survey progress, and the French Excel format (';' and comma decimals).
import { describe, expect, it } from 'vitest'
import type { Measurement, PlanDoc, Room } from '../../model/types'
import {
  csvCell, roomCeilingCm, scheduleCsv, scheduleRows, scheduleSvgTable, scheduleTableHeight,
  scheduleTableWidth, totalsOf, volumeM3,
} from './rows'

/** 400 x 300 cm room with 10 cm walls: inside faces 390 x 290 (area 11,31 m², perimeter 13,60 m). */
const rect = (over: Partial<Room> = {}): Room => ({
  id: 'r1', code: 'CU', name: 'Cuisine', holes: [], walls: {}, walkOrder: 0,
  vertices: [
    { id: 'a', x: 0, y: 0 }, { id: 'b', x: 400, y: 0 }, { id: 'c', x: 400, y: 300 }, { id: 'd', x: 0, y: 300 },
  ],
  ...over,
})

/** Second room, next to the first one in the walk-through. */
const living = (over: Partial<Room> = {}): Room =>
  rect({
    id: 'r2', code: 'SE', name: 'Séjour', walkOrder: 1,
    vertices: [
      { id: 'e', x: 400, y: 0 }, { id: 'f', x: 1000, y: 0 }, { id: 'g', x: 1000, y: 300 }, { id: 'h', x: 400, y: 300 },
    ],
    ...over,
  })

const doc = (over: Partial<PlanDoc> = {}): PlanDoc => ({
  projectId: 'p1',
  title: 'Rue Exemple',
  rooms: [rect()],
  elements: [],
  measurements: {},
  roomNotes: {},
  tapes: [],
  ...over,
})

const measured = (labels: string[]): Record<string, Measurement> =>
  Object.fromEntries(labels.map((label) => [label, { label, actualCm: 300, updatedAt: '2026-01-01T00:00:00.000Z' }]))

describe('scheduleRows: one row per room', () => {
  it('gives the code, the name, the area and the perimeter of a room', () => {
    const { rows } = scheduleRows(doc())
    expect(rows).toHaveLength(1)
    expect(rows[0].roomId).toBe('r1')
    expect(rows[0].code).toBe('CU')
    expect(rows[0].name).toBe('Cuisine')
    expect(rows[0].outdoor).toBe(false)
    // Inside faces 390 x 290: area 11,31 m², perimeter 1360 cm.
    expect(rows[0].areaM2).toBeCloseTo(11.31, 6)
    expect(rows[0].perimeterCm).toBeCloseTo(1360, 6)
  })

  it('follows the walk order, not the order of the document', () => {
    const { rows } = scheduleRows(doc({ rooms: [living(), rect()] }))
    expect(rows.map((r) => r.code)).toEqual(['CU', 'SE'])
    const reversed = scheduleRows(doc({ rooms: [living({ walkOrder: 0 }), rect({ walkOrder: 5 })] }))
    expect(reversed.rows.map((r) => r.code)).toEqual(['SE', 'CU'])
  })

  it('takes the ceiling height of the room, else the apartment default', () => {
    expect(scheduleRows(doc({ rooms: [rect({ ceilingCm: 250 })] })).rows[0].ceilingCm).toBe(250)
    // No own height: the apartment default is used.
    expect(scheduleRows(doc({ apartment: { defaultCeilingCm: 260 } })).rows[0].ceilingCm).toBe(260)
    // The room wins over the apartment default.
    expect(scheduleRows(doc({ rooms: [rect({ ceilingCm: 240 })], apartment: { defaultCeilingCm: 260 } })).rows[0].ceilingCm).toBe(240)
    // No value anywhere: no ceiling, no volume.
    const none = scheduleRows(doc()).rows[0]
    expect(none.ceilingCm).toBeUndefined()
    expect(none.volumeM3).toBeUndefined()
    // A height of 0 counts as no height (same rule as the room tag).
    expect(roomCeilingCm(rect({ ceilingCm: 0 }), 0)).toBeUndefined()
    expect(roomCeilingCm(rect(), undefined)).toBeUndefined()
  })

  it('computes the volume when the ceiling height is known', () => {
    const row = scheduleRows(doc({ rooms: [rect({ ceilingCm: 250 })] })).rows[0]
    // 11,31 m² x 2,50 m = 28,275 m³.
    expect(row.volumeM3).toBeCloseTo(28.275, 6)
    expect(volumeM3(20, 250)).toBeCloseTo(50, 6)
    expect(volumeM3(20, undefined)).toBeUndefined()
  })

  it('counts the measured walls and the walls of a room', () => {
    expect(scheduleRows(doc()).rows[0]).toMatchObject({ measuredWalls: 0, walls: 4 })
    const some = scheduleRows(doc({ measurements: measured(['CU-1', 'CU-3', 'CU-D']) })).rows[0]
    expect(some).toMatchObject({ measuredWalls: 2, walls: 4 })
  })
})

describe('scheduleRows: the totals', () => {
  it('adds up the indoor rooms only', () => {
    const d = doc({
      rooms: [rect({ ceilingCm: 250 }), living({ ceilingCm: 250 }), rect({ id: 'r3', code: 'BA', name: 'Balcon', outdoor: true, walkOrder: 2 })],
    })
    const { rows, totals } = scheduleRows(d)
    // The balcony is a row, marked outdoor.
    expect(rows).toHaveLength(3)
    expect(rows[2].outdoor).toBe(true)
    expect(totals.rooms).toBe(2)
    expect(totals.areaM2).toBeCloseTo(11.31 + 17.11, 6)
    expect(totals.volumeM3).toBeCloseTo((11.31 + 17.11) * 2.5, 6)
    expect(totals.missingCeiling).toBe(0)
    expect(totals.walls).toBe(8)
    expect(totals.measuredWalls).toBe(0)
  })

  it('leaves a room without a ceiling height out of the volume and counts it', () => {
    const d = doc({ rooms: [rect({ ceilingCm: 250 }), living({ walkOrder: 1 })], apartment: {} })
    const { totals } = scheduleRows(d)
    expect(totals.rooms).toBe(2)
    expect(totals.volumeM3).toBeCloseTo(11.31 * 2.5, 6)
    expect(totals.missingCeiling).toBe(1)
  })

  it('gives empty totals for a document without rooms', () => {
    const { rows, totals } = scheduleRows(doc({ rooms: [] }))
    expect(rows).toEqual([])
    expect(totals).toEqual({ rooms: 0, areaM2: 0, volumeM3: 0, missingCeiling: 0, measuredWalls: 0, walls: 0 })
    expect(totalsOf([])).toEqual(totals)
  })
})

describe('scheduleCsv: French Excel', () => {
  const d = doc({
    rooms: [rect({ ceilingCm: 250, name: 'Cuisine; coin repas' }), living({ name: 'Séjour', walkOrder: 1 }), rect({ id: 'r3', code: 'BA', name: 'Balcon', outdoor: true, walkOrder: 2 })],
    measurements: measured(['CU-1']),
  })

  it('starts with a header line and uses ";" between the cells', () => {
    const lines = scheduleCsv(scheduleRows(d).rows).split('\r\n')
    expect(lines[0]).toBe('Code;Name;Area (m2);Perimeter (m);Ceiling (m);Volume (m3);Measured walls;Walls;Outdoor')
    expect(lines).toHaveLength(4)
  })

  it('writes comma decimals and metres for the lengths', () => {
    const lines = scheduleCsv(scheduleRows(d).rows).split('\r\n')
    // Area 11,31 m²; perimeter 13,60 m; ceiling 2,50 m; volume 28,28 m³.
    expect(lines[1]).toBe('CU;"Cuisine; coin repas";11,31;13,60;2,50;28,27;1;4;')
    // No ceiling height: empty ceiling and volume cells.
    expect(lines[2]).toBe('SE;Séjour;17,11;17,60;;;0;4;')
  })

  it('marks the outdoor rooms and keeps them in the file', () => {
    const lines = scheduleCsv(scheduleRows(d).rows).split('\r\n')
    expect(lines[3]).toBe('BA;Balcon;11,31;13,60;;;0;4;yes')
  })

  it('adds a total line when the totals are given', () => {
    const { rows, totals } = scheduleRows(d)
    const lines = scheduleCsv(rows, { areaDecimals: 2, totals }).split('\r\n')
    // The balcony is not in the total.
    expect(lines[4]).toBe(';Total;28,42;;;28,27;1;8;')
  })

  it('follows the area decimals of the room tag', () => {
    const { rows } = scheduleRows(doc())
    expect(scheduleCsv(rows, { areaDecimals: 0 }).split('\r\n')[1].split(';')[2]).toBe('11')
    expect(scheduleCsv(rows, { areaDecimals: 1 }).split('\r\n')[1].split(';')[2]).toBe('11,3')
  })

  it('quotes a cell that holds the separator, a quote or a line break', () => {
    expect(csvCell('plain')).toBe('plain')
    expect(csvCell('a;b')).toBe('"a;b"')
    expect(csvCell('a"b')).toBe('"a""b"')
    expect(csvCell('a\nb')).toBe('"a\nb"')
  })
})

describe('scheduleSvgTable', () => {
  const d = doc({
    rooms: [rect({ ceilingCm: 250, name: 'Cuisine & coin <repas>' })],
    measurements: measured(['CU-1', 'CU-2']),
  })

  it('returns one group with the header and one line per room', () => {
    const { rows } = scheduleRows(d)
    const svg = scheduleSvgTable(rows, { x: 10, y: 20, fontSize: 4 })
    expect(svg.startsWith('<g')).toBe(true)
    expect(svg.endsWith('</g>')).toBe(true)
    expect(svg).toContain('font-size="4"')
    expect(svg).toContain('>Code<')
    expect(svg).toContain('>Area m²<')
    // One <text> per column of the header, plus seven per row: no cell is missing.
    expect(svg.match(/<text/g)).toHaveLength(7 + 7)
    // The row values: area, perimeter, ceiling, volume, progress.
    expect(svg).toContain('>11,31<')
    expect(svg).toContain('>13,60<')
    expect(svg).toContain('>2,50<')
    expect(svg).toContain('>28,27<')
    expect(svg).toContain('>2/4<')
  })

  it('puts the table at x and y, and escapes the text of a name', () => {
    const { rows } = scheduleRows(d)
    const svg = scheduleSvgTable(rows, { x: 10, y: 20, fontSize: 4 })
    // The first text of the first column starts at x + half a font size, at y + 0.7 row.
    expect(svg).toContain('x="12" y="24.48" text-anchor="start" font-weight="600">Code<')
    expect(svg).toContain('Cuisine &amp; coin &lt;repas&gt;')
    expect(svg).not.toContain('<repas>')
  })

  it('adds a total line when the totals are given', () => {
    const { rows, totals } = scheduleRows(d)
    const withTotals = scheduleSvgTable(rows, { x: 0, y: 0, fontSize: 4, totals })
    expect(withTotals).toContain('Total (1 rooms)')
    expect(withTotals.match(/<text/g)).toHaveLength(7 + 7 + 4)
  })

  it('reports the size of the table for the caller', () => {
    // 4 cm font: header 6.4 cm, 49 columns of font sizes.
    expect(scheduleTableHeight(3, 4)).toBeCloseTo(4 * 1.6 * 4, 6)
    expect(scheduleTableHeight(3, 4, true)).toBeCloseTo(4 * 1.6 * 5, 6)
    expect(scheduleTableWidth(4)).toBeCloseTo(55 * 4, 6)
  })
})
