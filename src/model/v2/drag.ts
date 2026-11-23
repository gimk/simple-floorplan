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
// The elements follow their wall (docs/walls-plan.md phase 7): `alongCm` stays the distance from node
// a, so a moved wall takes its doors and windows with it, and a wall that a drag made shorter pulls
// them inside it. A room that gets its own copy of a shared wall takes its elements with it.

import { dist, dot, sub } from '../geometry'
import type { PlanDoc, Room, RoomFace, StoredNode, StoredWall, Vec } from '../types'
import { materializeElements } from './elements'
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
  const stops = stopsWithNodes(wall, pos)
  return stops ? stops.map((s) => s.u) : null
}

/** The nodes that lie on a wall line, with their distance from node a: the two ends, the T junctions. */
function stopsWithNodes(wall: StoredWall, pos: Map<string, Vec>): { u: number; nodeId: string }[] | null {
  const a = pos.get(wall.a)
  const b = pos.get(wall.b)
  if (!a || !b) return null
  const length = dist(a, b)
  if (length < EPS) return null
  const d = { x: (b.x - a.x) / length, y: (b.y - a.y) / length }
  const stops = [{ u: 0, nodeId: wall.a }, { u: length, nodeId: wall.b }]
  for (const [id, p] of pos) {
    if (id === wall.a || id === wall.b) continue
    const rel = sub(p, a)
    if (Math.abs(d.x * rel.y - d.y * rel.x) > ON_LINE_TOL_CM) continue
    const u = dot(rel, d)
    if (u > EPS && u < length - EPS) stops.push({ u, nodeId: id })
  }
  return stops.sort((p, q) => p.u - q.u)
}

/** A span end that sat on a node of its wall before a move: the room, the face, the end, the node. */
type SpanAnchor = { roomId: string; index: number; end: 'from' | 'to'; nodeId: string }

/** What a drag reads from the document BEFORE the move. */
type BeforeMove = {
  /** Length of each wall (cm). */
  oldLength: Map<string, number>
  /**
   * The node that each span end sat on before the move. The distance of an end is not enough: a
   * T junction can move far along its wall, and the end must still follow the NODE.
   */
  anchors: SpanAnchor[]
}

/** The node that the two ends of each face span sat on, before the move. */
function spanAnchors(doc: Pick<PlanDoc, 'rooms' | 'nodes' | 'walls'>): SpanAnchor[] {
  const pos = new Map((doc.nodes ?? []).map((n) => [n.id, { x: n.x, y: n.y }]))
  const out: SpanAnchor[] = []
  for (const w of doc.walls ?? []) {
    const stops = stopsWithNodes(w, pos)
    if (!stops) continue
    // The node at a distance, when a node is there (the closest one wins).
    const nodeAtCm = (u: number): string | null => {
      let best: { u: number; nodeId: string } | null = null
      for (const s of stops) {
        if (Math.abs(s.u - u) > SPAN_TOL_CM) continue
        if (!best || Math.abs(s.u - u) < Math.abs(best.u - u)) best = s
      }
      return best ? best.nodeId : null
    }
    for (const r of doc.rooms) {
      (r.cycle ?? []).forEach((f, index) => {
        if (f.wallId !== w.id) return
        const from = nodeAtCm(f.from)
        if (from) out.push({ roomId: r.id, index, end: 'from', nodeId: from })
        const to = nodeAtCm(f.to)
        if (to) out.push({ roomId: r.id, index, end: 'to', nodeId: to })
      })
    }
  }
  return out
}

/** What a drag reads before the move: the wall lengths and the node of each span end. */
function beforeMove(doc: Pick<PlanDoc, 'rooms' | 'nodes' | 'walls'>): BeforeMove {
  return { oldLength: wallLengths(doc), anchors: spanAnchors(doc) }
}

/**
 * The room cycles with their spans followed up: a span end that sat on a node of its wall moves
 * with that node, so a wall that a drag stretched still holds its faces over the whole wall, and a
 * T junction that a drag moved along its wall still cuts it at the new place.
 */
function followSpans(doc: Pick<PlanDoc, 'rooms' | 'nodes' | 'walls'>, before: BeforeMove): Room[] {
  const oldLength = before.oldLength
  const pos = new Map((doc.nodes ?? []).map((n) => [n.id, { x: n.x, y: n.y }]))
  const walls = new Map((doc.walls ?? []).map((w) => [w.id, w]))
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
    const was = oldLength.get(wallId)
    if (was !== undefined && Math.abs(u - was) <= SPAN_TOL_CM) return roundStored(len)
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
  // The distance from node a of a node after the move, or null when it left the line of its wall.
  const nodeCm = (wallId: string, nodeId: string): number | null => {
    const w = walls.get(wallId)
    const a = w ? pos.get(w.a) : undefined
    const b = w ? pos.get(w.b) : undefined
    if (!w || !a || !b) return null
    const len = dist(a, b)
    if (len < EPS) return null
    if (nodeId === w.a) return 0
    if (nodeId === w.b) return roundStored(len)
    const p = pos.get(nodeId)
    if (!p) return null
    const d = { x: (b.x - a.x) / len, y: (b.y - a.y) / len }
    const rel = sub(p, a)
    // A node that a drag took off the wall does not cut it any more: the distance of the end stays.
    if (Math.abs(d.x * rel.y - d.y * rel.x) > ON_LINE_TOL_CM) return null
    return roundStored(Math.min(Math.max(dot(rel, d), 0), len))
  }
  const anchorOf = new Map<string, string>()
  for (const a of before.anchors) anchorOf.set(`${a.roomId}|${a.index}|${a.end}`, a.nodeId)
  return doc.rooms.map((r) => {
    const cycle = r.cycle
    if (!cycle || !cycle.length) return r
    let changed = false
    const next: RoomFace[] = cycle.map((f, index) => {
      // The end follows the node it sat on; an end that sat on no node follows the distances.
      const follow = (end: 'from' | 'to', u: number): number => {
        const nodeId = anchorOf.get(`${r.id}|${index}|${end}`)
        const got = nodeId === undefined ? null : nodeCm(f.wallId, nodeId)
        return got === null ? snap(f.wallId, u) : got
      }
      const from = follow('from', f.from)
      const to = follow('to', f.to)
      if (from === f.from && to === f.to) return f
      changed = true
      return { ...f, from, to }
    })
    return changed ? { ...r, cycle: next } : r
  })
}

/** The document after a move: spans followed up, faces derived, rooms and elements calculated. */
function rebuild(
  doc: PlanDoc,
  rooms: Room[],
  nodes: StoredNode[],
  walls: StoredWall[],
  before: BeforeMove,
): PlanDoc {
  const followed = followSpans({ rooms, nodes, walls }, before)
  const plain: PlanDoc = { ...doc, rooms: followed, nodes, walls }
  const withFaces: PlanDoc = { ...plain, walls: deriveWallFaces(plain) }
  return materializeElements({ ...withFaces, rooms: materializeRooms(withFaces) })
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
  const before = beforeMove(doc)
  const moved = nodes.map((n) => (n.id === nodeId ? { ...n, x: to.x, y: to.y } : n))
  return rebuild(doc, doc.rooms, moved, doc.walls ?? [], before)
}

/**
 * Move one wall by `delta`: its two nodes move, so the rooms on both of its sides follow (one wall,
 * two faces) and the walls connected at its ends stretch.
 */
export function moveWall(doc: PlanDoc, wallId: string, delta: Vec): PlanDoc {
  const wall = (doc.walls ?? []).find((w) => w.id === wallId)
  if (!wall || (!delta.x && !delta.y)) return doc
  const ids = new Set([wall.a, wall.b])
  const before = beforeMove(doc)
  const moved = (doc.nodes ?? []).map((n) => (ids.has(n.id) ? { ...n, x: n.x + delta.x, y: n.y + delta.y } : n))
  return rebuild(doc, doc.rooms, moved, doc.walls ?? [], before)
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
  const before = beforeMove(doc)
  if (!opts.thisRoomOnly) {
    const ids = new Set<string>()
    for (const w of walls) {
      if (!mine.has(w.id)) continue
      ids.add(w.a)
      ids.add(w.b)
    }
    const moved = (doc.nodes ?? []).map((n) => (ids.has(n.id) ? { ...n, x: n.x + delta.x, y: n.y + delta.y } : n))
    return rebuild(doc, doc.rooms, moved, walls, before)
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
  // An element of this room that sits on a copied wall sits on the copy: it moves with the room.
  const elements = doc.elements.map((el) => {
    if (el.roomId !== roomId || !el.wallId) return el
    const copy = wallCopy.get(el.wallId)
    return copy ? { ...el, wallId: copy } : el
  })
  return rebuild({ ...doc, elements }, rooms, [...nodes, ...added], nextWalls, before)
}
