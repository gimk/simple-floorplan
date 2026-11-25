// Write layer of the v2 model (docs/walls-plan.md, phase 5c step 3). Pure, cm, y points down.
//
// In a v2 document the walls are the source. The tools and the server commands keep their logic:
// they build the polygon of a room. `applyRoomPolygon` writes that polygon into the WALL graph, so
// a wall between two rooms is one wall with two faces:
//   - an edge that lies on an existing wall (both ends within 1 cm of its centre line, any
//     direction) REUSES that wall: the room gets a face of it over the span of the edge;
//   - an edge that lies on an existing wall only partly reuses it for that part and makes a new
//     wall for the rest. A wall is NEVER split to give the new room a face: a face belongs to one
//     wall, so a wall that must hold faces of two rooms keeps its props and its values, and the two
//     sides are cut independently (the Entree / Couloir rule). A new node is made only where the
//     new room has a corner;
//   - an edge that lies on no wall makes a new wall, with the properties of `room.walls[cornerId]`
//     (default: a partition).
// The properties that the room gives for a corner are written on the wall of the face that starts
// there. On a shared wall both rooms see the change: that is the v2 design (one wall).
// Then the walls that no room uses any more go away, the nodes that no wall uses too, and the
// survey view of every room is calculated again (materializeRooms).
//
// A document that is not in the v2 state (no room has a cycle) is written the v1 way: the polygon
// goes into the room and the stored graph is left alone (the doc rule builds it again).
//
// `removeRoom` is the same write path for a room that goes away: its faces go, and its walls STAY
// (docs/walls-plan.md, "Walls in the interface"): a wall that another room still uses keeps its
// faces, a wall that no room uses any more becomes a STANDALONE wall (`standalone: true`).
//
// One exception, and it is the MERGE: when one edit makes two rooms ONE space, the wall between
// them is not a wall of the plan any more. `settleWallsWithoutFaces` runs after the rooms of an
// edit and removes a wall that was used before the edit, has no face now, and whose middle a room
// of the result COVERS (docs/walls-plan.md, "Walls in the interface"). A room that the user deletes
// covers nothing, so its walls stay as standalone walls.
//
// A STANDALONE wall is a wall that stays when no room uses it: a wall drawn with the Wall tool, a
// wall left by a deleted room, or a trace converted on load. It is never removed by the rules
// below; only the user removes it (`removeWall`, which refuses while a room face uses it). A wall
// WITHOUT the flag still goes away when a room shape edit leaves it without faces.

import { DEFAULT_WALL_CM, cross, dist, dot, pointInPolygon, projectOnSegment, signedArea, sub } from '../geometry'
import type { PlanDoc, Room, RoomFace, StoredNode, StoredWall, Vec, Vertex, WallProps } from '../types'
import { syncElements } from './elements'
import { deriveWallFaces, materializeRooms, roundStored, storedWallProps } from './materialize'
import { layWall, type GraphParts } from './spans'

/** An edge lies on a wall when both of its ends are this close to the centre line (cm). */
export const ON_WALL_TOL_CM = 1
/** Two directions with a sine below this are one line (a wall at an angle too). */
const PARALLEL_SIN = 0.02
/** A length or a distance below this is zero. */
const EPS = 1e-6
/** Properties of a wall that the room gives no properties for. */
const DEFAULT_PROPS: WallProps = { type: 'partition', thicknessCm: DEFAULT_WALL_CM }
/** One tolerance of the graph (cm): an end of a new wall, or a point of a polygon, this close to a node takes it. */
export const NEW_WALL_SNAP_CM = 1
/** A segment of a new wall shorter than this is no wall (cm). */
export const MIN_WALL_CM = 1
/** The middle of a wall this close to the polygon of a room is ON the polygon, not inside (cm). */
export const MID_INSIDE_CM = 1

export type WriteOptions = {
  /** Gives a new, unused id for a prefix ('v' corner, 'N' node, 'W' wall). Default: a counter. */
  newId?: (prefix: string) => string
  /**
   * `addStandaloneWall`: cut a wall where an end of the new wall lands inside it (default true). The
   * load step of the traces gives false: no wall that a room uses is cut while a document loads.
   */
  splitHosts?: boolean
}

/** A wall while it is edited: its two nodes, its properties and its standalone flag. */
type WallDraft = { id: string; a: string; b: string; props: WallProps; standalone?: boolean }

/** The centre line of a wall: the two node positions, the unit direction a -> b and the length. */
type Line = { a: Vec; b: Vec; d: Vec; length: number }

/** One part of one polygon edge: a span on an existing wall, or a new wall to create. */
type Piece = { kind: 'wall'; wallId: string; p: Vec; q: Vec } | { kind: 'new'; p: Vec; q: Vec }

/** True when the document holds the v2 graph (some room has a cycle of faces). */
const isV2 = (doc: Pick<PlanDoc, 'rooms' | 'schemaVersion'>) =>
  doc.schemaVersion === 2 || doc.rooms.some((r) => (r.cycle?.length ?? 0) > 0)

/** True when every room has a cycle, so a wall that no cycle uses is really unused. */
const allRoomsHaveCycle = (doc: Pick<PlanDoc, 'rooms'>) => doc.rooms.every((r) => !r.vertices.length || (r.cycle?.length ?? 0) > 0)

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi)

/** The stored wall of a draft wall: no faces yet (they are derived from the cycles). */
function storedWall(w: WallDraft): StoredWall {
  const out: StoredWall = { id: w.id, a: w.a, b: w.b, faces: [], type: w.props.type, thicknessCm: w.props.thicknessCm }
  if (w.props.status !== undefined) out.status = w.props.status
  if (w.props.align !== undefined) out.align = w.props.align
  if (w.props.locked !== undefined) out.locked = w.props.locked
  if (w.standalone) out.standalone = true
  return out
}

/** Same content, whatever the key order (undefined and a missing key are the same). */
function sameDeep(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => sameDeep(x, b[i]))
  const ka = Object.keys(a as object).filter((k) => (a as Record<string, unknown>)[k] !== undefined)
  const kb = Object.keys(b as object).filter((k) => (b as Record<string, unknown>)[k] !== undefined)
  return ka.length === kb.length && ka.every((k) => sameDeep((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
}

/** The wall graph of a document while it is edited, plus the ids of the items it makes. */
class Draft {
  nodes: StoredNode[]
  walls: WallDraft[]
  private used = new Set<string>()
  private counters = new Map<string, number>()
  private opts: WriteOptions

  constructor(doc: Pick<PlanDoc, 'nodes' | 'walls' | 'rooms'>, opts: WriteOptions = {}) {
    this.opts = opts
    this.nodes = (doc.nodes ?? []).map((n) => ({ id: n.id, x: n.x, y: n.y }))
    this.walls = (doc.walls ?? []).map((w) => {
      const draft: WallDraft = { id: w.id, a: w.a, b: w.b, props: storedWallProps(w) }
      if (w.standalone) draft.standalone = true
      return draft
    })
    for (const n of this.nodes) this.used.add(n.id)
    for (const w of this.walls) this.used.add(w.id)
    for (const r of doc.rooms) {
      for (const v of r.vertices) this.used.add(v.id)
      for (const f of r.cycle ?? []) this.used.add(f.cornerId)
    }
  }

  /** A new id for a prefix that no item of the document has. */
  newId(prefix: string): string {
    let k = this.counters.get(prefix) ?? 0
    let id = ''
    do {
      k++
      id = this.opts.newId ? this.opts.newId(prefix) : `${prefix}${k}`
    } while (this.used.has(id))
    this.counters.set(prefix, k)
    this.used.add(id)
    return id
  }

  pos(id: string): Vec | undefined {
    const n = this.nodes.find((x) => x.id === id)
    return n ? { x: n.x, y: n.y } : undefined
  }

  /** The centre line of a wall, or null when a node is missing or the two nodes touch. */
  line(id: string): Line | null {
    const w = this.walls.find((x) => x.id === id)
    if (!w) return null
    const a = this.pos(w.a)
    const b = this.pos(w.b)
    if (!a || !b) return null
    const length = dist(a, b)
    if (length < EPS) return null
    return { a, b, d: { x: (b.x - a.x) / length, y: (b.y - a.y) / length }, length }
  }

  /** The id of the node at `p`: an existing node there, or a new node. */
  nodeAt(p: Vec): string {
    for (const n of this.nodes) if (dist(n, p) <= NEW_WALL_SNAP_CM) return n.id
    const id = this.newId('N')
    this.nodes.push({ id, x: roundStored(p.x), y: roundStored(p.y) })
    return id
  }

  /**
   * The id of the node for one END of a new wall (the Wall tool, a trace converted on load):
   *   - an existing node within 1 cm takes the point (two walls then share the node);
   *   - a point on the MIDDLE of an existing wall becomes a new node ON that wall: the host wall is
   *     not split (the faces of the two sides are cut independently, so a T junction needs no
   *     split);
   *   - elsewhere a new node at the point.
   */
  nodeForEnd(p: Vec): string {
    for (const n of this.nodes) if (dist(n, p) <= NEW_WALL_SNAP_CM) return n.id
    let best: { p: Vec; d: number } | null = null
    for (const w of this.walls) {
      const line = this.line(w.id)
      if (!line) continue
      const normal = { x: -line.d.y, y: line.d.x }
      const off = Math.abs(dot(sub(p, line.a), normal))
      if (off > ON_WALL_TOL_CM) continue
      // Not at one of the two ends of the host wall (that end would have taken the point above).
      const t = dot(sub(p, line.a), line.d)
      if (t <= NEW_WALL_SNAP_CM || t >= line.length - NEW_WALL_SNAP_CM) continue
      if (!best || off < best.d) best = { p: { x: line.a.x + line.d.x * t, y: line.a.y + line.d.y * t }, d: off }
    }
    const id = this.newId('N')
    const at = best ? best.p : p
    this.nodes.push({ id, x: roundStored(at.x), y: roundStored(at.y) })
    return id
  }

  /** Write the properties of a wall (a shared wall shows them in both rooms, by design). */
  setProps(wallId: string, props: WallProps): void {
    const wall = this.walls.find((x) => x.id === wallId)
    if (!wall) return
    wall.props = { ...props }
  }
}

// ---------- the pieces of one polygon edge ----------

/**
 * The pieces of the edge p -> q, in order: spans that existing walls already hold, and the parts
 * that no wall holds (they make new walls). A wall that holds only a part of the edge is used for
 * that part only: it is not split.
 */
function edgePieces(draft: Draft, p: Vec, q: Vec): Piece[] {
  const length = dist(p, q)
  if (length < EPS) return []
  const d = { x: (q.x - p.x) / length, y: (q.y - p.y) / length }
  const at = (t: number): Vec => ({ x: p.x + d.x * t, y: p.y + d.y * t })
  // Span of each existing wall on this edge, in cm from the edge start.
  const covers: { t0: number; t1: number; wallId: string; off: number }[] = []
  for (const w of draft.walls) {
    const line = draft.line(w.id)
    if (!line) continue
    // The wall must be on one line with the edge (a wall at an angle covers an edge at its angle).
    // A short wall is judged by the distance of its ends to the line of the edge: a sine of 0.02 is
    // more than 1 cm of drift on a wall of 50 cm or less.
    if (Math.abs(cross(line.d, d)) > PARALLEL_SIN && line.length * Math.abs(cross(line.d, d)) > ON_WALL_TOL_CM) continue
    // Both ends of the edge must be on the centre line of the wall (within the tolerance).
    const n = { x: -line.d.y, y: line.d.x }
    const offStart = Math.abs(dot(sub(p, line.a), n))
    const offEnd = Math.abs(dot(sub(q, line.a), n))
    if (offStart > ON_WALL_TOL_CM || offEnd > ON_WALL_TOL_CM) continue
    const t0 = Math.max(0, Math.min(dot(sub(line.a, p), d), dot(sub(line.b, p), d)))
    const t1 = Math.min(length, Math.max(dot(sub(line.a, p), d), dot(sub(line.b, p), d)))
    if (t1 - t0 <= EPS) continue
    covers.push({ t0, t1, wallId: w.id, off: Math.max(offStart, offEnd) })
  }
  // Walk along the edge from its start: the wall that covers the most of the rest wins.
  covers.sort((a, b) => a.t0 - b.t0 || b.t1 - a.t1 || a.wallId.localeCompare(b.wallId))
  const order = (a: { t0: number; t1: number; wallId: string; off: number }, b: typeof a) =>
    b.t1 - a.t1 || a.off - b.off || a.wallId.localeCompare(b.wallId)
  const pieces: Piece[] = []
  let t = 0
  for (let guard = 0; guard <= covers.length + 1 && t < length - EPS; guard++) {
    const here = covers.filter((c) => c.t0 <= t + EPS && c.t1 > t + EPS).sort(order)[0]
    if (here) {
      pieces.push({ kind: 'wall', wallId: here.wallId, p: at(t), q: at(here.t1) })
      t = here.t1
      continue
    }
    // No wall here: a new wall, up to the start of the next cover (or the end of the edge).
    const next = covers.filter((c) => c.t0 > t + EPS).reduce((m, c) => Math.min(m, c.t0), length)
    pieces.push({ kind: 'new', p: at(t), q: at(next) })
    t = next
  }
  return pieces
}

// ---------- the cycle of a room ----------

/**
 * The cycle of the wanted room: one face per piece of its polygon edges, in polygon order. A face
 * starts at the corner of its piece, and the properties that the room gives for that corner are
 * written on its wall.
 */
function buildCycle(draft: Draft, room: Room): RoomFace[] {
  const v: Vertex[] = room.vertices
  const n = v.length
  if (n < 3) return []
  const winding = Math.sign(signedArea(v)) || 1
  const cycle: RoomFace[] = []
  for (let i = 0; i < n; i++) {
    const p = v[i]
    const q = v[(i + 1) % n]
    const length = dist(p, q)
    if (length < EPS) continue
    const d = { x: (q.x - p.x) / length, y: (q.y - p.y) / length }
    edgePieces(draft, p, q).forEach((piece, k) => {
      // The corner of the piece: the polygon corner for the first piece, a new one after it.
      const cornerId = k === 0 ? p.id : draft.newId('v')
      // The properties of the edge come from the corner of the POLYGON, so every piece of a split
      // edge gets them: the piece on an existing wall, and the piece that makes a new wall.
      const props = room.walls[p.id]
      if (piece.kind === 'wall') {
        const line = draft.line(piece.wallId)
        if (!line) return
        const u1 = clamp(dot(sub(piece.p, line.a), line.d), 0, line.length)
        const u2 = clamp(dot(sub(piece.q, line.a), line.d), 0, line.length)
        const from = roundStored(Math.min(u1, u2))
        const to = roundStored(Math.max(u1, u2))
        if (to - from < EPS) return
        // The side is where the room LIES (left or right of node a -> node b), so it does not depend
        // on the winding. Which way the room walks along the wall follows from the side and from the
        // winding of its polygon; the read layer derives it (materialize.faceForward), so a
        // counter-clockwise room keeps its vertex order, its corner ids and its labels.
        const forward = dot(d, line.d) > 0
        const side: 'L' | 'R' = forward === (winding > 0) ? 'L' : 'R'
        cycle.push({ wallId: piece.wallId, side, from, to, cornerId })
        if (props) draft.setProps(piece.wallId, props)
        return
      }
      const a = draft.nodeAt(piece.p)
      const b = draft.nodeAt(piece.q)
      if (a === b) return
      // A new wall is drawn in the direction of the room: the room is then on the left of it (or on
      // the right when its polygon is wound the other way).
      const id = draft.newId('W')
      draft.walls.push({ id, a, b, props: props ? { ...props } : { ...DEFAULT_PROPS } })
      const line = draft.line(id)
      if (!line) return
      cycle.push({
        wallId: id,
        side: winding > 0 ? 'L' : 'R',
        from: 0,
        to: roundStored(line.length),
        cornerId,
      })
    })
  }
  return cycle
}

// ---------- output ----------

/**
 * Remove the walls that no room uses any more, then the nodes that no wall uses.
 * A STANDALONE wall is never removed here (`standalone: true`): it stays with no face.
 */
function prune(draft: Draft, rooms: Room[], candidates: Set<string>): void {
  const used = new Set<string>()
  for (const r of rooms) for (const f of r.cycle ?? []) used.add(f.wallId)
  draft.walls = draft.walls.filter((w) => used.has(w.id) || w.standalone === true || !candidates.has(w.id))
  const usedNodes = new Set<string>()
  for (const w of draft.walls) {
    usedNodes.add(w.a)
    usedNodes.add(w.b)
  }
  draft.nodes = draft.nodes.filter((n) => usedNodes.has(n.id))
}

/**
 * The survey diagonal of the room, on the corners of the new cycle: an edge that a piece split makes
 * new corners, so the old indexes can point at another corner. Missing = no diagonal.
 */
function remapDiagonal(room: Room, cycle: RoomFace[]): [number, number] | undefined {
  const d = room.diagonal
  if (!d) return undefined
  const ids = cycle.map((f) => f.cornerId)
  const a = room.vertices[d[0]] ? ids.indexOf(room.vertices[d[0]].id) : -1
  const b = room.vertices[d[1]] ? ids.indexOf(room.vertices[d[1]].id) : -1
  return a >= 0 && b >= 0 && a !== b ? [a, b] : undefined
}

/** The document with the edited graph: derived faces, then the survey view of every room. */
function finish(doc: PlanDoc, draft: Draft, rooms: Room[]): PlanDoc {
  const plain: PlanDoc = { ...doc, rooms, nodes: draft.nodes, walls: draft.walls.map(storedWall) }
  const withFaces: PlanDoc = { ...plain, walls: deriveWallFaces(plain) }
  const out: PlanDoc = { ...withFaces, rooms: materializeRooms(withFaces) }
  // Same polygon and same properties: give the document back as it was (no undo step).
  const same = sameDeep(out.rooms, doc.rooms) && sameDeep(out.nodes, doc.nodes) && sameDeep(out.walls, doc.walls)
  return same ? doc : out
}

// ---------- the public write path ----------

/**
 * Write the polygon of a room into the wall graph (docs/walls-plan.md phase 5c).
 * `room` is the room the tool wants: its vertices (with the ids the tool kept), its wall properties
 * (keyed by vertex id) and its holes. The room is replaced, or added when `roomId` is new.
 * Gives the same document back when the polygon and the properties did not change.
 */
export function applyRoomPolygon(doc: PlanDoc, roomId: string, room: Room, opts: WriteOptions = {}): PlanDoc {
  const known = doc.rooms.find((r) => r.id === roomId)
  const target: Room = { ...(known ?? room), ...room, id: roomId }
  // A v1 document: the polygon is the source, the stored graph is not touched here.
  if (!isV2(doc)) {
    const next: Room = { ...target }
    delete next.cycle
    const rooms = known ? doc.rooms.map((r) => (r.id === roomId ? next : r)) : [...doc.rooms, next]
    return sameDeep(rooms, doc.rooms) ? doc : { ...doc, rooms }
  }
  const draft = new Draft(doc, opts)
  const cycle = buildCycle(draft, target)
  // A polygon that makes no closed cycle (fewer than 3 walls) is refused: nothing is written.
  if (cycle.length < 3) return doc
  const written: Room = { ...target, cycle, diagonal: remapDiagonal(target, cycle) }
  const rooms = known ? doc.rooms.map((r) => (r.id === roomId ? written : r)) : [...doc.rooms, written]
  // The walls that may go away: those the room used before the edit, and those that hold no face.
  const candidates = new Set<string>(known?.cycle?.map((f) => f.wallId) ?? [])
  for (const w of doc.walls ?? []) if (!w.faces.length) candidates.add(w.id)
  if (allRoomsHaveCycle(doc)) prune(draft, rooms, candidates)
  return finish(doc, draft, rooms)
}

/**
 * Remove a room. Its faces go, and its walls STAY (docs/walls-plan.md, "Walls in the interface"):
 * a wall that another room still uses keeps its faces, and a wall that no room uses any more
 * becomes a STANDALONE wall, so the drawing of the plan keeps the walls of the deleted room.
 * Gives the same document back when the room does not exist.
 */
export function removeRoom(doc: PlanDoc, roomId: string): PlanDoc {
  const room = doc.rooms.find((r) => r.id === roomId)
  if (!room) return doc
  const rooms = doc.rooms.filter((r) => r.id !== roomId)
  if (!isV2(doc)) return { ...doc, rooms }
  const draft = new Draft(doc)
  // The walls that a room that stays still uses keep their place without the flag.
  const stillUsed = new Set<string>()
  for (const r of rooms) for (const f of r.cycle ?? []) stillUsed.add(f.wallId)
  for (const f of room.cycle ?? []) {
    const wall = draft.walls.find((w) => w.id === f.wallId)
    if (wall && !stillUsed.has(wall.id)) wall.standalone = true
  }
  // No wall of the room goes away: the kept walls are candidates of nothing.
  const candidates = new Set<string>()
  for (const w of doc.walls ?? []) if (!w.faces.length && !w.standalone) candidates.add(w.id)
  if (allRoomsHaveCycle(doc)) prune(draft, rooms, candidates)
  return finish(doc, draft, rooms)
}

// ---------- walls that lost every face in one edit ----------

/** Distance from a point to the nearest edge of a closed ring (cm). */
function distToRing(p: Vec, ring: Vec[]): number {
  let best = Infinity
  for (let i = 0; i < ring.length; i++) {
    const d = projectOnSegment(p, ring[i], ring[(i + 1) % ring.length]).distance
    if (d < best) best = d
  }
  return best
}

/**
 * True when the room polygon holds the point with room to spare: the point is inside it, more than
 * `MID_INSIDE_CM` from its edges, and not in one of its holes. A point ON an edge is not inside: a
 * wall on the outline of a room is the wall of that room, not a wall inside it.
 */
function roomHolds(p: Vec, room: Room): boolean {
  const ring = room.vertices
  if (ring.length < 3) return false
  if (distToRing(p, ring) <= MID_INSIDE_CM) return false
  if (!pointInPolygon(p, ring)) return false
  for (const hole of room.holes) if (hole.length >= 3 && pointInPolygon(p, hole)) return false
  return true
}

/**
 * The walls that lost every face in ONE edit (docs/walls-plan.md, "Walls in the interface"):
 *   - a wall that a room used before the edit and that no room uses now is REMOVED when the polygon
 *     of a room of the result holds its middle: the wall between two rooms that became one space is
 *     then the wall of that one space, and it must not be drawn across it (a MERGE);
 *   - the same wall STAYS, as a STANDALONE wall, when no room holds it (a room that the user
 *     deletes keeps its walls: that is the decided rule).
 * A wall that was already standalone before the edit is never removed here, and a wall that is new
 * in this edit is not touched: the user drew those walls, only the user removes them.
 * The nodes that no wall uses any more go with a removed wall.
 * `prev` is the document BEFORE the edit: it says which walls a room used.
 */
export function settleWallsWithoutFaces(doc: PlanDoc, prev: PlanDoc): PlanDoc {
  if (!isV2(doc)) return doc
  // The walls that a room of the result uses: a face in a cycle.
  const used = new Set<string>()
  for (const r of doc.rooms) for (const f of r.cycle ?? []) used.add(f.wallId)
  const prevWalls = new Map((prev.walls ?? []).map((w) => [w.id, w]))
  const draft = new Draft(doc)
  let changed = false
  draft.walls = draft.walls.filter((w) => {
    const before = prevWalls.get(w.id)
    if (used.has(w.id)) {
      // A room uses the wall again (the merged room reuses a wall of the room that went away), so
      // the standalone flag that `removeRoom` put on it in this edit says nothing true any more.
      if (w.standalone && before && !before.standalone) {
        w.standalone = undefined
        changed = true
      }
      return true
    }
    // A new wall and a wall that already had no room face before the edit are not the business of the
    // rule. A standalone wall that a room REUSED (it keeps its flag and has a room face) is: when the
    // room moves away from it (a corner drag with Cmd/Ctrl, the room resize), it must not stay behind
    // at the old place of the side.
    const wasUsed = before !== undefined && before.faces.some((f) => f.roomId !== undefined)
    if (!wasUsed) return true
    const a = draft.pos(w.a)
    const b = draft.pos(w.b)
    const mid = a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : null
    if (mid && doc.rooms.some((r) => roomHolds(mid, r))) {
      // A room covers the wall: it was the wall between two rooms that are one space now.
      changed = true
      return false
    }
    // No room covers it: it stays as a standalone wall (the walls of a deleted room).
    if (!w.standalone) {
      w.standalone = true
      changed = true
    }
    return true
  })
  if (!changed) return doc
  // The nodes that no wall uses any more go with the walls that went away.
  const usedNodes = new Set<string>()
  for (const w of draft.walls) {
    usedNodes.add(w.a)
    usedNodes.add(w.b)
  }
  draft.nodes = draft.nodes.filter((n) => usedNodes.has(n.id))
  return finish(doc, draft, doc.rooms)
}

// ---------- walls drawn on their own (docs/walls-plan.md, "Walls in the interface") ----------

/**
 * Add one wall to the graph as a STANDALONE wall: a wall that stays when no room uses it (the Wall
 * tool, a trace converted on load). Both ends take an existing node within 1 cm, else a new node
 * on the wall that the end lies on, else a new node.
 * A wall on the same line (within 1 cm) that already holds a span of the new wall is reused for that
 * span, and is cut where an end of the new wall lies inside it. A T junction (a wall at an angle)
 * does not cut the host wall. Only the spans that no wall holds get a new wall (`layWall`).
 * A segment of less than 1 cm, and a segment that existing walls already hold, add nothing.
 * `opts.newId` gives the ids ('N' node, 'W' wall) when a caller needs its own.
 * This is a v2 write: a v1 document is written by its rooms (the stored graph follows them).
 */
const usedNodesOf = (g: GraphParts): Set<string> => new Set(g.walls.flatMap((w) => [w.a, w.b]))

export function addStandaloneWall(
  doc: PlanDoc,
  a: Vec,
  b: Vec,
  props: WallProps = DEFAULT_PROPS,
  opts: WriteOptions = {},
): { doc: PlanDoc; wallId: string | null } {
  if (dist(a, b) < MIN_WALL_CM) return { doc, wallId: null }
  const draft = new Draft(doc, opts)
  const nodesBefore = draft.nodes.length
  const na = draft.nodeForEnd(a)
  const nb = draft.nodeForEnd(b)
  if (na === nb) return { doc, wallId: null }
  // An existing wall on the same line is reused (and cut where an end lands inside it); only the
  // spans that no wall holds get a new wall: a wall is never stored twice and never overlaps.
  const parts: GraphParts = {
    nodes: draft.nodes,
    walls: draft.walls.map(storedWall),
    rooms: doc.rooms,
    elements: doc.elements,
  }
  const laid = layWall(parts, na, nb, props, true, (prefix) => draft.newId(prefix), { cut: opts.splitHosts })
  const first = laid.pieces[0]?.wallId ?? null
  if (!laid.changed && !laid.g.nodes.some((n, i) => i < nodesBefore ? false : usedNodesOf(laid.g).has(n.id))) return { doc, wallId: first }
  // A node that this call made for an end and that no wall uses (the end lies inside a wall that was
  // reused whole) goes away.
  const usedNodes = new Set<string>()
  for (const w of laid.g.walls) {
    usedNodes.add(w.a)
    usedNodes.add(w.b)
  }
  draft.nodes = laid.g.nodes.filter((n, i) => i < nodesBefore || usedNodes.has(n.id))
  draft.walls = laid.g.walls.map((w) => {
    const out: WallDraft = { id: w.id, a: w.a, b: w.b, props: storedWallProps(w) }
    if (w.standalone) out.standalone = true
    return out
  })
  const elementsMoved = laid.g.elements !== doc.elements
  const out = finish({ ...doc, elements: laid.g.elements }, draft, laid.g.rooms)
  return { doc: elementsMoved ? syncElements(doc, out) : out, wallId: first }
}

/** The survey codes of the rooms whose faces use a wall, in the order of the rooms. */
export function roomCodesOfWall(doc: Pick<PlanDoc, 'rooms' | 'walls'>, wallId: string): string[] {
  const wall = (doc.walls ?? []).find((w) => w.id === wallId)
  const ids = new Set<string>()
  for (const r of doc.rooms) for (const f of r.cycle ?? []) if (f.wallId === wallId) ids.add(r.id)
  for (const f of wall?.faces ?? []) if (f.roomId !== undefined) ids.add(f.roomId)
  return doc.rooms.filter((r) => ids.has(r.id)).map((r) => r.code)
}

/**
 * Remove one wall and the nodes that no wall uses any more. A wall that a room face uses is
 * REFUSED: deleting it would open the room. `refusedBy` holds the survey codes of those rooms, so
 * the caller can name them in a toast; it is empty when the wall was removed.
 * A wall that is not in the document, and a wall of a v1 document (its stored graph is derived
 * data), gives the document back unchanged.
 */
export function removeWall(doc: PlanDoc, wallId: string): { doc: PlanDoc; refusedBy: string[] } {
  const wall = (doc.walls ?? []).find((w) => w.id === wallId)
  if (!wall) return { doc, refusedBy: [] }
  const refusedBy = roomCodesOfWall(doc, wallId)
  if (refusedBy.length) return { doc, refusedBy }
  // A v1 document: the walls are derived from the rooms, so there is nothing to remove here.
  if (!isV2(doc)) return { doc, refusedBy: [] }
  const draft = new Draft(doc)
  draft.walls = draft.walls.filter((w) => w.id !== wallId)
  const usedNodes = new Set<string>()
  for (const w of draft.walls) {
    usedNodes.add(w.a)
    usedNodes.add(w.b)
  }
  draft.nodes = draft.nodes.filter((n) => usedNodes.has(n.id))
  return { doc: finish(doc, draft, doc.rooms), refusedBy: [] }
}
