// The wall graph DERIVED from the rooms (docs/walls-plan.md, phase 1). Pure, cm, y points down.
//
// Each room is a polygon with its own wall props, so the wall between two rooms is drawn two
// times. `buildWallGraph` groups those copies into ONE wall, with the same rules as the global
// solver (`src/features/rooms/globalSolve.ts`, sections "edges" and "walls"):
//   - two facing room walls (opposite sides, overlap > 20 cm, distance <= pairTolCm) are one wall,
//     nearest pairs first. Any direction: the two walls must be parallel within 2 degrees
//     (docs/walls-plan.md phase 4b), so a wall at an angle is one wall too;
//   - two in-line consecutive walls of one room are one wall (horizontal or vertical only, to keep
//     the stored ids of a wall at an angle when a corner is added on it).
// The centre line of a grouped wall is the mean of the drawn lines, its thickness is the max of
// the copies, and its properties come from the room first in the walk order.
//
// Each side of a wall is cut into faces: one face per room that sees that side (a T junction gives
// several faces on one side), and an outside face (no roomId) where no room is drawn.
//
// No document change: the graph is calculated from `room.vertices` at every call.

import { DEFAULT_WALL_CM, add, dist, dot, mul, roomWalls, sub } from './geometry'
import type { Room, Vec, WallAlign, WallProps, WallStatus, WallType } from './types'

export type WallGraphOptions = {
  /** Two facing walls of two rooms closer than this (cm) are the same wall. Default 35. */
  pairTolCm?: number
  /** Walls grouped into one wall must be this close when they fall on the same side (cm). Default 4. */
  alignTolCm?: number
}

export type GraphNode = { id: string; x: number; y: number }

/** One wall of the plan: one centre line, one thickness, one set of properties. */
export type GraphWall = {
  id: string
  /** Node id of the start of the wall (distance 0). */
  a: string
  /** Node id of the end of the wall. */
  b: string
  type: WallType
  thicknessCm: number
  locked?: boolean
  status?: WallStatus
  align?: WallAlign
}

/** One side of one wall, seen from one room (no roomId = outside). */
export type GraphFace = {
  wallId: string
  /** L = left of the direction a -> b, R = right of it. */
  side: 'L' | 'R'
  roomId?: string
  /** Distance along the wall from node a to the start of the face, cm. */
  from: number
  /** Distance along the wall from node a to the end of the face, cm. */
  to: number
}

/** The faces of one room wall (keyed by its start vertex id), in polygon order. */
export type RoomFaceRef = { wallStart: string; faceIndexes: number[] }

export type GraphConflict = {
  kind: 'same-side-overlap' | 'unpaired-near'
  /** The two rooms of the two room walls that make the conflict. */
  roomIds: string[]
  detail: string
}

export type WallGraph = {
  nodes: GraphNode[]
  walls: GraphWall[]
  faces: GraphFace[]
  /** For each room, one entry per room wall, in polygon order. */
  roomFaces: Record<string, RoomFaceRef[]>
  conflicts: GraphConflict[]
}

const DEFAULTS: Required<WallGraphOptions> = { pairTolCm: 35, alignTolCm: 4 }

/** Two facing walls must share at least this length to be one wall (cm). Same as the solver. */
const MIN_OVERLAP_CM = 20
/**
 * Two walls are parallel when the angle between their normals is under 2 degrees (cosine above
 * this). Walls at any angle follow the same rules as horizontal and vertical ones, so a wall drawn
 * two times (once per room) is one wall in every direction (docs/walls-plan.md phase 4b).
 */
const PARALLEL_TOL = Math.cos((2 * Math.PI) / 180)
/** Two wall ends closer than this are one node (cm). */
const NODE_TOL_CM = 1
/** A wall end closer than this to another wall's centre line is a T junction (cm). */
const T_TOL_CM = 1
/** Two in-line walls of one room are one wall when their lines are this close (cm). */
const IN_LINE_TOL_CM = 1
/** Two faces of one room that touch within this are one face (cm). */
const CONTIG_TOL_CM = 1
/** Lengths closer than this are equal (cm). */
const EPS = 1e-6

/** Wall props of a room wall with no value. Same default as `wallProps` in the room feature. */
const DEFAULT_PROPS: WallProps = { type: 'partition', thicknessCm: DEFAULT_WALL_CM }

type Orient = 'h' | 'v' | 'o'

/** One wall of one room (one edge of a room outline). */
type Edge = {
  /** Unique key of this room wall: room id + start vertex id. */
  key: string
  /** Position of the room in the walk order. */
  roomIndex: number
  room: Room
  /** Index of the wall in the room polygon (0-based). */
  index: number
  startId: string
  endId: string
  start: Vec
  end: Vec
  length: number
  orient: Orient
  /** Offset of the drawn centre line along the inward normal of this room: inward . start. */
  c: number
  thicknessCm: number
  props: WallProps
  dir: Vec
  inward: Vec
}

/** A wall while it is built: its members, its line and its extent. */
type Draft = {
  members: Edge[]
  orient: Orient
  /** Point of the line at distance 0 along the wall. */
  origin: Vec
  dir: Vec
  /** Distance along the line of the two end nodes. */
  uLo: number
  uHi: number
  thicknessCm: number
  props: WallProps
  id: string
}

type DraftFace = {
  roomId?: string
  side: 'L' | 'R'
  from: number
  to: number
  /** Room walls that make this face (2 or more after a merge of in-line walls). */
  sources: { roomIndex: number; index: number }[]
}

type Pair = { d: number; a: number; b: number; overlap: number }

const cmpStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/** Room walk order, then code, then id: the same order for the same rooms in any array order. */
const orderRooms = (a: Room, b: Room) =>
  a.walkOrder - b.walkOrder || cmpStr(a.code, b.code) || cmpStr(a.id, b.id)

/** Round a length for output (0.001 cm = 10 µm: no visible float noise). */
const round = (v: number) => Math.round(v * 1000) / 1000

const fmt = (v: number) => String(Math.round(v * 10) / 10).replace('.', ',')

/** Mean of a list of numbers (0 for an empty list). */
const mean = (v: number[]) => (v.length ? v.reduce((s, x) => s + x, 0) / v.length : 0)

/**
 * The wall graph of a set of rooms: nodes, walls, faces per side and the room wall -> face map.
 * Pure and deterministic: the same rooms give the same ids and the same order, in any array order.
 */
export function buildWallGraph(rooms: Room[], opts: WallGraphOptions = {}): WallGraph {
  const o = { ...DEFAULTS, ...opts }
  const ordered = [...rooms].sort(orderRooms)

  // ---- edges: one per room wall ----
  const edges: Edge[] = []
  /** Edge index per room and per wall index of the room polygon; -1 for a zero-length wall. */
  const edgeOfRoom: number[][] = []
  ordered.forEach((r, ri) => {
    const idx: number[] = []
    roomWalls(r).forEach((w, i) => {
      if (w.length < EPS) {
        idx[i] = -1
        return
      }
      const dx = w.end.x - w.start.x, dy = w.end.y - w.start.y
      const props = r.walls[w.start.id] ?? DEFAULT_PROPS
      const orient: Orient = Math.abs(dx) / w.length < 0.02 ? 'v' : Math.abs(dy) / w.length < 0.02 ? 'h' : 'o'
      idx[i] = edges.length
      edges.push({
        key: `${r.id}:${w.start.id}`,
        roomIndex: ri,
        room: r,
        index: i,
        startId: w.start.id,
        endId: w.end.id,
        start: w.start,
        end: w.end,
        length: w.length,
        orient,
        c: w.inward.x * w.start.x + w.inward.y * w.start.y,
        thicknessCm: props.thicknessCm,
        props,
        dir: w.dir,
        inward: w.inward,
      })
    })
    edgeOfRoom.push(idx)
  })

  // ---- walls: union of the room walls that are the same wall ----
  // Same rule as the solver: nearest candidate pairs first; a merge is refused when the wall would
  // get two faces on one side that are not in line.
  const parent = edges.map((_, i) => i)
  const groupOf = edges.map((_, i) => [i])
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  /** Distance between the drawn lines of two parallel walls (cm). */
  const lineGap = (A: Edge, B: Edge) => Math.abs(A.inward.x * B.start.x + A.inward.y * B.start.y - A.c)
  /** True when the two walls face each other (their room sides are opposite). */
  const facing = (A: Edge, B: Edge) => A.inward.x * B.inward.x + A.inward.y * B.inward.y < 0
  const fits = (ga: number[], gb: number[]) => ga.every((a) => gb.every((b) => {
    const A = edges[a], B = edges[b]
    const d = lineGap(A, B)
    return facing(A, B) ? d <= o.pairTolCm : d <= o.alignTolCm
  }))
  const union = (a: number, b: number) => {
    const ra = find(a), rb = find(b)
    if (ra === rb || !fits(groupOf[ra], groupOf[rb])) return
    parent[ra] = rb
    groupOf[rb].push(...groupOf[ra])
  }

  /** Length of B that lies over A, along the direction of A (cm). */
  const overlapAlong = (A: Edge, B: Edge) => {
    const u1 = dot(sub(B.start, A.start), A.dir)
    const u2 = dot(sub(B.end, A.start), A.dir)
    return Math.min(A.length, Math.max(u1, u2)) - Math.max(0, Math.min(u1, u2))
  }
  const pairs: Pair[] = []
  const facingPairs: Pair[] = []
  const onSameSide: Pair[] = []
  for (let a = 0; a < edges.length; a++) {
    const A = edges[a]
    for (let b = a + 1; b < edges.length; b++) {
      const B = edges[b]
      if (B.roomIndex === A.roomIndex) continue
      // Parallel within 2 degrees: a wall at any angle pairs like a horizontal or vertical one.
      if (Math.abs(A.inward.x * B.inward.x + A.inward.y * B.inward.y) < PARALLEL_TOL) continue
      const d = lineGap(A, B)
      if (d > o.pairTolCm) continue
      const overlap = overlapAlong(A, B)
      if (overlap <= MIN_OVERLAP_CM) continue
      const pair: Pair = { d, a, b, overlap }
      if (facing(A, B)) {
        // Opposite sides: the wall is between the two rooms.
        facingPairs.push(pair)
        pairs.push(pair)
      } else onSameSide.push(pair)
    }
  }
  // Two walls of one room in line (a straight corner) are one wall. LIMIT: only for a wall drawn
  // horizontal or vertical, as before phase 4b: a corner added on a wall at an angle keeps its two
  // parts, so the stored ids of that wall stay stable (see storedGraph.ts).
  edgeOfRoom.forEach((idx) => {
    idx.forEach((ei, i) => {
      const ej = idx[(i + 1) % idx.length]
      if (ei === undefined || ej === undefined || ei < 0 || ej < 0) return
      const A = edges[ei], B = edges[ej]
      if (A.orient === 'o' || A.orient !== B.orient) return
      if (lineGap(A, B) >= IN_LINE_TOL_CM) return
      pairs.push({ d: 0, a: Math.min(ei, ej), b: Math.max(ei, ej), overlap: 0 })
    })
  })
  // A pair of walls on the same side is never merged: it is a conflict, and the union refuses it.
  pairs.sort((p, q) => p.d - q.d || p.a - q.a || p.b - q.b)
  pairs.forEach((p) => union(p.a, p.b))

  const walls: Draft[] = []
  const wallOfRoot = new Map<number, number>()
  edges.forEach((e, i) => {
    const root = find(i)
    const known = wallOfRoot.get(root)
    if (known === undefined) {
      wallOfRoot.set(root, walls.length)
      walls.push({ members: [e], orient: e.orient, origin: e.start, dir: e.dir, uLo: 0, uHi: 0, thicknessCm: e.thicknessCm, props: e.props, id: '' })
    } else walls[known].members.push(e)
  })

  const along = (w: Draft, p: Vec) => dot(sub(p, w.origin), w.dir)
  const pointAt = (w: Draft, u: number) => add(w.origin, mul(w.dir, u))

  for (const w of walls) {
    const first = w.members[0]
    // Normal of the wall: the axis normal of a wall drawn horizontal or vertical, else the inward
    // normal of its first room wall. The centre line is the MEAN of the drawn lines, in every
    // direction (docs/walls-plan.md phase 4b).
    const n = first.orient === 'h' ? { x: 0, y: 1 } : first.orient === 'v' ? { x: 1, y: 0 } : first.inward
    const offset = mean(w.members.map((m) => {
      // +1 when the room of this member lies on the side of the normal n.
      const s = m.inward.x * n.x + m.inward.y * n.y >= 0 ? 1 : -1
      return s * m.c
    }))
    if (first.orient === 'h') {
      // y is constant: the centre line is the mean of the drawn lines.
      w.dir = { x: 1, y: 0 }
      w.origin = { x: 0, y: offset }
    } else if (first.orient === 'v') {
      w.dir = { x: 0, y: 1 }
      w.origin = { x: offset, y: 0 }
    } else {
      // Any direction: the line n . p = offset, with the first room wall starting at distance 0.
      w.dir = first.dir
      w.origin = add(mul(n, offset), mul(first.dir, dot(first.start, first.dir)))
    }
    let uLo = Infinity, uHi = -Infinity
    for (const m of w.members) {
      const u1 = along(w, m.start), u2 = along(w, m.end)
      uLo = Math.min(uLo, u1, u2)
      uHi = Math.max(uHi, u1, u2)
    }
    w.uLo = uLo
    w.uHi = uHi
    // Thickness of a shared wall: the max of the copies. Properties: from the first room in the
    // walk order (the "owner" of the wall).
    w.thicknessCm = Math.max(...w.members.map((m) => m.thicknessCm))
    w.props = w.members.reduce((best, m) => (m.roomIndex < best.roomIndex ? m : best)).props
    w.id = `w:${w.members.map((m) => m.key).sort(cmpStr).join('+')}`
  }

  // ---- nodes: one node where wall ends meet (within NODE_TOL_CM) ----
  type Cand = { pos: Vec; keys: string[] }
  const cands: Cand[] = []
  for (const w of walls) {
    for (const u of [w.uLo, w.uHi]) {
      const keys: string[] = []
      for (const m of w.members) {
        const us = along(w, m.start), ue = along(w, m.end)
        const ds = Math.abs(us - u), de = Math.abs(ue - u)
        if (Math.min(ds, de) > NODE_TOL_CM) continue
        keys.push(`${m.room.id}:${ds <= de ? m.startId : m.endId}`)
      }
      cands.push({ pos: pointAt(w, u), keys })
    }
  }
  const clusters: { pos: Vec; keys: Set<string> }[] = []
  const clusterOfCand: number[] = cands.map(() => -1)
  const candOrder = cands
    .map((_, i) => i)
    .sort((i, j) => cands[i].pos.x - cands[j].pos.x || cands[i].pos.y - cands[j].pos.y || cmpStr(cands[i].keys.join('+'), cands[j].keys.join('+')))
  for (const i of candOrder) {
    const c = cands[i]
    const hit = clusters.findIndex((k) => dist(k.pos, c.pos) <= NODE_TOL_CM)
    if (hit >= 0) c.keys.forEach((k) => clusters[hit].keys.add(k))
    else clusters.push({ pos: c.pos, keys: new Set(c.keys) })
    clusterOfCand[i] = hit >= 0 ? hit : clusters.length - 1
  }
  const nodes: GraphNode[] = clusters.map((c) => ({
    id: `n:${[...c.keys].sort(cmpStr).join('+')}`,
    x: round(c.pos.x),
    y: round(c.pos.y),
  }))
  // Candidate 2 * wall + end belongs to the a end (0) or the b end (1).
  const endNode = (wall: number, end: 0 | 1) => nodes[clusterOfCand[2 * wall + end]].id

  // ---- faces: one per room that sees a side, plus outside faces ----
  const faces: GraphFace[] = []
  /** Face indexes per edge index. */
  const faceOfEdge = new Map<number, number[]>()

  walls.forEach((w) => {
    const length = w.uHi - w.uLo
    const left = { x: -w.dir.y, y: w.dir.x }
    // T junctions: nodes that lie ON this wall (not at its ends) cut its faces.
    const cuts: number[] = []
    for (const c of clusters) {
      const rel = sub(c.pos, w.origin)
      if (Math.abs(dot(rel, left)) > T_TOL_CM) continue
      const u = dot(rel, w.dir) - w.uLo
      if (u > NODE_TOL_CM && u < length - NODE_TOL_CM) cuts.push(u)
    }
    const drafts: Record<'L' | 'R', DraftFace[]> = { L: [], R: [] }
    for (const m of w.members) {
      const u1 = along(w, m.start), u2 = along(w, m.end)
      const from = Math.max(0, Math.min(u1, u2) - w.uLo)
      const to = Math.min(length, Math.max(u1, u2) - w.uLo)
      if (to - from < EPS) continue
      // The room lies on the side of the inward normal of its wall.
      const side: 'L' | 'R' = dot(m.inward, left) >= 0 ? 'L' : 'R'
      drafts[side].push({ roomId: m.room.id, side, from, to, sources: [{ roomIndex: m.roomIndex, index: m.index }] })
    }
    for (const side of ['L', 'R'] as const) {
      for (const f of fillGaps(mergeFaces(drafts[side], cuts), length, side)) {
        const fi = faces.length
        faces.push(
          f.roomId === undefined
            ? { wallId: w.id, side, from: round(f.from), to: round(f.to) }
            : { wallId: w.id, side, roomId: f.roomId, from: round(f.from), to: round(f.to) },
        )
        for (const s of f.sources) {
          const ei = edgeOfRoom[s.roomIndex]?.[s.index] ?? -1
          if (ei < 0) continue
          const known = faceOfEdge.get(ei)
          if (known) known.push(fi)
          else faceOfEdge.set(ei, [fi])
        }
      }
    }
  })

  // ---- room wall -> its face(s) ----
  const roomFaces: Record<string, RoomFaceRef[]> = {}
  ordered.forEach((r, ri) => {
    roomFaces[r.id] = (edgeOfRoom[ri] ?? []).map((ei, i) => ({
      wallStart: r.vertices[i]?.id ?? '',
      faceIndexes: ei < 0 ? [] : [...(faceOfEdge.get(ei) ?? [])].sort((p, q) => p - q),
    }))
  })

  // ---- conflicts: pairs the grouping could not make one wall ----
  const label = (e: Edge) => `${e.room.code}-${e.index + 1}`
  const roomIdsOf = (A: Edge, B: Edge) => (A.roomIndex <= B.roomIndex ? [A.room.id, B.room.id] : [B.room.id, A.room.id])
  const conflicts: GraphConflict[] = []
  for (const p of onSameSide) {
    const A = edges[p.a], B = edges[p.b]
    conflicts.push({
      kind: 'same-side-overlap',
      roomIds: roomIdsOf(A, B),
      detail: `${label(A)} and ${label(B)} are on the same side: ${fmt(p.overlap)} cm of overlap, ${fmt(p.d)} cm apart`,
    })
  }
  for (const p of facingPairs) {
    const A = edges[p.a], B = edges[p.b]
    if (find(p.a) === find(p.b)) continue
    conflicts.push({
      kind: 'unpaired-near',
      roomIds: roomIdsOf(A, B),
      detail: `${label(A)} and ${label(B)} face each other (${fmt(p.overlap)} cm of overlap, ${fmt(p.d)} cm apart) but are not one wall`,
    })
  }

  return { nodes, walls: walls.map((w, wi) => graphWall(w, endNode(wi, 0), endNode(wi, 1))), faces, roomFaces, conflicts }
}

/** Public wall record: no internal fields, no `undefined` optional keys. */
function graphWall(w: Draft, a: string, b: string): GraphWall {
  const out: GraphWall = { id: w.id, a, b, type: w.props.type, thicknessCm: w.thicknessCm }
  if (w.props.locked !== undefined) out.locked = w.props.locked
  if (w.props.status !== undefined) out.status = w.props.status
  if (w.props.align !== undefined) out.align = w.props.align
  return out
}

/**
 * Faces of one side of one wall, in order: faces of one room that touch (or overlap) are one
 * face; two rooms that cover the same stretch are cut at the nearest T junction node.
 */
function mergeFaces(list: DraftFace[], cuts: number[]): DraftFace[] {
  const sorted = [...list].sort((p, q) =>
    p.from - q.from ||
    q.to - p.to ||
    (p.roomId === undefined ? 1 : 0) - (q.roomId === undefined ? 1 : 0) ||
    cmpStr(p.roomId ?? '', q.roomId ?? ''))
  const out: DraftFace[] = []
  for (const f of sorted) {
    const last = out[out.length - 1]
    if (!last) {
      out.push({ ...f, sources: [...f.sources] })
      continue
    }
    if (f.roomId === last.roomId && f.from <= last.to + CONTIG_TOL_CM) {
      last.to = Math.max(last.to, f.to)
      last.sources.push(...f.sources)
      continue
    }
    if (f.from < last.to - EPS) {
      // Two different rooms on the same side of the same wall: the T junction (or the middle)
      // gives each of them its own face.
      const mid = (f.from + last.to) / 2
      const near = cuts.filter((c) => c > f.from - EPS && c < last.to + EPS)
      const cut = near.length ? near.reduce((best, c) => (Math.abs(c - mid) < Math.abs(best - mid) ? c : best)) : mid
      last.to = Math.min(last.to, cut)
      f.from = Math.max(f.from, cut)
      if (f.to - f.from < EPS) continue
    }
    out.push({ ...f, sources: [...f.sources] })
  }
  return out
}

/** The faces that no room covers have no roomId: they are outside (facade). */
function fillGaps(merged: DraftFace[], length: number, side: 'L' | 'R'): DraftFace[] {
  const out: DraftFace[] = []
  let cursor = 0
  for (const f of merged) {
    if (f.from > cursor + CONTIG_TOL_CM) out.push({ side, from: cursor, to: f.from, sources: [] })
    out.push(f)
    cursor = Math.max(cursor, f.to)
  }
  if (cursor < length - CONTIG_TOL_CM) out.push({ side, from: cursor, to: length, sources: [] })
  return out
}
