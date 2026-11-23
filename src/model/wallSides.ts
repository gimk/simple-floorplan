// The two sides of one wall. Rooms are separate outlines, so a wall between two rooms is one
// room wall in each room. Pure, cm.
import { cross, dot, roomWalls, sub } from './geometry'
import type { PlanDoc, Room } from './types'

/** The two faces of one wall are at most this far apart on the plan (cm). */
const MAX_GAP_CM = 35
/** The two sides must share at least this length (cm). */
const MIN_OVERLAP_CM = 20

/**
 * Walls of OTHER rooms that are the other side of wall `index` of `room`: parallel, facing it
 * (the other room is on the outside of this wall), close to it and sharing a part of its length.
 */
export function otherSides(doc: Pick<PlanDoc, 'rooms'>, room: Room, index: number): { room: Room; index: number }[] {
  const w = roomWalls(room)[index]
  if (!w || w.length < 1) return []
  const out: { room: Room; index: number }[] = []
  for (const r of doc.rooms) {
    if (r.id === room.id) continue
    for (const o of roomWalls(r)) {
      if (o.length < 1 || dot(o.inward, w.inward) > -0.985 || Math.abs(cross(o.dir, w.dir)) > 0.2) continue
      // Distance of the other wall behind this one (inward points into this room).
      const d0 = -dot(sub(o.start, w.start), w.inward), d1 = -dot(sub(o.end, w.start), w.inward)
      if (Math.min(d0, d1) < -2 || Math.max(d0, d1) > MAX_GAP_CM) continue
      const t0 = dot(sub(o.start, w.start), w.dir), t1 = dot(sub(o.end, w.start), w.dir)
      const overlap = Math.min(w.length, Math.max(t0, t1)) - Math.max(0, Math.min(t0, t1))
      if (overlap < MIN_OVERLAP_CM) continue
      out.push({ room: r, index: o.index })
    }
  }
  return out
}

const before = (a: Room, b: Room) => a.walkOrder < b.walkOrder || (a.walkOrder === b.walkOrder && a.code < b.code)

/**
 * Is `room` the owner of wall `index`? A wall has ONE owner: of the rooms on its sides, the room
 * that comes first in the walk-through. The owner holds the wall's thickness ID (CODE-n-T).
 */
export const ownsWall = (doc: Pick<PlanDoc, 'rooms'>, room: Room, index: number): boolean =>
  otherSides(doc, room, index).every((o) => before(room, o.room))
