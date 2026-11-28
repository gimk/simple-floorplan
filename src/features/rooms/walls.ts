// Thick-wall helpers (no React). Rooms keep their interior polygon; the wall is drawn outward from
// every room edge. Units: cm, y down (same as the canvas).
import { pointInPolygon, signedArea } from '../../model/geometry'
import type { Vec } from '../../model/geometry'
import { DEFAULT_WALL_THICKNESS_CM, MAX_WALL_THICKNESS_CM } from '../../model/types'
import type { Artboard, Opening, Room, WallKind } from '../../model/types'
import { openingEndpoints } from '../openings/geometry'
import { hostWallIn } from '../openings/sync'

/** Crisp mid-grey wall body for the dark theme (canvas and export). */
export const WALL_COLOR = '#5b6577'

/** Fence (balcony railing) colour: a light blue-grey, clearly lighter than a wall. */
export const FENCE_COLOR = '#94a3b8'

/** Fence (balcony railing) thickness, in cm. A fence is thin whatever the artboard wall thickness. */
export const FENCE_THICKNESS_CM = 4

/** Kind of wall `edgeIndex` of `room`: 'fence' when the room marks it as a fence, else 'wall'. */
export function wallKindOf(room: Pick<Room, 'wallKinds'>, edgeIndex: number): WallKind {
  return room.wallKinds?.[String(edgeIndex)] ?? 'wall'
}

/** True when wall `edgeIndex` of `room` is a fence (low railing) instead of a normal wall. */
export function isFenceWall(room: Pick<Room, 'wallKinds'>, edgeIndex: number): boolean {
  return wallKindOf(room, edgeIndex) === 'fence'
}

/** Wall thickness of an artboard in cm: unset = default, clamped to 0..50. 0 = thick walls off. */
export function wallThicknessOf(a: { wallThicknessCm?: number }): number {
  const t = a.wallThicknessCm ?? DEFAULT_WALL_THICKNESS_CM
  return Number.isFinite(t) ? Math.min(MAX_WALL_THICKNESS_CM, Math.max(0, t)) : 0
}

/** Unit normal of edge `i` of `room` that points away from the room, or null for a zero-length edge. */
export function edgeOutwardNormal(room: Room, i: number): Vec | null {
  const v = room.vertices
  const a = v[i], b = v[(i + 1) % v.length]
  if (!a || !b) return null
  const len = Math.hypot(b.x - a.x, b.y - a.y)
  if (len < 1e-6) return null
  const s = signedArea(v) >= 0 ? 1 : -1
  // signedArea >= 0 means the polygon runs clockwise on screen (y down): the outside is to the left of a -> b.
  return { x: ((b.y - a.y) / len) * s + 0, y: (-(b.x - a.x) / len) * s + 0 } // + 0: no -0
}

/**
 * Outward unit normal of the wall that hosts `op`, or null. The host follows `op.roomId` and the
 * opening direction (see `hostWallIn`), so a flush wall of another room does not flip the frame.
 */
export function openingOutward(rooms: Room[], op: Opening): Vec | null {
  const host = hostWallIn(rooms, op)
  return host ? edgeOutwardNormal(host.room, host.edgeIndex) : null
}

/** Probe distance outward from the wall line, in cm, used to tell a flush room from an open side. */
export const FLUSH_PROBE_CM = 0.5
/** A room face closer than this to the wall line counts as flush: the visible wall has no thickness. */
export const FLUSH_GAP_CM = 0.5

/**
 * Distance from `p` along the unit direction `d` to the first face of `vertices` inside
 * `(0, maxCm)`, or null when the ray misses the polygon. Edges parallel to the ray never count, so a
 * face that runs along the wall (a flush neighbour) is not read as a crossing.
 */
function rayHitDistance(p: Vec, d: Vec, vertices: Vec[], maxCm: number): number | null {
  let best: number | null = null
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i], b = vertices[(i + 1) % vertices.length]
    const ex = b.x - a.x, ey = b.y - a.y
    const den = d.x * ey - d.y * ex
    if (Math.abs(den) < 1e-12) continue
    const wx = a.x - p.x, wy = a.y - p.y
    const t = (wx * ey - wy * ex) / den
    const u = (wx * d.y - wy * d.x) / den
    if (u < -1e-9 || u > 1 + 1e-9) continue
    if (!(t > 1e-9) || t >= maxCm) continue
    if (best === null || t < best) best = t
  }
  return best
}

/**
 * Wall thickness actually visible from the room edge `point`, along `outNormal` of the host room
 * `hostRoomId`, on an artboard whose walls are `maxThicknessCm` thick.
 *
 * Two rooms can be flush: their walls touch (0 cm gap). The wall body of the host room then reaches
 * into the other room, where the wall mask hides it, so the shared wall looks like a thin line. The
 * opening must follow that look, not the artboard thickness:
 * - a room right behind the wall (probe `FLUSH_PROBE_CM` outward) gives 0;
 * - a room face `t` cm outward (a 5 cm corridor, say) gives `t`, so the wall body is `t` cm wide;
 * - no room (exterior wall) or a room at `maxThicknessCm` or farther gives `maxThicknessCm`.
 * Result in `[0, maxThicknessCm]`.
 */
export function effectiveWallThickness(
  rooms: Room[],
  hostRoomId: string,
  point: Vec,
  outNormal: Vec,
  maxThicknessCm: number,
): number {
  if (!(maxThicknessCm > 0)) return 0
  const probe = { x: point.x + outNormal.x * FLUSH_PROBE_CM, y: point.y + outNormal.y * FLUSH_PROBE_CM }
  let eff = maxThicknessCm
  for (const r of rooms) {
    if (r.id === hostRoomId || r.vertices.length < 3) continue
    // A room interior immediately behind the wall: the wall mask hides the whole wall body.
    if (pointInPolygon(probe, r.vertices)) return 0
    const t = rayHitDistance(point, outNormal, r.vertices, maxThicknessCm)
    if (t === null) continue
    if (t <= FLUSH_GAP_CM) return 0
    eff = Math.min(eff, t)
  }
  return eff
}

/** Outward wall frame of an opening: unit outward normal and wall thickness. */
export type OpeningWall = { out: Vec; thicknessCm: number }

/**
 * Wall frame for `op`, or null when walls are thin (t <= 0), when the opening has no host wall, or
 * when the wall is masked away by a room right behind it (flush wall: effective thickness 0).
 * A null frame means a thin-wall look: short centred jamb ticks, the symbol on the wall line, the
 * resize handles and the hit band on the line.
 */
export function openingWall(rooms: Room[], op: Opening, thicknessCm: number): OpeningWall | null {
  if (!(thicknessCm > 0)) return null
  const host = hostWallIn(rooms, op)
  const out = host ? edgeOutwardNormal(host.room, host.edgeIndex) : null
  if (!host || !out) return null
  const eff = effectiveWallThickness(rooms, host.room.id, { x: op.xCm, y: op.yCm }, out, thicknessCm)
  return eff > 0 ? { out, thicknessCm: eff } : null
}

/**
 * Translation that places the symbol of an opening across the thick wall. Windows, gaps and sliding
 * panels centre in the wall. A hinged door (standard, french) hinges from the wall face on its swing side.
 */
export function openingSymbolShift(op: Opening, wall: OpeningWall): Vec {
  const { out, thicknessCm: t } = wall
  const variant = op.variant ?? 'standard'
  if (op.kind === 'door' && (variant === 'standard' || variant === 'french' || variant === 'french-glass')) {
    const rad = (op.angleDeg * Math.PI) / 180
    const n = { x: -Math.sin(rad), y: Math.cos(rad) }
    const swingSign = (op.swing ?? 'in') === 'in' ? 1 : -1
    const swingsOutward = (n.x * out.x + n.y * out.y) * swingSign > 0
    return swingsOutward ? { x: out.x * t, y: out.y * t } : { x: 0, y: 0 }
  }
  return { x: (out.x * t) / 2, y: (out.y * t) / 2 }
}

/** How far the inner edge of a threshold quad reaches into the room, in cm. */
export const THRESHOLD_INSET_CM = 0.25

/**
 * Floor threshold quad per host room id, for every door and open passage of `openings` that crosses
 * a thick wall. A quad spans the opening width and bridges the wall thickness, from the room border
 * to the outer wall face, so the floor colour and the floor pattern of the host room continue
 * through the doorway instead of stopping at the wall line. Thin walls, flush 0 cm shared walls and
 * windows (they sit above a wall sill) get no quad.
 */
export function roomDoorThresholds(rooms: Room[], openings: Opening[], thicknessCm: number): Map<string, Vec[][]> {
  const byRoom = new Map<string, Vec[][]>()
  if (!(thicknessCm > 0)) return byRoom
  for (const op of openings) {
    if (op.kind !== 'door' && op.kind !== 'opening') continue
    const host = hostWallIn(rooms, op)
    const wall = openingWall(rooms, op, thicknessCm)
    if (!host || !wall || !(wall.thicknessCm > 0)) continue
    const { start, end } = openingEndpoints(op)
    const { out } = wall
    // Inner edge slightly inside the room: no anti-aliasing hairline seam against the room polygon.
    const startIn = { x: start.x - out.x * THRESHOLD_INSET_CM, y: start.y - out.y * THRESHOLD_INSET_CM }
    const endIn = { x: end.x - out.x * THRESHOLD_INSET_CM, y: end.y - out.y * THRESHOLD_INSET_CM }
    const startOut = { x: start.x + out.x * wall.thicknessCm, y: start.y + out.y * wall.thicknessCm }
    const endOut = { x: end.x + out.x * wall.thicknessCm, y: end.y + out.y * wall.thicknessCm }
    const quad = [startIn, endIn, endOut, startOut]
    const list = byRoom.get(host.room.id)
    if (list) list.push(quad)
    else byRoom.set(host.room.id, [quad])
  }
  return byRoom
}

/** Jamb segment from the room edge point `p` across the wall thickness. */
export function jambSegment(p: Vec, wall: OpeningWall): { a: Vec; b: Vec } {
  return { a: p, b: { x: p.x + wall.out.x * wall.thicknessCm, y: p.y + wall.out.y * wall.thicknessCm } }
}

/** Black cutout band across a thick wall: a butt-capped stroke of `width` from (x1,y1) to (x2,y2). */
export type WallCutout = { x1: number; y1: number; x2: number; y2: number; width: number }

/** Mask area (userSpaceOnUse) of one artboard, in cm. */
type MaskArea = { x: number; y: number; width: number; height: number }

export type WallMaskModel = MaskArea & {
  /** Points attribute of each room interior (black in the mask). */
  roomPoints: string[]
  /** Black cutout lines: a stroke of `width` from (x1,y1) to (x2,y2) across the wall. */
  cutouts: WallCutout[]
}

/** Data for the wall mask of one artboard, or null when there is nothing to draw. */
export function wallMaskModel(artboard: Pick<Artboard, 'rooms' | 'openings'>, thicknessCm: number): WallMaskModel | null {
  if (!(thicknessCm > 0)) return null
  const rooms = artboard.rooms.filter((r) => r.vertices.length >= 3)
  if (rooms.length === 0) return null
  // Miter joins can reach limit * thickness past a corner.
  const area = maskArea(rooms, thicknessCm * 4 + 20)
  const cutouts: WallCutout[] = []
  for (const op of artboard.openings) {
    const out = openingOutward(rooms, op)
    if (!out) continue
    // A little overshoot on both sides so no sliver of wall survives at the faces.
    cutouts.push({
      x1: op.xCm - out.x, y1: op.yCm - out.y,
      x2: op.xCm + out.x * (thicknessCm + 1), y2: op.yCm + out.y * (thicknessCm + 1),
      width: op.widthCm,
    })
  }
  return {
    ...area,
    roomPoints: rooms.map((r) => r.vertices.map((v) => `${v.x},${v.y}`).join(' ')),
    cutouts,
  }
}

export type WallStrokeMaskModel = MaskArea & {
  /** One butt-capped cutout per opening that crosses a thick wall. */
  cutouts: WallCutout[]
}

/**
 * Data for the mask that hides the room border strokes and the wall paint lines inside an opening
 * that crosses a thick wall (the wall body has its own mask). Every cutout is a butt-capped stroke
 * of the exact opening width, from `padCm` inside the room to `padCm` past the outer wall face, so
 * both room borders and the whole wall vanish through the opening and leave the page below clean.
 * `padCm` is the extra reach on both faces: `Math.max(px(3), 1.5)` on screen. Null when walls are thin.
 *
 * The cutout always uses the artboard thickness, never the effective thickness of the opening: on a
 * thick-wall artboard a flush opening (0 cm gap, see `effectiveWallThickness`) still needs the full
 * band, so the 1px border lines of BOTH flush rooms are cut away across the opening.
 */
export function wallStrokeMaskModel(
  artboard: Pick<Artboard, 'rooms' | 'openings'>,
  thicknessCm: number,
  padCm: number,
): WallStrokeMaskModel | null {
  if (!(thicknessCm > 0)) return null
  const rooms = artboard.rooms.filter((r) => r.vertices.length >= 3)
  if (rooms.length === 0) return null
  const pad = Math.max(padCm, 1.5)
  const cutouts: WallCutout[] = []
  for (const op of artboard.openings) {
    const out = openingOutward(rooms, op)
    if (!out) continue
    cutouts.push({
      x1: op.xCm - out.x * pad, y1: op.yCm - out.y * pad,
      x2: op.xCm + out.x * (thicknessCm + pad), y2: op.yCm + out.y * (thicknessCm + pad),
      width: op.widthCm,
    })
  }
  // Room strokes and paint lines lie on the room edges; cutouts reach at most `thicknessCm + pad`
  // outward from them. Keep the box tight: it sets the size of the offscreen mask raster.
  return { ...maskArea(rooms, thicknessCm + pad * 2 + 5), cutouts }
}

/** Axis box of the room polygons grown by `pad` on every side, with finite values. */
function maskArea(rooms: Room[], pad: number): MaskArea {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const r of rooms) for (const v of r.vertices) {
    minX = Math.min(minX, v.x); minY = Math.min(minY, v.y); maxX = Math.max(maxX, v.x); maxY = Math.max(maxY, v.y)
  }
  return {
    x: minX - pad, y: minY - pad, width: maxX - minX + 2 * pad, height: maxY - minY + 2 * pad,
  }
}
