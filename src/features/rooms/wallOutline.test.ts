import { describe, expect, it } from 'vitest'
import type { Room, Vec } from '../../model/types'
import { faceCorner, MITER_LIMIT, polygonPath, wallFaces, wallQuads } from './wallOutline'

const room = (pts: [number, number][], half: number | Record<string, number>): Room => {
  const ids = pts.map((_, i) => 'v' + i)
  const verts = pts.map(([x, y], i) => ({ id: ids[i], x, y }))
  const walls: Room['walls'] = {}
  for (const id of ids) {
    const h = typeof half === 'number' ? half : (half[id] ?? 0)
    walls[id] = { type: 'partition', thicknessCm: h * 2 }
  }
  return { id: 'r1', code: 'R', name: 'Room', vertices: verts, holes: [], walls, walkOrder: 1 }
}

const halfOf = (r: Room) => (startId: string) => (r.walls[startId]?.thicknessCm ?? 0) / 2

const area = (pts: Vec[]) => {
  let a = 0
  pts.forEach((p, i) => { const q = pts[(i + 1) % pts.length]; a += p.x * q.y - q.x * p.y })
  return Math.abs(a / 2)
}

const close = (a: Vec, b: Vec) => expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(1e-6)
const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y)

describe('wallQuads', () => {
  it('miter a rectangle to exact corners (no overshoot)', () => {
    const r = room([[0, 0], [400, 0], [400, 300], [0, 300]], 5)
    const q = wallQuads(r, halfOf(r))
    expect(q).toHaveLength(4)
    expect(q[0].startId).toBe('v0')
    // Wall 0 runs from (0,0) to (400,0): band from y = -5 to y = 5, cut by the miters.
    close(q[0].points[0], { x: 5, y: 5 })
    close(q[0].points[1], { x: -5, y: -5 })
    close(q[0].points[2], { x: 405, y: -5 })
    close(q[0].points[3], { x: 395, y: 5 })
  })

  it('keeps every wall band at exactly length * thickness for a rectangle', () => {
    const r = room([[0, 0], [400, 0], [400, 300], [0, 300]], 5)
    const q = wallQuads(r, halfOf(r))
    expect(area(q[0].points)).toBeCloseTo(400 * 10, 6)
    expect(area(q[1].points)).toBeCloseTo(300 * 10, 6)
  })

  it('gives neighbouring walls the same corner points (closed joins)', () => {
    const r = room([[0, 0], [400, 0], [400, 300], [0, 300]], 5)
    const q = wallQuads(r, halfOf(r))
    for (let i = 0; i < q.length; i++) {
      const next = q[(i + 1) % q.length]
      close(q[i].points[2], next.points[1]) // end- joins start-
      close(q[i].points[3], next.points[0]) // end+ joins start+
    }
  })

  it('joins walls of different thickness on the same corners', () => {
    const r = room([[0, 0], [400, 0], [400, 300], [0, 300]], { v0: 15, v1: 5, v2: 5, v3: 5 })
    const q = wallQuads(r, halfOf(r))
    close(q[0].points[3], q[1].points[0])
    close(q[0].points[2], q[1].points[1])
    // Every corner sits on this wall's own face, i.e. exactly half a thickness away.
    expect(Math.abs(q[0].points[0].y - 0)).toBeCloseTo(15, 6)
    expect(Math.abs(q[1].points[0].x - 400)).toBeCloseTo(5, 6)
  })

  it('does not overshoot at a 135° corner', () => {
    const d = { x: Math.SQRT1_2, y: Math.SQRT1_2 }
    const b = { x: 300, y: 0 }
    const c = { x: b.x + 300 * d.x, y: b.y + 300 * d.y }
    const r = room([[0, 0], [b.x, b.y], [c.x, c.y]], 5)
    const q = wallQuads(r, halfOf(r))
    // Miter length of a join with a 135° interior angle, half thickness 5.
    const miter = 5 / Math.sin((135 * Math.PI) / 180 / 2)
    const corners = [q[0].points[2], q[0].points[3], q[1].points[0], q[1].points[1]]
    for (const p of corners) expect(dist(p, b)).toBeCloseTo(miter, 6)
    // A square cap would reach 5 * sqrt(2) = 7,07 from the vertex.
    for (const p of corners) expect(dist(p, b)).toBeLessThan(5 * Math.SQRT2)
  })

  it('clamps the miter at a sharp angle', () => {
    const a = (170 * Math.PI) / 180
    const d = { x: Math.cos(a), y: Math.sin(a) }
    const b = { x: 200, y: 0 }
    const c = { x: b.x + 200 * d.x, y: b.y + 200 * d.y }
    const r = room([[0, 0], [b.x, b.y], [c.x, c.y]], 5)
    const q = wallQuads(r, halfOf(r))
    const corners = [q[0].points[2], q[0].points[3], q[1].points[0], q[1].points[1]]
    for (const p of corners) {
      expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true)
      expect(dist(p, b)).toBeLessThanOrEqual(MITER_LIMIT * 5 + 1e-6)
    }
    // The unclamped miter would sit 5 / sin(5°) = 57,4 cm away.
    expect(dist(q[1].points[0], b)).toBeCloseTo(MITER_LIMIT * 5, 6)
  })

  it('falls back to the wall\'s own face at a collinear vertex', () => {
    // v1 is in the middle of a straight edge; wall 0 is thicker than wall 1.
    const r = room([[0, 0], [200, 0], [400, 0], [400, 200], [0, 200]], { v0: 15, v1: 5 })
    const q = wallQuads(r, halfOf(r))
    for (const quad of q) {
      for (const p of quad.points) expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true)
    }
    // Wall 0 ends at its own thickness (y = ±15), wall 1 starts at its own (y = ±5).
    expect([q[0].points[3].y, q[0].points[2].y].sort((x, y) => x - y)).toEqual([-15, 15])
    expect([q[1].points[0].y, q[1].points[1].y].sort((x, y) => x - y)).toEqual([-5, 5])
  })

  it('returns nothing for a room with fewer than two vertices', () => {
    const r = room([[0, 0]], 5)
    expect(wallQuads(r, halfOf(r))).toEqual([])
  })
})

describe('faceCorner', () => {
  it('returns null when the walls are collinear', () => {
    expect(faceCorner({ x: 0, y: 0 }, { x: 1, y: 0 }, 5, { x: 1, y: 0 }, 5, 1)).toBeNull()
    expect(faceCorner({ x: 0, y: 0 }, { x: 1, y: 0 }, 5, { x: -1, y: 0 }, 5, 1)).toBeNull()
  })
})

describe('paths', () => {
  it('builds closed and open paths', () => {
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]
    expect(polygonPath(pts)).toBe('M0 0L10 0L10 10Z')
    const quad = wallQuads(room([[0, 0], [100, 0], [100, 100], [0, 100]], 5), () => 5)
    const [plus, minus] = wallFaces(quad[0])
    expect(plus).toHaveLength(2)
    expect(minus).toHaveLength(2)
  })
})
