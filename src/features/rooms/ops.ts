// Pure room geometry and edit operations (no React, no store). Units: cm, y points down.
// Every function returns a new object; inputs are never changed.
import polygonClipping from 'polygon-clipping'
import type { Ring } from 'polygon-clipping'
import { add, area, dist, len, lerp, norm, signedArea, sub } from '../../model/geometry'
import type { Vec } from '../../model/geometry'
import { newId } from '../../model/schema'
import type { Room } from '../../model/types'

export const MIN_ROOM_SIDE_CM = 10
const EPS = 1e-6

export type Wall = { index: number; a: Vec; b: Vec; lengthCm: number; mid: Vec; angleDeg: number }

const cp = (v: Vec): Vec => ({ x: v.x, y: v.y })
const withVertices = (room: Room, vertices: Vec[]): Room => ({ ...room, vertices })

/** Walls of a room: wall i goes from vertex i to vertex i+1 (the last wall closes the loop). */
export function roomWalls(room: Room): Wall[] {
  const v = room.vertices
  return v.map((a, index) => {
    const b = v[(index + 1) % v.length]
    return {
      index,
      a: cp(a),
      b: cp(b),
      lengthCm: dist(a, b),
      mid: lerp(a, b, 0.5),
      angleDeg: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI,
    }
  })
}

/** True when the polygon is a rectangle with 4 vertices and walls parallel to the axes. */
export function isAxisAlignedRect(vertices: Vec[]): boolean {
  if (vertices.length !== 4) return false
  for (let i = 0; i < 4; i++) {
    const a = vertices[i], b = vertices[(i + 1) % 4]
    const horizontal = Math.abs(a.y - b.y) < EPS, vertical = Math.abs(a.x - b.x) < EPS
    if (horizontal === vertical) return false // diagonal or zero-length
    const c = vertices[(i + 2) % 4]
    const nextHorizontal = Math.abs(b.y - c.y) < EPS
    if (horizontal === nextHorizontal) return false // two parallel walls in a row
  }
  return true
}

/**
 * Set the length of wall `edgeIndex`.
 * Axis-aligned rectangle: the next wall and the opposite wall move, so the room stays a rectangle.
 * Other polygon: only the end vertex (edgeIndex+1) moves along the wall direction.
 * Returns null when the length is not a finite number > 0 or the wall has no direction.
 */
export function setWallLength(room: Room, edgeIndex: number, newLengthCm: number): Room | null {
  const v = room.vertices, n = v.length
  if (!Number.isFinite(newLengthCm) || newLengthCm <= 0) return null
  if (edgeIndex < 0 || edgeIndex >= n || n < 2) return null
  const a = v[edgeIndex], j = (edgeIndex + 1) % n, b = v[j]
  if (dist(a, b) < EPS) return null
  const delta = lerp({ x: 0, y: 0 }, norm(sub(b, a)), newLengthCm - dist(a, b))
  const out = v.map(cp)
  out[j] = add(b, delta)
  if (isAxisAlignedRect(v)) {
    const k = (edgeIndex + 2) % n
    out[k] = add(v[k], delta)
  }
  return withVertices(room, out)
}

export function moveRoom(room: Room, dx: number, dy: number): Room {
  return withVertices(room, room.vertices.map((p) => ({ x: p.x + dx, y: p.y + dy })))
}

export function moveVertex(room: Room, idx: number, pos: Vec): Room {
  if (idx < 0 || idx >= room.vertices.length) return room
  return withVertices(room, room.vertices.map((p, i) => (i === idx ? cp(pos) : cp(p))))
}

/** Move both ends of a wall by delta (the neighbour walls stretch). */
export function moveEdge(room: Room, edgeIndex: number, delta: Vec): Room {
  const n = room.vertices.length
  if (edgeIndex < 0 || edgeIndex >= n) return room
  const j = (edgeIndex + 1) % n
  return withVertices(room, room.vertices.map((p, i) => (i === edgeIndex || i === j ? add(p, delta) : cp(p))))
}

/** Insert a vertex at pos on wall `edgeIndex`: it becomes vertex edgeIndex+1. */
export function insertVertexOnEdge(room: Room, edgeIndex: number, pos: Vec): Room {
  const n = room.vertices.length
  if (edgeIndex < 0 || edgeIndex >= n) return room
  const out = room.vertices.map(cp)
  out.splice(edgeIndex + 1, 0, cp(pos))
  return withVertices(room, out)
}

/** Remove vertex idx. Returns null when the room would have fewer than 3 vertices. */
export function deleteVertex(room: Room, idx: number): Room | null {
  const n = room.vertices.length
  if (n <= 3 || idx < 0 || idx >= n) return null
  return withVertices(room, room.vertices.filter((_, i) => i !== idx).map(cp))
}

/** Rectangle room from two opposite corners. 4 vertices, clockwise on screen, each side at least 10 cm. */
export function createRectRoom(a: Vec, b: Vec, name: string): Room {
  const w = Math.max(MIN_ROOM_SIDE_CM, Math.abs(b.x - a.x)), h = Math.max(MIN_ROOM_SIDE_CM, Math.abs(b.y - a.y))
  const bx = a.x + (b.x < a.x ? -w : w), by = a.y + (b.y < a.y ? -h : h)
  const x0 = Math.min(a.x, bx), x1 = Math.max(a.x, bx), y0 = Math.min(a.y, by), y1 = Math.max(a.y, by)
  return { id: newId(), name, vertices: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }] }
}

/** "Room N" with the smallest N >= 1 not used yet. */
export function nextRoomName(rooms: Room[]): string {
  const used = new Set(rooms.map((r) => r.name))
  let n = 1
  while (used.has(`Room ${n}`)) n++
  return `Room ${n}`
}

// ---------- boolean operations ----------

const toRing = (vs: Vec[]): Ring => {
  const r: Ring = vs.map((p) => [p.x, p.y] as [number, number])
  if (r.length) r.push([r[0][0], r[0][1]])
  return r
}

/** Closed polygon-clipping ring -> clockwise open vertex list, without duplicate or collinear points. */
function fromRing(ring: Ring): Vec[] {
  let pts: Vec[] = ring.slice(0, -1).map(([x, y]) => ({ x, y }))
  let changed = true
  while (changed && pts.length >= 3) {
    changed = false
    for (let i = 0; i < pts.length; i++) {
      const p = pts[(i + pts.length - 1) % pts.length], q = pts[i], r = pts[(i + 1) % pts.length]
      const cr = (q.x - p.x) * (r.y - q.y) - (q.y - p.y) * (r.x - q.x)
      if (dist(p, q) < EPS || Math.abs(cr) < EPS * Math.max(1, len(sub(r, p)))) {
        pts = pts.filter((_, k) => k !== i)
        changed = true
        break
      }
    }
  }
  return signedArea(pts) < 0 ? pts.reverse() : pts
}

/**
 * Subtract `cutter` (polygon) from the room. Returns the resulting outer rings as rooms.
 * The largest ring keeps room.id and room.name; the others get a new id and "<name> 2", "<name> 3"...
 * Holes are dropped (a room is one ring). Empty array when nothing is left.
 */
export function cutoutRoom(room: Room, cutter: Vec[]): Room[] {
  if (room.vertices.length < 3 || cutter.length < 3) return [withVertices(room, room.vertices.map(cp))]
  const result = polygonClipping.difference([toRing(room.vertices)], [toRing(cutter)])
  const rings = result.map((poly) => fromRing(poly[0])).filter((r) => r.length >= 3 && area(r) > EPS)
  if (!rings.length) return []
  rings.sort((p, q) => area(q) - area(p))
  return rings.map((vertices, i) => ({
    ...room,
    id: i === 0 ? room.id : newId(),
    name: i === 0 ? room.name : `${room.name} ${i + 1}`,
    vertices,
  }))
}

/**
 * Union of rooms. When the result is one outer ring (rooms touch or overlap, no hole), returns one
 * room that keeps the first room's id, name and fill. Otherwise (disjoint, or a hole) returns null.
 */
export function mergeRooms(rooms: Room[]): Room | null {
  if (rooms.length < 2 || rooms.some((r) => r.vertices.length < 3)) return null
  const [first, ...rest] = rooms.map((r) => [toRing(r.vertices)])
  const result = polygonClipping.union(first, ...rest)
  if (result.length !== 1 || result[0].length !== 1) return null
  const vertices = fromRing(result[0][0])
  if (vertices.length < 3) return null
  return { ...rooms[0], vertices }
}
