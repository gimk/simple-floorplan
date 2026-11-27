// Zoom-aware text level of detail for the room and wall labels of one artboard.
// Pure: no React, no DOM. All sizes in "px" are screen px; geometry is artboard-local cm and
// zoom = screen px per cm. Text boxes are estimated from the character count (no measuring).
import { boxFits, fmtCm, labelPlacement, pointInPolygon, signedArea } from '../../model/geometry'
import type { Vec } from '../../model/geometry'
import type { Room } from '../../model/types'
import { formatLengthCm, roomWalls } from './ops'
import type { Wall } from './ops'

export type RoomLodTier = 'full' | 'name' | 'compact' | 'hidden'

export type RoomLod = {
  tier: RoomLodTier
  /** Label centre (artboard-local cm). */
  p: Vec
  /** True when the label is turned by 90 degrees (narrow tall room). */
  vertical: boolean
  /** Font size of the room name, px. */
  nameFontPx: number
  /** Font size of the area line, px (only used by 'full'). */
  areaFontPx: number
  showArea: boolean
}

export type WallLod = {
  /** Anchor of the label (artboard-local cm). */
  x: number
  y: number
  /** Text rotation in degrees (never upside down). */
  rotDeg: number
  text: string
}

export type TextLod = {
  rooms: Map<string, RoomLod>
  /** Approved wall labels, keyed `${roomId}:${edgeIndex}`. */
  walls: Map<string, WallLod>
}

export type LodRoomInput = {
  room: Room
  areaText: string
  walls: Wall[]
  /** +1 / -1 winding sign, as in RoomsLayer. */
  s: number
}

export type TextLodParams = {
  rooms: readonly LodRoomInput[]
  zoom: number
  wallThicknessCm: number
  precisionCm: number
  selectedRoomIds: readonly string[]
  selectedWall: { roomId: string; edgeIndex: number } | null
  selectedVertex: { roomId: string } | null
}

// Font sizes (px).
export const NAME_PX = 13
export const NAME_SMALL_PX = 12
export const COMPACT_PX = 10
export const AREA_PX = 11
export const WALL_PX = 11
// Padding (px) inside the room around a label, and around a label for collision checks.
const FIT_PAD_PX = 4
const COLLIDE_PAD_PX = 3
const LINE_GAP_PX = 4

/** Estimated text width, px. Bold text is a little wider. */
export const textWidthPx = (text: string, fontPx: number, bold = false) =>
  text.length * fontPx * (bold ? 0.62 : 0.56)

type Box = { cx: number; cy: number; hx: number; hy: number }

/** Padded screen-space AABB of a w×h px box turned by rotDeg around its centre. */
function aabb(cxCm: number, cyCm: number, zoom: number, wPx: number, hPx: number, rotDeg: number): Box {
  const r = (rotDeg * Math.PI) / 180
  const c = Math.abs(Math.cos(r)), s = Math.abs(Math.sin(r))
  return {
    cx: cxCm * zoom, cy: cyCm * zoom,
    hx: (c * wPx + s * hPx) / 2 + COLLIDE_PAD_PX,
    hy: (s * wPx + c * hPx) / 2 + COLLIDE_PAD_PX,
  }
}
const overlaps = (a: Box, b: Box) => Math.abs(a.cx - b.cx) < a.hx + b.hx && Math.abs(a.cy - b.cy) < a.hy + b.hy

type Fit = { p: Vec; vertical: boolean }

/** Where a wPx×hPx text box fits inside the room (flat first, then turned), or null. */
function fitBox(vertices: Vec[], zoom: number, wPx: number, hPx: number, allowVertical: boolean): Fit | null {
  const w = (wPx + 2 * FIT_PAD_PX) / zoom, h = (hPx + 2 * FIT_PAD_PX) / zoom
  const rings = [vertices]
  const pl = labelPlacement(rings, w, h, 0)
  if (boxFits(pl.p, pl.vertical ? h : w, pl.vertical ? w : h, rings) && (allowVertical || !pl.vertical)) return pl
  return null
}

function roomLod(input: LodRoomInput, zoom: number, forceShow: boolean): RoomLod {
  const { room, areaText } = input
  const v = room.vertices
  const none: RoomLod = { tier: 'hidden', p: { x: 0, y: 0 }, vertical: false, nameFontPx: COMPACT_PX, areaFontPx: AREA_PX, showArea: false }
  if (v.length < 3) return none

  const nameW = textWidthPx(room.name, NAME_PX, true)
  const areaW = textWidthPx(`${areaText} m²`, AREA_PX)
  const full = fitBox(v, zoom, Math.max(nameW, areaW), NAME_PX + AREA_PX + LINE_GAP_PX, false)
  if (full) return { tier: 'full', ...full, nameFontPx: NAME_PX, areaFontPx: AREA_PX, showArea: true }

  const name = fitBox(v, zoom, textWidthPx(room.name, NAME_SMALL_PX, true), NAME_SMALL_PX + 2, true)
  if (name) return { tier: 'name', ...name, nameFontPx: NAME_SMALL_PX, areaFontPx: AREA_PX, showArea: false }

  const compact = fitBox(v, zoom, textWidthPx(room.name, COMPACT_PX, true), COMPACT_PX + 2, true)
  if (compact) return { tier: 'compact', ...compact, nameFontPx: COMPACT_PX, areaFontPx: AREA_PX, showArea: false }

  if (!forceShow) return none
  // A selected room always shows its name, even if it does not fit.
  const pl = labelPlacement([v], 0, 0)
  return { tier: 'compact', p: pl.p, vertical: false, nameFontPx: COMPACT_PX, areaFontPx: AREA_PX, showArea: false }
}

function roomBox(l: RoomLod, name: string, areaText: string, zoom: number): Box {
  const nameW = textWidthPx(name, l.nameFontPx, true)
  const w = l.showArea ? Math.max(nameW, textWidthPx(`${areaText} m²`, l.areaFontPx)) : nameW
  const h = l.showArea ? l.nameFontPx + l.areaFontPx + LINE_GAP_PX : l.nameFontPx + 2
  return aabb(l.p.x, l.p.y, zoom, w, h, l.vertical ? 90 : 0)
}

/** Text LOD of every room and wall label of one artboard at a given zoom. */
export function computeTextLod(params: TextLodParams): TextLod {
  const { rooms, zoom, wallThicknessCm, precisionCm, selectedRoomIds, selectedWall, selectedVertex } = params
  const out: TextLod = { rooms: new Map(), walls: new Map() }
  if (!(zoom > 0)) return out

  const isSelRoom = (id: string) =>
    selectedRoomIds.includes(id) || selectedWall?.roomId === id || selectedVertex?.roomId === id
  const placed: Box[] = []
  const hit = (b: Box) => placed.some((p) => overlaps(b, p))

  // Room labels.
  const roomItems = rooms.map((r) => {
    const sel = isSelRoom(r.room.id)
    const lod = roomLod(r, zoom, sel)
    return { r, sel, lod, areaCm2: Math.abs(signedArea(r.room.vertices)) }
  })
  for (const it of roomItems) {
    if (it.sel && it.lod.tier !== 'hidden') placed.push(roomBox(it.lod, it.r.room.name, it.r.areaText, zoom))
  }
  // Selected wall labels come before every other label.
  type WallItem = { r: LodRoomInput; w: Wall; key: string; sel: boolean; lod: WallLod; box: Box }
  const wallItems: WallItem[] = []
  for (const r of rooms) {
    const { room, s } = r
    if (room.vertices.length < 3) continue
    for (const w of r.walls) {
      const sel = selectedWall?.roomId === room.id && selectedWall.edgeIndex === w.index
      const text = formatLengthCm(w.lengthCm, precisionCm)
      const textW = textWidthPx(text, WALL_PX)
      if (!sel && w.lengthCm * zoom < Math.max(48, textW + 24)) continue
      const dx = (w.b.x - w.a.x) / (w.lengthCm || 1), dy = (w.b.y - w.a.y) / (w.lengthCm || 1)
      const off = 10 / zoom + wallThicknessCm
      const x = w.mid.x - dy * s * off, y = w.mid.y + dx * s * off
      if (!sel && !pointInPolygon({ x, y }, room.vertices)) continue
      const flip = w.angleDeg > 90 || w.angleDeg <= -90
      const rotDeg = flip ? w.angleDeg + 180 : w.angleDeg
      wallItems.push({
        r, w, key: `${room.id}:${w.index}`, sel,
        lod: { x, y, rotDeg, text },
        box: aabb(x, y, zoom, textW, WALL_PX + 2, rotDeg),
      })
    }
  }
  for (const it of wallItems) {
    if (it.sel) { out.walls.set(it.key, it.lod); placed.push(it.box) }
  }

  // Non-selected rooms, largest first.
  roomItems.sort((a, b) => b.areaCm2 - a.areaCm2)
  for (const it of roomItems) {
    const id = it.r.room.id
    if (it.lod.tier === 'hidden') { out.rooms.set(id, it.lod); continue }
    if (it.sel) { out.rooms.set(id, it.lod); continue }
    const box = roomBox(it.lod, it.r.room.name, it.r.areaText, zoom)
    if (hit(box)) { out.rooms.set(id, { ...it.lod, tier: 'hidden' }); continue }
    placed.push(box)
    out.rooms.set(id, it.lod)
  }

  // Non-selected walls, longest first.
  const rest = wallItems.filter((i) => !i.sel).sort((a, b) => b.w.lengthCm - a.w.lengthCm)
  for (const it of rest) {
    if (hit(it.box)) continue
    placed.push(it.box)
    out.walls.set(it.key, it.lod)
  }
  return out
}

/** Helper to build the LOD input of a room (RoomsLayer builds the same from its geometry cache). */
export function lodInputOf(room: Room): LodRoomInput {
  return {
    room,
    areaText: fmtCm(Math.round((Math.abs(signedArea(room.vertices)) / 10000) * 100) / 100),
    walls: roomWalls(room),
    s: signedArea(room.vertices) >= 0 ? 1 : -1,
  }
}
