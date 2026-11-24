// Rows of the room tag (docs/measurements-plan.md section 2): the title, the order of the rows,
// the area decimals, and the values taken from the room (perimeter, ceiling, survey progress).
import { describe, expect, it } from 'vitest'
import type { RoomTagFields } from '../../model/store'
import type { Measurement, Room } from '../../model/types'
import { decimalText, outlinePerimeterCm, roomPerimeterCm, roomTagLines, tagCeilingCm, wallProgress } from './roomTag'

/** The defaults of the View menu: code, name and area, two decimals (nothing changes today). */
const FIELDS: RoomTagFields = {
  code: true, name: true, area: true, perimeter: false, ceiling: false, progress: false, areaDecimals: 2,
}

const ALL: RoomTagFields = {
  code: true, name: true, area: true, perimeter: true, ceiling: true, progress: true, areaDecimals: 2,
}

/** 400 x 300 cm room, corners "CU-1".. with the survey codes; walls 10 cm thick by default. */
const rect = (over: Partial<Room> = {}): Room => ({
  id: 'r1', code: 'CU', name: 'Cuisine', holes: [], walls: {}, walkOrder: 0,
  vertices: [
    { id: 'a', x: 0, y: 0 }, { id: 'b', x: 400, y: 0 }, { id: 'c', x: 400, y: 300 }, { id: 'd', x: 0, y: 300 },
  ],
  ...over,
})

const measured = (labels: string[]): Record<string, Measurement> =>
  Object.fromEntries(labels.map((label) => [label, { label, actualCm: 300, updatedAt: '2026-01-01T00:00:00.000Z' }]))

describe('roomTagLines: the title', () => {
  it('gives the code and the name, as the label shows them today', () => {
    const tag = roomTagLines({ name: 'Cuisine', codes: ['CU'], areaM2: 12, perimeterCm: 0, measuredWalls: 0, walls: 0 }, FIELDS)
    expect(tag.title).toEqual({ code: 'CU', name: 'Cuisine' })
    expect(tag.rows).toEqual(['12,00 m²'])
  })

  it('joins the codes of the rooms merged in the After view', () => {
    const tag = roomTagLines({ name: 'Séjour + Cuisine', codes: ['SE', 'CU'], areaM2: 30, perimeterCm: 0, measuredWalls: 0, walls: 0 }, FIELDS)
    expect(tag.title.code).toBe('SE CU')
  })

  it('leaves out the code when the field is off, or when the layer hides it', () => {
    const input = { name: 'Cuisine', codes: ['CU'], areaM2: 12, perimeterCm: 0, measuredWalls: 0, walls: 0 }
    expect(roomTagLines(input, { ...FIELDS, code: false }).title.code).toBeUndefined()
    expect(roomTagLines(input, FIELDS, { showCodes: false }).title.code).toBeUndefined()
    expect(roomTagLines(input, FIELDS, { showCodes: true }).title.code).toBe('CU')
  })

  it('leaves out the name when the field is off', () => {
    const tag = roomTagLines({ name: 'Cuisine', codes: ['CU'], areaM2: 12, perimeterCm: 0, measuredWalls: 0, walls: 0 }, { ...FIELDS, name: false })
    expect(tag.title.name).toBeUndefined()
    expect(tag.title.code).toBe('CU')
  })
})

describe('roomTagLines: the rows', () => {
  const input = { name: 'Cuisine', codes: ['CU'], areaM2: 12.345, perimeterCm: 1360, ceilingCm: 250, measuredWalls: 4, walls: 6 }

  it('keeps the order area, perimeter, ceiling, progress', () => {
    expect(roomTagLines(input, ALL).rows).toEqual(['12,35 m²', 'P 13,60 m', 'H 2,50 m', '4/6 walls'])
  })

  it('writes the area with 0, 1 or 2 decimals and a comma', () => {
    const area = (areaDecimals: 0 | 1 | 2) => roomTagLines({ ...input, areaM2: 12.345 }, { ...FIELDS, areaDecimals }).rows[0]
    expect(area(0)).toBe('12 m²')
    expect(area(1)).toBe('12,3 m²')
    expect(area(2)).toBe('12,35 m²')
    expect(decimalText(1360 / 100, 2)).toBe('13,60')
  })

  it('shows the perimeter in metres, two decimals', () => {
    expect(roomTagLines({ ...input, perimeterCm: 1420 }, ALL).rows).toContain('P 14,20 m')
  })

  it('skips the ceiling height when the room has none', () => {
    const rows = roomTagLines({ ...input, ceilingCm: undefined }, ALL).rows
    expect(rows).toContain('P 13,60 m')
    expect(rows.some((r) => r.startsWith('H '))).toBe(false)
  })

  it('skips the progress of a room with no walls', () => {
    const rows = roomTagLines({ ...input, measuredWalls: 0, walls: 0 }, ALL).rows
    expect(rows.some((r) => r.endsWith(' walls'))).toBe(false)
  })

  it('shows no row when every field is off', () => {
    const off = { code: true, name: true, area: false, perimeter: false, ceiling: false, progress: false, areaDecimals: 2 } as RoomTagFields
    expect(roomTagLines(input, off).rows).toEqual([])
  })
})

describe('values taken from a room', () => {
  it('measures the perimeter on the inside faces (10 cm walls, 400 x 300)', () => {
    // Inside faces: 390 + 290 + 390 + 290.
    expect(roomPerimeterCm(rect())).toBeCloseTo(1360, 6)
    expect(roomPerimeterCm(rect({ walls: { a: { type: 'partition', thicknessCm: 20 } } }))).toBeLessThan(1360)
  })

  it('takes the perimeter of the outline of a merged group', () => {
    const pieces = [[[
      { x: 0, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 300 }, { x: 0, y: 300 },
    ]]]
    expect(outlinePerimeterCm(pieces)).toBeCloseTo(1800, 6)
    // A hole (second ring) does not count in the perimeter of the outline.
    expect(outlinePerimeterCm([[...pieces[0], [{ x: 10, y: 10 }, { x: 20, y: 10 }, { x: 20, y: 20 }]]])).toBeCloseTo(1800, 6)
    expect(outlinePerimeterCm([])).toBe(0)
  })

  it('counts the walls of the room that have a measured value', () => {
    // The four walls of the room are CU-1..CU-4 (the diagonal and the height are not walls).
    expect(wallProgress([rect()], {})).toEqual({ measured: 0, walls: 4 })
    expect(wallProgress([rect()], measured(['CU-1', 'CU-3', 'CU-D', 'CU-H']))).toEqual({ measured: 2, walls: 4 })
    // A value of 0 is not a measured wall.
    expect(wallProgress([rect()], { 'CU-1': { label: 'CU-1', actualCm: 0, updatedAt: '' } })).toEqual({ measured: 0, walls: 4 })
  })

  it('adds up the walls of a group of rooms', () => {
    const second = rect({ id: 'r2', code: 'SE', walls: {} })
    // Two rooms of four walls: eight walls, two of them measured.
    expect(wallProgress([rect(), second], measured(['CU-1', 'SE-2']))).toEqual({ measured: 2, walls: 8 })
  })

  it('keeps the ceiling of a group only when every room has the same height', () => {
    expect(tagCeilingCm([])).toBeUndefined()
    expect(tagCeilingCm([rect()])).toBeUndefined()
    expect(tagCeilingCm([rect({ ceilingCm: 250 })])).toBe(250)
    expect(tagCeilingCm([rect({ ceilingCm: 250 }), rect({ id: 'r2', ceilingCm: 250 })])).toBe(250)
    expect(tagCeilingCm([rect({ ceilingCm: 250 }), rect({ id: 'r2', ceilingCm: 270 })])).toBeUndefined()
    expect(tagCeilingCm([rect({ ceilingCm: 250 }), rect({ id: 'r2' })])).toBeUndefined()
    // A height of 0 counts as no height (same rule as hasOwnCeiling()).
    expect(tagCeilingCm([rect({ ceilingCm: 0 })])).toBeUndefined()
  })
})
