import { describe, expect, it } from 'vitest'
import { parsePlan } from '../../core/schema'
import type { PlanDoc, Room, SurfaceReference } from '../../model/types'
import { apartmentTotals, compareReference, parseCeilingInput, parseSurfaceInput, totalAreaM2 } from './logic'

const rect = (code: string, x: number, y: number, w: number, h: number, over: Partial<Room> = {}): Room => ({
  id: `room_${code}`,
  code,
  name: code,
  walkOrder: 1,
  holes: [],
  walls: {},
  vertices: [
    { id: `${code}_0`, x, y },
    { id: `${code}_1`, x: x + w, y },
    { id: `${code}_2`, x: x + w, y: y + h },
    { id: `${code}_3`, x, y: y + h },
  ],
  ...over,
})

/** SE 4x3 m (12 m²), CU 2x3 m (6 m²), BA balcony 4x1 m outdoor (4 m²). */
const mkDoc = (over: Partial<PlanDoc> = {}): PlanDoc => ({
  projectId: 'p1',
  title: 'Apt',
  rooms: [
    rect('SE', 0, 0, 400, 300, { ceilingCm: 260 }),
    rect('CU', 400, 0, 200, 300),
    rect('BA', 0, 300, 400, 100, { outdoor: true }),
  ],
  elements: [],
  measurements: {},
  roomNotes: {},
  tapes: [],
  pins: [],
  ...over,
})

const ref = (over: Partial<SurfaceReference> = {}): SurfaceReference => ({
  id: 'ref_0',
  source: 'carrez',
  surfaceM2: 18,
  ...over,
})

describe('apartment: totals', () => {
  it('separates indoor and outdoor areas and counts rooms', () => {
    const t = apartmentTotals(mkDoc())
    expect(t.roomCount).toBe(3)
    expect(t.indoorRoomCount).toBe(2)
    expect(t.outdoorRoomCount).toBe(1)
    expect(t.indoorAreaM2).toBe(18)
    expect(t.outdoorAreaM2).toBe(4)
    expect(t.wallPerimeterM).toBe(24) // 14 (SE) + 10 (CU), outdoor excluded
    expect(totalAreaM2(mkDoc().rooms)).toBeCloseTo(22)
  })

  it('computes the volume from the effective ceiling and reports missing heights', () => {
    expect(apartmentTotals(mkDoc()).volumeM3).toBeCloseTo(12 * 2.6) // only SE has a height
    const withDefault = apartmentTotals(mkDoc({ apartment: { defaultCeilingCm: 200 } }))
    expect(withDefault.defaultCeilingCm).toBe(200)
    expect(withDefault.volumeM3).toBeCloseTo(12 * 2.6 + 6 * 2) // SE keeps its own height
    expect(withDefault.roomsWithOwnCeiling).toBe(1)
    expect(withDefault.roomsWithoutCeiling).toBe(0)
    expect(apartmentTotals(mkDoc()).roomsWithoutCeiling).toBe(1)
  })

  it('counts rooms that override the default height and the survey progress', () => {
    const t = apartmentTotals(mkDoc({ apartment: { defaultCeilingCm: 250 } }))
    expect(t.roomsWithOwnCeiling).toBe(1) // SE
    expect(t.measured).toEqual({ done: 0, total: 15 }) // 3 rooms x (4 walls + 1 height)
    const doc = mkDoc()
    doc.measurements = { 'SE-1': { label: 'SE-1', actualCm: 401, updatedAt: '2026-01-01T00:00:00Z' } }
    expect(apartmentTotals(doc).measured.done).toBe(1)
  })

  it('works on an empty doc and on a legacy doc without apartment data', () => {
    const empty = parsePlan({ projectId: 'p', rooms: [] })
    const t = apartmentTotals(empty)
    expect(t.roomCount).toBe(0)
    expect(t.indoorAreaM2).toBe(0)
    expect(t.volumeM3).toBe(0)
    expect(t.defaultCeilingCm).toBeNull()
    expect(t.measured).toEqual({ done: 0, total: 0 })
  })
})

describe('apartment: compareReference', () => {
  it('compares with the whole indoor area when no room is given', () => {
    const c = compareReference(mkDoc(), ref({ surfaceM2: 18 }))
    expect(c.scope).toBe('apartment')
    expect(c.planM2).toBe(18)
    expect(c.diffM2).toBe(0)
    expect(c.diffPct).toBe(0)
    expect(c.level).toBe('ok')
    expect(c.missingRoom).toBe(false)
  })

  it('compares with one room when roomCode is set', () => {
    const c = compareReference(mkDoc(), ref({ surfaceM2: 12, roomCode: 'SE' }))
    expect(c.scope).toBe('room')
    expect(c.planM2).toBe(12)
    expect(c.level).toBe('ok')
  })

  it('colours the difference: green ≤ 2 %, amber ≤ 5 %, red > 5 %', () => {
    const doc = mkDoc()
    expect(compareReference(doc, ref({ surfaceM2: 18.3 })).level).toBe('ok') // -1.6 %
    expect(compareReference(doc, ref({ surfaceM2: 18.5 })).level).toBe('warn') // -2.7 %
    expect(compareReference(doc, ref({ surfaceM2: 17.2 })).level).toBe('warn') // +4.7 %
    expect(compareReference(doc, ref({ surfaceM2: 20 })).level).toBe('bad') // -10 %
  })

  it('reports the signed difference in m² and %', () => {
    const c = compareReference(mkDoc(), ref({ surfaceM2: 16 }))
    expect(c.diffM2).toBe(2)
    expect(c.diffPct).toBe(12.5)
    expect(c.level).toBe('bad')
  })

  it('handles a reference to a room that does not exist', () => {
    const c = compareReference(mkDoc(), ref({ roomCode: 'ZZ', surfaceM2: 10 }))
    expect(c.planM2).toBeNull()
    expect(c.diffM2).toBeNull()
    expect(c.level).toBe('unknown')
    expect(c.missingRoom).toBe(true)
  })
})

describe('apartment: input parsing', () => {
  it('parses comma decimals and rejects invalid values', () => {
    expect(parseCeilingInput('250')).toBe(250)
    expect(parseCeilingInput(' 250,5 ')).toBe(250.5)
    expect(parseCeilingInput('')).toBeNull()
    expect(parseCeilingInput('0')).toBeNull()
    expect(parseCeilingInput('abc')).toBeNull()
    expect(parseSurfaceInput('62,4')).toBe(62.4)
    expect(parseSurfaceInput('-1')).toBeNull()
  })
})
