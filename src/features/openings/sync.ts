// Keep openings (doors, windows) attached to their wall when a room moves, a wall or vertex is
// dragged, or rooms are deleted, cut or merged. Pure functions: no store, no React.
// An opening belongs to a wall when its centre is within WALL_HOST_TOL_CM of that wall.
//
// Two rooms can be flush: their walls have a 0 cm gap, so the centre of an opening on that wall is at
// distance 0 from an edge of both rooms. The host is then chosen with, in this order:
//   1. `opening.roomId`, the room the opening belongs to (when that room still hosts the opening);
//   2. the edge that runs along the opening axis (dot > 0), so a coincident edge of the other room,
//      which runs the other way, does not flip the hinge side and the swing side of the opening.
import { lerp, projectOnSegment } from '../../model/geometry'
import type { Vec } from '../../model/geometry'
import type { Opening, Room } from '../../model/types'
import { keepOpeningOrientation } from './geometry'

export const WALL_HOST_TOL_CM = 2

/** Host edges whose distances differ by less than this are "the same distance": ties are broken. */
export const HOST_TIE_TOL_CM = 0.5

export type Host = { room: Room; edgeIndex: number; t: number; distance: number }

const RAD = Math.PI / 180

/** True when edge `i` of `room` runs along the opening axis (dot of the two unit directions > 0). */
function edgeAlongOpening(room: Room, edgeIndex: number, o: Opening): boolean {
  const v = room.vertices
  const a = v[edgeIndex], b = v[(edgeIndex + 1) % v.length]
  if (!a || !b) return false
  const len = Math.hypot(b.x - a.x, b.y - a.y)
  if (len < 1e-9) return false
  const dot = ((b.x - a.x) / len) * Math.cos(o.angleDeg * RAD) + ((b.y - a.y) / len) * Math.sin(o.angleDeg * RAD)
  return dot > 1e-9
}

/** True when the two hosts are at nearly the same distance from the opening centre. */
const sameDistance = (d1: number, d2: number) => Math.abs(d1 - d2) <= HOST_TIE_TOL_CM

/**
 * True when `cand` should host `o` instead of `best`. A clearly nearer edge always wins; two edges at
 * nearly the same distance (a flush wall) are told apart by `ownRoomId` (the room the opening
 * belongs to) and then by the direction of the edge.
 */
function betterHost(cand: Host, best: Host | null, o: Opening, ownRoomId?: string): boolean {
  if (!best) return true
  if (!sameDistance(cand.distance, best.distance)) return cand.distance < best.distance
  if (ownRoomId) {
    const candOwn = cand.room.id === ownRoomId, bestOwn = best.room.id === ownRoomId
    if (candOwn !== bestOwn) return candOwn
  }
  const candAlong = edgeAlongOpening(cand.room, cand.edgeIndex, o)
  const bestAlong = edgeAlongOpening(best.room, best.edgeIndex, o)
  if (candAlong !== bestAlong) return candAlong
  return cand.distance < best.distance
}

/** Nearest wall of `room` within tolerance of the opening centre, or null. */
export function hostWall(room: Room, o: Opening): Host | null {
  const v = room.vertices
  const pt = { x: o.xCm, y: o.yCm }
  let best: Host | null = null
  for (let i = 0; i < v.length; i++) {
    const a = v[i], b = v[(i + 1) % v.length]
    if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-6) continue
    const p = projectOnSegment(pt, a, b)
    if (p.distance > WALL_HOST_TOL_CM) continue
    if (betterHost({ room, edgeIndex: i, t: p.t, distance: p.distance }, best, o)) {
      best = { room, edgeIndex: i, t: p.t, distance: p.distance }
    }
  }
  return best
}

/**
 * Wall that hosts `o` over all `rooms`, or null. With two rooms flush (`o` at distance 0 from an edge
 * of each), the room of `o.roomId` wins, then the edge that runs along the opening axis, then the
 * nearest edge. Falls back to the nearest edge when `o.roomId` is unknown or does not host `o`.
 */
export function hostWallIn(rooms: Room[], o: Opening): Host | null {
  let best: Host | null = null
  for (const room of rooms) {
    const h = hostWall(room, o)
    if (h && betterHost(h, best, o, o.roomId)) best = h
  }
  return best
}

/** Every host edge of `o` in `rooms`, best first (see `betterHost`). */
function rankedHosts(rooms: Room[], o: Opening): Host[] {
  const hosts: Host[] = []
  for (const room of rooms) {
    const h = hostWall(room, o)
    if (h) hosts.push(h)
  }
  return hosts.sort((a, b) => (betterHost(a, b, o, o.roomId) ? -1 : betterHost(b, a, o, o.roomId) ? 1 : 0))
}

const sameVertices = (a: Vec[], b: Vec[]) =>
  a.length === b.length && a.every((p, i) => p.x === b[i].x && p.y === b[i].y)

/** Put the opening on edge `edgeIndex` of `next` at fraction t; null if the edge does not exist. */
function placeOnWall(o: Opening, next: Room, edgeIndex: number, t: number): Opening | null {
  const v = next.vertices
  if (edgeIndex >= v.length) return null
  const a = v[edgeIndex], b = v[(edgeIndex + 1) % v.length]
  if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-6) return null
  const c = lerp(a, b, t)
  const wallAngle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI
  return { ...o, roomId: next.id, xCm: c.x, yCm: c.y, angleDeg: keepOpeningOrientation(wallAngle, o.angleDeg) }
}

/**
 * One room changed shape or position (prevRoom -> nextRoom, same vertex count): every opening on
 * one of its walls follows that wall (same fraction t along the updated wall, angle updated).
 * Openings that belong to another room stay where they are, even when `prevRoom` has a wall flush
 * with that room. Other openings are returned as they are. Returns a new array.
 */
export function syncOpeningsForRoomMove(openings: Opening[], prevRoom: Room, nextRoom: Room): Opening[] {
  if (prevRoom.vertices.length !== nextRoom.vertices.length || sameVertices(prevRoom.vertices, nextRoom.vertices)) return openings.slice()
  return openings.map((o) => {
    if (o.roomId && o.roomId !== prevRoom.id) return o
    const host = hostWall(prevRoom, o)
    return (host && placeOnWall(o, nextRoom, host.edgeIndex, host.t)) ?? o
  })
}

/**
 * Several rooms changed (moved, resized, deleted, cut, merged). For each opening:
 * - not on any wall of prevRooms: kept;
 * - on a wall of the room it belongs to (`roomId`) that still exists with the same vertex count:
 *   follows that wall, even when a flush wall of another room stays put;
 * - on a wall of a room that did not change: kept (the wall is still there);
 * - on a wall of a changed room that still exists with the same vertex count: follows the wall;
 * - otherwise kept when it is still on a wall of nextRooms or its host room still exists
 *   (id found), and removed when its host rooms are gone and no wall is near it.
 * `roomId` is kept accurate: it follows the room the opening ends up on, and is re-pointed when its
 * room is gone but the opening stays on a wall of another room.
 */
export function syncOpeningsForRoomChange(openings: Opening[], prevRooms: Room[], nextRooms: Room[]): Opening[] {
  const nextById = new Map(nextRooms.map((r) => [r.id, r] as const))
  const out: Opening[] = []
  /** Keep the opening in place, re-pointing `roomId` at a host room that still exists. */
  const keep = (o: Opening, hosts: Host[]): Opening => {
    if (!o.roomId) return o
    const own = nextById.get(o.roomId)
    if (own && hostWall(own, o)) return o
    const host = hosts.find((h) => nextById.has(h.room.id))
    return host ? { ...o, roomId: host.room.id } : o
  }
  for (const o of openings) {
    const hosts = rankedHosts(prevRooms, o)
    if (hosts.length === 0) { out.push(o); continue }
    // The room the opening belongs to comes first: a flush wall of another room must not take it over.
    const own = o.roomId ? hosts.find((h) => h.room.id === o.roomId) : undefined
    const ownNext = own ? nextById.get(own.room.id) : undefined
    if (own && ownNext && ownNext.vertices.length === own.room.vertices.length) {
      out.push(sameVertices(own.room.vertices, ownNext.vertices) ? o : placeOnWall(o, ownNext, own.edgeIndex, own.t) ?? o)
      continue
    }
    if (hosts.some((h) => { const n = nextById.get(h.room.id); return n && sameVertices(h.room.vertices, n.vertices) })) {
      out.push(keep(o, hosts)); continue
    }
    let moved: Opening | null = null
    for (const h of hosts) {
      const n = nextById.get(h.room.id)
      if (n && n.vertices.length === h.room.vertices.length) { moved = placeOnWall(o, n, h.edgeIndex, h.t); if (moved) break }
    }
    if (moved) { out.push(moved); continue }
    const hostSurvives = hosts.some((h) => nextById.has(h.room.id))
    if (hostSurvives || nextRooms.some((r) => hostWall(r, o))) out.push(keep(o, hosts))
  }
  return out
}
