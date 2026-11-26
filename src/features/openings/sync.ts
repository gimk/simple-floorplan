// Keep openings (doors, windows) attached to their wall when a room moves, a wall or vertex is
// dragged, or rooms are deleted, cut or merged. Pure functions: no store, no React.
// An opening belongs to a wall when its centre is within WALL_HOST_TOL_CM of that wall.
import { lerp, projectOnSegment } from '../../model/geometry'
import type { Vec } from '../../model/geometry'
import type { Opening, Room } from '../../model/types'
import { keepOpeningOrientation } from './geometry'

export const WALL_HOST_TOL_CM = 2

type Host = { room: Room; edgeIndex: number; t: number; distance: number }

/** Nearest wall of `room` within tolerance of the opening centre, or null. */
function hostWall(room: Room, o: Opening): Host | null {
  const v = room.vertices
  const pt = { x: o.xCm, y: o.yCm }
  let best: Host | null = null
  for (let i = 0; i < v.length; i++) {
    const a = v[i], b = v[(i + 1) % v.length]
    if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-6) continue
    const p = projectOnSegment(pt, a, b)
    if (p.distance <= WALL_HOST_TOL_CM && (!best || p.distance < best.distance)) {
      best = { room, edgeIndex: i, t: p.t, distance: p.distance }
    }
  }
  return best
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
  return { ...o, xCm: c.x, yCm: c.y, angleDeg: keepOpeningOrientation(wallAngle, o.angleDeg) }
}

/**
 * One room changed shape or position (prevRoom -> nextRoom, same vertex count): every opening on
 * one of its walls follows that wall (same fraction t along the updated wall, angle updated).
 * Other openings are returned as they are. Returns a new array.
 */
export function syncOpeningsForRoomMove(openings: Opening[], prevRoom: Room, nextRoom: Room): Opening[] {
  if (prevRoom.vertices.length !== nextRoom.vertices.length || sameVertices(prevRoom.vertices, nextRoom.vertices)) return openings.slice()
  return openings.map((o) => {
    const host = hostWall(prevRoom, o)
    return (host && placeOnWall(o, nextRoom, host.edgeIndex, host.t)) ?? o
  })
}

/**
 * Several rooms changed (moved, resized, deleted, cut, merged). For each opening:
 * - not on any wall of prevRooms: kept;
 * - on a wall of a room that did not change: kept (the wall is still there);
 * - on a wall of a changed room that still exists with the same vertex count: follows the wall;
 * - otherwise kept when it is still on a wall of nextRooms or its host room still exists
 *   (id found), and removed when its host rooms are gone and no wall is near it.
 */
export function syncOpeningsForRoomChange(openings: Opening[], prevRooms: Room[], nextRooms: Room[]): Opening[] {
  const nextById = new Map(nextRooms.map((r) => [r.id, r] as const))
  const out: Opening[] = []
  for (const o of openings) {
    const hosts = prevRooms.map((r) => hostWall(r, o)).filter((h): h is Host => h !== null)
    if (hosts.length === 0) { out.push(o); continue }
    if (hosts.some((h) => { const n = nextById.get(h.room.id); return n && sameVertices(h.room.vertices, n.vertices) })) { out.push(o); continue }
    hosts.sort((a, b) => a.distance - b.distance)
    let moved: Opening | null = null
    for (const h of hosts) {
      const n = nextById.get(h.room.id)
      if (n && n.vertices.length === h.room.vertices.length) { moved = placeOnWall(o, n, h.edgeIndex, h.t); if (moved) break }
    }
    if (moved) { out.push(moved); continue }
    const hostSurvives = hosts.some((h) => nextById.has(h.room.id))
    if (hostSurvives || nextRooms.some((r) => hostWall(r, o))) out.push(o)
  }
  return out
}
