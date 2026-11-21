// Pure command layer for PlanDoc mutations (zero React, zero DOM, zero store imports).
// Every command is validated with Zod and returns { doc, result, warnings }.
import polygonClipping from 'polygon-clipping'
import { z } from 'zod'
import {
  area,
  dist,
  dot,
  len,
  norm,
  pointInPolygon,
  projectOnSegment,
  roomAreaM2,
  roomWalls,
  signedArea,
  sub,
  type Wall,
} from '../model/geometry'
import { nextRoomCode, surveyIds } from '../model/survey'
import type { PlanDoc, Room, Vec, Vertex, WallElement, WallProps, WallType } from '../model/types'
import { defaultElement, overflows } from '../features/elements/geometry'
import { DEFAULT_THICKNESS, wallProps } from '../features/rooms/walls'
import { ElementKindSchema, ElementVariantSchema, parsePlan, type PlanDocV1, VecSchema, WallTypeSchema } from './schema'
import { findSharedWalls } from './queries'

const EPS = 0.05
const BIG = 1e5

export class CommandError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'CommandError'
    this.code = code
  }
}

export type CommandWarning = {
  code: string
  message: string
  details?: Record<string, unknown>
}

export type ApplyResult<T = Record<string, unknown>> = {
  doc: PlanDocV1
  result: T
  warnings: CommandWarning[]
}

// ---------- pure ID + time helpers ----------

function uid(prefix = ''): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`
  }
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}

const nowIso = (): string => new Date().toISOString()

// ---------- Zod schemas ----------

export const RectSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  w: z.number().finite().positive(),
  h: z.number().finite().positive(),
})

/** Wall reference: survey label "SE-2", { roomId, wallStart }, or { roomCode, wallIndex (1-based) }. */
export const WallRefSchema = z.union([
  z.string().min(1),
  z.object({ roomId: z.string().min(1), wallStart: z.string().min(1) }),
  z.object({ roomCode: z.string().min(1), wallIndex: z.number().int().min(1) }),
])

export type WallRef = z.infer<typeof WallRefSchema>

const AddRoomSchema = z
  .object({
    type: z.literal('add_room'),
    id: z.string().min(1).optional(),
    code: z.string().min(1).optional(),
    name: z.string().optional(),
    vertices: z.array(VecSchema).min(3).optional(),
    rect: RectSchema.optional(),
    ceilingCm: z.number().finite().positive().optional(),
    outdoor: z.boolean().optional(),
    walkOrder: z.number().finite().optional(),
  })
  .refine((v) => Boolean(v.vertices || v.rect), {
    message: 'add_room requires either vertices or rect',
  })

const UpdateRoomSchema = z
  .object({
    type: z.literal('update_room'),
    roomId: z.string().min(1).optional(),
    roomCode: z.string().min(1).optional(),
    name: z.string().optional(),
    code: z.string().min(1).optional(),
    ceilingCm: z.number().finite().positive().nullable().optional(),
    outdoor: z.boolean().optional(),
    walkOrder: z.number().finite().optional(),
  })
  .refine((v) => Boolean(v.roomId || v.roomCode), {
    message: 'update_room requires roomId or roomCode',
  })

const DeleteRoomSchema = z
  .object({
    type: z.literal('delete_room'),
    roomId: z.string().min(1).optional(),
    roomCode: z.string().min(1).optional(),
  })
  .refine((v) => Boolean(v.roomId || v.roomCode), {
    message: 'delete_room requires roomId or roomCode',
  })

const SliceRoomSchema = z.object({
  type: z.literal('slice_room'),
  roomId: z.string().min(1).optional(),
  roomCode: z.string().min(1).optional(),
  a: VecSchema,
  b: VecSchema,
  newRoomCode: z.string().min(1).optional(),
  newRoomName: z.string().optional(),
})

const CutoutRoomSchema = z
  .object({
    type: z.literal('cutout_room'),
    roomId: z.string().min(1).optional(),
    roomCode: z.string().min(1).optional(),
    vertices: z.array(VecSchema).min(3).optional(),
    rect: RectSchema.optional(),
  })
  .refine((v) => Boolean(v.vertices || v.rect), {
    message: 'cutout_room requires either vertices or rect',
  })

const MergeRoomsSchema = z
  .object({
    type: z.literal('merge_rooms'),
    roomIds: z.tuple([z.string().min(1), z.string().min(1)]).optional(),
    roomCodes: z.tuple([z.string().min(1), z.string().min(1)]).optional(),
    keepCode: z.string().min(1).optional(),
    newName: z.string().optional(),
    allowBearingRemoval: z.boolean().optional().default(false),
  })
  .refine((v) => Boolean(v.roomIds || v.roomCodes), {
    message: 'merge_rooms requires roomIds or roomCodes',
  })

const SetWallPropsSchema = z.object({
  type: z.literal('set_wall_props'),
  wall: WallRefSchema,
  wallType: WallTypeSchema.optional(),
  thicknessCm: z.number().finite().positive().optional(),
  locked: z.boolean().optional(),
})

const SetWallLengthSchema = z.object({
  type: z.literal('set_wall_length'),
  wall: WallRefSchema,
  lengthCm: z.number().finite().positive(),
  anchor: z.enum(['start', 'end', 'center']).optional().default('start'),
  force: z.boolean().optional().default(false),
})

const MoveVertexSchema = z
  .object({
    type: z.literal('move_vertex'),
    roomId: z.string().min(1).optional(),
    roomCode: z.string().min(1).optional(),
    vertexId: z.string().min(1).optional(),
    vertexIndex: z.number().int().min(0).optional(),
    x: z.number().finite(),
    y: z.number().finite(),
    moveLinked: z.boolean().optional().default(true),
    force: z.boolean().optional().default(false),
  })
  .refine((v) => Boolean((v.roomId || v.roomCode) && (v.vertexId || v.vertexIndex !== undefined)), {
    message: 'move_vertex requires roomId/roomCode and vertexId/vertexIndex',
  })

const PlaceElementSchema = z.object({
  type: z.literal('place_element'),
  id: z.string().min(1).optional(),
  wall: WallRefSchema,
  kind: ElementKindSchema,
  variant: ElementVariantSchema.optional(),
  offsetCm: z.number().finite().min(0),
  widthCm: z.number().finite().positive().optional(),
  heightCm: z.number().finite().positive().optional(),
  sillCm: z.number().finite().min(0).optional(),
  depthCm: z.number().finite().positive().optional(),
  hinge: z.enum(['start', 'end']).optional(),
  swing: z.enum(['in', 'out']).optional(),
  note: z.string().optional(),
})

const UpdateElementSchema = z.object({
  type: z.literal('update_element'),
  elementId: z.string().min(1),
  wall: WallRefSchema.optional(),
  kind: ElementKindSchema.optional(),
  variant: ElementVariantSchema.nullable().optional(),
  offsetCm: z.number().finite().min(0).optional(),
  widthCm: z.number().finite().positive().optional(),
  heightCm: z.number().finite().positive().nullable().optional(),
  sillCm: z.number().finite().min(0).nullable().optional(),
  depthCm: z.number().finite().positive().nullable().optional(),
  hinge: z.enum(['start', 'end']).nullable().optional(),
  swing: z.enum(['in', 'out']).nullable().optional(),
  note: z.string().nullable().optional(),
})

const DeleteElementSchema = z.object({
  type: z.literal('delete_element'),
  elementId: z.string().min(1),
})

const SetMeasurementSchema = z.object({
  type: z.literal('set_measurement'),
  label: z.string().min(1),
  actualCm: z.number().finite().positive(),
  updatedAt: z.string().optional(),
})

const ClearMeasurementSchema = z.object({
  type: z.literal('clear_measurement'),
  label: z.string().min(1),
})

const ApplyMeasurementsSchema = z.object({
  type: z.literal('apply_measurements'),
  roomId: z.string().min(1).optional(),
  roomCode: z.string().min(1).optional(),
  roomIds: z.array(z.string().min(1)).optional(),
  roomCodes: z.array(z.string().min(1)).optional(),
  lockVerifiedWalls: z.boolean().optional().default(true),
})

const SetRoomNoteSchema = z
  .object({
    type: z.literal('set_room_note'),
    roomId: z.string().min(1).optional(),
    roomCode: z.string().min(1).optional(),
    text: z.string(),
  })
  .refine((v) => Boolean(v.roomId || v.roomCode), {
    message: 'set_room_note requires roomId or roomCode',
  })

const AddPinSchema = z.object({
  type: z.literal('add_pin'),
  id: z.string().min(1).optional(),
  roomId: z.string().min(1).optional(),
  roomCode: z.string().min(1).optional(),
  wall: WallRefSchema.optional(),
  at: VecSchema,
  text: z.string().optional(),
  photoKeys: z.array(z.string()).optional().default([]),
})

const AddTapeSchema = z.object({
  type: z.literal('add_tape'),
  id: z.string().min(1).optional(),
  a: VecSchema,
  b: VecSchema,
  actualCm: z.number().finite().positive().optional(),
  note: z.string().optional(),
  label: z.string().optional(),
  roomId: z.string().min(1).optional(),
  roomCode: z.string().min(1).optional(),
})

export const CommandSchema = z.discriminatedUnion('type', [
  AddRoomSchema,
  UpdateRoomSchema,
  DeleteRoomSchema,
  SliceRoomSchema,
  CutoutRoomSchema,
  MergeRoomsSchema,
  SetWallPropsSchema,
  SetWallLengthSchema,
  MoveVertexSchema,
  PlaceElementSchema,
  UpdateElementSchema,
  DeleteElementSchema,
  SetMeasurementSchema,
  ClearMeasurementSchema,
  ApplyMeasurementsSchema,
  SetRoomNoteSchema,
  AddPinSchema,
  AddTapeSchema,
])

export type Command = z.infer<typeof CommandSchema>

export const CommandsBatchRequestSchema = z.object({
  commands: z.array(CommandSchema).min(1),
  dryRun: z.boolean().optional().default(false),
  baseVersion: z.number().int().min(0).optional(),
})

// ---------- pure geometry / polygon helpers (copied from ops.ts & apply.ts without store imports) ----------

type Ring = Vec[]
type Piece = Ring[]

const toRing = (pts: Vec[]): [number, number][] => pts.map((p) => [p.x, p.y])
const fromRing = (r: [number, number][]): Ring => r.slice(0, -1).map(([x, y]) => ({ x, y }))
const roomPolygon = (r: Room): [number, number][][] => [toRing(r.vertices), ...r.holes.map(toRing)]
const fromMulti = (m: ReturnType<typeof polygonClipping.union>): Piece[] => m.map((poly) => poly.map(fromRing))
const pieceArea = (p: Piece) => area(p[0]) - p.slice(1).reduce((s, h) => s + area(h), 0)
const maxWalkOrder = (d: PlanDoc) => d.rooms.reduce((m, r) => Math.max(m, r.walkOrder), 0)
const validOutline = (pts: Vec[]) => pts.length >= 3 && area(pts) > 100
const same = (a: Vec, b: Vec) => Math.abs(a.x - b.x) < EPS * 2 && Math.abs(a.y - b.y) < EPS * 2
const orient = (ring: Ring, like: Ring): Ring =>
  Math.sign(signedArea(ring)) === Math.sign(signedArea(like)) ? ring : [...ring].reverse()

const rectToPoints = (rect: { x: number; y: number; w: number; h: number }): Vec[] => [
  { x: rect.x, y: rect.y },
  { x: rect.x + rect.w, y: rect.y },
  { x: rect.x + rect.w, y: rect.y + rect.h },
  { x: rect.x, y: rect.y + rect.h },
]

function remapDiagonal(old: Room, vertices: Vertex[]): [number, number] | undefined {
  if (!old.diagonal) return vertices.length === 4 ? [0, 2] : undefined
  const ids = old.diagonal.map((i) => old.vertices[i]?.id)
  const idx = ids.map((id) => vertices.findIndex((v) => v.id === id))
  if (idx.some((i) => i < 0)) return vertices.length === 4 ? [0, 2] : undefined
  return [idx[0], idx[1]]
}

function ringToVertices(ring: Ring, originals: Vertex[]): Vertex[] {
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
    for (const { v } of extra) {
      used.add(v.id)
      out.push({ id: v.id, x: v.x, y: v.y })
    }
  })
  return out
}

function originWall(room: Room, p: Vec, q: Vec): { start: Vertex; end: Vertex } | null {
  const n = room.vertices.length
  for (let i = 0; i < n; i++) {
    const a = room.vertices[i]
    const b = room.vertices[(i + 1) % n]
    if (projectOnSegment(p, a, b).distance > EPS * 4 || projectOnSegment(q, a, b).distance > EPS * 4) continue
    if (dot(sub(q, p), sub(b, a)) > 0) return { start: a, end: b }
  }
  return null
}

function rebuildRooms(
  doc: PlanDocV1,
  room: Room,
  piecesIn: Piece[],
  newRoomOpts?: { code?: string; name?: string },
): { doc: PlanDocV1; rooms: Room[]; elementsMoved: number; elementsDropped: number } {
  const pieces = [...piecesIn].sort((a, b) => pieceArea(b) - pieceArea(a))
  const results: Room[] = []
  const elementMoves = new Map<string, WallElement | null>()
  let work: PlanDocV1 = { ...doc, rooms: doc.rooms.filter((r) => r.id !== room.id) }
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
    if (pi === 0) {
      base = { ...room, vertices, holes, walls, diagonal: undefined }
    } else {
      const allSoFar = [...work.rooms, ...results]
      let code = pi === 1 && newRoomOpts?.code ? newRoomOpts.code : nextRoomCode({ ...work, rooms: allSoFar })
      if (allSoFar.some((r) => r.code === code)) {
        throw new CommandError('DUPLICATE_ROOM_CODE', `Room code "${code}" already exists.`)
      }
      const n = Number(code.replace(/\D/g, '')) || allSoFar.length + 1
      const name = pi === 1 && newRoomOpts?.name ? newRoomOpts.name : `Room ${n}`
      base = {
        id: uid('room'),
        code,
        name,
        vertices,
        holes,
        walls,
        ceilingCm: room.ceilingCm,
        outdoor: room.outdoor,
        walkOrder: Math.max(maxWalkOrder(work), ...results.map((r) => r.walkOrder)) + 1,
      }
    }
    base.diagonal = pi === 0 ? remapDiagonal(room, vertices) : vertices.length === 4 ? [0, 2] : undefined
    results.push(base)
  })

  let elementsMoved = 0
  let elementsDropped = 0
  for (const e of doc.elements.filter((x) => x.roomId === room.id)) {
    const host = room.vertices.find((v) => v.id === e.wallStart)
    const hostEnd = host && room.vertices[(room.vertices.indexOf(host) + 1) % room.vertices.length]
    let moved: WallElement | null = null
    if (host && hostEnd) {
      const dir = norm(sub(hostEnd, host))
      search: for (const r of results) {
        for (let i = 0; i < r.vertices.length; i++) {
          const p = r.vertices[i]
          const q = r.vertices[(i + 1) % r.vertices.length]
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
    if (moved) elementsMoved++
    else elementsDropped++
    elementMoves.set(e.id, moved)
  }

  const elements = doc.elements.flatMap((e) => {
    if (!elementMoves.has(e.id)) return [e]
    const m = elementMoves.get(e.id)
    return m ? [m] : []
  })
  work = { ...work, rooms: [...work.rooms, ...results], elements }
  const idx = doc.rooms.findIndex((r) => r.id === room.id)
  const others = work.rooms.filter((r) => !results.includes(r))
  others.splice(Math.max(0, idx), 0, ...results)
  return { doc: { ...work, rooms: others }, rooms: results, elementsMoved, elementsDropped }
}

function slicePieces(room: Room, a: Vec, b: Vec): Piece[] | null {
  if (dist(a, b) < 1) return null
  const d = norm(sub(b, a))
  const n = { x: -d.y, y: d.x }
  const half = (s: number): [number, number][][] => {
    const p0 = { x: a.x - d.x * BIG, y: a.y - d.y * BIG }
    const p1 = { x: a.x + d.x * BIG, y: a.y + d.y * BIG }
    const q = (p: Vec) => [p.x + n.x * BIG * s, p.y + n.y * BIG * s] as [number, number]
    return [[[p0.x, p0.y], [p1.x, p1.y], q(p1), q(p0), [p0.x, p0.y]]]
  }
  const poly = roomPolygon(room)
  const pieces = [
    ...fromMulti(polygonClipping.intersection(poly, half(1))),
    ...fromMulti(polygonClipping.intersection(poly, half(-1))),
  ].filter((p) => pieceArea(p) > 1)
  return pieces.length >= 2 ? pieces : null
}

const segCross = (p: Vec, q: Vec, r: Vec, s: Vec) => {
  const d1 = sub(q, p)
  const d2 = sub(s, r)
  const den = d1.x * d2.y - d1.y * d2.x
  if (Math.abs(den) < 1e-9) return false
  const w = sub(r, p)
  const t = (w.x * d2.y - w.y * d2.x) / den
  const u = (w.x * d1.y - w.y * d1.x) / den
  return t >= 0 && t <= 1 && u >= 0 && u <= 1
}

function segmentTouchesRoom(room: Room, a: Vec, b: Vec): boolean {
  if (pointInPolygon(a, room.vertices) || pointInPolygon(b, room.vertices)) return true
  const v = room.vertices
  return v.some((p, i) => segCross(a, b, p, v[(i + 1) % v.length]))
}

function cutPieces(room: Room, cut: Ring): Piece[] | null {
  if (!validOutline(cut)) return null
  const poly = roomPolygon(room)
  const overlap = polygonClipping.intersection(poly, [toRing(cut)])
  if (!overlap.length || fromMulti(overlap).reduce((s, p) => s + pieceArea(p), 0) < 1) return null
  const pieces = fromMulti(polygonClipping.difference(poly, [toRing(cut)])).filter((p) => pieceArea(p) > 1)
  return pieces.length ? pieces : null
}

type VRef = { roomId: string; vertexId: string }
type VMove = VRef & { x: number; y: number }

function linkedVertices(doc: Pick<PlanDoc, 'rooms'>, roomId: string, vertexId: string, tol = 0.5): VRef[] {
  const v = doc.rooms.find((r) => r.id === roomId)?.vertices.find((x) => x.id === vertexId)
  if (!v) return []
  const out: VRef[] = []
  for (const r of doc.rooms) {
    if (r.id === roomId) continue
    for (const o of r.vertices) if (dist(o, v) <= tol) out.push({ roomId: r.id, vertexId: o.id })
  }
  return out
}

function vertexLocked(room: Room, vertexId: string): boolean {
  const n = room.vertices.length
  const i = room.vertices.findIndex((v) => v.id === vertexId)
  if (i < 0) return false
  return !!room.walls[vertexId]?.locked || !!room.walls[room.vertices[(i - 1 + n) % n].id]?.locked
}

function movableLinked(doc: Pick<PlanDoc, 'rooms'>, roomId: string, vertexId: string): VRef[] {
  return linkedVertices(doc, roomId, vertexId).filter((ref) => {
    const rm = doc.rooms.find((r) => r.id === ref.roomId)
    return !!rm && !vertexLocked(rm, ref.vertexId)
  })
}

function moveVertices(doc: PlanDocV1, moves: VMove[]): PlanDocV1 {
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
      return {
        ...r,
        vertices: r.vertices.map((v) => {
          const m = mm.get(v.id)
          return m ? { ...v, x: m.x, y: m.y } : v
        }),
      }
    }),
  }
}

// ---------- addressing helpers ----------

function resolveRoom(doc: PlanDoc, ref: { roomId?: string; roomCode?: string }): Room {
  const room = ref.roomId
    ? doc.rooms.find((r) => r.id === ref.roomId)
    : ref.roomCode
      ? doc.rooms.find((r) => r.code === ref.roomCode)
      : undefined
  if (!room) {
    throw new CommandError('ROOM_NOT_FOUND', `Room not found: ${ref.roomCode ?? ref.roomId ?? '(unspecified)'}`)
  }
  return room
}

export function resolveWall(doc: PlanDoc, ref: WallRef): { room: Room; wall: Wall; label: string } {
  if (typeof ref === 'string') {
    const m = /^(.+)-(\d+)$/.exec(ref.trim())
    if (!m) {
      throw new CommandError('INVALID_WALL_REF', `Invalid wall label "${ref}". Expected format "CODE-1".`)
    }
    const code = m[1]
    const idx = Number(m[2]) - 1
    const room = doc.rooms.find((r) => r.code === code)
    if (!room) throw new CommandError('ROOM_NOT_FOUND', `Room with code "${code}" not found.`)
    const walls = roomWalls(room)
    const wall = walls[idx]
    if (!wall) throw new CommandError('WALL_NOT_FOUND', `Wall "${ref}" not found (room ${code} has ${walls.length} walls).`)
    return { room, wall, label: `${room.code}-${wall.index + 1}` }
  }
  if ('roomId' in ref) {
    const room = doc.rooms.find((r) => r.id === ref.roomId)
    if (!room) throw new CommandError('ROOM_NOT_FOUND', `Room "${ref.roomId}" not found.`)
    const wall = roomWalls(room).find((w) => w.start.id === ref.wallStart)
    if (!wall) throw new CommandError('WALL_NOT_FOUND', `Wall starting at "${ref.wallStart}" not found in room ${room.code}.`)
    return { room, wall, label: `${room.code}-${wall.index + 1}` }
  }
  const room = doc.rooms.find((r) => r.code === ref.roomCode)
  if (!room) throw new CommandError('ROOM_NOT_FOUND', `Room with code "${ref.roomCode}" not found.`)
  const walls = roomWalls(room)
  const wall = walls[ref.wallIndex - 1]
  if (!wall) {
    throw new CommandError('WALL_NOT_FOUND', `Wall ${ref.roomCode}-${ref.wallIndex} not found (room has ${walls.length} walls).`)
  }
  return { room, wall, label: `${room.code}-${wall.index + 1}` }
}

// ---------- apply_measurements pure solver ----------

function isRightAngledQuad(room: Room): boolean {
  const v = room.vertices
  if (v.length !== 4) return false
  return v.every((b, i) => {
    const a = v[(i + 3) % 4]
    const c = v[(i + 1) % 4]
    const d1 = norm(sub(a, b))
    const d2 = norm(sub(c, b))
    return Math.abs(dot(d1, d2)) < 0.02
  })
}

function solveRect(room: Room, measured: (number | null)[]) {
  const w = roomWalls(room)
  const pair = (i: number, j: number) => {
    const a = measured[i]
    const b = measured[j]
    if (a !== null && b !== null) return { v: (a + b) / 2, diff: Math.abs(a - b) }
    if (a !== null) return { v: a, diff: 0 }
    if (b !== null) return { v: b, diff: 0 }
    return { v: (w[i].length + w[j].length) / 2, diff: 0 }
  }
  const A = pair(0, 2)
  const B = pair(1, 3)
  const d0 = w[0].dir
  let n = { x: -d0.y, y: d0.x }
  if (dot(n, w[1].dir) < 0) n = { x: -n.x, y: -n.y }
  const p0 = room.vertices[0]
  const p1 = { x: p0.x + d0.x * A.v, y: p0.y + d0.y * A.v }
  const p2 = { x: p1.x + n.x * B.v, y: p1.y + n.y * B.v }
  const p3 = { x: p0.x + n.x * B.v, y: p0.y + n.y * B.v }
  return { points: [{ x: p0.x, y: p0.y }, p1, p2, p3], closingErrorCm: 0, oppositeDiffCm: Math.max(A.diff, B.diff), mode: 'rect' as const }
}

function solvePolygon(room: Room, measured: (number | null)[]) {
  const w = roomWalls(room)
  const n = w.length
  const L = w.map((x, i) => measured[i] ?? x.length)
  const v0 = room.vertices[0]
  const walk: Vec[] = [{ x: v0.x, y: v0.y }]
  for (let i = 0; i < n; i++) {
    const p = walk[i]
    walk.push({ x: p.x + w[i].dir.x * L[i], y: p.y + w[i].dir.y * L[i] })
  }
  const e = sub(walk[n], v0)
  const closingErrorCm = len(e)
  const unmeasured = w.map((_, i) => i).filter((i) => measured[i] === null)
  if (!unmeasured.length) {
    return { points: walk.slice(0, n), closingErrorCm, oppositeDiffCm: 0, mode: 'polygon' as const }
  }
  const total = unmeasured.reduce((s, i) => s + L[i], 0) || 1
  const pts: Vec[] = [{ x: v0.x, y: v0.y }]
  for (let i = 0; i < n - 1; i++) {
    const share = measured[i] === null ? L[i] / total : 0
    const p = pts[i]
    pts.push({ x: p.x + w[i].dir.x * L[i] - e.x * share, y: p.y + w[i].dir.y * L[i] - e.y * share })
  }
  return { points: pts, closingErrorCm, oppositeDiffCm: 0, mode: 'polygon' as const }
}

function applyMeasurementsForRoom(doc: PlanDocV1, roomId: string, lockVerifiedWalls: boolean) {
  const room = doc.rooms.find((r) => r.id === roomId)
  if (!room) {
    return {
      doc,
      report: { roomId, code: '?', mode: 'none' as const, appliedWalls: 0, closingErrorCm: 0, oppositeDiffCm: 0, skipped: 'Room not found' },
    }
  }
  const ver: { index: number; wallStart: string; label: string; cm: number }[] = []
  surveyIds(room).forEach((s, index) => {
    if (s.kind !== 'wall' || !s.wallStart) return
    const m = doc.measurements[s.label]
    if (m && Number.isFinite(m.actualCm) && m.actualCm > 0) {
      ver.push({ index, wallStart: s.wallStart, label: s.label, cm: m.actualCm })
    }
  })
  if (!ver.length) {
    return {
      doc,
      report: {
        roomId: room.id,
        code: room.code,
        mode: 'none' as const,
        appliedWalls: 0,
        closingErrorCm: 0,
        oppositeDiffCm: 0,
        skipped: 'No verified wall lengths',
      },
    }
  }

  const measured: (number | null)[] = room.vertices.map(() => null)
  for (const v of ver) measured[v.index] = v.cm
  const solved = isRightAngledQuad(room) ? solveRect(room, measured) : solvePolygon(room, measured)
  const walls = roomWalls({ ...room, vertices: room.vertices.map((v, i) => ({ ...v, ...solved.points[i] })) })
  if (walls.some((x) => x.length < 1)) {
    return {
      doc,
      report: {
        roomId: room.id,
        code: room.code,
        mode: 'none' as const,
        appliedWalls: 0,
        closingErrorCm: 0,
        oppositeDiffCm: 0,
        skipped: 'A wall would collapse',
      },
    }
  }

  const props: Record<string, WallProps> = { ...room.walls }
  const lockedWalls: string[] = []
  if (lockVerifiedWalls) {
    for (const v of ver) {
      const got = walls[v.index].length
      if (solved.mode === 'rect' || Math.abs(got - v.cm) <= 0.5) {
        props[v.wallStart] = { ...wallProps(room, v.wallStart), locked: true }
        lockedWalls.push(v.label)
      }
    }
  }

  const moves: VMove[] = []
  room.vertices.forEach((v, i) => {
    const to = solved.points[i]
    if (dist(v, to) < 0.01) return
    moves.push({ roomId, vertexId: v.id, x: to.x, y: to.y })
    for (const ref of movableLinked(doc, roomId, v.id)) moves.push({ ...ref, x: to.x, y: to.y })
  })
  const moved = moveVertices(doc, moves)
  const next: PlanDocV1 = {
    ...moved,
    rooms: moved.rooms.map((r) => (r.id === roomId ? { ...r, walls: props } : r)),
  }

  const oldAreaM2 = Math.round(roomAreaM2(room) * 100) / 100
  const updatedRoom = next.rooms.find((r) => r.id === roomId)!
  const newAreaM2 = Math.round(roomAreaM2(updatedRoom) * 100) / 100

  let diagonal: { measuredCm: number; planCm: number; diffCm: number } | undefined
  if (room.diagonal) {
    const [i, j] = room.diagonal
    const m = doc.measurements[`${room.code}-D`]
    if (m && m.actualCm > 0 && solved.points[i] && solved.points[j]) {
      const planCm = dist(solved.points[i], solved.points[j])
      diagonal = {
        measuredCm: m.actualCm,
        planCm: Math.round(planCm * 10) / 10,
        diffCm: Math.round(Math.abs(m.actualCm - planCm) * 10) / 10,
      }
    }
  }

  return {
    doc: next,
    report: {
      roomId,
      code: room.code,
      mode: solved.mode,
      appliedWalls: ver.length,
      closingErrorCm: Math.round(solved.closingErrorCm * 10) / 10,
      oppositeDiffCm: Math.round(solved.oppositeDiffCm * 10) / 10,
      oldAreaM2,
      newAreaM2,
      lockedWalls,
      ...(diagonal ? { diagonal } : {}),
    },
  }
}

// ---------- main command reducer ----------

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * Purely apply one validated command to a PlanDoc.
 * Throws ZodError on malformed command or CommandError on domain error.
 */
export function apply(rawDoc: PlanDoc, rawCommand: unknown): ApplyResult {
  const doc = parsePlan(rawDoc)
  const cmd = CommandSchema.parse(rawCommand)
  const warnings: CommandWarning[] = []

  switch (cmd.type) {
    case 'add_room': {
      const pts = cmd.rect ? rectToPoints(cmd.rect) : cmd.vertices!
      if (!validOutline(pts)) {
        throw new CommandError('INVALID_POLYGON', 'Room polygon must have >= 3 vertices and area > 100 cm².')
      }
      const code = cmd.code ?? nextRoomCode(doc)
      if (doc.rooms.some((r) => r.code === code)) {
        throw new CommandError('DUPLICATE_ROOM_CODE', `Room code "${code}" already exists.`)
      }
      const id = cmd.id ?? uid('room')
      if (doc.rooms.some((r) => r.id === id)) {
        throw new CommandError('DUPLICATE_ROOM_ID', `Room id "${id}" already exists.`)
      }
      const n = Number(code.replace(/\D/g, '')) || doc.rooms.length + 1
      const room: Room = {
        id,
        code,
        name: cmd.name ?? `Room ${n}`,
        vertices: pts.map((p) => ({ id: uid('v'), x: p.x, y: p.y })),
        holes: [],
        walls: {},
        ...(cmd.ceilingCm !== undefined ? { ceilingCm: cmd.ceilingCm } : {}),
        ...(cmd.outdoor !== undefined ? { outdoor: cmd.outdoor } : {}),
        walkOrder: cmd.walkOrder ?? maxWalkOrder(doc) + 1,
        diagonal: pts.length === 4 ? [0, 2] : undefined,
      }
      const next: PlanDocV1 = { ...doc, rooms: [...doc.rooms, room] }
      return {
        doc: next,
        result: {
          roomId: room.id,
          code: room.code,
          name: room.name,
          areaM2: round2(roomAreaM2(room)),
          walls: room.vertices.map((_, i) => `${room.code}-${i + 1}`),
        },
        warnings,
      }
    }

    case 'update_room': {
      const room = resolveRoom(doc, cmd)
      const oldCode = room.code
      const nextCode = cmd.code ?? oldCode
      if (nextCode !== oldCode && doc.rooms.some((r) => r.id !== room.id && r.code === nextCode)) {
        throw new CommandError('DUPLICATE_ROOM_CODE', `Room code "${nextCode}" already exists.`)
      }

      let measurements = doc.measurements
      let roomNotes = doc.roomNotes
      if (nextCode !== oldCode) {
        measurements = {}
        for (const [k, m] of Object.entries(doc.measurements)) {
          if (k.startsWith(oldCode + '-')) {
            const nk = nextCode + k.slice(oldCode.length)
            measurements[nk] = { ...m, label: nk }
          } else {
            measurements[k] = m
          }
        }
        roomNotes = {}
        for (const [k, v] of Object.entries(doc.roomNotes)) {
          roomNotes[k === oldCode ? nextCode : k] = v
        }
      }

      const updated: Room = {
        ...room,
        code: nextCode,
        name: cmd.name ?? room.name,
        outdoor: cmd.outdoor !== undefined ? cmd.outdoor : room.outdoor,
        walkOrder: cmd.walkOrder !== undefined ? cmd.walkOrder : room.walkOrder,
      }
      if (cmd.ceilingCm === null) delete updated.ceilingCm
      else if (cmd.ceilingCm !== undefined) updated.ceilingCm = cmd.ceilingCm

      const next: PlanDocV1 = {
        ...doc,
        rooms: doc.rooms.map((r) => (r.id === room.id ? updated : r)),
        measurements,
        roomNotes,
      }
      return {
        doc: next,
        result: {
          roomId: updated.id,
          code: updated.code,
          previousCode: oldCode,
          name: updated.name,
          ceilingCm: updated.ceilingCm ?? null,
          outdoor: Boolean(updated.outdoor),
          walkOrder: updated.walkOrder,
        },
        warnings,
      }
    }

    case 'delete_room': {
      const room = resolveRoom(doc, cmd)
      const removedElements = doc.elements.filter((e) => e.roomId === room.id).map((e) => e.id)
      const next: PlanDocV1 = {
        ...doc,
        rooms: doc.rooms.filter((r) => r.id !== room.id),
        elements: doc.elements.filter((e) => e.roomId !== room.id),
      }
      return {
        doc: next,
        result: { deletedRoomId: room.id, deletedCode: room.code, removedElements },
        warnings,
      }
    }

    case 'slice_room': {
      let target: Room | null = null
      if (cmd.roomId || cmd.roomCode) {
        target = resolveRoom(doc, cmd)
      } else {
        const mid = { x: (cmd.a.x + cmd.b.x) / 2, y: (cmd.a.y + cmd.b.y) / 2 }
        const ordered = [...doc.rooms].sort(
          (r1, r2) => Number(pointInPolygon(mid, r2.vertices)) - Number(pointInPolygon(mid, r1.vertices)),
        )
        target = ordered.find((r) => segmentTouchesRoom(r, cmd.a, cmd.b)) ?? null
      }
      if (!target) {
        throw new CommandError('SLICE_NO_INTERSECTION', 'Slice line does not intersect any room.')
      }
      const pieces = slicePieces(target, cmd.a, cmd.b)
      if (!pieces) {
        throw new CommandError('SLICE_NO_INTERSECTION', `Slice line does not split room ${target.code}.`)
      }
      const rebuilt = rebuildRooms(doc, target, pieces, {
        code: cmd.newRoomCode,
        name: cmd.newRoomName,
      })
      if (rebuilt.elementsDropped > 0) {
        warnings.push({
          code: 'ELEMENTS_DROPPED',
          message: `${rebuilt.elementsDropped} element(s) no longer fit after slicing ${target.code} and were removed.`,
        })
      }
      return {
        doc: rebuilt.doc,
        result: {
          rooms: rebuilt.rooms.map((r) => ({ id: r.id, code: r.code, name: r.name, areaM2: round2(roomAreaM2(r)) })),
          elementsMoved: rebuilt.elementsMoved,
          elementsDropped: rebuilt.elementsDropped,
        },
        warnings,
      }
    }

    case 'cutout_room': {
      const cut = cmd.rect ? rectToPoints(cmd.rect) : cmd.vertices!
      if (!validOutline(cut)) {
        throw new CommandError('INVALID_POLYGON', 'Cutout polygon must have >= 3 vertices and area > 100 cm².')
      }
      const targets = cmd.roomId || cmd.roomCode ? [resolveRoom(doc, cmd)] : doc.rooms
      let cur = doc
      const affected: { id: string; code: string; oldAreaM2: number; newAreaM2: number }[] = []
      let totalDropped = 0
      for (const room of targets) {
        const pieces = cutPieces(room, cut)
        if (!pieces) continue
        const oldAreaM2 = round2(roomAreaM2(room))
        const rebuilt = rebuildRooms(cur, room, pieces)
        cur = rebuilt.doc
        totalDropped += rebuilt.elementsDropped
        const newAreaM2 = round2(rebuilt.rooms.reduce((s, r) => s + roomAreaM2(r), 0))
        affected.push({ id: room.id, code: room.code, oldAreaM2, newAreaM2 })
      }
      if (!affected.length) {
        throw new CommandError('CUTOUT_NO_OVERLAP', 'Cutout does not overlap any target room (or would erase it completely).')
      }
      if (totalDropped > 0) {
        warnings.push({
          code: 'ELEMENTS_DROPPED',
          message: `${totalDropped} element(s) were removed because their host wall was cut.`,
        })
      }
      return {
        doc: cur,
        result: { affected },
        warnings,
      }
    }

    case 'merge_rooms': {
      const roomA = cmd.roomIds
        ? resolveRoom(doc, { roomId: cmd.roomIds[0] })
        : resolveRoom(doc, { roomCode: cmd.roomCodes![0] })
      const roomB = cmd.roomIds
        ? resolveRoom(doc, { roomId: cmd.roomIds[1] })
        : resolveRoom(doc, { roomCode: cmd.roomCodes![1] })
      if (roomA.id === roomB.id) {
        throw new CommandError('SAME_ROOM', 'Cannot merge a room with itself.')
      }

      const shared = findSharedWalls(doc, { roomIds: [roomA.id, roomB.id], maxGapCm: 35, minOverlapCm: 1 })
      if (!shared.length) {
        throw new CommandError('ROOMS_NOT_ADJACENT', `Rooms ${roomA.code} and ${roomB.code} do not share a wall.`)
      }
      const bearing = shared.find((s) => s.isBearing)
      if (bearing && !cmd.allowBearingRemoval) {
        throw new CommandError(
          'BEARING_WALL_BLOCKED',
          `Shared wall ${bearing.wallA} / ${bearing.wallB} is marked bearing. Set allowBearingRemoval: true to override.`,
        )
      }

      // Build bridge strips for any shared walls separated by wall-thickness gap (> 0.05 cm)
      const polyA = roomPolygon(roomA)
      const polyB = roomPolygon(roomB)
      const bridges: [number, number][][][] = []
      for (const sw of shared) {
        const [a0, a1] = sw.segmentA
        const [b0, b1] = sw.segmentB
        // Match b0/b1 order so quad is non-self-intersecting
        const sameOrder = dist(a0, b0) + dist(a1, b1) <= dist(a0, b1) + dist(a1, b0)
        const p0 = a0
        const p1 = a1
        const p2 = sameOrder ? b1 : b0
        const p3 = sameOrder ? b0 : b1
        if (sw.gapCm > 0.05) {
          // Slightly expand normal outward by 0.2 cm into both rooms so union fuses cleanly
          const dir = norm(sub(p1, p0))
          const midA = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 }
          const midB = { x: (p2.x + p3.x) / 2, y: (p2.y + p3.y) / 2 }
          const span = norm(sub(midB, midA))
          const eps = 0.2
          const q0 = { x: p0.x - span.x * eps - dir.x * 0.01, y: p0.y - span.y * eps - dir.y * 0.01 }
          const q1 = { x: p1.x - span.x * eps + dir.x * 0.01, y: p1.y - span.y * eps + dir.y * 0.01 }
          const q2 = { x: p2.x + span.x * eps + dir.x * 0.01, y: p2.y + span.y * eps + dir.y * 0.01 }
          const q3 = { x: p3.x + span.x * eps - dir.x * 0.01, y: p3.y + span.y * eps - dir.y * 0.01 }
          bridges.push([toRing([q0, q1, q2, q3])])
        }
      }

      const unioned = fromMulti(polygonClipping.union(polyA, polyB, ...bridges)).filter((p) => pieceArea(p) > 1)
      if (unioned.length !== 1) {
        throw new CommandError(
          'MERGE_FAILED',
          `Union of ${roomA.code} and ${roomB.code} produced ${unioned.length} disconnected pieces.`,
        )
      }

      const piece = unioned[0]
      const outer = orient(piece[0], roomA.vertices)
      const mergedVertices = ringToVertices(outer, [...roomA.vertices, ...roomB.vertices])
      const oldHoleVerts = [...roomA.holes.flat(), ...roomB.holes.flat()]
      const mergedHoles = piece.slice(1).map((h) => ringToVertices(h, oldHoleVerts))

      const mergedWalls: Record<string, WallProps> = {}
      mergedVertices.forEach((v, i) => {
        const nextV = mergedVertices[(i + 1) % mergedVertices.length]
        const wA = originWall(roomA, v, nextV)
        if (wA && roomA.walls[wA.start.id]) {
          mergedWalls[v.id] = { ...roomA.walls[wA.start.id] }
          return
        }
        const wB = originWall(roomB, v, nextV)
        if (wB && roomB.walls[wB.start.id]) {
          mergedWalls[v.id] = { ...roomB.walls[wB.start.id] }
        }
      })

      const keepRoom = cmd.keepCode === roomB.code ? roomB : roomA
      const dropRoom = keepRoom.id === roomA.id ? roomB : roomA
      const keepCode = cmd.keepCode ?? keepRoom.code
      if (keepCode !== roomA.code && keepCode !== roomB.code && doc.rooms.some((r) => r.code === keepCode)) {
        throw new CommandError('DUPLICATE_ROOM_CODE', `Room code "${keepCode}" already exists.`)
      }

      const mergedRoom: Room = {
        id: keepRoom.id,
        code: keepCode,
        name: cmd.newName ?? keepRoom.name,
        vertices: mergedVertices,
        holes: mergedHoles,
        walls: mergedWalls,
        ceilingCm: keepRoom.ceilingCm ?? dropRoom.ceilingCm,
        outdoor: keepRoom.outdoor,
        walkOrder: Math.min(roomA.walkOrder, roomB.walkOrder),
        diagonal: mergedVertices.length === 4 ? [0, 2] : undefined,
      }

      // Drop elements on shared walls; re-parent surviving elements from roomA & roomB
      const sharedWallKeys = new Set<string>()
      for (const sw of shared) {
        sharedWallKeys.add(`${sw.roomAId}:${sw.wallStartA}`)
        sharedWallKeys.add(`${sw.roomBId}:${sw.wallStartB}`)
      }

      const removedElements: { id: string; kind: WallElement['kind']; widthCm: number }[] = []
      const nextElements: WallElement[] = []
      for (const e of doc.elements) {
        if (e.roomId !== roomA.id && e.roomId !== roomB.id) {
          nextElements.push(e)
          continue
        }
        if (sharedWallKeys.has(`${e.roomId}:${e.wallStart}`)) {
          removedElements.push({ id: e.id, kind: e.kind, widthCm: e.widthCm })
          continue
        }
        const srcRoom = e.roomId === roomA.id ? roomA : roomB
        const host = srcRoom.vertices.find((v) => v.id === e.wallStart)
        const hostEnd = host && srcRoom.vertices[(srcRoom.vertices.indexOf(host) + 1) % srcRoom.vertices.length]
        let reparented: WallElement | null = null
        if (host && hostEnd) {
          const dir = norm(sub(hostEnd, host))
          for (let i = 0; i < mergedRoom.vertices.length; i++) {
            const p = mergedRoom.vertices[i]
            const q = mergedRoom.vertices[(i + 1) % mergedRoom.vertices.length]
            const ow = originWall(srcRoom, p, q)
            if (!ow || ow.start.id !== host.id) continue
            const shift = dot(sub(p, host), dir)
            const off = e.offsetCm - shift
            if (off >= -EPS && off + e.widthCm <= dist(p, q) + EPS) {
              reparented = { ...e, roomId: mergedRoom.id, wallStart: p.id, offsetCm: Math.max(0, off), updatedAt: nowIso() }
              break
            }
          }
        }
        if (reparented) nextElements.push(reparented)
        else removedElements.push({ id: e.id, kind: e.kind, widthCm: e.widthCm })
      }

      const nextRooms = doc.rooms
        .filter((r) => r.id !== dropRoom.id)
        .map((r) => (r.id === keepRoom.id ? mergedRoom : r))

      const beforeA = round2(roomAreaM2(roomA))
      const beforeB = round2(roomAreaM2(roomB))
      const afterAreaM2 = round2(roomAreaM2(mergedRoom))

      if (bearing) {
        warnings.push({
          code: 'BEARING_WALL_REMOVED',
          message: `Removed bearing wall ${bearing.wallA} / ${bearing.wallB} (allowBearingRemoval=true).`,
        })
      }

      return {
        doc: { ...doc, rooms: nextRooms, elements: nextElements },
        result: {
          roomId: mergedRoom.id,
          code: mergedRoom.code,
          name: mergedRoom.name,
          removedRoomCode: dropRoom.code,
          sharedWalls: shared.map((s) => ({
            wallA: s.wallA,
            wallB: s.wallB,
            overlapCm: s.overlapCm,
            gapCm: s.gapCm,
            isBearing: s.isBearing,
          })),
          beforeAreaM2: { [roomA.code]: beforeA, [roomB.code]: beforeB, sum: round2(beforeA + beforeB) },
          afterAreaM2,
          deltaAreaM2: round2(afterAreaM2 - (beforeA + beforeB)),
          elementsRemovedOnSharedWall: removedElements,
        },
        warnings,
      }
    }

    case 'set_wall_props': {
      const { room, wall, label } = resolveWall(doc, cmd.wall)
      const cur = wallProps(room, wall.start.id)
      const nextType: WallType = cmd.wallType ?? cur.type
      const nextThickness =
        cmd.thicknessCm ?? (cmd.wallType && cmd.wallType !== cur.type ? DEFAULT_THICKNESS[cmd.wallType] : cur.thicknessCm)
      const nextLocked = cmd.locked !== undefined ? cmd.locked : cur.locked
      const nextProps: WallProps = {
        type: nextType,
        thicknessCm: nextThickness,
        ...(nextLocked !== undefined ? { locked: nextLocked } : {}),
      }
      const next: PlanDocV1 = {
        ...doc,
        rooms: doc.rooms.map((r) =>
          r.id === room.id ? { ...r, walls: { ...r.walls, [wall.start.id]: nextProps } } : r,
        ),
      }
      return {
        doc: next,
        result: { roomId: room.id, wallLabel: label, wallStart: wall.start.id, props: nextProps },
        warnings,
      }
    }

    case 'set_wall_length': {
      const { room, wall, label } = resolveWall(doc, cmd.wall)
      if (room.walls[wall.start.id]?.locked && !cmd.force) {
        throw new CommandError('WALL_LOCKED', `Wall ${label} is locked. Unlock it or pass force: true.`)
      }
      if (cmd.lengthCm < 1) {
        throw new CommandError('INVALID_LENGTH', 'Wall length must be >= 1 cm.')
      }
      const delta = cmd.lengthCm - wall.length
      const moves: VMove[] = []
      const pushMove = (v: Vertex, dx: number, dy: number) => {
        const nx = v.x + dx
        const ny = v.y + dy
        moves.push({ roomId: room.id, vertexId: v.id, x: nx, y: ny })
        for (const ref of movableLinked(doc, room.id, v.id)) {
          moves.push({ ...ref, x: nx, y: ny })
        }
      }
      if (cmd.anchor === 'start') {
        pushMove(wall.end, wall.dir.x * delta, wall.dir.y * delta)
      } else if (cmd.anchor === 'end') {
        pushMove(wall.start, -wall.dir.x * delta, -wall.dir.y * delta)
      } else {
        pushMove(wall.start, (-wall.dir.x * delta) / 2, (-wall.dir.y * delta) / 2)
        pushMove(wall.end, (wall.dir.x * delta) / 2, (wall.dir.y * delta) / 2)
      }
      const next = moveVertices(doc, moves)
      return {
        doc: next,
        result: {
          roomId: room.id,
          wallLabel: label,
          oldLengthCm: Math.round(wall.length * 10) / 10,
          newLengthCm: Math.round(cmd.lengthCm * 10) / 10,
        },
        warnings,
      }
    }

    case 'move_vertex': {
      const room = resolveRoom(doc, cmd)
      const vertex =
        cmd.vertexId !== undefined
          ? room.vertices.find((v) => v.id === cmd.vertexId)
          : room.vertices[cmd.vertexIndex!]
      if (!vertex) {
        throw new CommandError('VERTEX_NOT_FOUND', `Vertex not found in room ${room.code}.`)
      }
      if (vertexLocked(room, vertex.id) && !cmd.force) {
        throw new CommandError('VERTEX_LOCKED', `Vertex ${vertex.id} is attached to a locked wall. Pass force: true to override.`)
      }
      const moves: VMove[] = [{ roomId: room.id, vertexId: vertex.id, x: cmd.x, y: cmd.y }]
      if (cmd.moveLinked) {
        for (const ref of movableLinked(doc, room.id, vertex.id)) {
          moves.push({ ...ref, x: cmd.x, y: cmd.y })
        }
      }
      const next = moveVertices(doc, moves)
      return {
        doc: next,
        result: {
          roomId: room.id,
          vertexId: vertex.id,
          from: { x: vertex.x, y: vertex.y },
          to: { x: cmd.x, y: cmd.y },
          linkedMoved: moves.length - 1,
        },
        warnings,
      }
    }

    case 'place_element': {
      const { room, wall, label } = resolveWall(doc, cmd.wall)
      const id = cmd.id ?? uid('el')
      if (doc.elements.some((e) => e.id === id)) {
        throw new CommandError('DUPLICATE_ELEMENT_ID', `Element id "${id}" already exists.`)
      }
      const def = defaultElement(cmd.kind, cmd.variant)
      const now = nowIso()
      const el: WallElement = {
        id,
        roomId: room.id,
        wallStart: wall.start.id,
        kind: cmd.kind,
        ...(cmd.variant ?? def.variant ? { variant: cmd.variant ?? def.variant } : {}),
        offsetCm: cmd.offsetCm,
        widthCm: cmd.widthCm ?? def.widthCm,
        ...(cmd.heightCm ?? def.heightCm ? { heightCm: cmd.heightCm ?? def.heightCm } : {}),
        ...(cmd.sillCm ?? def.sillCm !== undefined ? { sillCm: cmd.sillCm ?? def.sillCm } : {}),
        ...(cmd.depthCm ?? def.depthCm ? { depthCm: cmd.depthCm ?? def.depthCm } : {}),
        ...(cmd.hinge ?? def.hinge ? { hinge: cmd.hinge ?? def.hinge } : {}),
        ...(cmd.swing ?? def.swing ? { swing: cmd.swing ?? def.swing } : {}),
        ...(cmd.note !== undefined ? { note: cmd.note } : {}),
        createdAt: now,
        updatedAt: now,
      }
      if (el.widthCm > wall.length + EPS) {
        throw new CommandError(
          'ELEMENT_TOO_WIDE',
          `Element ${el.id} is ${Math.round(el.widthCm * 10) / 10} cm wide but wall ${label} is only ${Math.round(wall.length * 10) / 10} cm long.`,
        )
      }
      const ov = overflows(el, wall.length)
      if (ov) {
        warnings.push({
          code: 'ELEMENT_OVERFLOW',
          message: `Element ${el.id} overflows wall ${label} (length ${Math.round(wall.length * 10) / 10} cm).`,
        })
      }
      const next: PlanDocV1 = { ...doc, elements: [...doc.elements, el] }
      return {
        doc: next,
        result: { element: el, wallLabel: label, overflows: ov },
        warnings,
      }
    }

    case 'update_element': {
      const cur = doc.elements.find((e) => e.id === cmd.elementId)
      if (!cur) throw new CommandError('ELEMENT_NOT_FOUND', `Element "${cmd.elementId}" not found.`)
      let roomId = cur.roomId
      let wallStart = cur.wallStart
      let wallLen = 0
      let wallLabel = ''
      if (cmd.wall) {
        const resolved = resolveWall(doc, cmd.wall)
        roomId = resolved.room.id
        wallStart = resolved.wall.start.id
        wallLen = resolved.wall.length
        wallLabel = resolved.label
      } else {
        const rm = doc.rooms.find((r) => r.id === roomId)
        const w = rm ? roomWalls(rm).find((x) => x.start.id === wallStart) : undefined
        wallLen = w?.length ?? 0
        wallLabel = rm && w ? `${rm.code}-${w.index + 1}` : ''
      }

      const updated: WallElement = {
        ...cur,
        roomId,
        wallStart,
        kind: cmd.kind ?? cur.kind,
        offsetCm: cmd.offsetCm ?? cur.offsetCm,
        widthCm: cmd.widthCm ?? cur.widthCm,
        updatedAt: nowIso(),
      }
      const optFields = ['variant', 'heightCm', 'sillCm', 'depthCm', 'hinge', 'swing', 'note'] as const
      for (const k of optFields) {
        const v = cmd[k]
        if (v === null) delete updated[k]
        else if (v !== undefined) (updated as Record<string, unknown>)[k] = v
      }

      if (wallLen > 0 && updated.widthCm > wallLen + EPS) {
        throw new CommandError(
          'ELEMENT_TOO_WIDE',
          `Element ${updated.id} is ${Math.round(updated.widthCm * 10) / 10} cm wide but wall ${wallLabel || 'its wall'} is only ${Math.round(wallLen * 10) / 10} cm long.`,
        )
      }
      const ov = wallLen > 0 && overflows(updated, wallLen)
      if (ov) {
        warnings.push({
          code: 'ELEMENT_OVERFLOW',
          message: `Element ${updated.id} overflows wall ${wallLabel} (length ${Math.round(wallLen * 10) / 10} cm).`,
        })
      }
      const next: PlanDocV1 = {
        ...doc,
        elements: doc.elements.map((e) => (e.id === cur.id ? updated : e)),
      }
      return {
        doc: next,
        result: { element: updated, wallLabel, overflows: ov },
        warnings,
      }
    }

    case 'delete_element': {
      const exists = doc.elements.some((e) => e.id === cmd.elementId)
      if (!exists) throw new CommandError('ELEMENT_NOT_FOUND', `Element "${cmd.elementId}" not found.`)
      const next: PlanDocV1 = {
        ...doc,
        elements: doc.elements.filter((e) => e.id !== cmd.elementId),
      }
      return {
        doc: next,
        result: { deletedElementId: cmd.elementId },
        warnings,
      }
    }

    case 'set_measurement': {
      const m = { label: cmd.label, actualCm: cmd.actualCm, updatedAt: cmd.updatedAt ?? nowIso() }
      const next: PlanDocV1 = {
        ...doc,
        measurements: { ...doc.measurements, [cmd.label]: m },
      }
      return {
        doc: next,
        result: { measurement: m },
        warnings,
      }
    }

    case 'clear_measurement': {
      const existed = cmd.label in doc.measurements
      const measurements = { ...doc.measurements }
      delete measurements[cmd.label]
      return {
        doc: { ...doc, measurements },
        result: { label: cmd.label, cleared: existed },
        warnings,
      }
    }

    case 'apply_measurements': {
      let targetIds: string[]
      if (cmd.roomId || cmd.roomCode) {
        targetIds = [resolveRoom(doc, cmd).id]
      } else if (cmd.roomIds?.length) {
        targetIds = cmd.roomIds.map((id) => resolveRoom(doc, { roomId: id }).id)
      } else if (cmd.roomCodes?.length) {
        targetIds = cmd.roomCodes.map((code) => resolveRoom(doc, { roomCode: code }).id)
      } else {
        targetIds = doc.rooms.map((r) => r.id)
      }
      let cur = doc
      const reports = []
      for (const id of targetIds) {
        const res = applyMeasurementsForRoom(cur, id, cmd.lockVerifiedWalls)
        cur = res.doc
        reports.push(res.report)
        if (res.report.mode === 'polygon' && res.report.closingErrorCm > 2) {
          warnings.push({
            code: 'CLOSING_ERROR',
            message: `Room ${res.report.code} has a closing error of ${res.report.closingErrorCm} cm.`,
          })
        }
      }
      return {
        doc: cur,
        result: { reports },
        warnings,
      }
    }

    case 'set_room_note': {
      const room = resolveRoom(doc, cmd)
      const roomNotes = { ...doc.roomNotes }
      if (cmd.text.length === 0) delete roomNotes[room.code]
      else roomNotes[room.code] = cmd.text
      return {
        doc: { ...doc, roomNotes },
        result: { roomCode: room.code, text: cmd.text },
        warnings,
      }
    }

    case 'add_pin': {
      const id = cmd.id ?? uid('pin')
      if (doc.pins.some((p) => p.id === id)) {
        throw new CommandError('DUPLICATE_PIN_ID', `Pin id "${id}" already exists.`)
      }
      let roomId = cmd.roomId
      let wallStart: string | undefined
      if (cmd.wall) {
        const resolved = resolveWall(doc, cmd.wall)
        roomId = resolved.room.id
        wallStart = resolved.wall.start.id
      } else if (!roomId && cmd.roomCode) {
        roomId = resolveRoom(doc, { roomCode: cmd.roomCode }).id
      }
      const now = nowIso()
      const pin = {
        id,
        ...(roomId ? { roomId } : {}),
        at: cmd.at,
        ...(wallStart ? { wallStart } : {}),
        ...(cmd.text !== undefined ? { text: cmd.text } : {}),
        photoKeys: cmd.photoKeys,
        createdAt: now,
        updatedAt: now,
      }
      return {
        doc: { ...doc, pins: [...doc.pins, pin] },
        result: { pin },
        warnings,
      }
    }

    case 'add_tape': {
      const id = cmd.id ?? uid('tape')
      if (doc.tapes.some((t) => t.id === id)) {
        throw new CommandError('DUPLICATE_TAPE_ID', `Tape id "${id}" already exists.`)
      }
      const roomId = cmd.roomId ?? (cmd.roomCode ? resolveRoom(doc, { roomCode: cmd.roomCode }).id : undefined)
      const tape = {
        id,
        a: cmd.a,
        b: cmd.b,
        ...(cmd.actualCm !== undefined ? { actualCm: cmd.actualCm } : {}),
        ...(cmd.note !== undefined ? { note: cmd.note } : {}),
        ...(cmd.label !== undefined ? { label: cmd.label } : {}),
        ...(roomId ? { roomId } : {}),
      }
      return {
        doc: { ...doc, tapes: [...doc.tapes, tape] },
        result: { tape, lengthCm: Math.round(dist(cmd.a, cmd.b) * 10) / 10 },
        warnings,
      }
    }
  }
}

/**
 * Apply an array of commands in order (all-or-nothing).
 * If any command fails, throws the error with `commandIndex` attached.
 */
export function applyBatch(
  rawDoc: PlanDoc,
  commands: unknown[],
): { doc: PlanDocV1; results: Record<string, unknown>[]; warnings: CommandWarning[] } {
  let cur = parsePlan(rawDoc)
  const results: Record<string, unknown>[] = []
  const warnings: CommandWarning[] = []

  for (let i = 0; i < commands.length; i++) {
    try {
      const step = apply(cur, commands[i])
      cur = step.doc
      results.push(step.result)
      warnings.push(...step.warnings)
    } catch (err) {
      if (err instanceof CommandError || err instanceof z.ZodError) {
        ;(err as Error & { commandIndex?: number }).commandIndex = i
      }
      throw err
    }
  }

  return { doc: cur, results, warnings }
}
