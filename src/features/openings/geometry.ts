// Pure geometry for doors, windows and openings (no React, no store). Units: cm, degrees, y points down.
// Axis of an opening: d = (cos a, sin a). Normal: n = (-sin a, cos a).
// Hinge 'left' = the start end (centre - d*w/2); 'right' = the end (centre + d*w/2).
// Swing 'in' = towards +n (the inside of a room with clockwise vertices on screen); 'out' = towards -n.
import { add, dist, dot, mul, projectOnSegment, sub } from '../../model/geometry'
import type { Vec } from '../../model/geometry'
import { newId } from '../../model/schema'
import type { Opening, OpeningKind, Room } from '../../model/types'

export const DEFAULT_OPENING_WIDTH_CM: Record<OpeningKind, number> = { door: 85, window: 120, opening: 100 }
export const MIN_OPENING_WIDTH_CM = 30
export const MAX_OPENING_WIDTH_CM = 400

export type WallSnap = {
  xCm: number
  yCm: number
  angleDeg: number
  roomId: string
  edgeIndex: number
  /** Position of the centre along the wall: 0 = start vertex, 1 = end vertex. */
  t: number
  wallLengthCm: number
  a: Vec
  b: Vec
}

const RAD = Math.PI / 180
const axis = (angleDeg: number): Vec => ({ x: Math.cos(angleDeg * RAD), y: Math.sin(angleDeg * RAD) })
const normal = (angleDeg: number): Vec => ({ x: -Math.sin(angleDeg * RAD), y: Math.cos(angleDeg * RAD) })
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/**
 * Nearest wall (all rooms) within thresholdCm of pt. The centre is kept so the opening of widthCm
 * stays inside the wall; a wall shorter than widthCm gets the opening at its middle.
 * Null when no wall is near enough.
 */
export function snapToWall(pt: Vec, rooms: Room[], widthCm: number = DEFAULT_OPENING_WIDTH_CM.door, thresholdCm = 35): WallSnap | null {
  let best: { d: number; roomId: string; edgeIndex: number; a: Vec; b: Vec; t: number; length: number } | null = null
  for (const room of rooms) {
    const v = room.vertices
    for (let i = 0; i < v.length; i++) {
      const a = v[i], b = v[(i + 1) % v.length]
      const length = dist(a, b)
      if (length < 1e-6) continue
      const p = projectOnSegment(pt, a, b)
      if (p.distance <= thresholdCm && (!best || p.distance < best.d)) {
        best = { d: p.distance, roomId: room.id, edgeIndex: i, a, b, t: p.t, length }
      }
    }
  }
  if (!best) return null
  const { a, b, length } = best
  const pos = length >= widthCm ? clamp(best.t * length, widthCm / 2, length - widthCm / 2) : length / 2
  const dir = mul(sub(b, a), 1 / length)
  const c = add(a, mul(dir, pos))
  return {
    xCm: c.x,
    yCm: c.y,
    angleDeg: Math.atan2(b.y - a.y, b.x - a.x) / RAD,
    roomId: best.roomId,
    edgeIndex: best.edgeIndex,
    t: pos / length,
    wallLengthCm: length,
    a: { x: a.x, y: a.y },
    b: { x: b.x, y: b.y },
  }
}

/**
 * Keep an existing opening on its current side of the wall: a wall can be seen from either end, and
 * the two directions differ by 180 degrees, which swaps the hinge end and the swing side (a door
 * would be mirrored). Two rooms drawn side by side share a wall, and the two coincident edges point
 * in opposite directions: without this, dragging a door along that wall can flip it.
 * Perpendicular walls (dot = 0) keep the wall angle as it is. Result is normalized to (-180, 180].
 */
export function keepOpeningOrientation(wallAngleDeg: number, currentAngleDeg: number): number {
  // A tiny negative dot is floating-point noise on a perpendicular wall: treat it as perpendicular.
  const deg = dot(axis(wallAngleDeg), axis(currentAngleDeg)) < -1e-9 ? wallAngleDeg + 180 : wallAngleDeg
  const wrapped = ((deg % 360) + 360) % 360
  return wrapped > 180 ? wrapped - 360 : wrapped
}

/** Hinge side (along the wall) and swing side (across the wall) from the cursor position relative to the centre. */
export function computeDoorFlip(center: Vec, angleDeg: number, cursorPt: Vec): { hinge: 'left' | 'right'; swing: 'in' | 'out' } {
  const rel = sub(cursorPt, center)
  return {
    hinge: dot(rel, axis(angleDeg)) < 0 ? 'left' : 'right',
    swing: dot(rel, normal(angleDeg)) >= 0 ? 'in' : 'out',
  }
}

export function openingEndpoints(op: Pick<Opening, 'xCm' | 'yCm' | 'angleDeg' | 'widthCm'>): { start: Vec; end: Vec } {
  const h = mul(axis(op.angleDeg), op.widthCm / 2)
  const c = { x: op.xCm, y: op.yCm }
  return { start: sub(c, h), end: add(c, h) }
}

/** Drag one end to the cursor (projected on the opening axis). The other end stays fixed; width is clamped. */
export function resizeOpeningFromEnd(op: Opening, end: 'start' | 'end', cursorPt: Vec): { xCm: number; yCm: number; widthCm: number } {
  const d = axis(op.angleDeg)
  const s = dot(sub(cursorPt, { x: op.xCm, y: op.yCm }), d) // cursor position along the axis, 0 = centre
  const ends = openingEndpoints(op)
  if (end === 'end') {
    const widthCm = clamp(s + op.widthCm / 2, MIN_OPENING_WIDTH_CM, MAX_OPENING_WIDTH_CM)
    const c = add(ends.start, mul(d, widthCm / 2))
    return { xCm: c.x, yCm: c.y, widthCm }
  }
  const widthCm = clamp(op.widthCm / 2 - s, MIN_OPENING_WIDTH_CM, MAX_OPENING_WIDTH_CM)
  const c = sub(ends.end, mul(d, widthCm / 2))
  return { xCm: c.x, yCm: c.y, widthCm }
}

/**
 * Door leaf and swing arc. The leaf is fixed at the hinge; closedTipPt is the other end of the opening,
 * openTipPt is the leaf tip when open at 90 degrees (on the swing side). The arc has radius = width,
 * centre = hingePt and goes from closedTipPt to openTipPt: SVG `A r r 0 0 sweepFlag x y`.
 * Defaults when missing: hinge 'left', swing 'in'.
 */
export function doorArcGeometry(op: Opening): { hingePt: Vec; closedTipPt: Vec; openTipPt: Vec; radius: number; sweepFlag: 0 | 1 } {
  const { start, end } = openingEndpoints(op)
  const left = (op.hinge ?? 'left') === 'left'
  const hingePt = left ? start : end
  const closedTipPt = left ? end : start
  const sign = (op.swing ?? 'in') === 'in' ? 1 : -1
  const openTipPt = add(hingePt, mul(normal(op.angleDeg), sign * op.widthCm))
  const u = sub(closedTipPt, hingePt), w = sub(openTipPt, hingePt)
  const crossUW = u.x * w.y - u.y * w.x
  return { hingePt, closedTipPt, openTipPt, radius: op.widthCm, sweepFlag: crossUW > 0 ? 1 : 0 }
}

/** New opening at a wall snap. Doors get hinge/swing (default 'left'/'in'); other kinds get none. */
export function createOpening(kind: OpeningKind, snap: WallSnap, hinge: 'left' | 'right' = 'left', swing: 'in' | 'out' = 'in'): Opening {
  const widthCm = Math.min(DEFAULT_OPENING_WIDTH_CM[kind], Math.max(MIN_OPENING_WIDTH_CM, snap.wallLengthCm))
  const op: Opening = { id: newId(), kind, xCm: snap.xCm, yCm: snap.yCm, angleDeg: snap.angleDeg, widthCm }
  if (kind === 'door') { op.hinge = hinge; op.swing = swing }
  return op
}
