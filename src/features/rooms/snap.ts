// Pure magnetic snapping for room drawing and moving (no React). Units: cm.
import { add, dist, projectOnSegment } from '../../model/geometry'
import type { Vec } from '../../model/geometry'
import type { Room } from '../../model/types'
import { constrainWallPerpendicular, roundToPrecision } from './ops'
import { edgeOutwardNormal } from './walls'

export type SnapGuide = { kind: 'point' | 'line'; a: Vec; b?: Vec }
export type SnapResult = { point: Vec; guides: SnapGuide[] }
export type SnapOpts = {
  gridCm?: number
  thresholdCm?: number
  anchor?: Vec
  /**
   * Extra alignment anchors (e.g. both connected vertices of the edited room).
   * Each axis snaps independently: the closest anchor within the threshold wins,
   * whatever the distance on the other axis.
   */
  anchors?: Vec[]
  /** Skip all snapping (Alt held): return the point rounded to precisionCm (or raw when not set). */
  disableSnap?: boolean
  /** Drawing precision in cm. Used as the grid when gridCm is omitted. */
  precisionCm?: number
  /** Wall thickness in cm (default 0). Above 0, the point also snaps to each room edge offset outward by it. */
  wallThicknessCm?: number
}

export const DEFAULT_GRID_CM = 5
export const DEFAULT_SNAP_THRESHOLD_CM = 10

const snapToGrid = (v: number, grid: number) => (grid > 0 ? Math.round(v / grid) * grid : v)
const roundP = (v: number, p?: number) => (p && p > 0 ? roundToPrecision(v, p) : v)

/**
 * Snap pt. Priority: 1) vertex of another room, 2) wall of another room (closest point),
 * 3) horizontal/vertical alignment with opts.anchor + opts.anchors, each axis then the grid
 * (default 5 cm; 0 = off). X and Y are resolved on their own, so a point can take x from one
 * anchor and y from another one even when those anchors are far away on the other axis.
 */
export function snapPoint(pt: Vec, otherRooms: Room[], opts: SnapOpts = {}): SnapResult {
  if (opts.disableSnap) return { point: { x: roundP(pt.x, opts.precisionCm), y: roundP(pt.y, opts.precisionCm) }, guides: [] }
  const grid = opts.gridCm ?? opts.precisionCm ?? DEFAULT_GRID_CM
  const thr = opts.thresholdCm ?? DEFAULT_SNAP_THRESHOLD_CM
  const anchors = [...(opts.anchor ? [opts.anchor] : []), ...(opts.anchors ?? [])]

  let bestV: Vec | null = null, bestVd = thr
  let bestW: { point: Vec; a: Vec; b: Vec } | null = null, bestWd = thr
  const gap = opts.wallThicknessCm && opts.wallThicknessCm > 0 ? opts.wallThicknessCm : 0
  for (const room of otherRooms) {
    const vs = room.vertices
    for (let i = 0; i < vs.length; i++) {
      const d = dist(pt, vs[i])
      if (d <= bestVd) { bestVd = d; bestV = vs[i] }
      const a = vs[i], b = vs[(i + 1) % vs.length]
      const p = projectOnSegment(pt, a, b)
      if (p.distance <= bestWd) { bestWd = p.distance; bestW = { point: p.point, a, b } }
      // The same edge pushed outward by the wall thickness: the gap between two thick-walled rooms.
      const n = gap > 0 ? edgeOutwardNormal(room, i) : null
      if (n) {
        const ga = { x: a.x + n.x * gap, y: a.y + n.y * gap }, gb = { x: b.x + n.x * gap, y: b.y + n.y * gap }
        const q = projectOnSegment(pt, ga, gb)
        if (q.distance <= bestWd) { bestWd = q.distance; bestW = { point: q.point, a: ga, b: gb } }
      }
    }
  }
  if (bestV) return { point: { x: bestV.x, y: bestV.y }, guides: [{ kind: 'point', a: { x: bestV.x, y: bestV.y } }] }
  if (bestW) {
    const guides: SnapGuide[] = [{ kind: 'line', a: bestW.a, b: bestW.b }, { kind: 'point', a: bestW.point }]
    // A point sliding along another room's axis-aligned wall still lines up with a connected
    // vertex on the free axis, so straight lines stay easy when rooms touch each other.
    if (anchors.length) {
      const flat = Math.abs(bestW.a.y - bestW.b.y) < 1e-6
      const upright = Math.abs(bestW.a.x - bestW.b.x) < 1e-6
      if (flat) {
        const lo = Math.min(bestW.a.x, bestW.b.x), hi = Math.max(bestW.a.x, bestW.b.x)
        const an = closestAnchor(anchors, pt.x, 'x', thr, (v) => v >= lo && v <= hi)
        if (an) {
          bestW.point.x = an.x
          pushLine(guides, an, bestW.point)
        }
      } else if (upright) {
        const lo = Math.min(bestW.a.y, bestW.b.y), hi = Math.max(bestW.a.y, bestW.b.y)
        const an = closestAnchor(anchors, pt.y, 'y', thr, (v) => v >= lo && v <= hi)
        if (an) {
          bestW.point.y = an.y
          pushLine(guides, an, bestW.point)
        }
      }
    }
    return { point: bestW.point, guides }
  }

  const out = { x: snapToGrid(pt.x, grid), y: snapToGrid(pt.y, grid) }
  const guides: SnapGuide[] = []
  // Each axis is resolved on its own: the perpendicular distance to the anchor does not matter.
  const bestAnX = closestAnchor(anchors, pt.x, 'x', thr)
  const bestAnY = closestAnchor(anchors, pt.y, 'y', thr)
  if (bestAnX) out.x = bestAnX.x
  if (bestAnY) out.y = bestAnY.y
  if (bestAnX && out.x === bestAnX.x && out.y !== bestAnX.y) pushLine(guides, bestAnX, out)
  if (bestAnY && out.y === bestAnY.y && out.x !== bestAnY.x) pushLine(guides, bestAnY, out)
  return { point: out, guides }
}

/**
 * Closest anchor on one axis only (|pt[axis] - an[axis]| <= thr), ignoring the other axis.
 * `accept` filters the candidate coordinate (used to stay inside a matched wall segment).
 */
function closestAnchor(anchors: Vec[], value: number, axis: 'x' | 'y', thr: number, accept?: (v: number) => boolean): Vec | null {
  let best: Vec | null = null, bestD = thr
  for (const an of anchors) {
    const v = an[axis]
    if (accept && !accept(v)) continue
    const d = Math.abs(value - v)
    if (d <= bestD) { bestD = d; best = an }
  }
  return best
}

/**
 * Add a line guide, but never the same line twice (two anchors can share coordinates).
 */
function pushLine(guides: SnapGuide[], a: Vec, b: Vec) {
  const same = guides.some((g) => g.kind === 'line' && g.a.x === a.x && g.a.y === a.y && g.b?.x === b.x && g.b?.y === b.y)
  if (!same) guides.push({ kind: 'line', a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y } })
}

/** Smallest correction (other - mine) with |correction| <= thr, or null. */
function bestShift(mine: number[], others: number[], thr: number): number | null {
  let best: number | null = null
  for (const m of mine) for (const o of others) {
    const d = o - m
    if (Math.abs(d) <= thr && (best === null || Math.abs(d) < Math.abs(best))) best = d
  }
  return best
}

/**
 * Move a room by (dx, dy), then pull its walls onto nearby walls/vertices of other rooms:
 * x and y are snapped on their own. Returns the corrected delta and guides
 * (a line along each aligned edge, a point where a corner meets a corner).
 * With opts.wallThicknessCm > 0 the walls also snap at a gap of +/- that thickness (flush stays).
 */
export function snapRoomDelta(
  room: Room,
  dx: number,
  dy: number,
  otherRooms: Room[],
  thresholdCm = 12,
  opts: { disableSnap?: boolean; precisionCm?: number; wallThicknessCm?: number } = {},
): { dx: number; dy: number; guides: SnapGuide[] } {
  if (opts.disableSnap) return { dx: roundP(dx, opts.precisionCm), dy: roundP(dy, opts.precisionCm), guides: [] }
  const others = otherRooms.flatMap((r) => r.vertices)
  if (!room.vertices.length || !others.length) return { dx, dy, guides: [] }
  const t = opts.wallThicknessCm && opts.wallThicknessCm > 0 ? opts.wallThicknessCm : 0
  const offsets = t > 0 ? [0, t, -t] : [0]
  const sx = bestShift(room.vertices.map((v) => v.x + dx), others.flatMap((v) => offsets.map((k) => v.x + k)), thresholdCm)
  const sy = bestShift(room.vertices.map((v) => v.y + dy), others.flatMap((v) => offsets.map((k) => v.y + k)), thresholdCm)
  const ox = dx + (sx ?? 0), oy = dy + (sy ?? 0)
  const moved = room.vertices.map((v) => ({ x: v.x + ox, y: v.y + oy }))
  const guides: SnapGuide[] = []
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-6
  if (sx !== null) {
    for (const v of moved) for (const o of others) for (const k of offsets) if (near(v.x, o.x + k)) {
      guides.push({ kind: 'line', a: { x: o.x + k, y: Math.min(v.y, o.y) }, b: { x: o.x + k, y: Math.max(v.y, o.y) } })
    }
  }
  if (sy !== null) {
    for (const v of moved) for (const o of others) for (const k of offsets) if (near(v.y, o.y + k)) {
      guides.push({ kind: 'line', a: { x: Math.min(v.x, o.x), y: o.y + k }, b: { x: Math.max(v.x, o.x), y: o.y + k } })
    }
  }
  for (const v of moved) for (const o of others) if (near(v.x, o.x) && near(v.y, o.y)) guides.push({ kind: 'point', a: { x: o.x, y: o.y } })
  return { dx: ox, dy: oy, guides }
}

/** Options of snapWallDelta. */
export type WallSnapOpts = {
  disableSnap?: boolean
  precisionCm?: number
  wallThicknessCm?: number
  /** Snap only the axis perpendicular to the wall (ortho 90° lock / Shift): the along axis keeps `delta`. */
  perpendicularOnly?: boolean
}

const AXIS_EPS = 1e-6

/**
 * Snap the wall a -> b, dragged by `delta`, onto the other rooms. A wall is a line, so it snaps the
 * way a whole room does (snapRoomDelta): its own line is pulled onto the parallel walls of the other
 * rooms and its two endpoints try to meet their vertices.
 * - Horizontal wall (|dy| <= |dx| of a -> b): the Y of the moved line snaps to the Y of every
 *   horizontal edge of the other rooms, plus and minus `wallThicknessCm` (flush stays, and the wall
 *   can stop at one wall thickness from the other wall). The X comes from the better endpoint snap.
 * - Vertical wall: the same on X, with Y from the endpoints.
 * - Slanted wall (not axis-aligned): no line snap, the endpoint with the better snap drags the wall.
 * A parallel edge whose span overlaps the moved wall (or ends within the threshold of it) wins over a
 * nearer edge far away along the wall: a wall prefers the wall it actually faces.
 */
export function snapWallDelta(
  a: Vec, b: Vec, delta: Vec, otherRooms: Room[],
  thresholdCm = DEFAULT_SNAP_THRESHOLD_CM, opts: WallSnapOpts = {},
): { delta: Vec; guides: SnapGuide[] } {
  if (opts.disableSnap) return { delta: { x: roundP(delta.x, opts.precisionCm), y: roundP(delta.y, opts.precisionCm) }, guides: [] }
  const snapOpts: SnapOpts = { precisionCm: opts.precisionCm, thresholdCm, wallThicknessCm: opts.wallThicknessCm }
  const pa = add(a, delta), pb = add(b, delta)
  const flat = Math.abs(b.y - a.y) < AXIS_EPS
  const upright = Math.abs(b.x - a.x) < AXIS_EPS

  if (!flat && !upright) {
    // Slanted wall: no line to align, only the endpoint that meets another wall or vertex moves the wall.
    const sa = snapPoint(pa, otherRooms, snapOpts)
    const sb = snapPoint(pb, otherRooms, snapOpts)
    const pick = bestEndpointSnap(pa, sa, pb, sb)
    const out = { x: delta.x + (pick.snap.point.x - pick.raw.x), y: delta.y + (pick.snap.point.y - pick.raw.y) }
    return { delta: opts.perpendicularOnly ? constrainWallPerpendicular(a, b, out.x, out.y) : out, guides: pick.snap.guides }
  }

  // Axis-aligned wall: `perp` is the axis of the line snap, `along` the axis of the free slide.
  const perp: 'x' | 'y' = flat ? 'y' : 'x'
  const along: 'x' | 'y' = flat ? 'x' : 'y'
  const t = opts.wallThicknessCm && opts.wallThicknessCm > 0 ? opts.wallThicknessCm : 0
  const offsets = t > 0 ? [0, t, -t] : [0]
  const movedPerp = a[perp] + delta[perp]
  const lo = Math.min(a[along], b[along]) + delta[along]
  const hi = Math.max(a[along], b[along]) + delta[along]

  type Cand = { value: number; lo: number; hi: number; shift: number; facing: boolean }
  const cands: Cand[] = []
  for (const room of otherRooms) {
    const vs = room.vertices
    for (let i = 0; i < vs.length; i++) {
      const e0 = vs[i], e1 = vs[(i + 1) % vs.length]
      const parallel = flat ? Math.abs(e1.y - e0.y) < AXIS_EPS : Math.abs(e1.x - e0.x) < AXIS_EPS
      if (!parallel) continue
      const candLo = Math.min(e0[along], e1[along]), candHi = Math.max(e0[along], e1[along])
      // The edge is "facing" when its span overlaps the moved wall, or ends within the threshold of it.
      const isFacing = candHi >= lo - thresholdCm && candLo <= hi + thresholdCm
      for (const k of offsets) {
        const value = e0[perp] + k
        const shift = value - movedPerp
        if (Math.abs(shift) <= thresholdCm) cands.push({ value, lo: candLo, hi: candHi, shift, facing: isFacing })
      }
    }
  }
  // Facing edges win: they share the wall line the user sees behind the dragged wall. Then the nearest.
  const nearestOf = (list: Cand[]) => list.reduce<Cand | null>((b, c) => (!b || Math.abs(c.shift) < Math.abs(b.shift) ? c : b), null)
  const chosen = nearestOf(cands.filter((c) => c.facing)) ?? nearestOf(cands)

  const out: Vec = { x: delta.x, y: delta.y }
  if (chosen) out[perp] = delta[perp] + chosen.shift
  else {
    // No wall at reach: stay on the precision grid, like the old endpoint snap did.
    const grid = opts.precisionCm ?? DEFAULT_GRID_CM
    if (grid > 0) out[perp] = snapToGrid(movedPerp, grid) - a[perp]
  }

  const guides: SnapGuide[] = []
  if (chosen) {
    // One line along the matched axis, from the other wall to the dragged one.
    const gLo = Math.min(lo, chosen.lo), gHi = Math.max(hi, chosen.hi)
    const guide: SnapGuide = perp === 'y'
      ? { kind: 'line', a: { x: gLo, y: chosen.value }, b: { x: gHi, y: chosen.value } }
      : { kind: 'line', a: { x: chosen.value, y: gLo }, b: { x: chosen.value, y: gHi } }
    guides.push(guide)
  }
  if (!opts.perpendicularOnly) {
    // Free slide along the wall: both endpoints try the vertices/walls of the other rooms, the
    // closer match sets the along coordinate. Neither matches: grid, as before.
    const sa = snapPoint(pa, otherRooms, snapOpts)
    const sb = snapPoint(pb, otherRooms, snapOpts)
    const pick = bestEndpointSnap(pa, sa, pb, sb)
    out[along] = delta[along] + (pick.snap.point[along] - pick.raw[along])
    for (const g of pick.snap.guides) if (g.kind === 'point') guides.push(g)
  }
  return { delta: out, guides }
}

/** The endpoint snap that matches something, the fewer corrected of the two (endpoint a by default). */
function bestEndpointSnap(
  pa: Vec, sa: SnapResult, pb: Vec, sb: SnapResult,
): { raw: Vec; snap: SnapResult } {
  const ra = sa.guides.length > 0, rb = sb.guides.length > 0
  if (ra && rb) return dist(sa.point, pa) <= dist(sb.point, pb) ? { raw: pa, snap: sa } : { raw: pb, snap: sb }
  if (rb && !ra) return { raw: pb, snap: sb }
  return { raw: pa, snap: sa }
}
