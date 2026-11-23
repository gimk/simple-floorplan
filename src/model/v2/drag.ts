// Drags on the wall graph of a v2 document (docs/walls-plan.md, phase 5c step 3). Pure, cm, y down.
//
// A drag moves NODES, never polygons:
//   - `moveNode` moves one junction: every wall that ends there follows, so the two rooms of a
//     shared wall keep sharing it;
//   - `moveWall` moves the two nodes of one wall: the walls connected at those nodes stretch;
//   - `moveRoom` moves every node of the walls of one room (the neighbours stretch, because a wall
//     between two rooms is one wall). With `thisRoomOnly`, the walls that another room also uses
//     stay where they are and the room gets its own COPIES of them, so the neighbour does not move:
//     the same behaviour as Shift + drag today.
// Each function gives the document back with the room cycles that follow the moved nodes, the faces
// of the walls derived again, and the survey view of every room calculated again.

import { dist, dot, sub } from '../geometry'
import type { PlanDoc, Room, RoomFace, StoredNode, StoredWall, Vec } from '../types'
import { deriveWallFaces, materializeRooms, roundStored } from './materialize'

/** A span end this close to a node of its wall follows that node (cm). */
const SPAN_TOL_CM = 1
/** A node this close to the line of a wall lies on it (a T junction), cm. */
const ON_LINE_TOL_CM = 1
/** A length or a distance below this is zero. */
const EPS = 1e-6

export type MoveRoomOptions = {
  /** Move this room only: the walls shared with another room are copied, the neighbour stays. */
  thisRoomOnly?: boolean
}

/** Length of each wall (cm), before a move: a span end that sat on a wall end followed it. */
function wallLengths(doc: Pick<PlanDoc, 'nodes' | 'walls'>): Map<string, number> {
  const pos = new Map((doc.nodes ?? []).map((n) => [n.id, { x: n.x, y: n.y }]))
  const out = new Map<string, number>()
  for (const w of doc.walls ?? []) {
    const a = pos.get(w.a)
    const b = pos.get(w.b)
    if (a && b) out.set(w.id, dist(a, b))
  }
  return out
}

/** The distances from node a of the nodes that lie on the wall (its two ends and its T junctions). */
function stopsOf(wall: StoredWall, pos: Map<string, Vec>): number[] | null {
  const a = pos.get(wall.a)
  const b = pos.get(wall.b)
  if (!a || !b) return null
  const length = dist(a, b)
  if (length < EPS) return null
  const d = { x: (b.x - a.x) / length, y: (b.y - a.y) / length }
  const stops = [0, length]
  for (const [id, p] of pos) {
    if (id === wall.a || id === wall.b) continue
    const rel = sub(p, a)
    if (Math.abs(d.x * rel.y - d.y * rel.x) > ON_LINE_TOL_CM) continue
    const u = dot(rel, d)
    if (u > EPS && u < length - EPS) stops.push(u)
  }
  return stops.sort((p, q) => p - q)
}

/**
 * The room cycles with their spans followed up: a span end that sat on a node of its wall moves
 * with that node, so a wall that a drag stretched still holds its faces over the whole wall.
 */
function followSpans(doc: Pick<PlanDoc, 'rooms' | 'nodes' | 'walls'>, oldLength: Map<string, number>): Room[] {
  const pos = new Map((doc.nodes ?? []).map((n) => [n.id, { x: n.x, y: n.y }]))
  const stops = new Map<string, number[]>()
  const length = new Map<string, number>()
  for (const w of doc.walls ?? []) {
    const s = stopsOf(w, pos)
    if (!s) continue
    stops.set(w.id, s)
    length.set(w.id, s[s.length - 1])
  }
  const snap = (wallId: string, u: number): number => {
    const s = stops.get(wallId)
    const len = length.get(wallId)
    if (!s || len === undefined) return u
    if (u <= SPAN_TOL_CM) return 0
    const before = oldLength.get(wallId)
    if (before !== undefined && Math.abs(u - before) <= SPAN_TOL_CM) return roundStored(len)
    let best = u
    let bestD = SPAN_TOL_CM
    for (const stop of s) {
      const d = Math.abs(stop - u)
      if (d < bestD) {
        bestD = d
        best = stop
      }
    }
    return roundStored(Math.min(Math.max(best, 0), len))
  }
  return doc.rooms.map((r) => {
    const cycle = r.cycle
    if (!cycle || !cycle.length) return r
    let changed = false
    const next: RoomFace[] = cycle.map((f) => {
      const from = snap(f.wallId, f.from)
      const to = snap(f.wallId, f.to)
      if (from === f.from && to === f.to) return f
      changed = true
      return { ...f, from, to }
    })
    return changed ? { ...r, cycle: next } : r
  })
}

/** The document after a move: spans followed up, faces derived, rooms calculated. */
function rebuild(
  doc: PlanDoc,
  rooms: Room[],
  nodes: StoredNode[],
  walls: StoredWall[],
  oldLength: Map<string, number>,
): PlanDoc {
  const followed = followSpans({ rooms, nodes, walls }, oldLength)
  const plain: PlanDoc = { ...doc, rooms: followed, nodes, walls }
  const withFaces: PlanDoc = { ...plain, walls: deriveWallFaces(plain) }
  return { ...withFaces, rooms: materializeRooms(withFaces) }
}

/** A copy of a wall with the same properties, under another id and on other nodes. */
function copyWall(wall: StoredWall, id: string, a: string, b: string): StoredWall {
  const out: StoredWall = { id, a, b, faces: [], type: wall.type, thicknessCm: wall.thicknessCm }
  if (wall.status !== undefined) out.status = wall.status
  if (wall.align !== undefined) out.align = wall.align
  if (wall.locked !== undefined) out.locked = wall.locked
  return out
}

/** Gives ids that no item of the document has (new nodes and new walls of a room copy). */
function idMaker(doc: Pick<PlanDoc, 'nodes' | 'walls' | 'rooms'>): (prefix: string) => string {
  const used = new Set<string>()
  for (const n of doc.nodes ?? []) used.add(n.id)
  for (const w of doc.walls ?? []) used.add(w.id)
  for (const r of doc.rooms) {
    for (const v of r.vertices) used.add(v.id)
    for (const f of r.cycle ?? []) used.add(f.cornerId)
  }
  let k = 0
  return (prefix: string) => {
    let id = ''
    do {
      k++
      id = `${prefix}${k}`
    } while (used.has(id))
    used.add(id)
    return id
  }
}

/**
 * Move one node (a corner of the plan) to `to`. The walls that end there follow, so every room that
 * shares one of them moves with it. Gives the same document back when the position did not change.
 */
export function moveNode(doc: PlanDoc, nodeId: string, to: Vec): PlanDoc {
  const nodes = doc.nodes ?? []
  const node = nodes.find((n) => n.id === nodeId)
  if (!node || (node.x === to.x && node.y === to.y)) return doc
  const old = wallLengths(doc)
  const moved = nodes.map((n) => (n.id === nodeId ? { ...n, x: to.x, y: to.y } : n))
  return rebuild(doc, doc.rooms, moved, doc.walls ?? [], old)
}

/**
 * Move one wall by `delta`: its two nodes move, so the rooms on both of its sides follow (one wall,
 * two faces) and the walls connected at its ends stretch.
 */
export function moveWall(doc: PlanDoc, wallId: string, delta: Vec): PlanDoc {
  const wall = (doc.walls ?? []).find((w) => w.id === wallId)
  if (!wall || (!delta.x && !delta.y)) return doc
  const ids = new Set([wall.a, wall.b])
  const old = wallLengths(doc)
  const moved = (doc.nodes ?? []).map((n) => (ids.has(n.id) ? { ...n, x: n.x + delta.x, y: n.y + delta.y } : n))
  return rebuild(doc, doc.rooms, moved, doc.walls ?? [], old)
}

/**
 * Move a whole room by `delta`. Every node of the walls of the room moves, so the rooms that share a
 * wall with it stretch. With `thisRoomOnly`, a wall that another room also uses stays where it is,
 * and the room gets its own copy of it: the neighbour does not move (the Shift + drag of today).
 */
export function moveRoom(doc: PlanDoc, roomId: string, delta: Vec, opts: MoveRoomOptions = {}): PlanDoc {
  const room = doc.rooms.find((r) => r.id === roomId)
  if (!room || !room.cycle?.length || (!delta.x && !delta.y)) return doc
  const walls = doc.walls ?? []
  const mine = new Set(room.cycle.map((f) => f.wallId))
  const old = wallLengths(doc)
  if (!opts.thisRoomOnly) {
    const ids = new Set<string>()
    for (const w of walls) {
      if (!mine.has(w.id)) continue
      ids.add(w.a)
      ids.add(w.b)
    }
    const moved = (doc.nodes ?? []).map((n) => (ids.has(n.id) ? { ...n, x: n.x + delta.x, y: n.y + delta.y } : n))
    return rebuild(doc, doc.rooms, moved, walls, old)
  }

  // ---- this room only ----
  // A wall that another room also has a face on stays, so the room needs its own copy of it.
  const others = doc.rooms.filter((r) => r.id !== roomId)
  const shared = new Set<string>()
  for (const id of mine) {
    if (others.some((r) => (r.cycle ?? []).some((f) => f.wallId === id))) shared.add(id)
  }
  const nodeIds = new Set<string>()
  for (const w of walls) {
    if (!mine.has(w.id)) continue
    nodeIds.add(w.a)
    nodeIds.add(w.b)
  }
  // A node stays (and the room gets a copy of it) when a wall that stays also uses it.
  const stays = (id: string) => walls.some((w) => (w.a === id || w.b === id) && (!mine.has(w.id) || shared.has(w.id)))
  const newId = idMaker(doc)
  const copies = new Map<string, string>()
  const added: StoredNode[] = []
  const nodes = (doc.nodes ?? []).map((n) => {
    if (!nodeIds.has(n.id)) return n
    if (!stays(n.id)) return { ...n, x: n.x + delta.x, y: n.y + delta.y }
    const id = newId('N')
    copies.set(n.id, id)
    added.push({ id, x: n.x + delta.x, y: n.y + delta.y })
    return n
  })
  // The walls: a shared one is copied, an own one keeps its id and takes the moved (or copied) nodes.
  const wallCopy = new Map<string, string>()
  const nextWalls: StoredWall[] = []
  for (const w of walls) {
    if (!mine.has(w.id)) {
      nextWalls.push(w)
      continue
    }
    const a = copies.get(w.a) ?? w.a
    const b = copies.get(w.b) ?? w.b
    if (!shared.has(w.id)) {
      nextWalls.push({ ...w, a, b })
      continue
    }
    // A shared wall stays where it is (the neighbour keeps it), and the room gets a copy of it.
    nextWalls.push(w)
    const id = newId('W')
    wallCopy.set(w.id, id)
    nextWalls.push(copyWall(w, id, a, b))
  }
  const cycle = room.cycle.map((f) => {
    const id = wallCopy.get(f.wallId)
    return id ? { ...f, wallId: id } : f
  })
  const rooms = doc.rooms.map((r) => (r.id === roomId ? { ...r, cycle } : r))
  return rebuild(doc, rooms, [...nodes, ...added], nextWalls, old)
}
