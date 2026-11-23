import { describe, expect, it } from 'vitest'
import type { PlanDoc, Room } from '../../model/types'
import { progressRows, progressTotals } from './logic'

const rect = (over: Partial<Room> = {}): Room => ({
  id: 'r1',
  code: 'SE',
  name: 'Séjour',
  holes: [],
  walls: {},
  walkOrder: 1,
  vertices: [
    { id: 'v0', x: 0, y: 0 },
    { id: 'v1', x: 400, y: 0 },
    { id: 'v2', x: 400, y: 300 },
    { id: 'v3', x: 0, y: 300 },
  ],
  ...over,
})

const doc = (over: Partial<PlanDoc> = {}): PlanDoc => ({
  projectId: 'local',
  title: 'Test',
  rooms: [rect()],
  elements: [],
  measurements: {},
  roomNotes: {},
  tapes: [],
  pins: [],
  ...over,
})

/** One on-site value, keyed by its survey label (SE-1 is the wall that starts at v0). */
const vals = (pairs: [string, number][]) =>
  Object.fromEntries(pairs.map(([label, actualCm]) => [label, { label, actualCm, updatedAt: '' }]))

const CU = rect({ id: 'r2', code: 'CU', name: 'Cuisine', vertices: [
  { id: 'c0', x: 0, y: 0 },
  { id: 'c1', x: 200, y: 0 },
  { id: 'c2', x: 200, y: 300 },
  { id: 'c3', x: 0, y: 300 },
] })

describe('progressRows', () => {
  it('gives one row per room, in document order, with the counts', () => {
    const rows = progressRows(doc({ rooms: [rect(), CU] }))
    expect(rows.map((r) => r.code)).toEqual(['SE', 'CU'])
    expect(rows.map((r) => r.name)).toEqual(['Séjour', 'Cuisine'])
    expect(rows[0]).toMatchObject({ roomId: 'r1', verified: 0, walls: 4, residualCm: null, allLocked: false })
  })

  it('counts the verified walls and the fit error', () => {
    // Inside faces: 400 - 2 x 5 = 390 and 300 - 2 x 5 = 290 cm.
    const rows = progressRows(doc({ measurements: vals([['SE-1', 390], ['SE-2', 290]]) }))
    expect(rows[0].verified).toBe(2)
    expect(rows[0].residualCm).toBeCloseTo(0, 6)
  })

  it('reports a residual when a measured value is off', () => {
    const rows = progressRows(doc({ measurements: vals([['SE-1', 392]]) }))
    expect(rows[0].verified).toBe(1)
    expect(rows[0].residualCm).toBeCloseTo(2, 6)
  })

  it('marks a room whose verified walls are all locked', () => {
    const walls = { v0: { type: 'partition' as const, thicknessCm: 10, locked: true } }
    const rows = progressRows(doc({ rooms: [rect({ walls })], measurements: vals([['SE-1', 390]]) }))
    expect(rows[0].allLocked).toBe(true)
    // An unverified locked wall does not count on its own.
    const open = progressRows(doc({ rooms: [rect({ walls })], measurements: vals([['SE-2', 290]]) }))
    expect(open[0].allLocked).toBe(false)
  })
})

describe('progressTotals', () => {
  it('is empty for an empty plan', () => {
    expect(progressTotals([])).toEqual({ rooms: 0, walls: 0, verified: 0, lockedRooms: 0, residualCm: null })
  })

  it('adds up the rooms, the walls and the locks', () => {
    const rows = progressRows(doc({
      rooms: [rect({ walls: { v0: { type: 'partition', thicknessCm: 10, locked: true } } }), CU],
      measurements: vals([['SE-1', 390]]),
    }))
    expect(progressTotals(rows)).toMatchObject({ rooms: 2, walls: 8, verified: 1, lockedRooms: 1 })
  })

  it('gives one rms fit error over the rooms that have one', () => {
    const rows = progressRows(doc({
      rooms: [rect(), CU],
      // SE-1 is 2 cm off; CU-1 (200 - 10 = 190) is 4 cm off.
      measurements: vals([['SE-1', 392], ['CU-1', 194]]),
    }))
    // rms of the room values: sqrt((2² + 4²) / 2) = 3.16
    expect(progressTotals(rows).residualCm).toBeCloseTo(Math.sqrt(10), 6)
  })

  it('leaves the fit error null when no room has a measured value', () => {
    expect(progressTotals(progressRows(doc({ rooms: [rect(), CU] }))).residualCm).toBeNull()
  })
})
