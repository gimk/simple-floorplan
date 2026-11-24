// Wall bands with joins (docs/walls-plan.md, "Walls in the interface").
// Pure geometry for the v2 model: cm, y points down, no React, no store.
//
// One stored wall is ONE band: its centre line widened by half of its thickness. In a v1 document
// the bands came from the rooms (`wallOutline.wallQuads`, one quad per room wall); here they come
// from the wall graph, so a wall between two rooms is drawn once.
//
// The ends of a band follow the junction at its node:
//   - a free end (no other wall there) = a square end at the node;
//   - two walls at a node, not in line = a MITRED join: both bands are cut on the two bisector
//     lines, so they share the two corner points exactly at any angle and with any thicknesses.
//     A very sharp angle would send the corner far away: the miter is limited to MITER_LIMIT
//     thicknesses, which reads as a small bevel;
//   - two walls in line at a node (the same direction) = square ends at the node: the bands meet;
//   - a wall end that lies on the MIDDLE of another wall (a T junction: the node is on the centre
//     line of the other wall, not at one of its two nodes) = a square end cut against the NEAR
//     FACE of the host wall, so the band stops at the host's face and does not run into it;
//   - three or more walls at one node = square ends at the node, plus a small patch (the convex
//     hull of the band corners at the node) that closes the junction.

import { add, cross, dist, dot, mul, sub } from '../../model/geometry'
import type { StoredNode, StoredWall, Vec } from '../../model/types'

/** A length below this is zero (cm). */
const EPS = 1e-6
/** A node this close to the centre line of a wall is on that wall (T junction, cm). */
export const ON_WALL_TOL_CM = 1
/** Two directions with a sine below this are in line (or parallel). */
const PARALLEL_SIN = 0.02
/** Longest miter, in thicknesses: a sharper angle gets a bevel instead of a long spike. */
export const MITER_LIMIT = 3

/** One wall as a closed band: the mitered corners of its two ends. */
export type WallBand = {
  wallId: string
  /**
   * Corners in this order: start+, start-, end+, end-. The "+" side of an end is its `perp(out)`
   * side, and `out` runs from the node into the wall, so the two ends label OPPOSITE physical
   * sides: that is what keeps the outline in one turn (start+, start-, end+, end-).
   */
  points: [Vec, Vec, Vec, Vec]
}

/** A patch that closes the junction of three or more walls. `wallIds` are those walls, thickest first. */
export type WallPatch = { nodeId: string; points: Vec[]; wallIds: string[] }

export type WallsGeometry = { bands: WallBand[]; patches: WallPatch[] }

export type JoinInput = { nodes?: StoredNode[]; walls?: Pick<StoredWall, 'id' | 'a' | 'b' | 'thicknessCm'>[] }

/** The centre line of a wall of the graph. */
type Line = { a: Vec; b: Vec; d: Vec; length: number; half: number }

/** One end of a wall, at one node: `out` points along the wall, away from the node. */
type End = {
  wallId: string
  end: 'a' | 'b'
  node: string
  at: Vec
  out: Vec
  half: number
  /** Corners of this end: [plus side, minus side]. */
  corners: [Vec, Vec]
}

const perp = (d: Vec): Vec => ({ x: -d.y, y: d.x })

/** The two corners of a square end at a node: the band stops on the line through the node. */
const squareCorners = (at: Vec, out: Vec, half: number): [Vec, Vec] => {
  const m = mul(perp(out), half)
  return [add(at, m), sub(at, m)]
}

/**
 * The two corners of a mitred join between the ends `e` and `o` of two walls at one node.
 * Both ends point AWAY from the node, so the + face of one wall (left of its `out`) meets the
 * - face of the other: e+ with o- gives one corner, e- with o+ gives the other. The two bands then
 * share both corner points exactly, whatever the angle and the thicknesses are, and the outside
 * corner is a full point (no cut).
 */
function miterCorners(e: End, o: End): [[Vec, Vec], [Vec, Vec]] {
  const span = cross(e.out, o.out)
  // In line (or parallel): no usable crossing, the caller keeps square ends.
  if (Math.abs(span) < PARALLEL_SIN) return [squareCorners(e.at, e.out, e.half), squareCorners(o.at, o.out, o.half)]
  const maxLen = MITER_LIMIT * 2 * Math.max(e.half, o.half)
  /** Crossing of the face of `e` on side sgnE with the face of `o` on side sgnO. */
  const corner = (sgnE: 1 | -1, sgnO: 1 | -1): Vec => {
    const p1 = add(e.at, mul(perp(e.out), sgnE * e.half))
    const p2 = add(o.at, mul(perp(o.out), sgnO * o.half))
    const t = cross(sub(p2, p1), o.out) / span
    const p = add(p1, mul(e.out, t))
    // A sharp angle sends the corner away: pull it back to the limit (a small bevel).
    const d = dist(p, e.at)
    return d <= maxLen || d < EPS ? p : add(e.at, mul(sub(p, e.at), maxLen / d))
  }
  const ePlus = corner(1, -1) // e+ meets o-
  const eMinus = corner(-1, 1) // e- meets o+
  // Corners are [plus side, minus side] of each end.
  return [
    [ePlus, eMinus],
    [eMinus, ePlus],
  ]
}

/**
 * The two corners of an end that stops on the near face of a host wall (a T junction).
 * The cut is the face of the host that the end comes from, so it is parallel to the host's centre
 * line; each band face crosses it at its own place, so the band stops with a straight cut and shows
 * no angle. A very sharp angle is limited like a miter.
 */
function hostCorners(e: End, host: Line): [Vec, Vec] {
  const nHost = perp(host.d)
  const side = dot(e.out, nHost) >= 0 ? 1 : -1
  const cut = add(e.at, mul(nHost, side * host.half))
  const span = cross(e.out, host.d)
  if (Math.abs(span) < PARALLEL_SIN) return squareCorners(e.at, e.out, e.half)
  const maxLen = MITER_LIMIT * 2 * Math.max(e.half, host.half)
  const points = ([1, -1] as const).map((sgn) => {
    const p = add(e.at, mul(perp(e.out), sgn * e.half))
    const t = cross(sub(cut, p), host.d) / span
    const at = add(p, mul(e.out, t))
    // Never behind the node: the band must not grow into the host wall.
    if (t < 0) return squareCorners(e.at, e.out, e.half)[sgn > 0 ? 0 : 1]
    const d = dist(at, e.at)
    return d <= maxLen ? at : add(e.at, mul(sub(at, e.at), maxLen / d))
  })
  return [points[0], points[1]]
}

/** Convex hull of a set of points (monotone chain). Fewer than 3 points give no polygon. */
export function convexHull(points: Vec[]): Vec[] {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y)
  if (pts.length < 3) return []
  const half = (list: Vec[]) => {
    const out: Vec[] = []
    for (const p of list) {
      while (out.length >= 2 && cross(sub(out[out.length - 1], out[out.length - 2]), sub(p, out[out.length - 2])) <= EPS) out.pop()
      out.push(p)
    }
    out.pop()
    return out
  }
  const hull = [...half(pts), ...half([...pts].reverse())]
  return hull.length >= 3 ? hull : []
}

/** True when `p` lies on the centre line of `line`, between its two nodes and clear of both. */
const onMiddle = (p: Vec, line: Line): boolean => {
  const n = perp(line.d)
  if (Math.abs(dot(sub(p, line.a), n)) > ON_WALL_TOL_CM) return false
  const t = dot(sub(p, line.a), line.d)
  return t > ON_WALL_TOL_CM && t < line.length - ON_WALL_TOL_CM
}

/**
 * The bands of every wall of the graph and the patches of the junctions of three or more walls.
 * Walls with a missing node, and walls of zero length, are left out.
 */
export function wallJoinGeometry(doc: JoinInput): WallsGeometry {
  const nodes = new Map((doc.nodes ?? []).map((n) => [n.id, { x: n.x, y: n.y }]))
  const lines = new Map<string, Line>()
  const ends: End[] = []
  for (const w of doc.walls ?? []) {
    const a = nodes.get(w.a)
    const b = nodes.get(w.b)
    if (!a || !b) continue
    const length = dist(a, b)
    if (length < EPS) continue
    const d = { x: (b.x - a.x) / length, y: (b.y - a.y) / length }
    const half = Math.max(w.thicknessCm ?? 0, 0) / 2
    lines.set(w.id, { a, b, d, length, half })
    ends.push({ wallId: w.id, end: 'a', node: w.a, at: a, out: d, half, corners: squareCorners(a, d, half) })
    ends.push({ wallId: w.id, end: 'b', node: w.b, at: b, out: mul(d, -1), half, corners: squareCorners(b, mul(d, -1), half) })
  }

  // The ends of each node, in the order of the walls (a stable result for the patches).
  const byNode = new Map<string, End[]>()
  for (const e of ends) {
    const list = byNode.get(e.node)
    if (list) list.push(e)
    else byNode.set(e.node, [e])
  }

  const patches: WallPatch[] = []
  for (const [nodeId, list] of byNode) {
    const at = list[0].at
    // The hosts of a T junction: the walls whose middle the node lies on.
    const hosts = [...lines.entries()].filter(([, line]) => onMiddle(at, line))
    for (const e of list) {
      const others = list.filter((x) => x.wallId !== e.wallId)
      if (others.length >= 2) {
        // Three or more walls: square ends, closed by the patch of this node (made below).
        e.corners = squareCorners(e.at, e.out, e.half)
        continue
      }
      if (others.length === 1) {
        const o = others[0]
        const pair = miterCorners(e, o)
        e.corners = pair[0]
        o.corners = pair[1]
        continue
      }
      // A lone end: on the middle of another wall it stops at that wall's face, else it is square.
      const host = hosts.filter(([id]) => id !== e.wallId).sort((a, b) => {
        const da = Math.abs(dot(sub(at, a[1].a), perp(a[1].d)))
        const db = Math.abs(dot(sub(at, b[1].a), perp(b[1].d)))
        return da - db || b[1].half - a[1].half
      })[0]
      e.corners = host ? hostCorners(e, host[1]) : squareCorners(e.at, e.out, e.half)
    }
    if (list.length >= 3) {
      const corners = list.flatMap((e) => e.corners)
      const hull = convexHull(corners)
      if (hull.length >= 3) {
        const wallIds = [...list].sort((a, b) => b.half - a.half).map((e) => e.wallId)
        patches.push({ nodeId, points: hull, wallIds })
      }
    }
  }

  // One band per wall: the corner of each end, in the order of `WallQuad.points`.
  const byWall = new Map<string, End[]>()
  for (const e of ends) {
    const list = byWall.get(e.wallId)
    if (list) list.push(e)
    else byWall.set(e.wallId, [e])
  }
  const bands: WallBand[] = []
  for (const [wallId, list] of byWall) {
    const a = list.find((e) => e.end === 'a')
    const b = list.find((e) => e.end === 'b')
    if (!a || !b) continue
    bands.push({ wallId, points: [a.corners[0], a.corners[1], b.corners[0], b.corners[1]] })
  }
  return { bands, patches }
}
