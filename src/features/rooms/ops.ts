// Pure room geometry and edit operations (no React, no store). Units: cm, y points down.
// Every function returns a new object; inputs are never changed.
import polygonClipping from 'polygon-clipping'
import type { Ring } from 'polygon-clipping'
import { add, area, dist, dot, innerRing, len, lerp, norm, signedArea, sub } from '../../model/geometry'
import type { Vec } from '../../model/geometry'
import { newId } from '../../model/schema'
import type { Room, WallKind } from '../../model/types'
import { edgeOutwardNormal } from './walls'

export const MIN_ROOM_SIDE_CM = 10
const EPS = 1e-6

export type Wall = { index: number; a: Vec; b: Vec; lengthCm: number; mid: Vec; angleDeg: number }

const cp = (v: Vec): Vec => ({ x: v.x, y: v.y })
const withVertices = (room: Room, vertices: Vec[]): Room => ({ ...room, vertices })

/**
 * Copy of `room` whose `wallKinds` map is re-keyed: `oldToNew` gives, for one old edge index, the
 * new edge indices that inherit its kind (an empty list means the edge is gone). Edges with no
 * entry under a key keep nothing. The map is dropped when it ends up empty; a room without
 * `wallKinds` is returned unchanged.
 */
function remapWallKinds(room: Room, oldToNew: (oldIndex: number) => number[]): Room {
  if (!room.wallKinds) return room
  const next: Record<string, WallKind> = {}
  for (const [key, kind] of Object.entries(room.wallKinds)) {
    const old = Number(key)
    if (!Number.isInteger(old)) continue
    for (const newIndex of oldToNew(old)) next[String(newIndex)] = kind
  }
  const out: Room = { ...room }
  if (Object.keys(next).length === 0) delete out.wallKinds
  else out.wallKinds = next
  return out
}

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

/**
 * Move vertex idx to target and keep a 90° corner square: the two neighbours slide so both
 * adjacent walls stay horizontal / vertical. A corner that is not 90° (or a room with fewer than
 * 4 vertices) only moves the vertex, axis-locked to its previous neighbour.
 */
export function moveVertexOrtho(room: Room, idx: number, target: Vec): Room {
  const n = room.vertices.length
  if (idx < 0 || idx >= n) return room
  const prevIdx = (idx + n - 1) % n, nextIdx = (idx + 1) % n
  const curr = room.vertices[idx], prev = room.vertices[prevIdx], next = room.vertices[nextIdx]
  const prevHorizontal = Math.abs(prev.y - curr.y) <= Math.abs(prev.x - curr.x)
  const nextHorizontal = Math.abs(curr.y - next.y) <= Math.abs(curr.x - next.x)
  const out = room.vertices.map(cp)
  if (n >= 4 && prevHorizontal !== nextHorizontal) {
    out[idx] = cp(target)
    if (prevHorizontal) {
      out[prevIdx] = { x: prev.x, y: target.y }
      out[nextIdx] = { x: target.x, y: next.y }
    } else {
      out[prevIdx] = { x: target.x, y: prev.y }
      out[nextIdx] = { x: next.x, y: target.y }
    }
    return withVertices(room, out)
  }
  const d = constrainAxis(target.x - prev.x, target.y - prev.y)
  out[idx] = { x: prev.x + d.x, y: prev.y + d.y }
  return withVertices(room, out)
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
  // Old edge edgeIndex becomes edges edgeIndex and edgeIndex+1 (the new vertex splits it); later
  // edges shift by 1.
  return remapWallKinds(withVertices(room, out), (k) =>
    k === edgeIndex ? [edgeIndex, edgeIndex + 1] : k > edgeIndex ? [k + 1] : [k])
}

/** Remove vertex idx. Returns null when the room would have fewer than 3 vertices. */
export function deleteVertex(room: Room, idx: number): Room | null {
  const n = room.vertices.length
  if (n <= 3 || idx < 0 || idx >= n) return null
  // Vertex idx is gone: the edge that ended on it disappears and later edges shift down by 1.
  return remapWallKinds(withVertices(room, room.vertices.filter((_, i) => i !== idx).map(cp)), (k) =>
    k === idx ? [] : k > idx ? [k - 1] : [k])
}

const MIN_WALL_DELETE_AREA_CM2 = 10

/**
 * Remove wall `edgeIndex` (vertex i to vertex i+1). The neighbour walls are extended until they
 * meet at their intersection P (A and B are replaced by P). When they are parallel, meet too far
 * away, or P gives a degenerate polygon, A and B are replaced by their midpoint instead.
 * Returns null when the room has 3 or fewer vertices or the result would have no area.
 */
export function deleteWall(room: Room, edgeIndex: number): Room | null {
  const v = room.vertices, n = v.length
  if (n <= 3 || edgeIndex < 0 || edgeIndex >= n) return null
  // Rotate so that A = r[0], B = r[1]; the rest follows in order.
  const r = v.map((_, k) => cp(v[(edgeIndex + k) % n]))
  const a = r[0], b = r[1], prev = r[n - 1], next = r[2]
  const build = (p: Vec): Room | null => {
    const vertices = [cp(p), ...r.slice(2)]
    if (!(area(vertices) > MIN_WALL_DELETE_AREA_CM2)) return null
    // Edge edgeIndex is gone: later edges shift down by 1.
    return remapWallKinds(withVertices(room, vertices), (k) =>
      k === edgeIndex ? [] : k > edgeIndex ? [k - 1] : [k])
  }
  const d1 = sub(a, prev), d2 = sub(next, b)
  const den = d1.x * d2.y - d1.y * d2.x
  if (Math.abs(den) > EPS) {
    const q = sub(b, prev)
    const t = (q.x * d2.y - q.y * d2.x) / den
    const p = { x: prev.x + d1.x * t, y: prev.y + d1.y * t }
    const mid = lerp(a, b, 0.5)
    if (dist(p, mid) <= Math.max(dist(a, b) * 4, 500)) {
      const res = build(p)
      if (res) return res
    }
  }
  return build(lerp(a, b, 0.5))
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
  // The boolean result re-numbers every edge, so per-edge wall kinds of the old polygon are stale.
  const base: Room = { ...room }
  delete base.wallKinds
  return rings.map((vertices, i) => ({
    ...base,
    id: i === 0 ? room.id : newId(),
    name: i === 0 ? room.name : `${room.name} ${i + 1}`,
    vertices,
  }))
}

/** Extra gap allowed on top of the wall thickness when looking for a shared wall, in cm. */
const SHARED_WALL_SLACK_CM = 0.5
/** Extra offset of the closing (cm): the grown rooms overlap a little, so the union has no seam. */
const CLOSING_EXTRA_CM = 0.25

/** True when an edge of `a` faces a parallel edge of `b` (gap 0..maxGap) with a positive overlap along the wall. */
function facingEdges(a: Room, b: Room, maxGap: number): boolean {
  const va = a.vertices, vb = b.vertices
  for (let i = 0; i < va.length; i++) {
    const nA = edgeOutwardNormal(a, i)
    if (!nA) continue
    const a0 = va[i], a1 = va[(i + 1) % va.length]
    const lenA = dist(a0, a1), dA = norm(sub(a1, a0))
    for (let j = 0; j < vb.length; j++) {
      const nB = edgeOutwardNormal(b, j)
      if (!nB || dot(nA, nB) >= -0.999) continue
      const b0 = vb[j], b1 = vb[(j + 1) % vb.length]
      const gap = dot(nA, sub(b0, a0))
      if (gap < -EPS || gap > maxGap) continue
      const t0 = dot(sub(b0, a0), dA), t1 = dot(sub(b1, a0), dA)
      const overlap = Math.min(lenA, Math.max(t0, t1)) - Math.max(0, Math.min(t0, t1))
      if (overlap > 1e-3) return true
    }
  }
  return false
}

/** True when all rooms form ONE group where neighbours touch, overlap or share a wall (gap <= maxGap). */
function connectedByWalls(rooms: Room[], maxGap: number): boolean {
  const linked = (a: Room, b: Room) =>
    polygonClipping.union([toRing(a.vertices)], [toRing(b.vertices)]).length === 1 || facingEdges(a, b, maxGap)
  const seen = new Set<number>([0])
  const queue = [0]
  while (queue.length) {
    const i = queue.pop()!
    for (let k = 0; k < rooms.length; k++) {
      if (!seen.has(k) && linked(rooms[i], rooms[k])) { seen.add(k); queue.push(k) }
    }
  }
  return seen.size === rooms.length
}

/** Remove float noise: coordinates near an integer or near an input vertex coordinate become exact. */
function snapNoise(pts: Vec[], inputs: Vec[]): Vec[] {
  const xs = inputs.map((p) => p.x), ys = inputs.map((p) => p.y)
  const snap = (v: number, refs: number[]) => {
    for (const r of refs) if (Math.abs(v - r) <= 1e-4) return r
    const n = Math.round(v)
    return Math.abs(v - n) <= 1e-6 ? n : v
  }
  return pts.map((p) => ({ x: snap(p.x, xs) + 0, y: snap(p.y, ys) + 0 }))
}

/**
 * Union of rooms. When the result is one outer ring (rooms touch or overlap, no hole), returns one
 * room that keeps the first room's id, name and fill. Otherwise (disjoint, or a hole) returns null.
 *
 * With wallThicknessCm > 0, rooms that share a wall (interiors a gap of 0..wallThicknessCm apart, facing
 * parallel edges that overlap) merge too: the wall strip becomes part of the room (morphological
 * closing: grow every room by half the thickness, union, shrink back). All rooms must form one
 * connected group, and the result must have no hole.
 */
/** Merged room: keeps id, name and style of `first`, but never its per-edge `wallKinds`. */
function mergedRoom(first: Room, vertices: Vec[]): Room {
  const out: Room = { ...first, vertices }
  delete out.wallKinds
  return out
}

export function mergeRooms(rooms: Room[], wallThicknessCm = 0): Room | null {
  if (rooms.length < 2 || rooms.some((r) => r.vertices.length < 3)) return null
  const [first, ...rest] = rooms.map((r) => [toRing(r.vertices)])
  const result = polygonClipping.union(first, ...rest)
  if (result.length === 1 && result[0].length === 1) {
    const vertices = fromRing(result[0][0])
    // The union re-numbers every edge, so per-edge wall kinds of the inputs are stale.
    return vertices.length >= 3 ? mergedRoom(rooms[0], vertices) : null
  }
  if (!(wallThicknessCm > 0)) return null
  if (!connectedByWalls(rooms, wallThicknessCm + SHARED_WALL_SLACK_CM)) return null

  const r = wallThicknessCm / 2 + CLOSING_EXTRA_CM
  const grown = rooms.map((room) => [toRing(innerRing(room.vertices, room.vertices.map(() => -r)))])
  const [g0, ...gRest] = grown
  const closed = polygonClipping.union(g0, ...gRest)
  if (closed.length !== 1 || closed[0].length !== 1) return null
  const grownUnion = fromRing(closed[0][0])
  if (grownUnion.length < 3) return null
  const shrunk = innerRing(grownUnion, grownUnion.map(() => r))
  const inputs = rooms.flatMap((room) => room.vertices)
  const cleaned = snapNoise(shrunk, inputs)
  if (cleaned.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return null
  const vertices = fromRing(toRing(cleaned))
  if (vertices.length < 3 || !(area(vertices) > EPS)) return null
  // The closing never removes area: a smaller result means the shrink folded over itself.
  if (area(vertices) < Math.max(...rooms.map((room) => area(room.vertices))) - 1e-6) return null
  return mergedRoom(rooms[0], vertices)
}

// ---------- precision, scaling and constraints ----------

/** Round v to the nearest multiple of precisionCm (no rounding when precisionCm <= 0). */
export function roundToPrecision(v: number, precisionCm: number): number {
  if (!(precisionCm > 0)) return v
  const r = Math.round(v / precisionCm) * precisionCm
  return Math.round(r * 1e6) / 1e6 + 0 // trim float noise; "+ 0" turns -0 into 0
}

/** Length text: 0 decimals for 1 cm precision (or coarser), 1 decimal for 0.5 and 0.1 cm. */
export function formatLengthCm(v: number, precisionCm: number): string {
  const r = roundToPrecision(v, precisionCm)
  return precisionCm > 0 && precisionCm < 1 ? r.toFixed(1) : r.toFixed(0)
}

/**
 * Scale a room uniformly while dragging one vertex. The anchor is the bbox corner opposite to the
 * dragged vertex (per axis: the side of the bbox that the vertex is not on). All vertices scale about
 * the anchor by one factor, so the dragged vertex follows cursorPt as closely as a uniform scale allows.
 * The bbox keeps at least MIN_ROOM_SIDE_CM on each side. Returns the same room for a bad index.
 */
export function scaleRoomFromVertex(room: Room, vertexIndex: number, cursorPt: Vec, precisionCm = 0): Room {
  const vs = room.vertices
  if (vertexIndex < 0 || vertexIndex >= vs.length) return room
  const xs = vs.map((p) => p.x), ys = vs.map((p) => p.y)
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys)
  const w = maxX - minX, h = maxY - minY
  const d = vs[vertexIndex]
  const anchor: Vec = {
    x: Math.abs(d.x - minX) <= Math.abs(d.x - maxX) ? maxX : minX,
    y: Math.abs(d.y - minY) <= Math.abs(d.y - maxY) ? maxY : minY,
  }
  const cursor = { x: roundToPrecision(cursorPt.x, precisionCm), y: roundToPrecision(cursorPt.y, precisionCm) }
  const vx = d.x - anchor.x, vy = d.y - anchor.y
  const denom = vx * vx + vy * vy
  if (denom < EPS) {
    // Dragged vertex sits on the anchor on both axes (degenerate bbox): no direction to scale along.
    return withVertices(room, vs.map(cp))
  }
  // Least-squares factor: projection of (cursor - anchor) on (dragged - anchor).
  let k = ((cursor.x - anchor.x) * vx + (cursor.y - anchor.y) * vy) / denom
  const kMin = Math.max(w > EPS ? MIN_ROOM_SIDE_CM / w : 0, h > EPS ? MIN_ROOM_SIDE_CM / h : 0)
  if (!Number.isFinite(k)) k = 1
  k = Math.max(k, kMin)
  return withVertices(room, vs.map((p) => ({ x: anchor.x + (p.x - anchor.x) * k, y: anchor.y + (p.y - anchor.y) * k })))
}

/** Lock a drag delta to the dominant axis (Shift): the smaller component becomes 0. A tie keeps x. */
export function constrainAxis(dx: number, dy: number): Vec {
  return Math.abs(dx) >= Math.abs(dy) ? { x: dx, y: 0 } : { x: 0, y: dy }
}

/**
 * Keep only the part of delta (dx, dy) that is perpendicular to wall a->b (a wall drag).
 * A zero-length wall returns the delta unchanged.
 */
export function constrainWallPerpendicular(a: Vec, b: Vec, dx: number, dy: number): Vec {
  const L = dist(a, b)
  if (L < EPS) return { x: dx, y: dy }
  const nx = -(b.y - a.y) / L, ny = (b.x - a.x) / L
  const p = dx * nx + dy * ny
  return { x: nx * p + 0, y: ny * p + 0 }
}

/** Snap pt to the nearest 45° direction around anchor, keeping the distance. */
export function constrainAngle45(anchor: Vec, pt: Vec): Vec {
  const dx = pt.x - anchor.x, dy = pt.y - anchor.y
  const r = Math.hypot(dx, dy)
  if (r < EPS) return { x: pt.x, y: pt.y }
  const step = Math.PI / 4
  const ang = Math.round(Math.atan2(dy, dx) / step) * step
  const clean = (v: number) => (Math.abs(v) < 1e-9 ? 0 : v)
  return { x: anchor.x + clean(r * Math.cos(ang)), y: anchor.y + clean(r * Math.sin(ang)) }
}

export type WallResizeCursor = 'ns-resize' | 'ew-resize' | 'nesw-resize' | 'nwse-resize'

/**
 * CSS resize cursor for dragging wall a->b (it moves along the wall normal).
 * Horizontal wall -> ns-resize, vertical wall -> ew-resize; diagonals pick the nearest diagonal cursor.
 * Screen y points down: a wall going down-right (angle 45°) has a normal going down-left -> nesw-resize.
 */
export function wallResizeCursor(a: Vec, b: Vec): WallResizeCursor {
  const dx = b.x - a.x, dy = b.y - a.y
  let deg = (Math.atan2(dy, dx) * 180) / Math.PI // wall direction
  deg = ((deg % 180) + 180) % 180 // 0..180
  if (deg < 22.5 || deg >= 157.5) return 'ns-resize'
  if (deg < 67.5) return 'nesw-resize'
  if (deg < 112.5) return 'ew-resize'
  return 'nwse-resize'
}
