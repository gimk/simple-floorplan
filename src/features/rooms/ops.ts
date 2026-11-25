// Pure document operations for rooms (cm). No React here.
import polygonClipping from 'polygon-clipping'
import { area, dist, dot, norm, pointInPolygon, projectOnSegment, signedArea, sub } from '../../model/geometry'
import { nextRoomCode } from '../../model/survey'
import { uid, nowIso } from '../../model/store'
import type { PlanDoc, Room, Vec, Vertex, WallElement, WallProps } from '../../model/types'
import { deleteStorage } from '../storage/actions'

const EPS = 0.05

export type Ring = Vec[]
/** [outer, ...holes] */
export type Piece = Ring[]

const toRing = (pts: Vec[]): [number, number][] => pts.map((p) => [p.x, p.y])
const fromRing = (r: [number, number][]): Ring => r.slice(0, -1).map(([x, y]) => ({ x, y }))

export const roomPolygon = (r: Room): [number, number][][] => [toRing(r.vertices), ...r.holes.map(toRing)]

const fromMulti = (m: ReturnType<typeof polygonClipping.union>): Piece[] => m.map((poly) => poly.map(fromRing))

const pieceArea = (p: Piece) => area(p[0]) - p.slice(1).reduce((s, h) => s + area(h), 0)

export const maxWalkOrder = (d: PlanDoc) => d.rooms.reduce((m, r) => Math.max(m, r.walkOrder), 0)

/** Build a new room from outline points. */
export function makeRoom(doc: PlanDoc, pts: Vec[]): Room {
  const code = nextRoomCode(doc)
  const n = Number(code.replace(/\D/g, '')) || doc.rooms.length + 1
  return {
    id: uid('room'),
    code,
    name: `Room ${n}`,
    vertices: pts.map((p) => ({ id: uid('v'), x: p.x, y: p.y })),
    holes: [],
    walls: {},
    walkOrder: maxWalkOrder(doc) + 1,
    diagonal: pts.length === 4 ? [0, 2] : undefined,
  }
}

export const rectPoints = (a: Vec, b: Vec): Vec[] => [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }]

/** Perimeter in cm. */
export const perimeter = (pts: Vec[]) => pts.reduce((s, p, i) => s + dist(p, pts[(i + 1) % pts.length]), 0)

/** Valid simple-enough polygon: >= 3 points and some area. */
export const validOutline = (pts: Vec[]) => pts.length >= 3 && area(pts) > 100

// ---------- vertex ops ----------

const remapDiagonal = (old: Room, vertices: Vertex[]): [number, number] | undefined => {
  if (!old.diagonal) return vertices.length === 4 ? [0, 2] : undefined
  const ids = old.diagonal.map((i) => old.vertices[i]?.id)
  const idx = ids.map((id) => vertices.findIndex((v) => v.id === id))
  if (idx.some((i) => i < 0)) return vertices.length === 4 ? [0, 2] : undefined
  return [idx[0], idx[1]]
}

/** Remove a vertex (min 3 vertices). Drops the wall that started there and its elements. */
export function removeVertex(doc: PlanDoc, roomId: string, vertexId: string): PlanDoc {
  const room = doc.rooms.find((r) => r.id === roomId)
  if (!room || room.vertices.length <= 3 || !room.vertices.some((v) => v.id === vertexId)) return doc
  const vertices = room.vertices.filter((v) => v.id !== vertexId)
  const walls = { ...room.walls }
  delete walls[vertexId]
  const next: Room = { ...room, vertices, walls, diagonal: remapDiagonal(room, vertices) }
  return {
    ...doc,
    rooms: doc.rooms.map((r) => (r.id === roomId ? next : r)),
    elements: doc.elements.filter((e) => !(e.roomId === roomId && e.wallStart === vertexId)),
  }
}

/** Insert a vertex on the wall starting at `wallStart`, at `point` (projected on the wall). Returns new doc + new id. */
export function insertVertex(doc: PlanDoc, roomId: string, wallStart: string, point: Vec): { doc: PlanDoc; vertexId: string } | null {
  const room = doc.rooms.find((r) => r.id === roomId)
  if (!room) return null
  const i = room.vertices.findIndex((v) => v.id === wallStart)
  if (i < 0) return null
  const a = room.vertices[i], b = room.vertices[(i + 1) % room.vertices.length]
  const pr = projectOnSegment(point, a, b)
  const nv: Vertex = { id: uid('v'), x: pr.point.x, y: pr.point.y }
  const splitAt = dist(a, nv)
  const vertices = [...room.vertices.slice(0, i + 1), nv, ...room.vertices.slice(i + 1)]
  const walls = { ...room.walls }
  if (walls[wallStart]) walls[nv.id] = { ...walls[wallStart] }
  const diag = room.diagonal
    ? (room.diagonal.map((k) => (k > i ? k + 1 : k)) as [number, number])
    : undefined
  const next: Room = { ...room, vertices, walls, diagonal: diag }
  const elements = doc.elements.map((e) =>
    e.roomId === roomId && e.wallStart === wallStart && e.offsetCm >= splitAt - EPS
      ? { ...e, wallStart: nv.id, offsetCm: e.offsetCm - splitAt }
      : e)
  return { doc: { ...doc, rooms: doc.rooms.map((r) => (r.id === roomId ? next : r)), elements }, vertexId: nv.id }
}

export function deleteRoom(doc: PlanDoc, roomId: string): PlanDoc {
  let next = doc
  for (const r of doc.rooms) {
    if (r.storage?.parentRoomId === roomId) {
      next = deleteStorage(next, r.id)
    }
  }
  return { ...next, rooms: next.rooms.filter((r) => r.id !== roomId), elements: next.elements.filter((e) => e.roomId !== roomId) }
}

/** Rename a room code and migrate survey data keyed by it. */
export function setRoomCode(doc: PlanDoc, roomId: string, code: string): PlanDoc {
  const room = doc.rooms.find((r) => r.id === roomId)
  if (!room || room.code === code || !code || doc.rooms.some((r) => r.id !== roomId && r.code === code)) return doc
  const old = room.code
  const measurements: PlanDoc['measurements'] = {}
  for (const [k, m] of Object.entries(doc.measurements)) {
    if (k.startsWith(old + '-')) {
      const nk = code + k.slice(old.length)
      measurements[nk] = { ...m, label: nk }
    } else measurements[k] = m
  }
  const roomNotes: PlanDoc['roomNotes'] = {}
  for (const [k, v] of Object.entries(doc.roomNotes)) roomNotes[k === old ? code : k] = v
  return { ...doc, rooms: doc.rooms.map((r) => (r.id === roomId ? { ...r, code } : r)), measurements, roomNotes }
}

// ---------- rebuild rooms from clipped pieces ----------

const same = (a: Vec, b: Vec) => Math.abs(a.x - b.x) < EPS * 2 && Math.abs(a.y - b.y) < EPS * 2

/** Orient `ring` the same way (cw/ccw) as `like`. */
const orient = (ring: Ring, like: Ring): Ring =>
  Math.sign(signedArea(ring)) === Math.sign(signedArea(like)) ? ring : [...ring].reverse()

/**
 * Ring points -> vertices. Reuses the id of an original vertex found at the same place, and
 * re-inserts original vertices that lie on a ring edge (polygon-clipping drops collinear points),
 * so vertex ids, wall props and element hosts survive a slice or cutout.
 */
export function ringToVertices(ring: Ring, originals: Vertex[]): Vertex[] {
  const used = new Set<string>()
  const base: Vertex[] = ring.map((p) => {
    const m = originals.find((v) => !used.has(v.id) && same(v, p))
    if (m) used.add(m.id)
    return { id: m ? m.id : uid('v'), x: p.x, y: p.y }
  })
  const out: Vertex[] = []
  base.forEach((a, i) => {
    out.push(a)
    const b = base[(i + 1) % base.length]
    const extra = originals
      .filter((v) => !used.has(v.id))
      .map((v) => ({ v, pr: projectOnSegment(v, a, b) }))
      .filter(({ v, pr }) => pr.distance < EPS * 2 && pr.t > 0 && pr.t < 1 && !same(v, a) && !same(v, b))
      .sort((x, y) => x.pr.t - y.pr.t)
    for (const { v } of extra) { used.add(v.id); out.push({ id: v.id, x: v.x, y: v.y }) }
  })
  return out
}

/** Find the original wall that contains the directed edge p->q. */
function originWall(room: Room, p: Vec, q: Vec): { start: Vertex; end: Vertex } | null {
  const n = room.vertices.length
  for (let i = 0; i < n; i++) {
    const a = room.vertices[i], b = room.vertices[(i + 1) % n]
    if (projectOnSegment(p, a, b).distance > EPS * 4 || projectOnSegment(q, a, b).distance > EPS * 4) continue
    if (dot(sub(q, p), sub(b, a)) > 0) return { start: a, end: b }
  }
  return null
}

/**
 * Replace `room` by one or more rooms described by `pieces` (outer ring + holes).
 * The largest piece keeps the room's identity; others become new rooms.
 * Wall props are kept for edges lying on an original wall; new edges are partitions.
 * Elements move with their wall when it still exists and still fits.
 */
export function rebuildRooms(doc: PlanDoc, room: Room, piecesIn: Piece[]): { doc: PlanDoc; roomIds: string[] } {
  const pieces = [...piecesIn].sort((a, b) => pieceArea(b) - pieceArea(a))
  const results: Room[] = []
  const elementMoves = new Map<string, WallElement | null>()
  let work: PlanDoc = { ...doc, rooms: doc.rooms.filter((r) => r.id !== room.id) }
  const oldHoleVerts = room.holes.flat()

  pieces.forEach((piece, pi) => {
    const outer = orient(piece[0], room.vertices)
    const vertices: Vertex[] = ringToVertices(outer, room.vertices)
    const holes: Vertex[][] = piece.slice(1).map((h) => ringToVertices(h, oldHoleVerts))
    const walls: Record<string, WallProps> = {}
    vertices.forEach((v, i) => {
      const w = originWall(room, v, vertices[(i + 1) % vertices.length])
      if (w && room.walls[w.start.id]) walls[v.id] = { ...room.walls[w.start.id] }
    })
    let base: Room
    if (pi === 0) base = { ...room, vertices, holes, walls, diagonal: undefined }
    else {
      const code = nextRoomCode({ ...work, rooms: [...work.rooms, ...results] })
      const n = Number(code.replace(/\D/g, '')) || work.rooms.length + results.length + 1
      base = {
        id: uid('room'), code, name: `Room ${n}`, vertices, holes, walls,
        ceilingCm: room.ceilingCm, outdoor: room.outdoor,
        walkOrder: Math.max(maxWalkOrder(work), ...results.map((r) => r.walkOrder)) + 1,
      }
    }
    base.diagonal = pi === 0 ? remapDiagonal(room, vertices) : vertices.length === 4 ? [0, 2] : undefined
    results.push(base)
  })

  // Elements: keep those whose host wall still exists and still contains them.
  for (const e of doc.elements.filter((x) => x.roomId === room.id)) {
    const host = room.vertices.find((v) => v.id === e.wallStart)
    const hostEnd = host && room.vertices[(room.vertices.indexOf(host) + 1) % room.vertices.length]
    let moved: WallElement | null = null
    if (host && hostEnd) {
      const dir = norm(sub(hostEnd, host))
      search: for (const r of results) {
        for (let i = 0; i < r.vertices.length; i++) {
          const p = r.vertices[i], q = r.vertices[(i + 1) % r.vertices.length]
          const ow = originWall(room, p, q)
          if (!ow || ow.start.id !== host.id) continue
          const shift = dot(sub(p, host), dir)
          const off = e.offsetCm - shift
          if (off >= -EPS && off + e.widthCm <= dist(p, q) + EPS) {
            moved = { ...e, roomId: r.id, wallStart: p.id, offsetCm: Math.max(0, off), updatedAt: nowIso() }
            break search
          }
        }
      }
    }
    elementMoves.set(e.id, moved)
  }
  const elements = doc.elements.flatMap((e) => {
    if (!elementMoves.has(e.id)) return [e]
    const m = elementMoves.get(e.id)
    return m ? [m] : []
  })
  work = { ...work, rooms: [...work.rooms, ...results], elements }
  // Keep room order stable: put results where the original was.
  const idx = doc.rooms.findIndex((r) => r.id === room.id)
  const others = work.rooms.filter((r) => !results.includes(r))
  others.splice(Math.max(0, idx), 0, ...results)
  return { doc: { ...work, rooms: others }, roomIds: results.map((r) => r.id) }
}

// ---------- slice ----------

const BIG = 1e5

/** Split a room's pieces along the infinite line a-b. Returns null if the line does not cut the room. */
export function slicePieces(room: Room, a: Vec, b: Vec): Piece[] | null {
  if (dist(a, b) < 1) return null
  const d = norm(sub(b, a)), n = { x: -d.y, y: d.x }
  const half = (s: number): [number, number][][] => {
    const p0 = { x: a.x - d.x * BIG, y: a.y - d.y * BIG }, p1 = { x: a.x + d.x * BIG, y: a.y + d.y * BIG }
    const q = (p: Vec) => [p.x + n.x * BIG * s, p.y + n.y * BIG * s] as [number, number]
    return [[[p0.x, p0.y], [p1.x, p1.y], q(p1), q(p0), [p0.x, p0.y]]]
  }
  const poly = roomPolygon(room)
  const pieces = [...fromMulti(polygonClipping.intersection(poly, half(1))), ...fromMulti(polygonClipping.intersection(poly, half(-1)))]
    .filter((p) => pieceArea(p) > 1)
  return pieces.length >= 2 ? pieces : null
}

/** Slice the best room crossed by line a-b. Returns the new doc and ids, or null. */
export function sliceDoc(doc: PlanDoc, a: Vec, b: Vec): { doc: PlanDoc; roomIds: string[] } | null {
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  const ordered = [...doc.rooms].sort((r1, r2) => Number(pointInPolygon(mid, r2.vertices)) - Number(pointInPolygon(mid, r1.vertices)))
  for (const room of ordered) {
    if (!segmentTouchesRoom(room, a, b)) continue
    const pieces = slicePieces(room, a, b)
    if (pieces) return rebuildRooms(doc, room, pieces)
  }
  return null
}

const segCross = (p: Vec, q: Vec, r: Vec, s: Vec) => {
  const d1 = sub(q, p), d2 = sub(s, r), den = d1.x * d2.y - d1.y * d2.x
  if (Math.abs(den) < 1e-9) return false
  const w = sub(r, p), t = (w.x * d2.y - w.y * d2.x) / den, u = (w.x * d1.y - w.y * d1.x) / den
  return t >= 0 && t <= 1 && u >= 0 && u <= 1
}

function segmentTouchesRoom(room: Room, a: Vec, b: Vec): boolean {
  if (pointInPolygon(a, room.vertices) || pointInPolygon(b, room.vertices)) return true
  const v = room.vertices
  return v.some((p, i) => segCross(a, b, p, v[(i + 1) % v.length]))
}

// ---------- cutout ----------

/** Subtract `cut` from one room. Returns pieces (outline reshaped, hole added, or split) or null if nothing changes / nothing remains. */
export function cutPieces(room: Room, cut: Ring): Piece[] | null {
  if (!validOutline(cut)) return null
  const poly = roomPolygon(room)
  const overlap = polygonClipping.intersection(poly, [toRing(cut)])
  if (!overlap.length || fromMulti(overlap).reduce((s, p) => s + pieceArea(p), 0) < 1) return null
  const pieces = fromMulti(polygonClipping.difference(poly, [toRing(cut)])).filter((p) => pieceArea(p) > 1)
  return pieces.length ? pieces : null
}

/** Cut a ring out of every room it overlaps. */
export function cutDoc(doc: PlanDoc, cut: Ring): { doc: PlanDoc; roomIds: string[] } | null {
  let cur = doc, ids: string[] = [], changed = false
  for (const room of doc.rooms) {
    const pieces = cutPieces(room, cut)
    if (!pieces) continue
    const r = rebuildRooms(cur, room, pieces)
    cur = r.doc; ids = [...ids, ...r.roomIds]; changed = true
  }
  return changed ? { doc: cur, roomIds: ids } : null
}

// ---------- shared corners ----------

export type VRef = { roomId: string; vertexId: string }

/** Outline vertices of OTHER rooms at the same position (within `tol` cm) as the given vertex. */
export function linkedVertices(doc: Pick<PlanDoc, 'rooms'>, roomId: string, vertexId: string, tol = 0.5): VRef[] {
  const v = doc.rooms.find((r) => r.id === roomId)?.vertices.find((x) => x.id === vertexId)
  if (!v) return []
  const out: VRef[] = []
  for (const r of doc.rooms) {
    if (r.id === roomId) continue
    for (const o of r.vertices) if (dist(o, v) <= tol) out.push({ roomId: r.id, vertexId: o.id })
  }
  return out
}

/** Is a wall that starts or ends at this vertex locked? */
export function vertexLocked(room: Room, vertexId: string): boolean {
  const n = room.vertices.length
  const i = room.vertices.findIndex((v) => v.id === vertexId)
  if (i < 0) return false
  return !!room.walls[vertexId]?.locked || !!room.walls[room.vertices[(i - 1 + n) % n].id]?.locked
}

/** Linked vertices that may follow a move (their own walls are not locked). */
export function movableLinked(doc: Pick<PlanDoc, 'rooms'>, roomId: string, vertexId: string): VRef[] {
  return linkedVertices(doc, roomId, vertexId).filter((ref) => {
    const rm = doc.rooms.find((r) => r.id === ref.roomId)
    return !!rm && !vertexLocked(rm, ref.vertexId)
  })
}

export type VMove = VRef & { x: number; y: number }

/** Move outline vertices to new positions in one pass. */
export function moveVertices(doc: PlanDoc, moves: VMove[]): PlanDoc {
  if (!moves.length) return doc
  const byRoom = new Map<string, Map<string, VMove>>()
  for (const m of moves) {
    if (!byRoom.has(m.roomId)) byRoom.set(m.roomId, new Map())
    byRoom.get(m.roomId)!.set(m.vertexId, m)
  }
  return {
    ...doc,
    rooms: doc.rooms.map((r) => {
      const mm = byRoom.get(r.id)
      if (!mm) return r
      return { ...r, vertices: r.vertices.map((v) => { const m = mm.get(v.id); return m ? { ...v, x: m.x, y: m.y } : v }) }
    }),
  }
}

// ---------- holes ----------

/** Move one hole vertex. */
export function moveHoleVertex(doc: PlanDoc, roomId: string, vertexId: string, to: Vec): PlanDoc {
  return {
    ...doc,
    rooms: doc.rooms.map((r) => r.id !== roomId ? r : {
      ...r, holes: r.holes.map((h) => h.map((v) => (v.id === vertexId ? { ...v, x: to.x, y: to.y } : v))),
    }),
  }
}

/** Remove a vertex from a hole (a hole keeps at least 3 vertices). */
export function removeHoleVertex(doc: PlanDoc, roomId: string, vertexId: string): PlanDoc {
  const room = doc.rooms.find((r) => r.id === roomId)
  if (!room) return doc
  const hi = room.holes.findIndex((h) => h.some((v) => v.id === vertexId))
  if (hi < 0 || room.holes[hi].length <= 3) return doc
  const holes = room.holes.map((h, i) => (i === hi ? h.filter((v) => v.id !== vertexId) : h))
  return { ...doc, rooms: doc.rooms.map((r) => (r.id === roomId ? { ...r, holes } : r)) }
}

/** Remove a whole hole. */
export function removeHole(doc: PlanDoc, roomId: string, holeIndex: number): PlanDoc {
  const room = doc.rooms.find((r) => r.id === roomId)
  if (!room || holeIndex < 0 || holeIndex >= room.holes.length) return doc
  const holes = room.holes.filter((_, i) => i !== holeIndex)
  return { ...doc, rooms: doc.rooms.map((r) => (r.id === roomId ? { ...r, holes } : r)) }
}
