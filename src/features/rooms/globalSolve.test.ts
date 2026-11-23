import { describe, expect, it } from 'vitest'
import type { Measurement, Room } from '../../model/types'
import { solveGlobal } from './globalSolve'

const room = (id: string, pts: [number, number][], diagonal?: [number, number]): Room => ({
  id, code: id, name: id,
  vertices: pts.map(([x, y], i) => ({ id: `${id}v${i}`, x, y })),
  holes: [], walls: {}, walkOrder: 1,
  ...(diagonal ? { diagonal } : {}),
})

const meas = (v: Record<string, number>): Record<string, Measurement> =>
  Object.fromEntries(Object.entries(v).map(([label, actualCm]) => [label, { label, actualCm, updatedAt: '' }]))

// True plan (centre lines): A = x 0..300, y 0..400. B = x 300..600, y 0..200. C = x 300..600, y 200..400.
// Outside walls 20 cm, wall A|B+C 10 cm, wall B|C 8 cm. The drawing is a bit wrong and uses 10 cm everywhere.
const rooms = [
  room('A', [[0, 0], [304, 0], [304, 398], [0, 398]], [0, 2]),
  room('B', [[304, 0], [601, 0], [601, 203], [304, 203]]),
  room('C', [[304, 203], [601, 203], [601, 398], [304, 398]]),
]
// Inside faces of the true plan.
const A = { w: 300 - 10 - 5, h: 400 - 10 - 10 }
const B = { w: 300 - 5 - 10, h: 200 - 10 - 4 }
const C = { w: 300 - 5 - 10, h: 200 - 4 - 10 }
const measurements = meas({
  'A-1': A.w, 'A-2': A.h, 'A-3': A.w, 'A-4': A.h, 'A-D': Math.hypot(A.w, A.h),
  'B-1': B.w, 'B-2': B.h, 'B-3': B.w, 'B-4': B.h,
  'C-1': C.w, 'C-2': C.h, 'C-3': C.w, 'C-4': C.h,
})

describe('solveGlobal', () => {
  const s = solveGlobal({ rooms, measurements })
  const wallOf = (label: string) => s.groups.find((g) => g.walls.includes(label))!

  it('makes one wall of the two sides of a shared wall', () => {
    expect(wallOf('B-3').walls.sort()).toEqual(['B-3', 'C-1'])
    expect(wallOf('A-2').walls.sort()).toEqual(['A-2', 'B-4', 'C-4'])
  })

  it('finds the thickness of a wall that a loop crosses', () => {
    const g = wallOf('B-3')
    expect(g.determined).toBe(true)
    expect(g.thicknessCm).toBeCloseTo(8, 0)
  })

  it('says when the data does not find a thickness', () => {
    expect(wallOf('A-2').determined).toBe(false)
    expect(wallOf('A-1').determined).toBe(false)
  })

  it('fits the measured values', () => {
    expect(s.rmsCm).toBeLessThan(0.2)
    expect(s.skipped).toEqual([])
  })

  it('places the shared wall between the rooms', () => {
    const b = s.rooms.B, a = s.rooms.A
    expect(b[0].x).toBeCloseTo(a[1].x, 6)
    // B + wall + C = A, so B|C wall is at A's top face + B height + half the wall.
    expect(s.inner.C[0].y - s.inner.B[3].y).toBeCloseTo(8, 0)
  })
})

describe('solveGlobal pairing', () => {
  it('does not join a wall to two room faces that are not in line', () => {
    // T above, L and R below. R's top is drawn 23 cm lower than L's top: only L shares T's wall.
    const s = solveGlobal({
      rooms: [
        room('T', [[0, 0], [400, 0], [400, 200], [0, 200]]),
        room('L', [[0, 200], [200, 200], [200, 400], [0, 400]]),
        room('R', [[200, 223], [400, 223], [400, 400], [200, 400]]),
      ],
      measurements: meas({}),
    })
    const t3 = s.groups.find((g) => g.walls.includes('T-3'))!
    expect(t3.walls).toContain('L-1')
    expect(t3.walls).not.toContain('R-1')
  })
})

describe('solveGlobal face alignment', () => {
  // A and B side by side. Top walls continue each other: A's is 30 cm, B's is 10 cm.
  // True plan: flush inside at y = 15 (A top centre y = 0, B top centre y = 10).
  const withTop = (r: Room, cm: number, align?: 'room' | 'center' | 'other'): Room =>
    ({ ...r, walls: { [r.vertices[0].id]: { type: 'partition', thicknessCm: cm, ...(align ? { align } : {}) } } })
  const A = withTop(room('A', [[0, 0], [300, 0], [300, 300], [0, 300]]), 30)
  const B = withTop(room('B', [[300, 10], [600, 10], [600, 300], [300, 300]]), 10)

  it('keeps the faces in the rooms in line by default', () => {
    const s = solveGlobal({ rooms: [A, B], measurements: meas({}) })
    expect(s.inner.A[0].y).toBeCloseTo(s.inner.B[0].y, 1)
    expect(s.rooms.B[0].y - s.rooms.A[0].y).toBeCloseTo(10, 0)
  })

  it('keeps the centre lines in line when the walls say so', () => {
    const rooms = [withTop(A, 30, 'center'), withTop({ ...B, vertices: B.vertices.map((v) => ({ ...v, y: v.y === 10 ? 0 : v.y })) }, 10, 'center')]
    const s = solveGlobal({ rooms, measurements: meas({}) })
    expect(s.rooms.A[0].y).toBeCloseTo(s.rooms.B[0].y, 1)
    expect(s.inner.A[0].y - s.inner.B[0].y).toBeCloseTo(10, 0)
  })

  it('moves a wall that is drawn wrong when the values say so', () => {
    // B's top is drawn 8 cm too low. Both rooms are 280 high inside and their bottoms are flush:
    // the solver moves B's top wall up, so the faces in the rooms are flush again.
    const Bwrong = { ...B, vertices: B.vertices.map((v) => ({ ...v, y: v.y === 10 ? 18 : v.y })) }
    const s = solveGlobal({ rooms: [A, Bwrong], measurements: meas({ 'A-2': 280, 'A-4': 280, 'B-2': 280, 'B-4': 280 }) })
    expect(s.inner.B[0].y).toBeCloseTo(s.inner.A[0].y, 0)
    expect(s.rmsCm).toBeLessThan(0.3)
  })
})
