// Pure command layer: apply one agent command (or a batch) to a project document.
// Never mutates the input doc, never touches React, Zustand or the DOM. Units: cm, degrees.
import { area, signedArea } from '../model/geometry'
import type { Vec } from '../model/geometry'
import { createArtboard, newId } from '../model/schema'
import type { Artboard, FloorPattern, FurnitureItem, Opening, OpeningKind, OpeningVariant, ProjectDoc, Room } from '../model/types'
import { artboardFrame } from '../features/artboards/frame'
import { MAX_FURNITURE_CM, MIN_FURNITURE_CM } from '../features/furniture/geometry'
import { FURNITURE_PRESETS } from '../features/furniture/presets'
import { DEFAULT_OPENING_WIDTH_CM, MAX_OPENING_WIDTH_CM, MIN_OPENING_WIDTH_CM } from '../features/openings/geometry'
import { syncOpeningsForMerge, syncOpeningsForRoomChange } from '../features/openings/sync'
import { wallThicknessOf } from '../features/rooms/walls'
import { MIN_ROOM_SIDE_CM, createRectRoom, cutoutRoom, deleteVertex, insertVertexOnEdge, mergeRooms, moveRoom, moveVertex, nextRoomName, setWallLength } from '../features/rooms/ops'
import { clampOpeningOffset, computeOpeningOnWall } from './query'
import { semanticIssues, validateProject } from './validate'
import type { ValidationIssue } from './validate'

// ---------- command types ----------

export type ArtboardPatch = {
  name?: string
  xCm?: number
  yCm?: number
  widthCm?: number
  heightCm?: number
  ceilingHeightCm?: number
  wallThicknessCm?: number
  precisionCm?: 0.1 | 0.5 | 1
}

type OnArtboard = { artboardId?: string }

export type AgentCommand =
  | { type: 'set_title'; title: string }
  | { type: 'add_artboard'; name?: string; xCm?: number; yCm?: number; widthCm?: number; heightCm?: number; ceilingHeightCm?: number; wallThicknessCm?: number }
  | ({ type: 'update_artboard'; patch: ArtboardPatch } & OnArtboard)
  | ({ type: 'duplicate_artboard'; name?: string } & OnArtboard)
  | { type: 'delete_artboard'; artboardId: string }
  | ({ type: 'add_room_rect'; name?: string; xCm: number; yCm: number; widthCm: number; heightCm: number; fill?: string } & OnArtboard)
  | ({ type: 'add_room_polygon'; name?: string; vertices: Vec[]; fill?: string } & OnArtboard)
  | ({ type: 'rename_room'; roomId: string; name: string } & OnArtboard)
  | ({ type: 'move_room'; roomId: string; dxCm?: number; dyCm?: number; xCm?: number; yCm?: number } & OnArtboard)
  | ({ type: 'set_wall_length'; roomId: string; edgeIndex: number; lengthCm: number } & OnArtboard)
  | ({ type: 'move_vertex'; roomId: string; vertexIndex: number; xCm: number; yCm: number } & OnArtboard)
  | ({ type: 'insert_vertex'; roomId: string; edgeIndex: number; xCm: number; yCm: number } & OnArtboard)
  | ({ type: 'delete_vertex'; roomId: string; vertexIndex: number } & OnArtboard)
  | ({ type: 'delete_rooms'; roomIds: string[] } & OnArtboard)
  | ({ type: 'cutout_rooms'; cutter: Vec[] } & OnArtboard)
  | ({ type: 'merge_rooms'; roomIds: string[] } & OnArtboard)
  | ({ type: 'set_room_style'; roomId: string; fill?: string | null; floorPattern?: FloorPattern | null; wallColors?: Record<number, string | null> } & OnArtboard)
  | ({
      type: 'add_opening_on_wall'
      roomId: string
      edgeIndex: number
      offsetCm: number
      kind: OpeningKind
      widthCm?: number
      variant?: OpeningVariant
      hinge?: 'left' | 'right'
      swing?: 'in' | 'out'
      heightCm?: number
      sillCm?: number
    } & OnArtboard)
  | ({ type: 'update_opening'; openingId: string; patch: Partial<Omit<Opening, 'id'>> } & OnArtboard)
  | ({ type: 'delete_opening'; openingId: string } & OnArtboard)
  | ({
      type: 'add_furniture'
      presetId?: string
      name?: string
      shape?: 'rect' | 'circle'
      xCm: number
      yCm: number
      widthCm?: number
      depthCm?: number
      rotationDeg?: number
      color?: string
      heightCm?: number
      showDirection?: boolean
      cornerRadiusCm?: number
    } & OnArtboard)
  | ({ type: 'update_furniture'; furnitureId: string; patch: Partial<Omit<FurnitureItem, 'id'>> } & OnArtboard)
  | ({ type: 'reorder_furniture'; furnitureId: string; direction: 'front' | 'back' | 'forward' | 'backward' } & OnArtboard)
  | ({ type: 'duplicate_furniture'; furnitureId: string } & OnArtboard)
  | ({ type: 'delete_furniture'; furnitureId: string } & OnArtboard)

export type CommandResult =
  | { ok: true; doc: ProjectDoc; result: Record<string, unknown>; dryRun: boolean }
  | { ok: false; error: string; issues?: ValidationIssue[] }

export type ApplyOptions = { dryRun?: boolean }

// ---------- helpers ----------

class CommandError extends Error {}
const fail = (msg: string): never => { throw new CommandError(msg) }

/** Deep copy of a doc. Reference images are shared shallowly (their `src` can be many MB and is immutable). */
export function cloneDocPure(doc: ProjectDoc): ProjectDoc {
  return {
    ...doc,
    refImages: doc.refImages.map((i) => ({ ...i })),
    artboards: doc.artboards.map(cloneArtboard),
  }
}

const cloneArtboard = (a: Artboard): Artboard => ({
  ...a,
  rooms: a.rooms.map((r) => ({ ...r, vertices: r.vertices.map((v) => ({ ...v })), ...(r.wallColors ? { wallColors: { ...r.wallColors } } : {}) })),
  openings: a.openings.map((o) => ({ ...o })),
  furniture: a.furniture.map((f) => ({ ...f })),
})

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const needNum = (v: unknown, name: string): number => (isNum(v) ? v : fail(`${name} must be a finite number.`))
const needPos = (v: unknown, name: string): number => (isNum(v) && v > 0 ? v : fail(`${name} must be a number > 0.`))
const needStr = (v: unknown, name: string): string => (typeof v === 'string' ? v : fail(`${name} must be a string.`))
const needIndex = (v: unknown, name: string, count: number): number =>
  Number.isInteger(v) && (v as number) >= 0 && (v as number) < count ? (v as number) : fail(`${name} ${String(v)} is out of range (0..${count - 1}).`)
const needVertices = (v: unknown, name: string, min = 3): Vec[] => {
  if (!Array.isArray(v) || v.length < min) return fail(`${name} needs at least ${min} points.`)
  return v.map((p, i) => {
    if (!p || !isNum((p as Vec).x) || !isNum((p as Vec).y)) return fail(`${name}[${i}] must be {x, y} with finite numbers.`)
    return { x: (p as Vec).x, y: (p as Vec).y }
  })
}

const getArtboard = (doc: ProjectDoc, artboardId: string | undefined): Artboard => {
  const id = artboardId ?? doc.artboards[0]?.id
  if (!id) return fail('The document has no artboard.')
  return doc.artboards.find((a) => a.id === id) ?? fail(`Artboard "${id}" not found.`)
}

const getRoom = (ab: Artboard, roomId: string): Room => ab.rooms.find((r) => r.id === roomId) ?? fail(`Room "${roomId}" not found in artboard "${ab.id}".`)
const getOpening = (ab: Artboard, id: string): Opening => ab.openings.find((o) => o.id === id) ?? fail(`Opening "${id}" not found in artboard "${ab.id}".`)
const getFurniture = (ab: Artboard, id: string): FurnitureItem => ab.furniture.find((f) => f.id === id) ?? fail(`Furniture "${id}" not found in artboard "${ab.id}".`)

const nextArtboardName = (artboards: Artboard[]): string => `Plan ${String.fromCharCode(65 + (artboards.length % 26))}`

/** Shift an artboard so its frame starts 150 cm right of every other artboard (same rule as the app). */
function placeRightOf(a: Artboard, others: Artboard[]): void {
  if (others.length === 0) return
  const right = Math.max(...others.map((o) => artboardFrame(o).maxX))
  a.xCm += right + 150 - artboardFrame(a).minX
}

/** Replace a room, keep its openings on their walls. */
function replaceRoom(ab: Artboard, next: Room): void {
  const prev = ab.rooms
  ab.rooms = ab.rooms.map((r) => (r.id === next.id ? next : r))
  ab.openings = syncOpeningsForRoomChange(ab.openings, prev, ab.rooms)
}

const clampSize = (v: number): number => Math.min(MAX_FURNITURE_CM, Math.max(MIN_FURNITURE_CM, v))

/** Copy only the keys whose value is not undefined. */
function definedEntries<T extends object>(patch: T): Partial<T> {
  const out: Partial<T> = {}
  for (const k of Object.keys(patch) as (keyof T)[]) if (patch[k] !== undefined) out[k] = patch[k]
  return out
}

// ---------- command handlers (mutate the draft; return a result) ----------

type Result = Record<string, unknown>

function run(d: ProjectDoc, cmd: AgentCommand): Result {
  switch (cmd.type) {
    case 'set_title': {
      d.title = needStr(cmd.title, 'title')
      return { title: d.title }
    }
    case 'add_artboard': {
      const a = createArtboard(cmd.name ?? nextArtboardName(d.artboards), 0, 0)
      if (cmd.xCm !== undefined || cmd.yCm !== undefined) {
        a.xCm = cmd.xCm === undefined ? 0 : needNum(cmd.xCm, 'xCm')
        a.yCm = cmd.yCm === undefined ? 0 : needNum(cmd.yCm, 'yCm')
      }
      if (cmd.widthCm !== undefined) a.widthCm = needPos(cmd.widthCm, 'widthCm')
      if (cmd.heightCm !== undefined) a.heightCm = needPos(cmd.heightCm, 'heightCm')
      if (cmd.ceilingHeightCm !== undefined) a.ceilingHeightCm = needPos(cmd.ceilingHeightCm, 'ceilingHeightCm')
      if (cmd.wallThicknessCm !== undefined) a.wallThicknessCm = needNum(cmd.wallThicknessCm, 'wallThicknessCm')
      if (cmd.xCm === undefined && cmd.yCm === undefined) placeRightOf(a, d.artboards)
      d.artboards.push(a)
      return { artboardId: a.id, name: a.name }
    }
    case 'update_artboard': {
      const a = getArtboard(d, cmd.artboardId)
      if (!cmd.patch || typeof cmd.patch !== 'object') return fail('patch is required.')
      Object.assign(a, definedEntries(cmd.patch))
      return { artboardId: a.id }
    }
    case 'duplicate_artboard': {
      const src = getArtboard(d, cmd.artboardId)
      const c = cloneArtboard(src)
      c.id = newId()
      c.name = cmd.name ?? `${src.name} (copy)`
      const roomIds = new Map<string, string>()
      c.rooms.forEach((r) => { const id = newId(); roomIds.set(r.id, id); r.id = id })
      c.openings.forEach((o) => { o.id = newId(); const rid = o.roomId && roomIds.get(o.roomId); if (rid) o.roomId = rid })
      c.furniture.forEach((f) => { f.id = newId() })
      placeRightOf(c, d.artboards)
      d.artboards.push(c)
      return { artboardId: c.id, sourceArtboardId: src.id }
    }
    case 'delete_artboard': {
      if (d.artboards.length <= 1) return fail('Cannot delete the last artboard.')
      if (!d.artboards.some((a) => a.id === cmd.artboardId)) return fail(`Artboard "${cmd.artboardId}" not found.`)
      d.artboards = d.artboards.filter((a) => a.id !== cmd.artboardId)
      return { deletedArtboardId: cmd.artboardId }
    }
    case 'add_room_rect': {
      const ab = getArtboard(d, cmd.artboardId)
      const x = needNum(cmd.xCm, 'xCm'), y = needNum(cmd.yCm, 'yCm')
      const w = needPos(cmd.widthCm, 'widthCm'), h = needPos(cmd.heightCm, 'heightCm')
      if (w < MIN_ROOM_SIDE_CM || h < MIN_ROOM_SIDE_CM) return fail(`A room side must be at least ${MIN_ROOM_SIDE_CM} cm.`)
      const room = createRectRoom({ x, y }, { x: x + w, y: y + h }, cmd.name ?? nextRoomName(ab.rooms))
      if (cmd.fill !== undefined) room.fill = needStr(cmd.fill, 'fill')
      ab.rooms.push(room)
      return { artboardId: ab.id, roomId: room.id, name: room.name }
    }
    case 'add_room_polygon': {
      const ab = getArtboard(d, cmd.artboardId)
      let vertices = needVertices(cmd.vertices, 'vertices')
      if (area(vertices) < 1e-6) return fail('The polygon has no area.')
      // Rooms are clockwise on screen (positive signed area): door swing sides depend on it.
      if (signedArea(vertices) < 0) vertices = vertices.reverse()
      const room: Room = { id: newId(), name: cmd.name ?? nextRoomName(ab.rooms), vertices }
      if (cmd.fill !== undefined) room.fill = needStr(cmd.fill, 'fill')
      ab.rooms.push(room)
      return { artboardId: ab.id, roomId: room.id, name: room.name }
    }
    case 'rename_room': {
      const ab = getArtboard(d, cmd.artboardId)
      getRoom(ab, cmd.roomId).name = needStr(cmd.name, 'name')
      return { artboardId: ab.id, roomId: cmd.roomId, name: cmd.name }
    }
    case 'move_room': {
      const ab = getArtboard(d, cmd.artboardId)
      const room = getRoom(ab, cmd.roomId)
      if (cmd.dxCm === undefined && cmd.dyCm === undefined && cmd.xCm === undefined && cmd.yCm === undefined) return fail('move_room needs dxCm/dyCm or xCm/yCm.')
      if (room.vertices.length === 0) return fail('The room has no vertices.')
      const minX = Math.min(...room.vertices.map((p) => p.x)), minY = Math.min(...room.vertices.map((p) => p.y))
      const dx = cmd.xCm !== undefined ? needNum(cmd.xCm, 'xCm') - minX : cmd.dxCm === undefined ? 0 : needNum(cmd.dxCm, 'dxCm')
      const dy = cmd.yCm !== undefined ? needNum(cmd.yCm, 'yCm') - minY : cmd.dyCm === undefined ? 0 : needNum(cmd.dyCm, 'dyCm')
      replaceRoom(ab, moveRoom(room, dx, dy))
      return { artboardId: ab.id, roomId: room.id, dxCm: dx, dyCm: dy }
    }
    case 'set_wall_length': {
      const ab = getArtboard(d, cmd.artboardId)
      const room = getRoom(ab, cmd.roomId)
      needIndex(cmd.edgeIndex, 'edgeIndex', room.vertices.length)
      const next = setWallLength(room, cmd.edgeIndex, cmd.lengthCm)
      if (!next) return fail('Cannot set the wall length: the length must be a number > 0 and the wall must have a direction.')
      replaceRoom(ab, next)
      return { artboardId: ab.id, roomId: room.id, edgeIndex: cmd.edgeIndex, lengthCm: cmd.lengthCm }
    }
    case 'move_vertex': {
      const ab = getArtboard(d, cmd.artboardId)
      const room = getRoom(ab, cmd.roomId)
      needIndex(cmd.vertexIndex, 'vertexIndex', room.vertices.length)
      replaceRoom(ab, moveVertex(room, cmd.vertexIndex, { x: needNum(cmd.xCm, 'xCm'), y: needNum(cmd.yCm, 'yCm') }))
      return { artboardId: ab.id, roomId: room.id, vertexIndex: cmd.vertexIndex }
    }
    case 'insert_vertex': {
      const ab = getArtboard(d, cmd.artboardId)
      const room = getRoom(ab, cmd.roomId)
      needIndex(cmd.edgeIndex, 'edgeIndex', room.vertices.length)
      replaceRoom(ab, insertVertexOnEdge(room, cmd.edgeIndex, { x: needNum(cmd.xCm, 'xCm'), y: needNum(cmd.yCm, 'yCm') }))
      return { artboardId: ab.id, roomId: room.id, vertexIndex: cmd.edgeIndex + 1 }
    }
    case 'delete_vertex': {
      const ab = getArtboard(d, cmd.artboardId)
      const room = getRoom(ab, cmd.roomId)
      needIndex(cmd.vertexIndex, 'vertexIndex', room.vertices.length)
      const next = deleteVertex(room, cmd.vertexIndex)
      if (!next) return fail('Cannot delete the vertex: a room needs at least 3 vertices.')
      replaceRoom(ab, next)
      return { artboardId: ab.id, roomId: room.id, vertexCount: next.vertices.length }
    }
    case 'delete_rooms': {
      const ab = getArtboard(d, cmd.artboardId)
      if (!Array.isArray(cmd.roomIds) || cmd.roomIds.length === 0) return fail('roomIds must be a non-empty array.')
      const missing = cmd.roomIds.filter((id) => !ab.rooms.some((r) => r.id === id))
      if (missing.length) return fail(`Room(s) not found: ${missing.join(', ')}.`)
      const prev = ab.rooms
      ab.rooms = ab.rooms.filter((r) => !cmd.roomIds.includes(r.id))
      ab.openings = syncOpeningsForRoomChange(ab.openings, prev, ab.rooms)
      return { artboardId: ab.id, deletedRoomIds: [...cmd.roomIds] }
    }
    case 'cutout_rooms': {
      const ab = getArtboard(d, cmd.artboardId)
      const cutter = needVertices(cmd.cutter, 'cutter')
      let changed = false
      const rooms: Room[] = []
      const changedRoomIds: string[] = []
      for (const r of ab.rooms) {
        const parts = cutoutRoom(r, cutter)
        const same = parts.length === 1 && Math.abs(area(parts[0].vertices) - area(r.vertices)) < 1e-6
        if (same) { rooms.push(r); continue }
        changed = true
        changedRoomIds.push(r.id)
        rooms.push(...parts)
      }
      if (changed) {
        ab.openings = syncOpeningsForRoomChange(ab.openings, ab.rooms, rooms)
        ab.rooms = rooms
      }
      return { artboardId: ab.id, changed, changedRoomIds, roomIds: ab.rooms.map((r) => r.id) }
    }
    case 'merge_rooms': {
      const ab = getArtboard(d, cmd.artboardId)
      if (!Array.isArray(cmd.roomIds) || cmd.roomIds.length < 2) return fail('merge_rooms needs at least 2 roomIds.')
      const picked = cmd.roomIds.map((id) => getRoom(ab, id))
      const merged = mergeRooms(picked, wallThicknessOf(ab))
      if (!merged) return fail('The rooms cannot be merged: they must touch, overlap or share a wall and form one outline without a hole.')
      const prev = ab.rooms
      ab.rooms = ab.rooms.filter((r) => r.id === merged.id || !cmd.roomIds.includes(r.id)).map((r) => (r.id === merged.id ? merged : r))
      ab.openings = syncOpeningsForMerge(ab.openings, cmd.roomIds, prev, merged, ab.rooms)
      return { artboardId: ab.id, roomId: merged.id, mergedRoomIds: [...cmd.roomIds] }
    }
    case 'set_room_style': {
      const ab = getArtboard(d, cmd.artboardId)
      const room = getRoom(ab, cmd.roomId)
      if (cmd.fill !== undefined) { if (cmd.fill === null) delete room.fill; else room.fill = needStr(cmd.fill, 'fill') }
      if (cmd.floorPattern !== undefined) {
        if (cmd.floorPattern === null || cmd.floorPattern === 'solid') delete room.floorPattern
        else room.floorPattern = cmd.floorPattern
      }
      if (cmd.wallColors !== undefined) {
        const colors = { ...(room.wallColors ?? {}) }
        for (const [key, color] of Object.entries(cmd.wallColors)) {
          const idx = Number(key)
          needIndex(idx, 'wallColors edge index', room.vertices.length)
          if (color === null) delete colors[String(idx)]
          else colors[String(idx)] = needStr(color, `wallColors[${key}]`)
        }
        if (Object.keys(colors).length === 0) delete room.wallColors
        else room.wallColors = colors
      }
      return { artboardId: ab.id, roomId: room.id }
    }
    case 'add_opening_on_wall': {
      const ab = getArtboard(d, cmd.artboardId)
      const room = getRoom(ab, cmd.roomId)
      needIndex(cmd.edgeIndex, 'edgeIndex', room.vertices.length)
      if (!['door', 'window', 'opening'].includes(cmd.kind)) return fail(`kind must be 'door', 'window' or 'opening'.`)
      const a = room.vertices[cmd.edgeIndex], b = room.vertices[(cmd.edgeIndex + 1) % room.vertices.length]
      const wallLength = Math.hypot(b.x - a.x, b.y - a.y)
      if (wallLength < 1e-6) return fail('The wall has zero length.')
      needNum(cmd.offsetCm, 'offsetCm')
      let widthCm: number
      if (cmd.widthCm !== undefined) {
        widthCm = needPos(cmd.widthCm, 'widthCm')
        if (widthCm < MIN_OPENING_WIDTH_CM || widthCm > MAX_OPENING_WIDTH_CM) return fail(`widthCm must be between ${MIN_OPENING_WIDTH_CM} and ${MAX_OPENING_WIDTH_CM}.`)
      } else {
        widthCm = Math.min(DEFAULT_OPENING_WIDTH_CM[cmd.kind], Math.max(MIN_OPENING_WIDTH_CM, wallLength))
      }
      const offsetCm = clampOpeningOffset(wallLength, cmd.offsetCm, widthCm)
      const pos = computeOpeningOnWall(room, cmd.edgeIndex, offsetCm, widthCm)
      const op: Opening = { id: newId(), kind: cmd.kind, roomId: room.id, xCm: pos.xCm, yCm: pos.yCm, angleDeg: pos.angleDeg, widthCm }
      if (cmd.kind === 'door') { op.hinge = cmd.hinge ?? 'left'; op.swing = cmd.swing ?? 'in' }
      else {
        if (cmd.hinge !== undefined) op.hinge = cmd.hinge
        if (cmd.swing !== undefined) op.swing = cmd.swing
      }
      if (cmd.variant !== undefined) op.variant = cmd.variant
      if (cmd.heightCm !== undefined) op.heightCm = cmd.heightCm
      if (cmd.sillCm !== undefined) op.sillCm = cmd.sillCm
      ab.openings.push(op)
      return { artboardId: ab.id, openingId: op.id, xCm: op.xCm, yCm: op.yCm, angleDeg: op.angleDeg, widthCm, offsetCm }
    }
    case 'update_opening': {
      const ab = getArtboard(d, cmd.artboardId)
      const o = getOpening(ab, cmd.openingId)
      if (!cmd.patch || typeof cmd.patch !== 'object') return fail('patch is required.')
      const { id: _id, ...rest } = cmd.patch as Partial<Opening>
      Object.assign(o, definedEntries(rest))
      return { artboardId: ab.id, openingId: o.id }
    }
    case 'delete_opening': {
      const ab = getArtboard(d, cmd.artboardId)
      getOpening(ab, cmd.openingId)
      ab.openings = ab.openings.filter((o) => o.id !== cmd.openingId)
      return { artboardId: ab.id, deletedOpeningId: cmd.openingId }
    }
    case 'add_furniture': {
      const ab = getArtboard(d, cmd.artboardId)
      const preset = cmd.presetId === undefined ? undefined : FURNITURE_PRESETS.find((p) => p.id === cmd.presetId) ?? fail(`Unknown furniture preset "${cmd.presetId}".`)
      const shape = cmd.shape ?? preset?.shape ?? 'rect'
      const widthCm = clampSize(needPos(cmd.widthCm ?? preset?.widthCm ?? 100, 'widthCm'))
      const depthCm = clampSize(needPos(cmd.depthCm ?? (shape === 'circle' && cmd.widthCm !== undefined ? cmd.widthCm : preset?.depthCm) ?? 100, 'depthCm'))
      const item: FurnitureItem = {
        id: newId(),
        name: cmd.name ?? preset?.name ?? 'Furniture',
        shape,
        xCm: needNum(cmd.xCm, 'xCm'),
        yCm: needNum(cmd.yCm, 'yCm'),
        widthCm,
        depthCm,
        rotationDeg: cmd.rotationDeg === undefined ? 0 : needNum(cmd.rotationDeg, 'rotationDeg'),
        color: cmd.color ?? preset?.color ?? '#4b5563',
      }
      const heightCm = cmd.heightCm ?? preset?.heightCm
      if (heightCm !== undefined) item.heightCm = heightCm
      const showDirection = cmd.showDirection ?? preset?.showDirection
      if (showDirection !== undefined) item.showDirection = showDirection
      if (cmd.cornerRadiusCm !== undefined) item.cornerRadiusCm = cmd.cornerRadiusCm
      if (preset?.layer === 'bottom') ab.furniture.unshift(item)
      else ab.furniture.push(item)
      return { artboardId: ab.id, furnitureId: item.id, name: item.name }
    }
    case 'update_furniture': {
      const ab = getArtboard(d, cmd.artboardId)
      const f = getFurniture(ab, cmd.furnitureId)
      if (!cmd.patch || typeof cmd.patch !== 'object') return fail('patch is required.')
      const { id: _id, ...rest } = cmd.patch as Partial<FurnitureItem>
      const patch = definedEntries(rest)
      if (isNum(patch.widthCm)) patch.widthCm = clampSize(patch.widthCm)
      if (isNum(patch.depthCm)) patch.depthCm = clampSize(patch.depthCm)
      Object.assign(f, patch)
      return { artboardId: ab.id, furnitureId: f.id }
    }
    case 'reorder_furniture': {
      const ab = getArtboard(d, cmd.artboardId)
      const from = ab.furniture.findIndex((f) => f.id === cmd.furnitureId)
      if (from < 0) return fail(`Furniture "${cmd.furnitureId}" not found in artboard "${ab.id}".`)
      if (!['front', 'back', 'forward', 'backward'].includes(cmd.direction)) return fail(`direction must be 'front', 'back', 'forward' or 'backward'.`)
      const last = ab.furniture.length - 1
      const wanted = cmd.direction === 'back' ? 0 : cmd.direction === 'backward' ? from - 1 : cmd.direction === 'forward' ? from + 1 : last
      const to = Math.max(0, Math.min(wanted, last))
      if (to !== from) {
        const [moved] = ab.furniture.splice(from, 1)
        ab.furniture.splice(to, 0, moved)
      }
      return { artboardId: ab.id, furnitureId: cmd.furnitureId, moved: to !== from, index: to }
    }
    case 'duplicate_furniture': {
      const ab = getArtboard(d, cmd.artboardId)
      const src = getFurniture(ab, cmd.furnitureId)
      const copy: FurnitureItem = { ...src, id: newId(), xCm: src.xCm + 20, yCm: src.yCm + 20 }
      ab.furniture.push(copy)
      return { artboardId: ab.id, furnitureId: copy.id, sourceFurnitureId: src.id }
    }
    case 'delete_furniture': {
      const ab = getArtboard(d, cmd.artboardId)
      getFurniture(ab, cmd.furnitureId)
      ab.furniture = ab.furniture.filter((f) => f.id !== cmd.furnitureId)
      return { artboardId: ab.id, deletedFurnitureId: cmd.furnitureId }
    }
    default:
      return fail(`Unknown command type "${(cmd as { type?: unknown }).type}".`)
  }
}

const issueKey = (i: ValidationIssue) => `${i.code}|${i.path}|${i.message}`

/** Schema errors, plus semantic errors that the command introduced (errors already in the input doc do not block it). */
function checkResult(before: ProjectDoc, after: ProjectDoc): ValidationIssue[] {
  const v = validateProject(after)
  const errors = v.issues.filter((i) => i.severity === 'error')
  if (errors.length === 0) return []
  if (errors.some((e) => e.code.startsWith('schema.'))) return errors
  const existing = new Set(semanticIssues(before).map(issueKey))
  return errors.filter((e) => !existing.has(issueKey(e)))
}

// ---------- public API ----------

/**
 * Apply one command to a copy of `doc`. The input is never changed. The result doc is checked with the
 * schema and the semantic errors; a command that would make the doc invalid fails with `issues`.
 * `dryRun: true` returns the same computed doc with `dryRun: true`: the caller decides whether to keep it.
 */
export function applyCommand(doc: ProjectDoc, cmd: AgentCommand, opts?: ApplyOptions): CommandResult {
  const dryRun = opts?.dryRun === true
  const draft = cloneDocPure(doc)
  try {
    if (!cmd || typeof cmd !== 'object') return { ok: false, error: 'Command must be an object with a "type".' }
    const result = run(draft, cmd)
    const issues = checkResult(doc, draft)
    if (issues.length) return { ok: false, error: `${cmd.type}: the result is not valid: ${issues[0].path}: ${issues[0].message}`, issues }
    return { ok: true, doc: draft, result, dryRun }
  } catch (e) {
    if (e instanceof CommandError) return { ok: false, error: `${(cmd as { type?: string } | null)?.type ?? 'command'}: ${e.message}` }
    throw e
  }
}

/**
 * Apply commands in order, all or nothing: the first failure returns that failure (with its index) and
 * no doc. On success `result.results` holds each command result. `dryRun` is passed through.
 */
export function applyCommands(doc: ProjectDoc, cmds: AgentCommand[], opts?: ApplyOptions): CommandResult {
  const dryRun = opts?.dryRun === true
  if (!Array.isArray(cmds)) return { ok: false, error: 'commands must be an array.' }
  let current = doc
  const results: Record<string, unknown>[] = []
  for (let i = 0; i < cmds.length; i++) {
    const r = applyCommand(current, cmds[i])
    if (!r.ok) return { ...r, error: `command ${i}: ${r.error}` }
    current = r.doc
    results.push(r.result)
  }
  // With no command the doc is returned as a copy, so the caller never shares state with the input.
  return { ok: true, doc: current === doc ? cloneDocPure(doc) : current, result: { results }, dryRun }
}
