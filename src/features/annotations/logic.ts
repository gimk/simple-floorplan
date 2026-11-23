// Pure logic for the tape tool and pins (cm). No React here.
import { dist, fmtCm, pointInPolygon, projectOnSegment, roomWalls } from '../../model/geometry'
import type { Pin, PlanDoc, Room, TapeMeasure, Vec } from '../../model/types'

export const SNAP_PX = 12

export type SnapHit = {
  point: Vec
  kind: 'vertex' | 'wall' | 'free'
  roomId?: string
  wallStart?: string
}

/** Snap a point to a room vertex, then to a wall point, within `radiusCm`. Otherwise return it unchanged. */
export function snapToPlan(p: Vec, rooms: Room[], radiusCm: number): SnapHit {
  let bestV: { d: number; hit: SnapHit } | null = null
  for (const r of rooms) {
    for (const v of r.vertices) {
      const d = dist(p, v)
      if (d <= radiusCm && (!bestV || d < bestV.d)) bestV = { d, hit: { point: { x: v.x, y: v.y }, kind: 'vertex', roomId: r.id } }
    }
  }
  if (bestV) return bestV.hit
  const w = nearestWall(p, rooms, radiusCm)
  if (w) return { point: w.point, kind: 'wall', roomId: w.roomId, wallStart: w.wallStart }
  return { point: p, kind: 'free' }
}

/**
 * Second end of a tape with Shift: the tape direction from `a` is locked to the nearest 45° step.
 * On that line, a room corner (within radiusCm of the line point) wins, then the crossing with a
 * wall near the pointer, else the plain point on the line.
 */
export function snapTapeAngle(a: Vec, p: Vec, rooms: Room[], radiusCm: number): SnapHit {
  const ang = Math.atan2(p.y - a.y, p.x - a.x)
  const step = Math.round(ang / (Math.PI / 4)) * (Math.PI / 4)
  const dir = { x: Math.cos(step), y: Math.sin(step) }
  const t = Math.max(0, (p.x - a.x) * dir.x + (p.y - a.y) * dir.y)
  const onLine = { x: a.x + dir.x * t, y: a.y + dir.y * t }
  // Corners on the locked line.
  let best: { d: number; hit: SnapHit } | null = null
  for (const r of rooms) {
    for (const v of r.vertices) {
      const tv = (v.x - a.x) * dir.x + (v.y - a.y) * dir.y
      const off = Math.abs((v.x - a.x) * dir.y - (v.y - a.y) * dir.x)
      const d = dist(v, onLine)
      if (tv > 0 && off < 0.5 && d <= radiusCm && (!best || d < best.d)) best = { d, hit: { point: { x: v.x, y: v.y }, kind: 'vertex', roomId: r.id } }
    }
  }
  if (best) return best.hit
  // Crossings of the locked line with walls, near the pointer.
  for (const r of rooms) {
    for (const w of roomWalls(r)) {
      const e = { x: w.end.x - w.start.x, y: w.end.y - w.start.y }
      const den = dir.x * e.y - dir.y * e.x
      if (Math.abs(den) < 1e-9) continue
      const s = { x: w.start.x - a.x, y: w.start.y - a.y }
      const tt = (s.x * e.y - s.y * e.x) / den
      const u = (s.x * dir.y - s.y * dir.x) / den
      if (tt <= 0 || u < 0 || u > 1) continue
      const q = { x: a.x + dir.x * tt, y: a.y + dir.y * tt }
      const d = dist(q, onLine)
      if (d <= radiusCm && (!best || d < best.d)) best = { d, hit: { point: q, kind: 'wall', roomId: r.id, wallStart: w.start.id } }
    }
  }
  return best ? best.hit : { point: onLine, kind: 'free' }
}

/** Nearest wall within radiusCm. Returns the projected point on the wall. */
export function nearestWall(p: Vec, rooms: Room[], radiusCm: number) {
  let best: { distance: number; point: Vec; roomId: string; wallStart: string } | null = null
  for (const r of rooms) {
    for (const w of roomWalls(r)) {
      const q = projectOnSegment(p, w.start, w.end)
      if (q.distance <= radiusCm && (!best || q.distance < best.distance)) {
        best = { distance: q.distance, point: q.point, roomId: r.id, wallStart: w.start.id }
      }
    }
  }
  return best
}

/** Where a new pin goes: on the nearest wall if close enough, otherwise at the point (room found by containment). */
export function placePin(p: Vec, rooms: Room[], radiusCm: number): Pick<Pin, 'at' | 'roomId' | 'wallStart'> {
  const w = nearestWall(p, rooms, radiusCm)
  if (w) return { at: w.point, roomId: w.roomId, wallStart: w.wallStart }
  const room = rooms.find((r) => pointInPolygon(p, r.vertices))
  return { at: p, roomId: room?.id }
}

export const tracedCm = (t: Pick<TapeMeasure, 'a' | 'b'>) => dist(t.a, t.b)

/** Label for a tape: "traced 245 · real 243", "traced 245" when not measured yet. */
export function tapeLabel(t: TapeMeasure): string {
  const traced = tracedCm(t)
  const base = `traced ${fmtCm(traced)}`
  return t.actualCm != null ? `${base} · real ${fmtCm(t.actualCm)}` : base
}

/** Ad-hoc tape from Measuring Mode (label + value, may have no points): a = b = {0,0}. */
export const isUnplaced = (t: Pick<TapeMeasure, 'a' | 'b'>) => t.a.x === 0 && t.a.y === 0 && t.b.x === 0 && t.b.y === 0

/** Pins of a room, oldest first. Pin numbers are the position in this list + 1. */
export function roomPins(doc: Pick<PlanDoc, 'pins'>, roomId: string): Pin[] {
  return (doc.pins ?? []).filter((p) => p.roomId === roomId).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

/** Position of a point on a wall: distance in cm from the wall start, and the point at that offset. */
export function pointOnWall(room: Room, wallStart: string, offsetCm: number) {
  const w = roomWalls(room).find((x) => x.start.id === wallStart)
  if (!w) return null
  const o = Math.max(0, Math.min(w.length, offsetCm))
  return { x: w.start.x + w.dir.x * o, y: w.start.y + w.dir.y * o }
}

/** Fit (w,h) in a max side length, keeping the ratio. Never upscales. */
export function fitSize(w: number, h: number, max: number) {
  const k = Math.min(1, max / Math.max(w, h, 1))
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) }
}
