// Tests of the wall bands and their joins (docs/walls-plan.md, "Walls in the interface").
import { describe, expect, it } from 'vitest'
import { dist, pointInPolygon } from '../../model/geometry'
import type { StoredNode, StoredWall, Vec } from '../../model/types'
import { MITER_LIMIT, convexHull, wallJoinGeometry, type WallBand } from './wallJoins'

/** A wall of the test graph: two node ids, a thickness. */
const wall = (id: string, a: string, b: string, thicknessCm = 20): Pick<StoredWall, 'id' | 'a' | 'b' | 'thicknessCm'> =>
  ({ id, a, b, thicknessCm })

const node = (id: string, x: number, y: number): StoredNode => ({ id, x, y })

/** The band of one wall, or a failed test. */
const bandOf = (bands: WallBand[], wallId: string): WallBand => {
  const band = bands.find((b) => b.wallId === wallId)
  expect(band, `no band for ${wallId}`).toBeDefined()
  return band!
}

/** True when the polygon holds the point. */
const holds = (points: Vec[], p: Vec) => pointInPolygon(p, points)

/** The corners of one end of a band: the near end of `a` (start) or of `b` (end). */
const startCorners = (band: WallBand) => [band.points[0], band.points[1]]
const endCorners = (band: WallBand) => [band.points[2], band.points[3]]

/** Every pair of these points: two bands share a corner when it is the SAME point. */
const samePoint = (a: Vec, b: Vec) => dist(a, b) < 1e-6

describe('wallJoinGeometry: a free end', () => {
  it('is a square end at the node', () => {
    const geo = wallJoinGeometry({ nodes: [node('n0', 0, 0), node('n1', 400, 0)], walls: [wall('W1', 'n0', 'n1', 20)] })
    expect(geo.bands).toHaveLength(1)
    const band = bandOf(geo.bands, 'W1')
    // half thickness 10, the wall runs east: the corners are 10 cm above and below each node.
    expect(band.points[0]).toEqual({ x: 0, y: 10 })
    expect(band.points[1]).toEqual({ x: 0, y: -10 })
    expect(band.points[2]).toEqual({ x: 400, y: -10 })
    expect(band.points[3]).toEqual({ x: 400, y: 10 })
    expect(geo.patches).toEqual([])
  })
})

describe('wallJoinGeometry: an L corner', () => {
  // W1 runs east to the node, W2 runs north from the node: a 90° corner, thickness 20 (half 10).
  const geo = wallJoinGeometry({
    nodes: [node('n0', -300, 0), node('n1', 0, 0), node('n2', 0, -300)],
    walls: [wall('W1', 'n0', 'n1', 20), wall('W2', 'n1', 'n2', 20)],
  })

  it('is mitred: both bands share the two corner points of the bisector', () => {
    const w1 = bandOf(geo.bands, 'W1')
    const w2 = bandOf(geo.bands, 'W2')
    // W1 covers y in [-10, 10] up to the node, W2 covers x in [-10, 10] up to the node. The outer
    // corner of the elbow is (10, 10) (south-east), the inner corner is (-10, -10).
    const outer = { x: 10, y: 10 }
    const inner = { x: -10, y: -10 }
    const corners1 = endCorners(w1)
    const corners2 = startCorners(w2)
    expect(corners1.some((p) => samePoint(p, outer))).toBe(true)
    expect(corners1.some((p) => samePoint(p, inner))).toBe(true)
    // The two bands share them EXACTLY: the corner is closed, with no gap and no overlap.
    corners1.forEach((p) => expect(corners2.some((q) => samePoint(p, q))).toBe(true))
    // Each band keeps its area (length x thickness): the miter moves no face.
    const areaOf = (b: WallBand) => Math.abs(
      b.points.reduce((s, p, i) => s + p.x * b.points[(i + 1) % 4].y - b.points[(i + 1) % 4].x * p.y, 0) / 2,
    )
    expect(areaOf(w1)).toBeCloseTo(300 * 20, 6)
    expect(areaOf(w2)).toBeCloseTo(300 * 20, 6)
    expect(geo.patches).toEqual([])
  })

  it('fills the whole corner square: no cut on the outside corner (any wall direction)', () => {
    // The same elbow with the walls stored in all four directions: the joint must be the same.
    const variants: [string, string][][] = [
      [['n0', 'n1'], ['n1', 'n2']],
      [['n1', 'n0'], ['n1', 'n2']],
      [['n0', 'n1'], ['n2', 'n1']],
      [['n1', 'n0'], ['n2', 'n1']],
    ]
    for (const [w1, w2] of variants) {
      const g = wallJoinGeometry({
        nodes: [node('n0', -300, 0), node('n1', 0, 0), node('n2', 0, -300)],
        walls: [wall('W1', w1[0], w1[1], 20), wall('W2', w2[0], w2[1], 20)],
      })
      const b1 = bandOf(g.bands, 'W1').points
      const b2 = bandOf(g.bands, 'W2').points
      // Points just inside the outer corner and on both sides of the mitre line are covered.
      for (const p of [{ x: 9, y: 9 }, { x: 9, y: 5 }, { x: 5, y: 9 }, { x: -9, y: 9 }, { x: 9, y: -9 }]) {
        expect(holds(b1, p) || holds(b2, p), `point ${p.x},${p.y} for ${JSON.stringify([w1, w2])}`).toBe(true)
      }
      // Nothing outside the elbow.
      expect(holds(b1, { x: 11, y: 11 }) || holds(b2, { x: 11, y: 11 })).toBe(false)
    }
  })

  it('is limited for a sharp angle: the corner stays within the miter limit', () => {
    // Two walls that leave the node with a 10° angle between them: the miter would run far away.
    const sharp = wallJoinGeometry({
      nodes: [node('n0', 0, 0), node('n1', 400, 0), node('n2', 400 * Math.cos(0.3), 400 * Math.sin(0.3))],
      walls: [wall('W1', 'n0', 'n1', 20), wall('W2', 'n0', 'n2', 20)],
    })
    const w1 = bandOf(sharp.bands, 'W1')
    const w2 = bandOf(sharp.bands, 'W2')
    const limit = MITER_LIMIT * 20
    for (const p of [...startCorners(w1), ...startCorners(w2)]) expect(dist(p, { x: 0, y: 0 })).toBeLessThanOrEqual(limit + 1e-6)
  })
})

describe('wallJoinGeometry: a T junction', () => {
  // The host runs east at y = 0 (thickness 20, half 10); the stem comes from the north (thickness 10,
  // half 5) and ends on the MIDDLE of the host at (200, 0).
  const geo = wallJoinGeometry({
    nodes: [node('h0', 0, 0), node('h1', 400, 0), node('s0', 200, -300), node('s1', 200, 0)],
    walls: [wall('H', 'h0', 'h1', 20), wall('S', 's0', 's1', 10)],
  })

  it('is a square cut on the near face of the host, and does not run into it', () => {
    const stem = bandOf(geo.bands, 'S')
    const corners = endCorners(stem)
    // The cut is the face of the host, 10 cm from its centre line: both corners are on it.
    corners.forEach((p) => expect(p.y).toBeCloseTo(-10, 6))
    // The band stops there: no point of the stem is inside the host wall (y > -10).
    stem.points.forEach((p) => expect(p.y).toBeLessThanOrEqual(-10 + 1e-6))
    // No angle: the two corners are at the same distance from the node along the stem.
    expect(dist(corners[0], { x: 200, y: 0 })).toBeCloseTo(dist(corners[1], { x: 200, y: 0 }), 6)
    // The host is not touched: it keeps its square ends and its full length.
    const host = bandOf(geo.bands, 'H')
    expect(host.points[0]).toEqual({ x: 0, y: 10 })
    expect(host.points[1]).toEqual({ x: 0, y: -10 })
    expect(geo.patches).toEqual([])
  })

  it('follows a thickness change of the host', () => {
    const thick = wallJoinGeometry({
      nodes: [node('h0', 0, 0), node('h1', 400, 0), node('s0', 200, -300), node('s1', 200, 0)],
      walls: [wall('H', 'h0', 'h1', 40), wall('S', 's0', 's1', 10)],
    })
    // The stem still stops at the face of the host, 20 cm from its centre line.
    endCorners(bandOf(thick.bands, 'S')).forEach((p) => expect(p.y).toBeCloseTo(-20, 6))
  })

  it('is a square cut at any angle of the stem', () => {
    // The stem comes at 45°: its corners lie on the host face too, so the cut has no angle.
    const slanted = wallJoinGeometry({
      nodes: [node('h0', 0, 0), node('h1', 400, 0), node('s0', 200 + 300, -300), node('s1', 200, 0)],
      walls: [wall('H', 'h0', 'h1', 20), wall('S', 's0', 's1', 10)],
    })
    endCorners(bandOf(slanted.bands, 'S')).forEach((p) => expect(p.y).toBeCloseTo(-10, 6))
  })
})

describe('wallJoinGeometry: a cross of four walls', () => {
  const geo = wallJoinGeometry({
    nodes: [node('w', -300, 0), node('c', 0, 0), node('e', 300, 0), node('n', 0, -300), node('s', 0, 300)],
    walls: [wall('W', 'w', 'c', 10), wall('E', 'c', 'e', 10), wall('N', 'n', 'c', 10), wall('S', 'c', 's', 10)],
  })

  it('has a patch that closes the junction, and square ends at the node', () => {
    expect(geo.patches).toHaveLength(1)
    const patch = geo.patches[0]
    expect(patch.nodeId).toBe('c')
    expect(patch.wallIds.sort()).toEqual(['E', 'N', 'S', 'W'])
    // Every corner of the four ends is on the patch outline (it is their convex hull).
    for (const id of ['W', 'E', 'N', 'S']) {
      const band = bandOf(geo.bands, id)
      const corners = id === 'W' || id === 'N' ? endCorners(band) : startCorners(band)
      corners.forEach((p) => expect(patch.points.some((q) => samePoint(p, q))).toBe(true))
    }
    // The junction is closed: no point near the node is left empty.
    for (const p of [{ x: 0, y: 0 }, { x: 3, y: 3 }, { x: -3, y: 3 }, { x: 3, y: -3 }, { x: -3, y: -3 }, { x: 4, y: 0 }]) {
      const covered = geo.bands.some((b) => holds(b.points, p)) || holds(patch.points, p)
      expect(covered, `hole at ${p.x},${p.y}`).toBe(true)
    }
  })
})

describe('wallJoinGeometry: walls in line', () => {
  it('continue with square ends at the node', () => {
    const geo = wallJoinGeometry({
      nodes: [node('n0', 0, 0), node('n1', 200, 0), node('n2', 400, 0)],
      walls: [wall('W1', 'n0', 'n1', 20), wall('W2', 'n1', 'n2', 20)],
    })
    expect(endCorners(bandOf(geo.bands, 'W1'))).toEqual([{ x: 200, y: -10 }, { x: 200, y: 10 }])
    expect(startCorners(bandOf(geo.bands, 'W2'))).toEqual([{ x: 200, y: 10 }, { x: 200, y: -10 }])
    // Two walls that touch: no patch (it would be a flat polygon).
    expect(geo.patches).toEqual([])
  })

  it('meet at a slanted corner without a gap between the bands', () => {
    // A slanted corner: W1 at 30°, W2 at 120° from the same node, both 20 cm thick.
    const a = { x: 300 * Math.cos(Math.PI / 6), y: 300 * Math.sin(Math.PI / 6) }
    const b = { x: 300 * Math.cos((2 * Math.PI) / 3), y: 300 * Math.sin((2 * Math.PI) / 3) }
    const geo = wallJoinGeometry({
      nodes: [node('c', 0, 0), node('p', a.x, a.y), node('q', b.x, b.y)],
      walls: [wall('W1', 'p', 'c', 20), wall('W2', 'c', 'q', 20)],
    })
    const w1 = endCorners(bandOf(geo.bands, 'W1'))
    const w2 = startCorners(bandOf(geo.bands, 'W2'))
    // The two bands share both corner points, so the corner is closed at any angle.
    w1.forEach((p) => expect(w2.some((q) => samePoint(p, q))).toBe(true))
  })
})

describe('wallJoinGeometry: missing data', () => {
  it('leaves out a wall with a missing node and a wall of zero length', () => {
    const geo = wallJoinGeometry({
      nodes: [node('n0', 0, 0), node('n2', 0, 0)],
      walls: [wall('W1', 'n0', 'gone', 20), wall('W2', 'n0', 'n2', 20)],
    })
    expect(geo.bands).toEqual([])
    expect(geo.patches).toEqual([])
  })
})

describe('convexHull', () => {
  it('gives the outline of a set of points, and nothing for a flat set', () => {
    expect(convexHull([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 5, y: 5 }]).length).toBe(3)
    expect(convexHull([{ x: 0, y: 0 }, { x: 10, y: 0 }])).toEqual([])
  })
})
