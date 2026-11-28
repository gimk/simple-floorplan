// Pure read-only queries on a project document. Results are plain JSON-serializable objects.
// No React, no store, no DOM. Units: cm, m² and degrees.
import { area } from '../model/geometry'
import type { Vec } from '../model/geometry'
import { artboardAreaM2, roomAreaM2 } from '../features/artboards/frame'
import { hostWallIn } from '../features/openings/sync'
import { furnitureCornerRadiiCm } from '../features/furniture/geometry'
import { roomWalls } from '../features/rooms/ops'
import { DEFAULT_WALL_THICKNESS_CM } from '../model/types'
import type { Artboard, FloorPattern, FurnitureItem, Opening, OpeningKind, OpeningVariant, ProjectDoc, Room, WallKind } from '../model/types'

export type WallSummary = {
  /** `${roomId}#${edgeIndex}` */
  ref: string
  edgeIndex: number
  start: Vec
  end: Vec
  lengthCm: number
  angleDeg: number
  color: string | null
  /** 'fence' for a low railing wall (for example a balcony parapet), else 'wall'. */
  kind: WallKind
  openingIds: string[]
}

export type RoomSummary = {
  id: string
  name: string
  areaM2: number
  perimeterCm: number
  bounds: { minX: number; minY: number; maxX: number; maxY: number; widthCm: number; heightCm: number }
  vertices: Vec[]
  fill: string | null
  floorPattern: FloorPattern | null
  walls: WallSummary[]
}

export type OpeningSummary = {
  id: string
  kind: OpeningKind
  variant: OpeningVariant
  roomId: string | null
  xCm: number
  yCm: number
  angleDeg: number
  widthCm: number
  hinge: 'left' | 'right' | null
  swing: 'in' | 'out' | null
  heightCm: number | null
  sillCm: number | null
}

export type FurnitureSummary = {
  id: string
  name: string
  shape: 'rect' | 'circle'
  xCm: number
  yCm: number
  widthCm: number
  depthCm: number
  rotationDeg: number
  color: string
  heightCm: number | null
  showDirection: boolean
  cornerRadiusCm: number
  /** Effective radii of a 'rect' item: top-left, top-right, bottom-right, bottom-left. */
  cornerRadiiCm: [number, number, number, number]
}

export type ArtboardSummary = {
  id: string
  name: string
  xCm: number
  yCm: number
  widthCm: number | null
  heightCm: number | null
  ceilingHeightCm: number
  wallThicknessCm: number
  precisionCm: number
  totalAreaM2: number
  rooms: RoomSummary[]
  openings: OpeningSummary[]
  furniture: FurnitureSummary[]
}

export type ProjectSummary = {
  schemaVersion: number
  id: string
  title: string
  artboards: ArtboardSummary[]
}

const clean = (v: number): number => v + 0 // turns -0 into 0
const pt = (v: Vec): Vec => ({ x: clean(v.x), y: clean(v.y) })

function summarizeRoom(room: Room, openings: Opening[], rooms: Room[]): RoomSummary {
  const v = room.vertices
  const xs = v.map((p) => p.x), ys = v.map((p) => p.y)
  const minX = v.length ? Math.min(...xs) : 0, maxX = v.length ? Math.max(...xs) : 0
  const minY = v.length ? Math.min(...ys) : 0, maxY = v.length ? Math.max(...ys) : 0
  const byWall = new Map<number, string[]>()
  for (const o of openings) {
    const host = hostWallIn(rooms, o)
    if (host && host.room.id === room.id) byWall.set(host.edgeIndex, [...(byWall.get(host.edgeIndex) ?? []), o.id])
  }
  const walls = roomWalls(room).map((w): WallSummary => ({
    ref: `${room.id}#${w.index}`,
    edgeIndex: w.index,
    start: pt(w.a),
    end: pt(w.b),
    lengthCm: w.lengthCm,
    angleDeg: clean(w.angleDeg),
    color: room.wallColors?.[String(w.index)] ?? null,
    kind: room.wallKinds?.[String(w.index)] ?? 'wall',
    openingIds: byWall.get(w.index) ?? [],
  }))
  return {
    id: room.id,
    name: room.name,
    areaM2: v.length >= 3 ? roomAreaM2(room) : 0,
    perimeterCm: walls.reduce((s, w) => s + w.lengthCm, 0),
    bounds: { minX: clean(minX), minY: clean(minY), maxX: clean(maxX), maxY: clean(maxY), widthCm: maxX - minX, heightCm: maxY - minY },
    vertices: v.map(pt),
    fill: room.fill ?? null,
    floorPattern: room.floorPattern ?? null,
    walls,
  }
}

const summarizeOpening = (o: Opening): OpeningSummary => ({
  id: o.id,
  kind: o.kind,
  variant: o.variant ?? 'standard',
  roomId: o.roomId ?? null,
  xCm: o.xCm,
  yCm: o.yCm,
  angleDeg: o.angleDeg,
  widthCm: o.widthCm,
  hinge: o.hinge ?? null,
  swing: o.swing ?? null,
  heightCm: o.heightCm ?? null,
  sillCm: o.sillCm ?? null,
})

const summarizeFurniture = (f: FurnitureItem): FurnitureSummary => ({
  id: f.id,
  name: f.name,
  shape: f.shape,
  xCm: f.xCm,
  yCm: f.yCm,
  widthCm: f.widthCm,
  depthCm: f.depthCm,
  rotationDeg: f.rotationDeg,
  color: f.color,
  heightCm: f.heightCm ?? null,
  showDirection: f.showDirection ?? false,
  cornerRadiusCm: f.cornerRadiusCm ?? 0,
  cornerRadiiCm: furnitureCornerRadiiCm(f),
})

function summarizeArtboard(a: Artboard): ArtboardSummary {
  return {
    id: a.id,
    name: a.name,
    xCm: a.xCm,
    yCm: a.yCm,
    widthCm: a.widthCm ?? null,
    heightCm: a.heightCm ?? null,
    ceilingHeightCm: a.ceilingHeightCm,
    wallThicknessCm: a.wallThicknessCm ?? DEFAULT_WALL_THICKNESS_CM,
    precisionCm: a.precisionCm,
    totalAreaM2: artboardAreaM2({ ...a, rooms: a.rooms.filter((r) => r.vertices.length >= 3) }),
    rooms: a.rooms.map((r) => summarizeRoom(r, a.openings, a.rooms)),
    openings: a.openings.map(summarizeOpening),
    furniture: a.furniture.map(summarizeFurniture),
  }
}

/** Plain JSON-serializable summary of a project: sizes, areas, walls (with their openings), furniture. */
export function summarizeProject(doc: ProjectDoc): ProjectSummary {
  return {
    schemaVersion: doc.schemaVersion,
    id: doc.id,
    title: doc.title,
    artboards: doc.artboards.map(summarizeArtboard),
  }
}

/** Offset (cm from the wall start) that keeps an opening of widthCm inside a wall of lengthCm. A wall shorter than the opening gets the opening at its middle. */
export function clampOpeningOffset(lengthCm: number, offsetCm: number, widthCm: number): number {
  if (lengthCm < widthCm) return lengthCm / 2
  return Math.min(lengthCm - widthCm / 2, Math.max(widthCm / 2, offsetCm))
}

/**
 * Exact centre and angle of an opening placed on wall `edgeIndex` of `room`. `offsetCm` is the distance
 * from the wall start (vertex edgeIndex) to the opening centre along the wall; it is clamped so the
 * opening stays inside the wall (a wall shorter than the opening gets it at its middle).
 * Throws a RangeError for a missing wall, a zero-length wall, or a non-finite offset or width.
 */
export function computeOpeningOnWall(room: Room, edgeIndex: number, offsetCm: number, widthCm: number): { xCm: number; yCm: number; angleDeg: number } {
  const v = room.vertices
  if (!Number.isInteger(edgeIndex) || edgeIndex < 0 || edgeIndex >= v.length) {
    throw new RangeError(`Room "${room.name}" has no wall ${edgeIndex} (it has ${v.length}).`)
  }
  if (!Number.isFinite(offsetCm) || !Number.isFinite(widthCm) || widthCm <= 0) throw new RangeError('offsetCm and widthCm must be finite numbers, widthCm > 0.')
  const a = v[edgeIndex], b = v[(edgeIndex + 1) % v.length]
  const length = Math.hypot(b.x - a.x, b.y - a.y)
  if (length < 1e-6) throw new RangeError(`Wall ${edgeIndex} of room "${room.name}" has zero length.`)
  const pos = clampOpeningOffset(length, offsetCm, widthCm)
  const ux = (b.x - a.x) / length, uy = (b.y - a.y) / length
  return {
    xCm: clean(a.x + ux * pos),
    yCm: clean(a.y + uy * pos),
    angleDeg: clean((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI),
  }
}

/** Perimeter of a room in cm. */
export const roomPerimeterCm = (room: Room): number => roomWalls(room).reduce((s, w) => s + w.lengthCm, 0)

/** Area of a polygon in m². */
export const polygonAreaM2 = (vertices: Vec[]): number => area(vertices) / 10_000
