// Read layer of the v2 model (docs/walls-plan.md, phase 5c step 1). Pure, cm, y points down.
//
// In a v2 document the walls are the source: `doc.nodes`, `doc.walls` (with their properties) and
// `room.cycle` (one face per room wall). This file calculates the survey view from them, so every
// read-only feature (measuring, solver, exports, surfaces) keeps working unchanged:
//   - `materializeRooms(doc)`: the polygon of each room. Corner k is the crossing of the centre
//     lines of the walls of face k-1 and face k (the node they share when the two walls are in
//     line). The corner keeps the id of `face.cornerId`, and `room.walls[cornerId]` gets the
//     properties of the wall of face k, so labels, elements, pins and wall props stay valid.
//   - `deriveWallFaces(doc)`: the faces of each stored wall, rebuilt from the cycles, plus the
//     outside faces (a span that no room covers). Both sides are cut independently, so a wall can
//     have one face of room A on side L and three faces on side R (the Entree / Couloir case).
// A face says which SIDE of its wall the room lies on, not which way the room walks along it: the
// walk direction also depends on the winding of the room polygon (a v1 room can be counter-clockwise),
// so every reader takes it from `faceForward` / `roomFaceForward`.
//
// The two functions are deterministic: the same document gives the same result. `deriveWallFaces`
// gives back the previous array and the previous wall objects when nothing changed, so the store
// does not churn.

import { DEFAULT_WALL_CM, add, cross, dist, mul, signedArea, sub } from '../geometry'
import type { PlanDoc, Room, RoomFace, StoredFace, StoredWall, Vec, WallProps, Vertex } from '../types'

/** A straight line: point `p` plus unit direction `d`. */
type Line = { p: Vec; d: Vec }

/** |sin| of the angle between two walls under this: the two lines are in line (or parallel). */
const PARALLEL_SIN = 1e-6
/** A distance along a wall closer than this is the same distance (cm). */
const EPS = 1e-6
/** Two faces that touch within this leave no gap: outside faces are not cut there (cm). */
const GAP_TOL_CM = 1
/** Gap between the drawn line of a copy and the line of its wall that is no difference (cm). */
export const LINE_TOL_CM = 0.1

/** Round a length of the report (0.1 cm: a report shows "1,5 cm apart"). */
export const roundReport = (v: number) => Math.round(v * 10) / 10

/** Round a stored length like the wall graph does (0.001 cm = 10 µm: no float noise in the JSON). */
export const roundStored = (v: number) => Math.round(v * 1000) / 1000

/** Wall properties of a stored wall, with the same defaults as a room wall. */
export function storedWallProps(w: StoredWall): WallProps {
  // A v2 document always has these, but a reader must not break on a document that lost them.
  const out: WallProps = { type: w.type ?? 'partition', thicknessCm: w.thicknessCm ?? DEFAULT_WALL_CM }
  if (w.locked !== undefined) out.locked = w.locked
  if (w.status !== undefined) out.status = w.status
  if (w.align !== undefined) out.align = w.align
  return out
}

/** The travel direction of a face when nothing better is known: side L means a -> b. */
const usualForward = (f: Pick<RoomFace, 'side'>): 1 | -1 => (f.side === 'L' ? 1 : -1)

/**
 * Distance along a face where the face STARTS in room order.
 * `forward` is the travel direction of the room on that wall (+1 = a -> b, -1 = b -> a); the default
 * takes the usual winding (side L runs a -> b). See `faceForward`.
 */
export const faceStartCm = (f: Pick<RoomFace, 'side' | 'from' | 'to'>, forward: 1 | -1 = usualForward(f)) =>
  (forward > 0 ? f.from : f.to)

/** Distance along a face where the face ENDS in room order. Same `forward` as `faceStartCm`. */
export const faceEndCm = (f: Pick<RoomFace, 'side' | 'from' | 'to'>, forward: 1 | -1 = usualForward(f)) =>
  (forward > 0 ? f.to : f.from)

/**
 * The travel direction of a face in room order: +1 when the room runs a -> b on that wall, -1 when
 * it runs b -> a. `winding` is the sign of the signed area of the room polygon.
 * The SIDE alone does not say the travel direction: it says where the room lies (left or right of
 * node a -> node b), and that is what the faces of the two rooms on a shared wall tell apart. Which
 * way the room walks along its wall depends on the winding of its polygon: the usual winding
 * (signed area > 0, every room that the tools draw) walks a -> b on side L, and a room wound the
 * other way (counter-clockwise; a v1 room can be, and a polygon typed by a user can be) walks
 * b -> a on side L. Every reader that needs room order takes it from here, so a CCW room keeps its
 * vertex order, its corner ids and its labels.
 */
export const faceForward = (f: Pick<RoomFace, 'side'>, winding: number): 1 | -1 =>
  ((winding >= 0 ? 1 : -1) * usualForward(f)) as 1 | -1

/** The travel direction of one face of a room, from the winding of the room polygon. */
export const roomFaceForward = (room: Pick<Room, 'vertices'>, f: Pick<RoomFace, 'side'>): 1 | -1 =>
  faceForward(f, signedArea(room.vertices))

/** Centre line of a stored wall, or null when one of its two nodes is missing or they touch. */
function wallLine(wall: StoredWall, nodes: Map<string, Vec>): Line | null {
  const a = nodes.get(wall.a)
  const b = nodes.get(wall.b)
  if (!a || !b) return null
  const length = dist(a, b)
  if (length < EPS) return null
  return { p: a, d: { x: (b.x - a.x) / length, y: (b.y - a.y) / length } }
}

/** The point of a line at distance `cm` along it. */
const pointAt = (line: Line, cm: number): Vec => add(line.p, mul(line.d, cm))

/**
 * The corner at the start of face `cur`, that is the corner between the wall of face `prev` and
 * the wall of face `cur`. `hint` is the corner calculated before it: it only breaks a tie when the
 * two walls are parallel and share no node (a spike), where the geometry gives two answers.
 */
function cornerBetween(prev: RoomFace, cur: RoomFace, walls: Map<string, StoredWall>, nodes: Map<string, Vec>, hint?: Vec): Vec | null {
  const wPrev = walls.get(prev.wallId)
  const wCur = walls.get(cur.wallId)
  if (!wCur) return null
  const lCur = wallLine(wCur, nodes)
  if (!lCur) return null

  if (prev.wallId === cur.wallId) {
    // Two faces of one room on one wall (in-line merge): the corner lies on that wall, where the
    // two spans meet. The end that the two spans share says where, whatever the travel direction
    // of the room is (two faces of one room meet at a point that is an end of both).
    const shared = sharedSpanCm(prev, cur)
    if (shared !== null) return pointAt(lCur, shared)
    // Spans that share no end (a spike on one wall): the middle of the two ends that face each
    // other on the way the room travels.
    const cm = prev.side === 'L' ? (prev.to + cur.from) / 2 : (prev.from + cur.to) / 2
    return pointAt(lCur, cm)
  }

  const lPrev = wPrev ? wallLine(wPrev, nodes) : null
  const den = lPrev ? cross(lPrev.d, lCur.d) : 0
  if (lPrev && Math.abs(den) > PARALLEL_SIN) {
    // Normal corner: the crossing of the two centre lines.
    const t = cross(sub(lCur.p, lPrev.p), lCur.d) / den
    return add(lPrev.p, mul(lPrev.d, t))
  }
  if (wPrev) {
    // In line (or parallel): the two walls meet at a node. A straight corner is one wall (handled
    // above), so this is a wall that was cut on the other side of the room (a T junction).
    const shared = sharedNode(wPrev, wCur, nodes)
    if (shared) return shared
  }
  // Spike (parallel walls that share no node): the end of face cur on its wall, nearest to hint.
  const start = pointAt(lCur, faceStartCm(cur))
  const end = pointAt(lCur, faceEndCm(cur))
  if (hint) return dist(start, hint) <= dist(end, hint) ? start : end
  return start
}

/**
 * The point where two faces of one room on one wall meet: the end of their two spans that they
 * share (within GAP_TOL_CM). Null when the spans share no end.
 */
function sharedSpanCm(prev: RoomFace, cur: RoomFace): number | null {
  let best: number | null = null
  let bestD = Infinity
  for (const a of [prev.from, prev.to]) {
    for (const b of [cur.from, cur.to]) {
      const d = Math.abs(a - b)
      if (d < bestD) {
        bestD = d
        best = (a + b) / 2
      }
    }
  }
  return bestD <= GAP_TOL_CM ? best : null
}

/** Position of the node that both walls have, if any. */
function sharedNode(a: StoredWall, b: StoredWall, nodes: Map<string, Vec>): Vec | null {
  const ids = new Set([a.a, a.b])
  const node = [b.a, b.b].find((id) => ids.has(id))
  const p = node === undefined ? undefined : nodes.get(node)
  return p ? { x: p.x, y: p.y } : null
}

/**
 * The rooms of the document with their polygon calculated from the walls and the cycles. A room
 * without a cycle (a v1 room, a room whose walls are not converted) is given back unchanged.
 */
export function materializeRooms(doc: Pick<PlanDoc, 'rooms' | 'nodes' | 'walls'>): Room[] {
  const nodeMap = new Map((doc.nodes ?? []).map((n) => [n.id, { x: n.x, y: n.y }]))
  const wallMap = new Map((doc.walls ?? []).map((w) => [w.id, w]))
  return doc.rooms.map((r) => materializeRoom(r, wallMap, nodeMap))
}

/** One room with its polygon calculated, or the same room when it has no cycle. */
function materializeRoom(r: Room, walls: Map<string, StoredWall>, nodes: Map<string, Vec>): Room {
  const cycle = r.cycle
  if (!cycle || !cycle.length) return r
  const vertices: Vertex[] = []
  const props: Record<string, WallProps> = {}
  let hint: Vec | undefined
  for (let k = 0; k < cycle.length; k++) {
    const prev = cycle[(k + cycle.length - 1) % cycle.length]
    const cur = cycle[k]
    // A cycle face whose wall is missing from `doc.walls` (a broken document) keeps the corner
    // before it, so the room stays a closed polygon.
    const p = cornerBetween(prev, cur, walls, nodes, hint) ?? hint ?? { x: 0, y: 0 }
    hint = p
    vertices.push({ id: cur.cornerId, x: p.x, y: p.y })
    const wall = walls.get(cur.wallId)
    props[cur.cornerId] = wall ? storedWallProps(wall) : { type: 'partition', thicknessCm: DEFAULT_WALL_CM }
  }
  return { ...r, vertices, walls: props }
}

/**
 * The faces of the stored walls, rebuilt from the room cycles plus the outside spans (a side span
 * that no room covers: a facade). Same shape as the stored faces of phase 5a: side, roomId,
 * wallStart (= the corner id of the face), from, to.
 * Gives back `doc.walls` itself when nothing changed.
 */
export function deriveWallFaces(doc: Pick<PlanDoc, 'rooms' | 'nodes' | 'walls'>): StoredWall[] {
  const walls = doc.walls ?? []
  const nodes = new Map((doc.nodes ?? []).map((n) => [n.id, { x: n.x, y: n.y }]))
  // Faces of each side of each wall, from the room cycles.
  const roomFaces = new Map<string, StoredFace[]>()
  for (const r of doc.rooms) {
    for (const f of r.cycle ?? []) {
      const face: StoredFace = {
        side: f.side,
        roomId: r.id,
        wallStart: f.cornerId,
        from: roundStored(Math.min(f.from, f.to)),
        to: roundStored(Math.max(f.from, f.to)),
      }
      const known = roomFaces.get(f.wallId)
      if (known) known.push(face)
      else roomFaces.set(f.wallId, [face])
    }
  }
  let changed = false
  const out = walls.map((w) => {
    const faces = facesOfWall(w, roomFaces.get(w.id) ?? [], nodes)
    if (sameFaces(w.faces, faces)) return w
    changed = true
    return { ...w, faces }
  })
  return changed ? out : walls
}

/** Faces of one wall: the room faces of each side, plus the outside spans. Sorted by side, then from. */
function facesOfWall(wall: StoredWall, faces: StoredFace[], nodes: Map<string, Vec>): StoredFace[] {
  const line = wallLine(wall, nodes)
  if (!line) {
    // No geometry: keep the spans as they are (they cannot be cut).
    return [...faces].sort(cmpFaces)
  }
  const length = dist(nodes.get(wall.a)!, nodes.get(wall.b)!)
  const out: StoredFace[] = []
  for (const side of ['L', 'R'] as const) {
    const mine = faces
      .filter((f) => f.side === side)
      .map((f) => ({ ...f, from: Math.max(0, Math.min(f.from, f.to)), to: Math.min(length, Math.max(f.from, f.to)) }))
      .filter((f) => f.to - f.from > EPS)
      .sort((a, b) => a.from - b.from || b.to - a.to || cmpRoom(a) - cmpRoom(b))
    let cursor = 0
    for (const f of mine) {
      if (f.from > cursor + GAP_TOL_CM) out.push({ side, from: roundStored(cursor), to: roundStored(f.from) })
      out.push(f)
      cursor = Math.max(cursor, f.to)
    }
    if (cursor < length - GAP_TOL_CM) out.push({ side, from: roundStored(cursor), to: roundStored(length) })
  }
  return out.length ? out : [...faces].sort(cmpFaces)
}

const cmpRoom = (f: StoredFace) => (f.roomId === undefined ? 1 : 0)

const cmpFaces = (a: StoredFace, b: StoredFace) =>
  (a.side === b.side ? 0 : a.side === 'L' ? -1 : 1) || a.from - b.from || a.to - b.to

const sameFace = (a: StoredFace, b: StoredFace) =>
  a.side === b.side && a.roomId === b.roomId && a.wallStart === b.wallStart && Math.abs(a.from - b.from) < EPS && Math.abs(a.to - b.to) < EPS

const sameFaces = (a: StoredFace[], b: StoredFace[]) =>
  a.length === b.length && a.every((f, i) => sameFace(f, b[i]))
