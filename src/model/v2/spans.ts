// Shared wall-graph edits of the v2 model: cut walls into pieces, and lay a wall without a duplicate.
// Pure, cm, y points down. Used by the write layer (`addStandaloneWall`), by the storage actions
// (the back wall of a storage) and by the repair (`repairGraph`).
//
//   - `rewireWalls` replaces some stored walls by other walls on the same line. Every room face and
//     every element that sat on a replaced wall moves to the new wall that holds that part of the
//     line, so nothing moves on the plan (a face that spans two new walls becomes two faces).
//   - `layWall` puts one wall between two nodes into a graph: an existing collinear wall is REUSED
//     for the span that it covers (and cut where the new wall ends inside it); only the spans that no
//     wall covers get a new wall. A wall is never stored twice.

import { cross, dist, dot, sub } from '../geometry'
import type { Room, RoomFace, StoredNode, StoredWall, Vec, WallElement } from '../types'
import { roomFaceForward, roundStored } from './materialize'

/** One shared tolerance of the wall graph (cm): the same value as the snap of the tools. */
export const WALL_TOL_CM = 1
/** A length below this is zero. */
const EPS = 1e-6
/** A face part shorter than this is nothing (cm). */
const MIN_PART_CM = 1e-3

export type GraphParts = { nodes: StoredNode[]; walls: StoredWall[]; rooms: Room[]; elements: WallElement[] }
export type NewId = (prefix: string) => string

/** Gives ids that no node, wall, room corner or room of the document has. */
export function idMaker(doc: { nodes?: StoredNode[]; walls?: StoredWall[]; rooms: Room[] }): NewId {
  const used = new Set<string>()
  for (const n of doc.nodes ?? []) used.add(n.id)
  for (const w of doc.walls ?? []) used.add(w.id)
  for (const r of doc.rooms) {
    used.add(r.id)
    for (const v of r.vertices) used.add(v.id)
    for (const f of r.cycle ?? []) used.add(f.cornerId)
  }
  const counters = new Map<string, number>()
  return (prefix) => {
    let k = counters.get(prefix) ?? 0
    let id = ''
    do {
      k++
      id = `${prefix}${k}`
    } while (used.has(id))
    counters.set(prefix, k)
    used.add(id)
    return id
  }
}

/** Centre line of a wall: node a, unit direction a -> b and the length. */
export type Frame = { a: Vec; d: Vec; length: number }

export function frameOf(nodes: Map<string, Vec>, w: Pick<StoredWall, 'a' | 'b'>): Frame | null {
  const a = nodes.get(w.a)
  const b = nodes.get(w.b)
  if (!a || !b) return null
  const length = dist(a, b)
  if (length < EPS) return null
  return { a: { x: a.x, y: a.y }, d: { x: (b.x - a.x) / length, y: (b.y - a.y) / length }, length }
}

export const nodeMap = (nodes: StoredNode[]): Map<string, Vec> => new Map(nodes.map((n) => [n.id, { x: n.x, y: n.y }]))

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi)
const flip = (s: 'L' | 'R'): 'L' | 'R' => (s === 'L' ? 'R' : 'L')

type Piece = { wall: StoredWall; fr: Frame }

/** The faces that replace one face of a removed wall: one per new wall that holds a part of it. */
function mapFace(room: Room, f: RoomFace, old: Frame, pieces: Piece[], newId: NewId): RoomFace[] {
  const lo = Math.min(f.from, f.to)
  const hi = Math.max(f.from, f.to)
  type Hit = { p: Piece; lo: number; hi: number; gap: number }
  const hits: Hit[] = []
  let nearest: Hit | null = null
  for (const p of pieces) {
    // The span of the new wall on the axis of the old wall.
    const u1 = dot(sub(p.fr.a, old.a), old.d)
    const u2 = u1 + dot(p.fr.d, old.d) * p.fr.length
    const pl = Math.min(u1, u2)
    const ph = Math.max(u1, u2)
    const ovLo = Math.max(lo, pl)
    const ovHi = Math.min(hi, ph)
    if (ovHi - ovLo > MIN_PART_CM) hits.push({ p, lo: ovLo, hi: ovHi, gap: 0 })
    else {
      const gap = Math.max(pl - hi, lo - ph, 0)
      if (!nearest || gap < nearest.gap) nearest = { p, lo: clamp(ovLo, pl, ph), hi: clamp(ovLo, pl, ph), gap }
    }
  }
  if (!hits.length && nearest) hits.push(nearest)
  hits.sort((x, y) => x.lo - y.lo)
  if (roomFaceForward(room, f) < 0) hits.reverse()
  return hits.map((h, i) => {
    const same = dot(h.p.fr.d, old.d) >= 0
    // Position on the new wall of a point of the old wall axis.
    const base = dot(sub(old.a, h.p.fr.a), h.p.fr.d)
    const k = dot(old.d, h.p.fr.d)
    const s1 = clamp(base + k * h.lo, 0, h.p.fr.length)
    const s2 = clamp(base + k * h.hi, 0, h.p.fr.length)
    return {
      wallId: h.p.wall.id,
      side: same ? f.side : flip(f.side),
      from: roundStored(Math.min(s1, s2)),
      to: roundStored(Math.max(s1, s2)),
      cornerId: i === 0 ? f.cornerId : newId('v'),
    }
  })
}

/** The element on a removed wall, put on the new wall that holds its middle. */
function mapElement(el: WallElement, old: Frame, pieces: Piece[]): WallElement {
  const mid = (el.alongCm ?? 0) + el.widthCm / 2
  let best: Piece | null = null
  let bestGap = Infinity
  for (const p of pieces) {
    const u1 = dot(sub(p.fr.a, old.a), old.d)
    const u2 = u1 + dot(p.fr.d, old.d) * p.fr.length
    const gap = Math.max(Math.min(u1, u2) - mid, mid - Math.max(u1, u2), 0)
    if (gap < bestGap) {
      best = p
      bestGap = gap
    }
  }
  // No wall holds the element any more: it keeps its view and loses its wall (the next load attaches it).
  if (!best) {
    const { wallId: _w, alongCm: _a, ...rest } = el
    void _w
    void _a
    return rest
  }
  const along = el.alongCm ?? 0
  const base = dot(sub(old.a, best.fr.a), best.fr.d)
  const k = dot(old.d, best.fr.d)
  const s1 = base + k * along
  const s2 = base + k * (along + el.widthCm)
  const start = clamp(Math.min(s1, s2), 0, Math.max(0, best.fr.length - el.widthCm))
  return { ...el, wallId: best.wall.id, alongCm: roundStored(start) }
}

/** The survey diagonal of a room on the corners of a new cycle (missing = no diagonal). */
function remapDiagonal(room: Room, cycle: RoomFace[]): [number, number] | undefined {
  const d = room.diagonal
  if (!d) return undefined
  const ids = cycle.map((f) => f.cornerId)
  const a = room.vertices[d[0]] ? ids.indexOf(room.vertices[d[0]].id) : -1
  const b = room.vertices[d[1]] ? ids.indexOf(room.vertices[d[1]].id) : -1
  return a >= 0 && b >= 0 && a !== b ? [a, b] : undefined
}

/**
 * Replace the walls `removeIds` by the walls `add` (they must lie on the same line, and their nodes
 * must be in `g.nodes`). The new walls take the place of the first removed wall in the list. The
 * faces and the elements that sat on a removed wall move to the new walls (`mapFace`, `mapElement`).
 * A wall that is in both lists keeps its id: give it in `add` with its new nodes.
 */
export function rewireWalls(g: GraphParts, removeIds: Set<string>, add: StoredWall[], newId: NewId): GraphParts {
  const nodes = nodeMap(g.nodes)
  const frames = new Map<string, Frame>()
  for (const w of g.walls) {
    if (!removeIds.has(w.id)) continue
    const fr = frameOf(nodes, w)
    if (fr) frames.set(w.id, fr)
  }
  const pieces: Piece[] = []
  for (const w of add) {
    const fr = frameOf(nodes, w)
    if (fr) pieces.push({ wall: w, fr })
  }
  const walls: StoredWall[] = []
  let placed = false
  for (const w of g.walls) {
    if (!removeIds.has(w.id)) {
      walls.push(w)
      continue
    }
    if (!placed) {
      walls.push(...add)
      placed = true
    }
  }
  if (!placed) walls.push(...add)
  if (!pieces.length) return { ...g, walls }

  const rooms = g.rooms.map((r) => {
    if (!r.cycle?.some((f) => removeIds.has(f.wallId) && frames.has(f.wallId))) return r
    const cycle: RoomFace[] = []
    for (const f of r.cycle) {
      const old = removeIds.has(f.wallId) ? frames.get(f.wallId) : undefined
      if (!old) cycle.push(f)
      else cycle.push(...mapFace(r, f, old, pieces, newId))
    }
    return { ...r, cycle, diagonal: remapDiagonal(r, cycle) }
  })
  const elements = g.elements.map((el) => {
    const old = el.wallId && removeIds.has(el.wallId) ? frames.get(el.wallId) : undefined
    return old ? mapElement(el, old, pieces) : el
  })
  return { nodes: g.nodes, walls, rooms, elements }
}

// ---------- lay a wall without a duplicate ----------

/** A wall property set for a new wall (no id, no nodes, no faces). */
export type NewWallProps = Omit<StoredWall, 'id' | 'a' | 'b' | 'faces' | 'standalone'>

/** One wall that holds a span of a laid wall, in order from the first node to the second. */
export type LaidPiece = { wallId: string; /** true when the wall runs the same way as the laid wall */ forward: boolean; lengthCm: number }

type Cover = { wall: StoredWall; lo: number; hi: number; nLo: string; nHi: string; forward: boolean; length: number }

/**
 * Put a wall from node `na` to node `nb` into the graph, without a duplicate or an overlap:
 *   - an existing wall on the same line (both ends of the new wall within 1 cm of its centre line)
 *     is REUSED for the span that it covers; where an end of the new wall lies inside that wall, the
 *     wall is cut there (its faces and elements follow, `rewireWalls`);
 *   - a span that no wall covers gets a new wall with `props` (`standalone` as given).
 * `opts.cut: false` reuses a wall for the span it covers without cutting it.
 * Gives the pieces in order from `na` to `nb`, and `changed` = false when the graph was not touched.
 */
export function layWall(
  g: GraphParts,
  na: string,
  nb: string,
  props: NewWallProps,
  standalone: boolean,
  newId: NewId,
  opts: { cut?: boolean } = {},
): { g: GraphParts; pieces: LaidPiece[]; changed: boolean } {
  const pos = nodeMap(g.nodes)
  const pa = pos.get(na)
  const pb = pos.get(nb)
  if (!pa || !pb || na === nb) return { g, pieces: [], changed: false }
  const length = dist(pa, pb)
  if (length < EPS) return { g, pieces: [], changed: false }
  const d = { x: (pb.x - pa.x) / length, y: (pb.y - pa.y) / length }
  const t = (p: Vec) => dot(sub(p, pa), d)
  let cur = g
  let changed = false

  /** The walls of the graph on the line of the new wall that overlap its span by more than 1 cm. */
  const collinear = (graph: GraphParts) => {
    const map = nodeMap(graph.nodes)
    const out: { wall: StoredWall; t0: number; t1: number; a: Vec; b: Vec; fr: Frame }[] = []
    for (const w of graph.walls) {
      const fr = frameOf(map, w)
      if (!fr) continue
      const a = map.get(w.a)!
      const b = map.get(w.b)!
      // Both ends of the new wall on the centre line of the wall, and both ends of the wall on the new line.
      const offOf = (p: Vec) => Math.abs(cross(fr.d, sub(p, fr.a)))
      if (offOf(pa) > WALL_TOL_CM || offOf(pb) > WALL_TOL_CM) continue
      if (Math.abs(cross(d, sub(a, pa))) > WALL_TOL_CM || Math.abs(cross(d, sub(b, pa))) > WALL_TOL_CM) continue
      const ta = t(a)
      const tb = t(b)
      const t0 = Math.min(ta, tb)
      const t1 = Math.max(ta, tb)
      if (Math.min(length, t1) - Math.max(0, t0) <= WALL_TOL_CM) continue
      out.push({ wall: w, t0, t1, a, b, fr })
    }
    return out
  }

  // 1. Cut the walls that hold an end of the new wall in their middle (`cut: false` keeps every wall
  //    whole: a wall that a room uses keeps its faces, so the labels of the room do not move).
  for (const host of opts.cut === false ? [] : collinear(cur)) {
    const cuts: { u: number; node: string }[] = []
    const u = (p: Vec) => dot(sub(p, host.fr.a), host.fr.d)
    if (host.t0 < -WALL_TOL_CM && host.t1 > WALL_TOL_CM) cuts.push({ u: u(pa), node: na })
    if (host.t0 < length - WALL_TOL_CM && host.t1 > length + WALL_TOL_CM) cuts.push({ u: u(pb), node: nb })
    if (!cuts.length) continue
    cuts.sort((x, y) => x.u - y.u)
    const chain = [host.wall.a, ...cuts.map((c) => c.node), host.wall.b]
    const parts: StoredWall[] = []
    for (let i = 0; i + 1 < chain.length; i++) {
      parts.push({ ...host.wall, id: i === 0 ? host.wall.id : newId('W'), a: chain[i], b: chain[i + 1], faces: [] })
    }
    cur = rewireWalls(cur, new Set([host.wall.id]), parts, newId)
    changed = true
  }

  // 2. The spans that wall already hold are reused; the gaps get a new wall.
  const map = nodeMap(cur.nodes)
  const covers: Cover[] = collinear(cur).map((c) => {
    const forward = t(c.a) <= t(c.b)
    return {
      wall: c.wall,
      lo: Math.max(0, c.t0),
      hi: Math.min(length, c.t1),
      nLo: c.t0 < 0 ? na : forward ? c.wall.a : c.wall.b,
      nHi: c.t1 > length ? nb : forward ? c.wall.b : c.wall.a,
      forward,
      length: c.fr.length,
    }
  })
  covers.sort((x, y) => x.lo - y.lo || y.hi - x.hi)
  const pieces: LaidPiece[] = []
  const added: StoredWall[] = []
  const gap = (from: string, to: string) => {
    if (from === to) return
    const p = map.get(from)
    const q = map.get(to)
    if (!p || !q || dist(p, q) < EPS) return
    const wall: StoredWall = { ...props, id: newId('W'), a: from, b: to, faces: [] }
    if (standalone) wall.standalone = true
    added.push(wall)
    pieces.push({ wallId: wall.id, forward: true, lengthCm: dist(p, q) })
  }
  let cursorT = 0
  let cursorNode = na
  for (const c of covers) {
    if (c.lo > cursorT + WALL_TOL_CM) {
      gap(cursorNode, c.nLo)
      cursorT = c.lo
      cursorNode = c.nLo
    }
    if (c.hi > cursorT + EPS) {
      pieces.push({ wallId: c.wall.id, forward: c.forward, lengthCm: c.length })
      cursorT = c.hi
      cursorNode = c.nHi
    }
  }
  if (length - cursorT > WALL_TOL_CM) gap(cursorNode, nb)
  if (added.length) {
    cur = { ...cur, walls: [...cur.walls, ...added] }
    changed = true
  }
  return { g: cur, pieces, changed }
}
