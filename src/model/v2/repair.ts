// Repair of the wall graph of a v2 document (docs/walls-plan.md, phase 5c). Pure, cm, y points down.
//
// A document can hold walls that the tools made before they were fixed: two points a few tenths of a
// centimetre apart, a wall stored twice, two walls on one line that overlap, a point in the middle of a
// straight run that no wall turns at. `repairGraph` cleans that, and gives the document back
// UNCHANGED (the same object) when there is nothing to clean:
//   a. nodes closer than 1 cm become one node (the node that more walls use stays);
//   b. a wall of zero length, and a wall stored twice (same two nodes), go away;
//   c. walls on one line that overlap become walls that do not overlap (cut where an end lies inside);
//   d. a node where exactly two walls meet, on one line, with the same type, thickness, status and
//      align, and neither locked, goes away: the two walls become one wall. A node where three walls
//      meet (a T junction) and a node where a room turns stay;
//   e. the elements (doors, windows) move to the merged wall and keep their place on the plan;
//   f. the measured values follow their faces. When two faces of one room become one face:
//      all measured -> the sum; exactly one measured and within 2 cm of the new length -> that value
//      stays; else the values go to the old values (never lost) and `changes` says so;
//   g. the room cycles, the faces of the walls and the survey view are calculated again.
// A locked wall is never merged, cut or removed: it keeps its lock.
//
// `inline: false` skips step d (the end of a drag: a point that a drag leaves on a straight run is the
// user's business, only points that touch and walls that overlap are cleaned).

import { cross, dist, dot, sub } from '../geometry'
import { appendOld } from '../oldMeasurements'
import type { DroppedValue } from '../relabel'
import type { MeasureTarget, Measurement, PlanDoc, Room, RoomFace, StoredNode, StoredWall, Vec } from '../types'
import { parseWallValueLabel } from '../wallValues'
import { syncElements } from './elements'
import { deriveWallFaces, materializeRooms, roundStored } from './materialize'
import { relabelByTarget } from './relabelV2'
import { frameOf, idMaker, nodeMap, rewireWalls, WALL_TOL_CM, type Frame, type GraphParts, type NewId } from './spans'
import { attachTargets } from './targets'

export type RepairOptions = {
  /** Remove the points in the middle of a straight run (step d). Default: true. */
  inline?: boolean
  /** Time of the values that move, for `updatedAt`. Default: the clock. */
  now?: string
}

export type RepairResult = {
  doc: PlanDoc
  /** One line per kind of change. Empty = the document is clean (and `doc` is the same object). */
  changes: string[]
  /** Number of nodes and walls that went away. */
  removed: number
}

/** A measured value within this of the new length stays on the merged face (cm). */
const KEEP_VALUE_CM = 2
const EPS = 1e-6
/** Two walls on one line overlap for the repair when they share more than this (cm). */
const OVERLAP_MIN_CM = 10

const faceCount = (rooms: Room[]) => {
  const n = new Map<string, number>()
  for (const r of rooms) for (const f of r.cycle ?? []) n.set(f.wallId, (n.get(f.wallId) ?? 0) + 1)
  return n
}

const samePropsOf = (a: StoredWall, b: StoredWall) =>
  (a.type ?? 'partition') === (b.type ?? 'partition') &&
  a.thicknessCm === b.thicknessCm &&
  a.status === b.status &&
  a.align === b.align

/** A copy of the wall with the flags of the walls that it replaces (a lock stays, a standalone stays). */
function withFlags(base: StoredWall, others: StoredWall[], id: string, a: string, b: string): StoredWall {
  const out: StoredWall = { ...base, id, a, b, faces: [] }
  const all = [base, ...others]
  if (all.some((w) => w.locked)) out.locked = true
  if (all.some((w) => w.standalone)) out.standalone = true
  else delete out.standalone
  return out
}

// ---------- a. nodes ----------

function mergeNodes(g: GraphParts): { g: GraphParts; merged: number } {
  const usage = new Map<string, number>()
  for (const w of g.walls) {
    usage.set(w.a, (usage.get(w.a) ?? 0) + 1)
    usage.set(w.b, (usage.get(w.b) ?? 0) + 1)
  }
  const order = g.nodes
    .map((n, i) => ({ n, i }))
    .filter((x) => (usage.get(x.n.id) ?? 0) > 0)
    .sort((x, y) => (usage.get(y.n.id) ?? 0) - (usage.get(x.n.id) ?? 0) || x.i - y.i)
  const kept: StoredNode[] = []
  const into = new Map<string, string>()
  for (const { n } of order) {
    const near = kept.find((k) => dist(k, n) <= WALL_TOL_CM)
    if (near) into.set(n.id, near.id)
    else kept.push(n)
  }
  if (!into.size) return { g, merged: 0 }
  const walls = g.walls.map((w) => (into.has(w.a) || into.has(w.b) ? { ...w, a: into.get(w.a) ?? w.a, b: into.get(w.b) ?? w.b } : w))
  return { g: { ...g, nodes: g.nodes.filter((n) => !into.has(n.id)), walls }, merged: into.size }
}

// ---------- b. zero length and duplicates ----------

function dropEmptyAndDuplicates(g: GraphParts, newId: NewId): { g: GraphParts; empty: number; duplicates: number } {
  let cur = g
  let empty = 0
  let duplicates = 0
  // Walls of zero length: the faces on them go (a room keeps at least 3 faces, else the wall stays).
  const pos = nodeMap(cur.nodes)
  const zero = new Set(
    cur.walls.filter((w) => w.a === w.b || (pos.has(w.a) && pos.has(w.b) && dist(pos.get(w.a)!, pos.get(w.b)!) < EPS)).map((w) => w.id),
  )
  for (const id of [...zero]) {
    if (cur.walls.find((w) => w.id === id)?.locked) zero.delete(id)
    else if (cur.rooms.some((r) => (r.cycle ?? []).some((f) => f.wallId === id) && (r.cycle ?? []).filter((f) => !zero.has(f.wallId)).length < 3)) zero.delete(id)
  }
  if (zero.size) {
    empty = zero.size
    const rooms = cur.rooms.map((r) => {
      if (!r.cycle?.some((f) => zero.has(f.wallId))) return r
      const cycle = r.cycle.filter((f) => !zero.has(f.wallId))
      const ids = cycle.map((f) => f.cornerId)
      const d = r.diagonal
      const a = d && r.vertices[d[0]] ? ids.indexOf(r.vertices[d[0]].id) : -1
      const b = d && r.vertices[d[1]] ? ids.indexOf(r.vertices[d[1]].id) : -1
      return { ...r, cycle, diagonal: a >= 0 && b >= 0 && a !== b ? ([a, b] as [number, number]) : undefined }
    })
    const elements = cur.elements.map((el) => {
      if (!el.wallId || !zero.has(el.wallId)) return el
      const { wallId: _w, alongCm: _a, ...rest } = el
      void _w
      void _a
      return rest
    })
    cur = { ...cur, walls: cur.walls.filter((w) => !zero.has(w.id)), rooms, elements }
  }
  // The same two nodes, in any order: one wall stays, the faces and the elements move to it.
  const groups = new Map<string, StoredWall[]>()
  for (const w of cur.walls) {
    const key = w.a < w.b ? `${w.a}|${w.b}` : `${w.b}|${w.a}`
    groups.set(key, [...(groups.get(key) ?? []), w])
  }
  const faces = faceCount(cur.rooms)
  for (const list of groups.values()) {
    if (list.length < 2) continue
    const keep = [...list].sort((x, y) => (faces.get(y.id) ?? 0) - (faces.get(x.id) ?? 0))[0]
    const merged = withFlags(keep, list.filter((w) => w !== keep), keep.id, keep.a, keep.b)
    cur = rewireWalls(cur, new Set(list.map((w) => w.id)), [merged], newId)
    duplicates += list.length - 1
  }
  return { g: cur, empty, duplicates }
}

// ---------- c. overlapping walls on one line ----------

/** True when two walls are on one line (ends within 1 cm of the other line) and overlap by more than 1 cm. */
function overlap(pos: Map<string, Vec>, x: StoredWall, y: StoredWall): boolean {
  const fx = frameOf(pos, x)
  const fy = frameOf(pos, y)
  if (!fx || !fy) return false
  const off = (f: Frame, p: Vec) => Math.abs(cross(f.d, sub(p, f.a)))
  const ya = pos.get(y.a)!
  const yb = pos.get(y.b)!
  const xa = pos.get(x.a)!
  const xb = pos.get(x.b)!
  if (off(fx, ya) > WALL_TOL_CM || off(fx, yb) > WALL_TOL_CM || off(fy, xa) > WALL_TOL_CM || off(fy, xb) > WALL_TOL_CM) return false
  const t1 = dot(sub(ya, fx.a), fx.d)
  const t2 = dot(sub(yb, fx.a), fx.d)
  // A sliver of a few cm is a survey offset between two rooms (the demo apartment has one of 7 cm), not a
  // stored twice wall: only a real overlap is merged.
  return Math.min(fx.length, Math.max(t1, t2)) - Math.max(0, Math.min(t1, t2)) > OVERLAP_MIN_CM
}

function resolveOverlaps(g: GraphParts, newId: NewId, touched: Set<string>): { g: GraphParts; groups: number; walls: number; lockedLeft: number } {
  let cur = g
  const pos = nodeMap(cur.nodes)
  const walls = cur.walls.filter((w) => frameOf(pos, w))
  // Union of the walls that overlap (a locked wall is never merged).
  const parent = new Map(walls.map((w) => [w.id, w.id]))
  const find = (id: string): string => {
    let r = id
    while (parent.get(r) !== r) r = parent.get(r)!
    return r
  }
  let lockedLeft = 0
  for (let i = 0; i < walls.length; i++) {
    for (let j = i + 1; j < walls.length; j++) {
      if (!overlap(pos, walls[i], walls[j])) continue
      if (walls[i].locked || walls[j].locked) {
        lockedLeft++
        continue
      }
      parent.set(find(walls[i].id), find(walls[j].id))
    }
  }
  const byRoot = new Map<string, StoredWall[]>()
  for (const w of walls) byRoot.set(find(w.id), [...(byRoot.get(find(w.id)) ?? []), w])
  let groups = 0
  let count = 0
  for (const list of byRoot.values()) {
    if (list.length < 2) continue
    const faces = faceCount(cur.rooms)
    const longest = list.reduce((m, w) => (frameOf(pos, w)!.length > frameOf(pos, m)!.length ? w : m), list[0])
    const axis = frameOf(pos, longest)!
    const tOf = (id: string) => dot(sub(pos.get(id)!, axis.a), axis.d)
    const ends = new Map<string, number>()
    for (const w of list) {
      ends.set(w.a, tOf(w.a))
      ends.set(w.b, tOf(w.b))
    }
    const breaks = [...ends.entries()].sort((x, y) => x[1] - y[1])
    const parts: StoredWall[] = []
    const used = new Set<string>()
    for (let i = 0; i + 1 < breaks.length; i++) {
      const [n0, t0] = breaks[i]
      const [n1, t1] = breaks[i + 1]
      if (t1 - t0 < EPS) continue
      const covering = list.filter((w) => Math.min(ends.get(w.a)!, ends.get(w.b)!) <= t0 + WALL_TOL_CM && Math.max(ends.get(w.a)!, ends.get(w.b)!) >= t1 - WALL_TOL_CM)
      if (!covering.length) continue
      const base = [...covering].sort((x, y) => (faces.get(y.id) ?? 0) - (faces.get(x.id) ?? 0))[0]
      const id = used.has(base.id) ? newId('W') : base.id
      used.add(id)
      // The piece runs the way of the wall it comes from.
      const same = dot(frameOf(pos, base)!.d, axis.d) >= 0
      parts.push(withFlags(base, covering.filter((w) => w !== base), id, same ? n0 : n1, same ? n1 : n0))
    }
    if (!parts.length) continue
    cur = rewireWalls(cur, new Set(list.map((w) => w.id)), parts, newId)
    for (const p of parts) touched.add(p.id)
    groups++
    count += list.length
  }
  return { g: cur, groups, walls: count, lockedLeft }
}

// ---------- d. points in the middle of a straight run ----------

function removeInlineNodes(g: GraphParts, newId: NewId, touched: Set<string>): { g: GraphParts; removed: number } {
  let cur = g
  let removed = 0
  for (let guard = 0; guard < 10000; guard++) {
    const pos = nodeMap(cur.nodes)
    let done = true
    for (const node of cur.nodes) {
      const inc = cur.walls.filter((w) => w.a === node.id || w.b === node.id)
      if (inc.length !== 2) continue
      const [w1, w2] = inc
      if (w1.locked || w2.locked || !samePropsOf(w1, w2)) continue
      const o1 = w1.a === node.id ? w1.b : w1.a
      const o2 = w2.a === node.id ? w2.b : w2.a
      if (o1 === o2 || o1 === node.id || o2 === node.id) continue
      const p = pos.get(node.id)
      const q1 = pos.get(o1)
      const q2 = pos.get(o2)
      if (!p || !q1 || !q2) continue
      const span = dist(q1, q2)
      if (span < EPS) continue
      const dir = { x: (q2.x - q1.x) / span, y: (q2.y - q1.y) / span }
      // On the line between the two far ends, and between them (the run does not fold back).
      const along = dot(sub(p, q1), dir)
      if (Math.abs(cross(dir, sub(p, q1))) > WALL_TOL_CM || along <= 0 || along >= span) continue
      // The merged wall keeps the direction and the id of the first wall.
      const merged = w1.b === node.id ? withFlags(w1, [w2], w1.id, o1, o2) : withFlags(w1, [w2], w1.id, o2, o1)
      cur = rewireWalls(cur, new Set([w1.id, w2.id]), [merged], newId)
      cur = { ...cur, nodes: cur.nodes.filter((n) => n.id !== node.id) }
      touched.add(merged.id)
      removed++
      done = false
      break
    }
    if (done) break
  }
  return { g: cur, removed }
}

// ---------- e. one face where two faces of one room meet on one wall ----------

type Merge = { roomId: string; /** corner ids of the faces that became one, in room order */ cornerIds: string[]; face: RoomFace }

const contiguous = (a: RoomFace, b: RoomFace) => {
  const lo = (f: RoomFace) => Math.min(f.from, f.to)
  const hi = (f: RoomFace) => Math.max(f.from, f.to)
  return Math.abs(hi(a) - lo(b)) <= 0.01 || Math.abs(hi(b) - lo(a)) <= 0.01
}

function coalesceFaces(rooms: Room[], touched: Set<string>): { rooms: Room[]; merges: Merge[] } {
  const merges: Merge[] = []
  const out = rooms.map((r) => {
    if (!r.cycle || r.cycle.length < 2) return r
    const groups: { face: RoomFace; corners: string[] }[] = []
    for (const f of r.cycle) {
      const last = groups[groups.length - 1]
      if (last && last.face.wallId === f.wallId && touched.has(f.wallId) && last.face.side === f.side && contiguous(last.face, f)) {
        last.face = { ...last.face, from: Math.min(last.face.from, last.face.to, f.from, f.to), to: Math.max(last.face.from, last.face.to, f.from, f.to) }
        last.corners.push(f.cornerId)
      } else groups.push({ face: { ...f }, corners: [f.cornerId] })
    }
    // The cycle is a ring: the last face can continue the first one.
    if (groups.length > 1) {
      const first = groups[0]
      const last = groups[groups.length - 1]
      if (first.face.wallId === last.face.wallId && touched.has(first.face.wallId) && first.face.side === last.face.side && contiguous(last.face, first.face)) {
        const face = {
          ...first.face,
          from: Math.min(last.face.from, last.face.to, first.face.from, first.face.to),
          to: Math.max(last.face.from, last.face.to, first.face.from, first.face.to),
          cornerId: last.face.cornerId,
        }
        groups.pop()
        groups[0] = { face, corners: [...last.corners, ...first.corners] }
      }
    }
    if (groups.length === r.cycle.length) return r
    const cycle = groups.map((x) => x.face)
    for (const x of groups) if (x.corners.length > 1) merges.push({ roomId: r.id, cornerIds: x.corners, face: x.face })
    const ids = cycle.map((f) => f.cornerId)
    const d = r.diagonal
    const a = d && r.vertices[d[0]] ? ids.indexOf(r.vertices[d[0]].id) : -1
    const b = d && r.vertices[d[1]] ? ids.indexOf(r.vertices[d[1]].id) : -1
    return { ...r, cycle, diagonal: a >= 0 && b >= 0 && a !== b ? ([a, b] as [number, number]) : undefined }
  })
  return { rooms: out, merges }
}

// ---------- f. measured values ----------

/** The label of the face that starts at a corner of a room, e.g. 'R1-4'. */
function labelOfCorner(room: Room, cornerId: string): string | undefined {
  const i = room.vertices.findIndex((v) => v.id === cornerId)
  return i < 0 ? undefined : `${room.code}-${i + 1}`
}

/** World ends of a face of a wall (cm along node a). */
function faceSegment(pos: Map<string, Vec>, walls: Map<string, StoredWall>, f: { wallId: string; from: number; to: number }): [Vec, Vec] | null {
  const w = walls.get(f.wallId)
  const fr = w ? frameOf(pos, w) : null
  if (!fr) return null
  const at = (u: number): Vec => ({ x: fr.a.x + fr.d.x * u, y: fr.a.y + fr.d.y * u })
  return [at(Math.min(f.from, f.to)), at(Math.max(f.from, f.to))]
}

const SAME_PLACE_CM = 1.5

// ---------- the repair ----------

export function repairGraph(doc: PlanDoc, opts: RepairOptions = {}): RepairResult {
  const clean: RepairResult = { doc, changes: [], removed: 0 }
  if (doc.schemaVersion !== 2 || !Array.isArray(doc.nodes) || !Array.isArray(doc.walls)) return clean
  const newId = idMaker(doc)
  const touched = new Set<string>()
  const changes: string[] = []
  let removed = 0
  let g: GraphParts = { nodes: doc.nodes, walls: doc.walls, rooms: doc.rooms, elements: doc.elements }
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

  // a. nodes
  const nodes = mergeNodes(g)
  g = nodes.g
  if (nodes.merged) {
    changes.push(`Merged ${plural(nodes.merged, 'point', 'points')} closer than 1 cm`)
    removed += nodes.merged
  }
  // b. zero length and duplicates
  const dup = dropEmptyAndDuplicates(g, newId)
  g = dup.g
  if (dup.empty) changes.push(`Removed ${plural(dup.empty, 'wall', 'walls')} of zero length`)
  if (dup.duplicates) changes.push(`Removed ${plural(dup.duplicates, 'duplicate wall', 'duplicate walls')}`)
  removed += dup.empty + dup.duplicates
  // c. overlap
  const over = resolveOverlaps(g, newId, touched)
  g = over.g
  if (over.groups) {
    changes.push(`Merged ${plural(over.walls, 'overlapping wall', 'overlapping walls')} into walls that do not overlap`)
    removed += Math.max(0, over.walls - over.groups)
  }
  if (over.lockedLeft) changes.push(`Left ${plural(over.lockedLeft, 'overlap', 'overlaps')} that involve a locked wall`)
  // d. straight runs
  if (opts.inline ?? true) {
    const inline = removeInlineNodes(g, newId, touched)
    g = inline.g
    if (inline.removed) {
      changes.push(`Removed ${plural(inline.removed, 'point', 'points')} in the middle of a straight wall`)
      removed += inline.removed
    }
  }
  const structural = g.nodes !== doc.nodes || g.walls !== doc.walls || g.rooms !== doc.rooms || g.elements !== doc.elements
  if (!structural) return clean
  // e. faces
  const co = coalesceFaces(g.rooms, touched)
  const now = opts.now ?? new Date().toISOString()

  // f. measured values: the targets point to the old walls, so they move with the faces.
  const withTargets = attachTargets(doc)
  const m: Record<string, Measurement> = { ...withTargets.measurements }
  const dropped: DroppedValue[] = []
  const handled = new Set<string>()
  const oldRoomOf = new Map(doc.rooms.map((r) => [r.id, r]))
  for (const mg of co.merges) {
    const room = oldRoomOf.get(mg.roomId)
    if (!room) continue
    const labels = mg.cornerIds.map((c) => labelOfCorner(room, c))
    const measured = labels.filter((l): l is string => l !== undefined && m[l] !== undefined)
    if (!measured.length) continue
    const length = Math.abs(mg.face.to - mg.face.from)
    const target: MeasureTarget = { wallId: mg.face.wallId, side: mg.face.side, roomId: mg.roomId, from: mg.face.from, to: mg.face.to, kind: 'face' }
    if (measured.length === mg.cornerIds.length) {
      const sum = measured.reduce((s, l) => s + m[l].actualCm, 0)
      const first = measured[0]
      const value: Measurement = { ...m[first], actualCm: roundStored(sum), updatedAt: now, target }
      for (const l of measured) delete m[l]
      m[first] = value
      handled.add(first)
    } else if (measured.length === 1 && Math.abs(m[measured[0]].actualCm - length) <= KEEP_VALUE_CM) {
      m[measured[0]] = { ...m[measured[0]], target }
      handled.add(measured[0])
    } else {
      for (const l of measured) {
        dropped.push({ roomCode: room.code, reason: 'wall-split', measurement: m[l] })
        delete m[l]
      }
      changes.push(`Dropped the values of ${measured.join(', ')}: the walls were merged and the values do not add up`)
    }
  }

  // Rebuild (g): faces of the walls, the survey view, the elements.
  const draft: PlanDoc = { ...doc, nodes: g.nodes, walls: g.walls, rooms: co.rooms, elements: g.elements, measurements: m }
  const withFaces: PlanDoc = { ...draft, walls: deriveWallFaces(draft) }
  const materialized: PlanDoc = { ...withFaces, rooms: materializeRooms(withFaces) }
  const synced = syncElements(doc, materialized)

  // The other faces follow: a value of a face that exists at the same place takes the new wall id.
  const oldPos = nodeMap(doc.nodes)
  const oldWalls = new Map(doc.walls.map((w) => [w.id, w]))
  const newPos = nodeMap(synced.nodes ?? [])
  const newWalls = new Map((synced.walls ?? []).map((w) => [w.id, w]))
  const near = (p: Vec, q: Vec) => dist(p, q) <= SAME_PLACE_CM
  for (const [label, v] of Object.entries(m)) {
    const t = v.target
    if (!t || t.roomId === undefined || handled.has(label)) continue
    const oldRoom = oldRoomOf.get(t.roomId)
    const newRoom = synced.rooms.find((r) => r.id === t.roomId)
    if (!oldRoom?.cycle || !newRoom?.cycle) continue
    const kind = t.kind ?? 'face'
    let oldFace: RoomFace | undefined
    let best = 0
    for (const f of oldRoom.cycle) {
      if (f.wallId !== t.wallId || f.side !== t.side) continue
      const lo = Math.min(f.from, f.to)
      const hi = Math.max(f.from, f.to)
      const ov = kind === 'face' && t.from !== undefined && t.to !== undefined ? Math.min(hi, t.to) - Math.max(lo, t.from) : hi - lo
      if (!oldFace || ov > best) {
        oldFace = f
        best = ov
      }
    }
    if (!oldFace) continue
    const seg = faceSegment(oldPos, oldWalls, oldFace)
    if (!seg) continue
    let target: RoomFace | undefined
    if (kind === 'face') {
      target = newRoom.cycle.find((f) => {
        const s = faceSegment(newPos, newWalls, f)
        return !!s && ((near(s[0], seg[0]) && near(s[1], seg[1])) || (near(s[0], seg[1]) && near(s[1], seg[0])))
      })
    } else {
      const mid = { x: (seg[0].x + seg[1].x) / 2, y: (seg[0].y + seg[1].y) / 2 }
      target = newRoom.cycle.find((f) => {
        const s = faceSegment(newPos, newWalls, f)
        if (!s) return false
        const len = dist(s[0], s[1])
        if (len < EPS) return false
        const d = { x: (s[1].x - s[0].x) / len, y: (s[1].y - s[0].y) / len }
        const along = dot(sub(mid, s[0]), d)
        return along >= -SAME_PLACE_CM && along <= len + SAME_PLACE_CM && Math.abs(cross(d, sub(mid, s[0]))) <= SAME_PLACE_CM
      })
    }
    if (!target || (target.wallId === t.wallId && target.side === t.side && kind !== 'face')) continue
    if (kind === 'face') {
      if (target.wallId === t.wallId && target.side === t.side && t.from !== undefined && Math.abs(t.from - target.from) < 0.01 && Math.abs((t.to ?? 0) - target.to) < 0.01) continue
      m[label] = { ...v, target: { ...t, wallId: target.wallId, side: target.side, from: target.from, to: target.to } }
    } else m[label] = { ...v, target: { ...t, wallId: target.wallId, side: target.side } }
  }

  // The values of a wall (centre line, outside face) are about its length: a wall that changed loses them.
  const lengthOf = (pos: Map<string, Vec>, w: StoredWall | undefined) => {
    const fr = w ? frameOf(pos, w) : null
    return fr ? fr.length : null
  }
  const changedWalls = new Set<string>()
  for (const w of doc.walls) {
    const now2 = newWalls.get(w.id)
    const before = lengthOf(oldPos, w)
    const after = lengthOf(newPos, now2)
    if (!now2 || before === null || after === null || Math.abs(before - after) > KEEP_VALUE_CM) changedWalls.add(w.id)
  }
  for (const [label, v] of Object.entries(m)) {
    const wallValue = parseWallValueLabel(label)
    if (!wallValue || !changedWalls.has(wallValue.wallId) || !oldWalls.has(wallValue.wallId)) continue
    dropped.push({ roomCode: '', reason: 'wall-removed', measurement: v })
    delete m[label]
    changes.push(`Dropped the value ${label}: its wall was merged`)
  }

  // Move every value to the label of its face (relabelByTarget keeps the ones that cannot move in the old values).
  const beforeV: PlanDoc = { ...doc, measurements: m }
  const afterV: PlanDoc = { ...synced, measurements: m }
  const relabel = relabelByTarget(beforeV, afterV, now, { rawMeasurements: m })
  const measurements = relabel ? relabel.measurements : m
  if (relabel) {
    dropped.push(...relabel.droppedValues)
    for (const label of relabel.dropped) changes.push(`Dropped the value ${label}: its wall was cut by the repair`)
  }
  const old = appendOld(doc.oldMeasurements, dropped, now)
  const out = attachTargets({ ...synced, measurements, ...(old ? { oldMeasurements: old } : {}) })
  return { doc: out, changes, removed }
}

/** The wall segments [x1, y1, x2, y2] of a document (tests, diagnostics). */
export function endpointsOf(doc: PlanDoc): [number, number, number, number][] {
  const pos = nodeMap(doc.nodes ?? [])
  const out: [number, number, number, number][] = []
  for (const w of doc.walls ?? []) {
    const a = pos.get(w.a)
    const b = pos.get(w.b)
    if (a && b) out.push([a.x, a.y, b.x, b.y])
  }
  return out
}
