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

/** How many of these bands hold the point (2 = the bands overlap, 0 = a gap). */
const covering = (bands: WallBand[], p: Vec) => bands.filter((b) => holds(b.points, p)).length

/** The corners of one end of a band: the near end of `a` (start) or of `b` (end). */
const startCorners = (band: WallBand) => [band.points[0], band.points[1]]
const endCorners = (band: WallBand) => [band.points[2], band.points[3]]

/** Every pair of these points: two bands share a corner when it is the SAME point. */
const samePoint = (a: Vec, b: Vec) => dist(a, b) < 1e-6

/** True when the two lists hold the same points, in any order. */
const sameSet = (a: Vec[], b: Vec[]) => a.length === b.length && a.every((p) => b.some((q) => samePoint(p, q)))

/** The area of a band. */
const areaOf = (b: WallBand) => Math.abs(
  b.points.reduce((s, p, i) => s + p.x * b.points[(i + 1) % 4].y - b.points[(i + 1) % 4].x * p.y, 0) / 2,
)

/** The distance of a mitre corner from the node: `half` / sin(angle / 2), for two equal walls. */
const miterDistance = (half: number, deg: number) => half / Math.sin((deg * Math.PI) / 360)

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

describe('wallJoinGeometry: an L corner at a right angle', () => {
  // W1 runs east to the node, W2 runs north from the node: a 90° corner, thickness 20 (half 10).
  // Same thickness, so the wall whose id sorts first continues through the corner: W1.
  const geo = wallJoinGeometry({
    nodes: [node('n0', -300, 0), node('n1', 0, 0), node('n2', 0, -300)],
    walls: [wall('W1', 'n0', 'n1', 20), wall('W2', 'n1', 'n2', 20)],
  })

  it('is a butt join with square ends: no diagonal line at the corner', () => {
    const w1 = bandOf(geo.bands, 'W1')
    const w2 = bandOf(geo.bands, 'W2')
    // W1 continues: its square end moves past the node by the half thickness of W2 (10 cm).
    expect(sameSet(endCorners(w1), [{ x: 10, y: 10 }, { x: 10, y: -10 }])).toBe(true)
    // W2 stops square on the near face of W1, 10 cm from the node (its own side, y = -10).
    expect(sameSet(startCorners(w2), [{ x: 10, y: -10 }, { x: -10, y: -10 }])).toBe(true)
    // The bands keep their own length: W1 is 10 cm longer, W2 is 10 cm shorter.
    expect(areaOf(w1)).toBeCloseTo(310 * 20, 6)
    expect(areaOf(w2)).toBeCloseTo(290 * 20, 6)
    expect(geo.patches).toEqual([])
  })

  it('fills the whole corner square, with no gap and no overlap', () => {
    const probes: Vec[] = []
    for (const x of [-8, -5, 0, 5, 8]) for (const y of [-8, -5, 0, 5, 8]) probes.push({ x, y })
    for (const p of probes) {
      expect(covering(geo.bands, p), `point ${p.x},${p.y} is covered once`).toBe(1)
    }
    // Nothing outside the corner: the corner square is 20 x 20 cm.
    for (const p of [{ x: 11, y: 0 }, { x: 0, y: 11 }, { x: 11, y: 11 }, { x: -11, y: -11 }, { x: 11, y: -11 }]) {
      expect(covering(geo.bands, p), `point ${p.x},${p.y} is outside`).toBe(0)
    }
  })

  it('continues the thicker wall through the corner', () => {
    // W2 is thicker (40 cm, half 20), so W2 continues and W1 stops on its face.
    const thick = wallJoinGeometry({
      nodes: [node('n0', -300, 0), node('n1', 0, 0), node('n2', 0, -300)],
      walls: [wall('W1', 'n0', 'n1', 20), wall('W2', 'n1', 'n2', 40)],
    })
    const w1 = bandOf(thick.bands, 'W1')
    const w2 = bandOf(thick.bands, 'W2')
    // W2 goes past the node by the half thickness of W1 (10 cm), and it is 40 cm wide.
    expect(sameSet(startCorners(w2), [{ x: 20, y: 10 }, { x: -20, y: 10 }])).toBe(true)
    // W1 stops square on the face of W2, 20 cm from the node.
    expect(sameSet(endCorners(w1), [{ x: -20, y: -10 }, { x: -20, y: 10 }])).toBe(true)
    expect(thick.patches).toEqual([])
    // The corner is full and the bands do not overlap.
    for (const p of [{ x: 10, y: 5 }, { x: 10, y: -5 }, { x: -10, y: 5 }, { x: -10, y: -5 }, { x: 15, y: 0 }]) {
      expect(covering(thick.bands, p), `point ${p.x},${p.y} is covered once`).toBe(1)
    }
  })

  it('is the same in all four directions of the two walls', () => {
    // The same elbow with the walls stored in all four directions: the joint must be the same.
    const variants: [string, string][][] = [
      [['n0', 'n1'], ['n1', 'n2']],
      [['n1', 'n0'], ['n1', 'n2']],
      [['n0', 'n1'], ['n2', 'n1']],
      [['n1', 'n0'], ['n2', 'n1']],
    ]
    const probes: Vec[] = []
    for (const x of [-8, -5, 0, 5, 8]) for (const y of [-8, -5, 0, 5, 8]) probes.push({ x, y })
    for (const [w1, w2] of variants) {
      const g = wallJoinGeometry({
        nodes: [node('n0', -300, 0), node('n1', 0, 0), node('n2', 0, -300)],
        walls: [wall('W1', w1[0], w1[1], 20), wall('W2', w2[0], w2[1], 20)],
      })
      const label = JSON.stringify([w1, w2])
      expect(g.patches, label).toEqual([])
      for (const p of probes) expect(covering(g.bands, p), `point ${p.x},${p.y} for ${label}`).toBe(1)
      for (const p of [{ x: 11, y: 11 }, { x: 11, y: 0 }, { x: 0, y: 11 }]) {
        expect(covering(g.bands, p), `point ${p.x},${p.y} outside for ${label}`).toBe(0)
      }
    }
  })
})

describe('wallJoinGeometry: an L corner at another angle', () => {
  it('stays a mitre at 120 degrees: the bands share both corners', () => {
    // W1 leaves the node at 30°, W2 at 150°: 120° between them, so the ends are mitred.
    const a = { x: 300 * Math.cos(Math.PI / 6), y: 300 * Math.sin(Math.PI / 6) }
    const b = { x: 300 * Math.cos((5 * Math.PI) / 6), y: 300 * Math.sin((5 * Math.PI) / 6) }
    const geo = wallJoinGeometry({
      nodes: [node('c', 0, 0), node('p', a.x, a.y), node('q', b.x, b.y)],
      walls: [wall('W1', 'p', 'c', 20), wall('W2', 'c', 'q', 20)],
    })
    const w1 = endCorners(bandOf(geo.bands, 'W1'))
    const w2 = startCorners(bandOf(geo.bands, 'W2'))
    // The corner is mitred: both bands share both corner points, so there is no gap.
    w1.forEach((p) => expect(w2.some((q) => samePoint(p, q))).toBe(true))
    // A mitre sends the corners further away than a square end (10 cm): this is not a butt join.
    for (const p of [...w1, ...w2]) expect(dist(p, { x: 0, y: 0 })).toBeCloseTo(miterDistance(10, 120), 6)
    expect(geo.patches).toEqual([])
  })

  it('stays a mitre at 60 degrees', () => {
    const geo = wallJoinGeometry({
      nodes: [node('c', 0, 0), node('p', 300, 0), node('q', 300 * Math.cos(Math.PI / 3), 300 * Math.sin(Math.PI / 3))],
      walls: [wall('W1', 'p', 'c', 20), wall('W2', 'c', 'q', 20)],
    })
    const w1 = endCorners(bandOf(geo.bands, 'W1'))
    const w2 = startCorners(bandOf(geo.bands, 'W2'))
    // The two bands share both corner points: the corner is closed.
    w1.forEach((p) => expect(w2.some((q) => samePoint(p, q))).toBe(true))
    // A 60° mitre sends the corners to 10 / sin(30°) = 20 cm from the node.
    for (const p of [...w1, ...w2]) expect(dist(p, { x: 0, y: 0 })).toBeCloseTo(miterDistance(10, 60), 6)
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

describe('wallJoinGeometry: three walls at one node', () => {
  // A through pair in line (A to the west, B to the east) and a stem S from the north. The pair is
  // the same thickness, so A (the first id) is the host.
  const geo = wallJoinGeometry({
    nodes: [node('a0', -300, 0), node('m', 0, 0), node('b1', 300, 0), node('s0', 0, -300)],
    walls: [wall('A', 'a0', 'm', 20), wall('B', 'm', 'b1', 20), wall('S', 's0', 'm', 10)],
  })

  it('keeps the pair in line square at the node, and cuts the third wall on the near face', () => {
    const a = bandOf(geo.bands, 'A')
    const b = bandOf(geo.bands, 'B')
    const s = bandOf(geo.bands, 'S')
    // The pair in line meets at the node: both ends are square on the line through the node (x = 0).
    expect(sameSet(endCorners(a), [{ x: 0, y: 10 }, { x: 0, y: -10 }])).toBe(true)
    expect(sameSet(startCorners(b), [{ x: 0, y: 10 }, { x: 0, y: -10 }])).toBe(true)
    // The stem stops on the near face of the host, 10 cm from its centre line (y = -10).
    expect(sameSet(endCorners(s), [{ x: 5, y: -10 }, { x: -5, y: -10 }])).toBe(true)
    // The node is closed by the bands alone: no patch is necessary.
    expect(geo.patches).toEqual([])
    for (const p of [{ x: -5, y: -5 }, { x: 5, y: -5 }, { x: 0, y: 5 }, { x: 5, y: 5 }, { x: 0, y: -15 }]) {
      expect(covering(geo.bands, p), `point ${p.x},${p.y} is covered once`).toBe(1)
    }
  })

  it('stops the third wall on the face of the thicker wall of the pair', () => {
    // B is thicker (40 cm, half 20): it is the host, so the stem stops at y = -20.
    const thick = wallJoinGeometry({
      nodes: [node('a0', -300, 0), node('m', 0, 0), node('b1', 300, 0), node('s0', 0, -300)],
      walls: [wall('A', 'a0', 'm', 20), wall('B', 'm', 'b1', 40), wall('S', 's0', 'm', 10)],
    })
    expect(sameSet(endCorners(bandOf(thick.bands, 'S')), [{ x: 5, y: -20 }, { x: -5, y: -20 }])).toBe(true)
    // The bands leave a small gap on the thin side of the pair: a patch closes it.
    expect(thick.patches).toHaveLength(1)
    expect(thick.patches[0].nodeId).toBe('m')
    expect(thick.patches[0].wallIds).toEqual(['B', 'A', 'S'])
  })

  it('keeps square ends and a patch when no pair is in line', () => {
    // Three walls at 0°, 120° and 240° from the node: there is no pair in line.
    const names = ['W0', 'W1', 'W2']
    const nodes = [node('m', 0, 0)]
    const walls: Pick<StoredWall, 'id' | 'a' | 'b' | 'thicknessCm'>[] = []
    names.forEach((id, i) => {
      const a = (i * 2 * Math.PI) / 3
      nodes.push(node(`p${i}`, 300 * Math.cos(a), 300 * Math.sin(a)))
      walls.push(wall(id, 'm', `p${i}`, 20))
    })
    const three = wallJoinGeometry({ nodes, walls })
    // Square ends at the node for every wall: each corner is the half thickness from the node.
    for (const id of names) {
      startCorners(bandOf(three.bands, id)).forEach((p) => expect(dist(p, { x: 0, y: 0 })).toBeCloseTo(10, 6))
    }
    expect(three.patches).toHaveLength(1)
    expect(three.patches[0].nodeId).toBe('m')
    expect([...three.patches[0].wallIds].sort()).toEqual(['W0', 'W1', 'W2'])
  })
})

describe('wallJoinGeometry: a cross of four walls', () => {
  const geo = wallJoinGeometry({
    nodes: [node('w', -300, 0), node('c', 0, 0), node('e', 300, 0), node('n', 0, -300), node('s', 0, 300)],
    walls: [wall('W', 'w', 'c', 20), wall('E', 'c', 'e', 20), wall('N', 'n', 'c', 20), wall('S', 'c', 's', 20)],
  })

  it('lets the first pair in line go through, and cuts the other pair on its faces', () => {
    // The two pairs have the same thickness, so the pair whose ids sort first (E and W) goes through.
    const e = bandOf(geo.bands, 'E')
    const w = bandOf(geo.bands, 'W')
    const n = bandOf(geo.bands, 'N')
    const s = bandOf(geo.bands, 'S')
    expect(sameSet(startCorners(e), [{ x: 0, y: 10 }, { x: 0, y: -10 }])).toBe(true)
    expect(sameSet(endCorners(w), [{ x: 0, y: 10 }, { x: 0, y: -10 }])).toBe(true)
    // The other pair stops on the faces of the host (E), 10 cm from its centre line.
    expect(sameSet(endCorners(n), [{ x: 10, y: -10 }, { x: -10, y: -10 }])).toBe(true)
    expect(sameSet(startCorners(s), [{ x: 10, y: 10 }, { x: -10, y: 10 }])).toBe(true)
    // The junction is closed by the bands alone.
    expect(geo.patches).toEqual([])
    for (const p of [{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: -5, y: 5 }, { x: 5, y: -5 }, { x: -5, y: -5 }, { x: 8, y: 0 }]) {
      expect(covering(geo.bands, p), `point ${p.x},${p.y} is covered once`).toBe(1)
    }
  })

  it('lets the thicker pair go through', () => {
    const thick = wallJoinGeometry({
      nodes: [node('w', -300, 0), node('c', 0, 0), node('e', 300, 0), node('n', 0, -300), node('s', 0, 300)],
      walls: [wall('W', 'w', 'c', 40), wall('E', 'c', 'e', 40), wall('N', 'n', 'c', 20), wall('S', 'c', 's', 20)],
    })
    // The thick pair (E and W) goes through; the thin pair stops on its faces, 20 cm from the node.
    expect(sameSet(endCorners(bandOf(thick.bands, 'N')), [{ x: 10, y: -20 }, { x: -10, y: -20 }])).toBe(true)
    expect(sameSet(startCorners(bandOf(thick.bands, 'S')), [{ x: 10, y: 20 }, { x: -10, y: 20 }])).toBe(true)
    expect(thick.patches).toEqual([])
    // The corner near the node is full: only the thick pair covers it.
    for (const p of [{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: -5, y: -5 }, { x: 0, y: 15 }]) {
      expect(covering(thick.bands, p), `point ${p.x},${p.y} is covered once`).toBe(1)
    }
  })
})

describe('wallJoinGeometry: a closed rectangle of four walls', () => {
  it('has full square corners, with no patch, no gap and no overlap', () => {
    const geo = wallJoinGeometry({
      nodes: [node('p0', 0, 0), node('p1', 400, 0), node('p2', 400, 300), node('p3', 0, 300)],
      walls: [wall('N1', 'p0', 'p1', 20), wall('N2', 'p1', 'p2', 20), wall('N3', 'p2', 'p3', 20), wall('N4', 'p3', 'p0', 20)],
    })
    expect(geo.patches).toEqual([])
    // The four corner squares (20 x 20 cm) are full, and only one band covers each point of them.
    for (const [x, y] of [[5, 5], [-5, 5], [-5, -5], [5, -5]]) {
      expect(covering(geo.bands, { x: 400 + x, y: 300 + y }), `corner p2 ${x},${y}`).toBe(1)
      expect(covering(geo.bands, { x: x, y: 300 + y }), `corner p3 ${x},${y}`).toBe(1)
      expect(covering(geo.bands, { x: x, y: y }), `corner p0 ${x},${y}`).toBe(1)
      expect(covering(geo.bands, { x: 400 + x, y: y }), `corner p1 ${x},${y}`).toBe(1)
    }
    // No diagonal line: every corner square is filled (the union is the same as a mitre).
    for (const p of [{ x: -9, y: 9 }, { x: 9, y: 9 }, { x: -9, y: -9 }, { x: 409, y: 291 }, { x: 391, y: 309 }]) {
      expect(covering(geo.bands, p), `point ${p.x},${p.y}`).toBe(1)
    }
    // Nothing outside the outline (the walls stick out by their half thickness at a corner only).
    for (const p of [{ x: -11, y: 11 }, { x: 411, y: -11 }, { x: 11, y: 311 }, { x: -11, y: 289 }, { x: 200, y: -11 }]) {
      expect(covering(geo.bands, p), `point ${p.x},${p.y} outside`).toBe(0)
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
