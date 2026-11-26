// Pure magnetic snapping for room drawing and moving (no React). Units: cm.
import { dist, projectOnSegment } from '../../model/geometry'
import type { Vec } from '../../model/geometry'
import type { Room } from '../../model/types'

export type SnapGuide = { kind: 'point' | 'line'; a: Vec; b?: Vec }
export type SnapResult = { point: Vec; guides: SnapGuide[] }
export type SnapOpts = { gridCm?: number; thresholdCm?: number; anchor?: Vec }

export const DEFAULT_GRID_CM = 5
export const DEFAULT_SNAP_THRESHOLD_CM = 10

const snapToGrid = (v: number, grid: number) => (grid > 0 ? Math.round(v / grid) * grid : v)

/**
 * Snap pt. Priority: 1) vertex of another room, 2) wall of another room (closest point),
 * 3) horizontal/vertical alignment with opts.anchor, each axis then the grid (default 5 cm; 0 = off).
 */
export function snapPoint(pt: Vec, otherRooms: Room[], opts: SnapOpts = {}): SnapResult {
  const grid = opts.gridCm ?? DEFAULT_GRID_CM
  const thr = opts.thresholdCm ?? DEFAULT_SNAP_THRESHOLD_CM

  let bestV: Vec | null = null, bestVd = thr
  let bestW: { point: Vec; a: Vec; b: Vec } | null = null, bestWd = thr
  for (const room of otherRooms) {
    const vs = room.vertices
    for (let i = 0; i < vs.length; i++) {
      const d = dist(pt, vs[i])
      if (d <= bestVd) { bestVd = d; bestV = vs[i] }
      const a = vs[i], b = vs[(i + 1) % vs.length]
      const p = projectOnSegment(pt, a, b)
      if (p.distance <= bestWd) { bestWd = p.distance; bestW = { point: p.point, a, b } }
    }
  }
  if (bestV) return { point: { x: bestV.x, y: bestV.y }, guides: [{ kind: 'point', a: { x: bestV.x, y: bestV.y } }] }
  if (bestW) return { point: bestW.point, guides: [{ kind: 'line', a: bestW.a, b: bestW.b }, { kind: 'point', a: bestW.point }] }

  const out = { x: snapToGrid(pt.x, grid), y: snapToGrid(pt.y, grid) }
  const guides: SnapGuide[] = []
  const an = opts.anchor
  if (an) {
    if (Math.abs(pt.x - an.x) <= thr) out.x = an.x
    if (Math.abs(pt.y - an.y) <= thr) out.y = an.y
    if (out.x === an.x && out.y !== an.y) guides.push({ kind: 'line', a: { x: an.x, y: an.y }, b: { x: out.x, y: out.y } })
    if (out.y === an.y && out.x !== an.x) guides.push({ kind: 'line', a: { x: an.x, y: an.y }, b: { x: out.x, y: out.y } })
  }
  return { point: out, guides }
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
 */
export function snapRoomDelta(
  room: Room,
  dx: number,
  dy: number,
  otherRooms: Room[],
  thresholdCm = 12,
): { dx: number; dy: number; guides: SnapGuide[] } {
  const others = otherRooms.flatMap((r) => r.vertices)
  if (!room.vertices.length || !others.length) return { dx, dy, guides: [] }
  const sx = bestShift(room.vertices.map((v) => v.x + dx), others.map((v) => v.x), thresholdCm)
  const sy = bestShift(room.vertices.map((v) => v.y + dy), others.map((v) => v.y), thresholdCm)
  const ox = dx + (sx ?? 0), oy = dy + (sy ?? 0)
  const moved = room.vertices.map((v) => ({ x: v.x + ox, y: v.y + oy }))
  const guides: SnapGuide[] = []
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-6
  if (sx !== null) {
    for (const v of moved) for (const o of others) if (near(v.x, o.x)) guides.push({ kind: 'line', a: { x: o.x, y: Math.min(v.y, o.y) }, b: { x: o.x, y: Math.max(v.y, o.y) } })
  }
  if (sy !== null) {
    for (const v of moved) for (const o of others) if (near(v.y, o.y)) guides.push({ kind: 'line', a: { x: Math.min(v.x, o.x), y: o.y }, b: { x: Math.max(v.x, o.x), y: o.y } })
  }
  for (const v of moved) for (const o of others) if (near(v.x, o.x) && near(v.y, o.y)) guides.push({ kind: 'point', a: { x: o.x, y: o.y } })
  return { dx: ox, dy: oy, guides }
}
