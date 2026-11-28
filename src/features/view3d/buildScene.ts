// Pure 3D scene geometry for the Views mode (docs/3d-and-finishes.md). No React, no Three.js, no DOM.
// It turns one artboard into plain data that a renderer can draw without any geometry maths.
//
// Space: artboard-local cm (artboard.xCm/yCm are NOT added). 2D (xCm, yCm) -> 3D (X = xCm, Y = height, Z = yCm).
// Rotation about the Y axis: rotationY = -deg * PI / 180 (a 2D clockwise-on-screen turn is a negative
// turn about +Y, because Y points up while 2D y points down).
//
// Walls follow the 2D model: a room keeps its interior polygon and the wall is a box built OUTWARD from
// the room edge. Two kinds of wall segment exist:
//   - exterior walls: `thicknessSide` 'outward', the box spans 0..thicknessCm along outwardNormal (inner face
//     ON the room edge). A long edge that is only partly shared gives one exterior wall per uncovered span;
//   - shared (unified) walls: where the edges of two rooms face each other (anti-parallel normals), flush or
//     across a gap smaller than two wall thicknesses, ONE wall covers the overlapping span. It is built from
//     the edge of the first room (A): 'outward' with thicknessCm = gap (from A's edge to B's edge, no overlap,
//     no seam), or 'centered' (thin 6 cm wall straddling the shared line) when flush. `innerColor` paints the
//     face towards room A, `oppositeColor` the face towards room B. `isInterior` is true.
//   - `start` / `end` are points on the edge line of room A (or of the room itself for an exterior wall), in the
//     ORIGINAL vertex order, so `edgeIndex` and `wallColors` keep working whatever the winding of the room is;
//   - `kind` is 'fence' when the edge is a fence (balcony railing): the box then uses the fence height
//     and thickness, and no corner post is emitted where a fence meets another wall;
//   - `center` is the middle of the wall box;
//   - pieces and window panes use `u` = distance in cm from `start` along start -> end (0..lengthCm)
//     and `y` = height above the floor in cm.
import { signedArea } from '../../model/geometry'
import type { Vec } from '../../model/geometry'
import {
  DEFAULT_CEILING_HEIGHT_CM, DEFAULT_FENCE_HEIGHT_CM, furnitureHeightCm, openingHeightCm, openingSillCm,
} from '../../model/defaults'
import { furnitureParts, shade } from './furnitureSolids'
import type { FurniturePartData } from './furnitureSolids'
import type { Artboard, FloorPattern, FurnitureItem, Opening, Room, WallKind, WallViewMode } from '../../model/types'
import { openingEndpoints } from '../openings/geometry'
import { hostWallIn } from '../openings/sync'
import {
  FENCE_COLOR, FENCE_THICKNESS_CM, edgeOutwardNormal, effectiveWallThickness, isFenceWall, roomDoorThresholds, wallThicknessOf,
} from '../rooms/walls'

/** Default paint of the room side of a wall. */
export const DEFAULT_WALL_INNER_COLOR = '#d9d6d0'
/** Default paint of the outer side of a wall. */
export const DEFAULT_WALL_OUTER_COLOR = '#b9b5ad'
/** Visual wall thickness used when the artboard turns thick walls off (thickness 0), in cm. */
export const THIN_WALL_FALLBACK_CM = 6
/** Thickness of a flush shared (interior) wall, in cm. */
export const INTERIOR_WALL_CM = THIN_WALL_FALLBACK_CM
/** Fallback thickness of an exterior wall span that sits right behind a room of another kind, in cm. */
export const INTERIOR_HALF_WALL_CM = THIN_WALL_FALLBACK_CM / 2
/** Rooms whose facing edges are this close (cm) share one flush wall. */
export const SHARED_FLUSH_CM = 1
/** Height of a wall in 'off' mode, in cm. */
export const DEFAULT_CURB_CM = 10
/** Height of a cut-away wall, in cm. */
export const DEFAULT_CUTAWAY_STUB_CM = 30
/** Furniture at or under this height (rugs) is lifted by RUG_LIFT_CM to avoid z-fighting with the floor. */
export const RUG_MAX_HEIGHT_CM = 2
export const RUG_LIFT_CM = 0.5

const EPS = 1e-6

/** A point on the floor plane (3D X, Z). */
export type Pt = { x: number; z: number }

export type SceneBounds = {
  minX: number; maxX: number; minZ: number; maxZ: number
  centerX: number; centerZ: number
  sizeX: number; sizeZ: number
  maxY: number
}

export type FloorMeshData = {
  roomId: string
  name: string
  /** Outline with a consistent winding: signedArea of (x, z) is positive. */
  vertices: Pt[]
  fill?: string
  floorPattern?: FloorPattern
  floorPatternAngleDeg?: number
}

/** A floor quad that bridges a thick wall at a door or an open passage. */
export type DoorThresholdData = {
  roomId: string
  vertices: Pt[]
  fill?: string
  floorPattern?: FloorPattern
  floorPatternAngleDeg?: number
}

/** A solid rectangle of a wall: u0..u1 along the wall, y0..y1 above the floor (cm). */
export type WallPieceData = { u0: number; u1: number; y0: number; y1: number }

/** The glass of a window opening, in the same wall space as the pieces. */
export type WindowPaneData = { openingId: string; u0: number; u1: number; y0: number; y1: number }

/** Kind of a 3D opening model. 'sliding-door' is a door of variant 'pocket', 'bypass' or 'bypass-glass'. */
export type OpeningModelKind = 'window' | 'door' | 'sliding-door'
/** What a model part is: frames and sills are solid; glass is translucent; leaf, handle and panel are solid too. */
export type OpeningPartKind = 'frame' | 'sill' | 'mullion' | 'glass' | 'leaf' | 'handle' | 'panel'

/**
 * One box of an opening model, in wall space: `u` along the wall from its start, `y` above the floor, `d` along the
 * wall's outward normal from the start line (so the wall mid-plane is at `(o0 + o1) / 2` of wallSideOffsets).
 * `su` / `sy` / `sd` are the box sizes along its own axes; `rotation` turns the box about the vertical axis, in the
 * (u, d) plane (0 = long side along u; positive turns from +u towards +d). `y0` / `y1` are the vertical span
 * to clip to a lowered wall (clipSpanToHeight). `solid` parts get blueprint edge lines.
 */
export type OpeningPartData = {
  kind: OpeningPartKind
  color: string
  u: number; y: number; d: number
  su: number; sy: number; sd: number
  rotation: number
  y0: number; y1: number
  solid: boolean
}

export type OpeningModelData = {
  openingId: string
  kind: OpeningModelKind
  /** The cut of the opening in wall space (same as the wall cut). */
  bounds: WallPieceData
  parts: OpeningPartData[]
}

export type WallSegmentData = {
  id: string
  roomId: string
  /** Index of the room edge in the ORIGINAL vertex order. */
  edgeIndex: number
  start: Pt
  end: Pt
  center: Pt
  lengthCm: number
  thicknessCm: number
  /**
   * Side of the start -> end line the box sits on: 'outward' (spans 0..thicknessCm along outwardNormal),
   * 'inward' (-thicknessCm..0) or 'centered' (-thicknessCm/2..+thicknessCm/2).
   */
  thicknessSide: 'outward' | 'inward' | 'centered'
  /** 'wall' for a normal wall, 'fence' for a low railing (balcony parapet, low garden wall). */
  kind: WallKind
  /** Full height of the wall in cm: the ceiling height, or the fence height for a fence wall. */
  heightCm: number
  /** Unit normal in the floor plane, pointing away from the room (of room A for a shared wall). */
  outwardNormal: Pt
  /** True for a shared wall: one unified wall between two rooms. */
  isInterior: boolean
  /** Cutaway group: always the wall id (a unified wall is one unit). */
  cutawayGroupId: string
  /** Ids of the room edges (`roomId:edgeIndex`) merged into this shared wall (empty when exterior). */
  pairedWallIds: string[]
  /** Paint of the face towards the room (room A on a shared wall). */
  innerColor: string
  /** Paint of the top, the ends and (exterior) the far face. */
  outerColor: string
  /** Paint of the face towards room B on a shared wall; absent on an exterior wall (use outerColor). */
  oppositeColor?: string
  /** Joined 2D footprint polygon on the floor plane (X, Z), non-overlapping with neighbouring walls. */
  footprint: Pt[]
  pieces: WallPieceData[]
  windowPanes: WindowPaneData[]
  /** Clean 3D models (frames, glass, leaves, ...) of the windows and doors in this wall, one per opening. */
  openingModels: OpeningModelData[]
}

export type CornerPostData = {
  id: string
  roomId: string
  vertexIndex: number
  /** Footprint of the post (floor plane), at the outside of a convex corner. */
  vertices: Pt[]
  heightCm: number
  /** Ids of the two walls that meet at the corner: the post follows their height in cutaway. */
  wallIds: [string, string]
}

export type FurnitureMeshData = {
  id: string
  name: string
  shape: 'rect' | 'circle'
  x: number
  /** Centre height: heightCm / 2, plus RUG_LIFT_CM for flat items. */
  y: number
  z: number
  widthCm: number
  depthCm: number
  heightCm: number
  rotationY: number
  color: string
  /** Radii of the corners [top-left, top-right, bottom-right, bottom-left], each within 0..min(w, d) / 2. */
  cornerRadiiCm: [number, number, number, number]
  /** Basic solids that make the item (item-local cm, see furnitureSolids.ts). Never empty. */
  parts: FurniturePartData[]
}

export type SceneData = {
  bounds: SceneBounds
  floors: FloorMeshData[]
  thresholds: DoorThresholdData[]
  walls: WallSegmentData[]
  cornerPosts: CornerPostData[]
  furniture: FurnitureMeshData[]
}

const toPt = (v: Vec): Pt => ({ x: v.x, z: v.y })
const finite = (n: number, fallback: number) => (Number.isFinite(n) ? n : fallback)

const wallId = (roomId: string, edgeIndex: number) => `${roomId}:${edgeIndex}`

// ---------- floors ----------

/** Floor outline with a positive signedArea (x, z), whatever the winding of the room. */
function floorOutline(room: Room): Pt[] {
  const pts = signedArea(room.vertices) >= 0 ? room.vertices : [...room.vertices].reverse()
  return pts.map(toPt)
}

// ---------- walls ----------

type WallBuild = {
  wall: WallSegmentData
  /** Unit direction start -> end. */
  dir: Pt
  /** Cut rectangles (wall space) from openings. */
  cuts: WallPieceData[]
  /** Exterior wall: the u-range of the room edge it covers. Null for a shared wall. */
  edgeSpan: { u0: number; u1: number; edgeLengthCm: number } | null
}

type EdgeInfo = {
  room: Room
  index: number
  id: string
  a: Pt
  b: Pt
  lengthCm: number
  dir: Pt
  n: Pt
  /** u-ranges of this edge that a shared wall already covers. */
  covered: [number, number][]
}

/** Offsets (cm) of the two faces of a wall box along its outward normal: [0, t], [-t, 0] or [-t/2, t/2]. */
export function wallSideOffsets(w: Pick<WallSegmentData, 'thicknessSide' | 'thicknessCm'>): [number, number] {
  if (w.thicknessSide === 'outward') return [0, w.thicknessCm]
  if (w.thicknessSide === 'inward') return [-w.thicknessCm, 0]
  return [-w.thicknessCm / 2, w.thicknessCm / 2]
}

/** Overlap of two spans in cm. */
const spanOverlap = (lo: number, hi: number, c: [number, number]) => Math.min(hi, c[1]) - Math.max(lo, c[0])

/**
 * Shared span of two facing edges: anti-parallel normals, b beyond a along a's normal, flush (gap <= 1 cm)
 * or across a gap below `maxGapCm`. Returns the gap and the overlap [lo, hi] in the u-space of each edge.
 */
function sharedSpan(
  ea: EdgeInfo, eb: EdgeInfo, maxGapCm: number,
): { gap: number; a: [number, number]; b: [number, number] } | null {
  if (ea.room.id === eb.room.id) return null
  if (ea.n.x * eb.n.x + ea.n.z * eb.n.z > -0.95) return null
  const ds = [eb.a, eb.b].map((p) => (p.x - ea.a.x) * ea.n.x + (p.z - ea.a.z) * ea.n.z)
  if (Math.abs(ds[0] - ds[1]) > SHARED_FLUSH_CM) return null
  const gap = (ds[0] + ds[1]) / 2
  if (gap < -SHARED_FLUSH_CM || gap >= maxGapCm) return null
  const ub = [eb.a, eb.b].map((p) => (p.x - ea.a.x) * ea.dir.x + (p.z - ea.a.z) * ea.dir.z)
  const lo = Math.max(0, Math.min(ub[0], ub[1])), hi = Math.min(ea.lengthCm, Math.max(ub[0], ub[1]))
  if (hi - lo <= 1) return null
  const toB = (u: number) => {
    const px = ea.a.x + ea.dir.x * u, pz = ea.a.z + ea.dir.z * u
    return (px - eb.a.x) * eb.dir.x + (pz - eb.a.z) * eb.dir.z
  }
  const b0 = toB(lo), b1 = toB(hi)
  return { gap, a: [lo, hi], b: [Math.max(0, Math.min(b0, b1)), Math.min(eb.lengthCm, Math.max(b0, b1))] }
}

/**
 * Vertical span y0..y1 of a wall piece or window pane clipped to a lowered wall of `heightCm`, or null
 * when nothing of it remains (it starts at or above that height). Pieces are CLIPPED, never squashed:
 * a lintel above a door must vanish when the wall drops, so the doorway stays open down to the floor.
 */
export function clipSpanToHeight(y0: number, y1: number, heightCm: number): { y0: number; y1: number } | null {
  const hi = Math.min(y1, heightCm)
  return hi - y0 > EPS ? { y0, y1: hi } : null
}

/** Solid rectangles of a wall of `lengthCm` x `heightCm` around the cut rectangles. No CSG. */
export function splitWallPieces(lengthCm: number, heightCm: number, cuts: readonly WallPieceData[]): WallPieceData[] {
  const clipped = cuts
    .map((c) => ({
      u0: Math.max(0, Math.min(c.u0, c.u1)), u1: Math.min(lengthCm, Math.max(c.u0, c.u1)),
      y0: Math.max(0, Math.min(c.y0, c.y1)), y1: Math.min(heightCm, Math.max(c.y0, c.y1)),
    }))
    .filter((c) => c.u1 - c.u0 > EPS && c.y1 - c.y0 > EPS)
  const breaks = [...new Set([0, lengthCm, ...clipped.flatMap((c) => [c.u0, c.u1])])].sort((a, b) => a - b)
  const pieces: WallPieceData[] = []
  const push = (p: WallPieceData) => {
    if (p.u1 - p.u0 <= EPS || p.y1 - p.y0 <= EPS) return
    // Join with a piece that ends where this one starts and has the same height range.
    const left = pieces.find((q) => Math.abs(q.u1 - p.u0) < EPS && Math.abs(q.y0 - p.y0) < EPS && Math.abs(q.y1 - p.y1) < EPS)
    if (left) left.u1 = p.u1
    else pieces.push({ ...p })
  }
  for (let i = 0; i + 1 < breaks.length; i++) {
    const a = breaks[i], b = breaks[i + 1]
    if (b - a <= EPS) continue
    const mid = (a + b) / 2
    const ranges = clipped
      .filter((c) => c.u0 < mid && mid < c.u1)
      .map((c) => [c.y0, c.y1] as [number, number])
      .sort((p, q) => p[0] - q[0])
    let y = 0
    for (const [r0, r1] of ranges) {
      if (r0 > y) push({ u0: a, u1: b, y0: y, y1: r0 })
      y = Math.max(y, r1)
    }
    if (y < heightCm) push({ u0: a, u1: b, y0: y, y1: heightCm })
  }
  return pieces
}


// ---------- opening models ----------

/** Frame member thickness (cm). */
export const OPENING_FRAME_CM = 4
/** The sill of a window sticks out of each wall face by this much (cm). */
export const WINDOW_SILL_PROUD_CM = 2
/** Mullion width of a wide window (cm), and the window width from which it appears. */
export const MULLION_CM = 3
export const MULLION_MIN_WINDOW_CM = 100
/** Door leaf thickness and ajar angle. */
export const DOOR_LEAF_CM = 4
export const DOOR_AJAR_DEG = 28
export const GLASS_LEAF_STILE_CM = 5
export const GLASS_LEAF_BOTTOM_RAIL_CM = 13
export const GLASS_LEAF_TOP_RAIL_CM = 6
/** Sliding door: bottom rail height, panel stile width, panel thickness, overlap of the two panels (cm). */
export const SLIDER_RAIL_CM = 2
export const SLIDER_STILE_CM = 4
export const SLIDER_PANEL_CM = 3
export const SLIDER_OVERLAP_CM = 4

const FRAME_COLORS: Record<OpeningModelKind, string> = { window: '#4b4540', door: '#6a5444', 'sliding-door': '#4a4f55' }
const LEAF_COLOR = '#b58d5e'
const HANDLE_COLOR = '#c8c8c8'
const SILL_COLOR = '#d4cfc6'

type Cut = { u0: number; u1: number; y0: number; y1: number }

/** Model kind of an opening, or null when it has no 3D model (an open passage). */
function openingModelKind(op: Opening): OpeningModelKind | null {
  if (op.kind === 'window') return 'window'
  if (op.kind === 'door') return op.variant === 'pocket' || op.variant === 'bypass' || op.variant === 'bypass-glass' ? 'sliding-door' : 'door'
  return null
}

/**
 * Parts of one window or door model inside `cut` (wall space). `midD` is the depth (along the outward normal)
 * of the wall mid-plane and `thick` the wall thickness. `hingeLow` / `side` only matter for hinged doors:
 * hinge at the low-u end, and the side of the swing along the outward normal (+1 outward, -1 inward).
 * `lowPanelSide` is the side (along the outward normal) of the low-u panel of a bypass door, as in the 2D symbol.
 * `normalSide` is the side (along the outward normal) of the 2D +normal, where the 2D pocket panel sits.
 */
function buildOpeningParts(
  kind: OpeningModelKind, op: Opening, cut: Cut, midD: number, thick: number, hingeLow: boolean, side: 1 | -1,
  lowPanelSide: 1 | -1 = 1, normalSide: 1 | -1 = 1,
): OpeningPartData[] {
  const parts: OpeningPartData[] = []
  const width = cut.u1 - cut.u0, h = cut.y1 - cut.y0
  const ft = Math.max(0.5, Math.min(OPENING_FRAME_CM, width / 4, h / 4))
  // A custom colour: the frame, door leaves and panels take it, the sill and door frame a darker shade.
  const custom = op.color
  const frameColor = custom ?? FRAME_COLORS[kind]
  const leafColor = custom ?? LEAF_COLOR
  const sillColor = custom ? shade(custom, 0.8) : SILL_COLOR
  const doorFrameColor = custom ? shade(custom, 0.8) : frameColor
  const box = (
    k: OpeningPartKind, color: string, u0: number, u1: number, y0: number, y1: number, d: number, sd: number,
    rotation = 0, solid = true,
  ) => {
    // A rotated part keeps su as its length along its own axis: u0..u1 is then the length, centred where given.
    if (u1 - u0 <= EPS || y1 - y0 <= EPS || sd <= EPS) return
    parts.push({ kind: k, color, u: (u0 + u1) / 2, y: (y0 + y1) / 2, d, su: u1 - u0, sy: y1 - y0, sd, rotation, y0, y1, solid })
  }
  const inU0 = cut.u0 + ft, inU1 = cut.u1 - ft
  const head0 = cut.y1 - ft

  if (kind === 'window') {
    const sillTop = cut.y0 + ft
    box('sill', sillColor, cut.u0, cut.u1, cut.y0, sillTop, midD, thick + 2 * WINDOW_SILL_PROUD_CM)
    box('frame', frameColor, cut.u0, inU0, sillTop, cut.y1, midD, thick)
    box('frame', frameColor, inU1, cut.u1, sillTop, cut.y1, midD, thick)
    box('frame', frameColor, inU0, inU1, head0, cut.y1, midD, thick)
    box('glass', '#9fd3ff', inU0, inU1, sillTop, head0, midD, 0.8, 0, false)
    if (width >= MULLION_MIN_WINDOW_CM) {
      const mid = (cut.u0 + cut.u1) / 2
      box('mullion', frameColor, mid - MULLION_CM / 2, mid + MULLION_CM / 2, sillTop, head0, midD, Math.min(thick, OPENING_FRAME_CM))
    }
    return parts
  }

  if (kind === 'sliding-door') {
    // Glass bypass: the frame is the custom colour itself. Solid sliders: a darker frame around the coloured panels.
    const slideFrameColor = op.variant === 'bypass-glass' ? frameColor : doorFrameColor
    const rail = Math.min(SLIDER_RAIL_CM, h / 4)
    box('frame', slideFrameColor, cut.u0, inU0, cut.y0, cut.y1, midD, thick)
    box('frame', slideFrameColor, inU1, cut.u1, cut.y0, cut.y1, midD, thick)
    box('frame', slideFrameColor, inU0, inU1, head0, cut.y1, midD, thick)
    box('frame', slideFrameColor, inU0, inU1, cut.y0, cut.y0 + rail, midD, thick)
    const inner = inU1 - inU0
    const py0 = cut.y0 + rail, py1 = head0
    const off = SLIDER_PANEL_CM / 2 + 0.2
    // Solid panel: one leaf with a small flush pull handle on both faces, `pullU` from the free edge.
    const solid = (u0: number, u1: number, d: number, pullAtHigh: boolean) => {
      box('leaf', leafColor, u0, u1, py0, py1, d, SLIDER_PANEL_CM)
      const hy = Math.max(py0 + 3, Math.min(100, py1 - 3))
      const hu = pullAtHigh ? u1 - 6 : u0 + 6
      for (const f of [-1, 1]) box('handle', HANDLE_COLOR, hu - 2, hu + 2, hy - 4, hy + 4, d + f * (SLIDER_PANEL_CM / 2 + 0.3), 0.6)
    }
    if (op.variant === 'pocket') {
      // One solid panel slid part way out of the pocket on the hinge side, on the 2D +normal side.
      const pw = inner * 0.65
      const d = midD + normalSide * off
      if (hingeLow) solid(inU0, inU0 + pw, d, true)
      else solid(inU1 - pw, inU1, d, false)
      return parts
    }
    const pw = (inner + SLIDER_OVERLAP_CM) / 2
    if (op.variant === 'bypass-glass') {
      const st = Math.min(SLIDER_STILE_CM, pw / 4, (py1 - py0) / 4)
      const panel = (u0: number, u1: number, d: number) => {
        box('panel', frameColor, u0, u1, py0, py0 + st, d, SLIDER_PANEL_CM)
        box('panel', frameColor, u0, u1, py1 - st, py1, d, SLIDER_PANEL_CM)
        box('panel', frameColor, u0, u0 + st, py0 + st, py1 - st, d, SLIDER_PANEL_CM)
        box('panel', frameColor, u1 - st, u1, py0 + st, py1 - st, d, SLIDER_PANEL_CM)
        box('glass', '#9fd3ff', u0 + st, u1 - st, py0 + st, py1 - st, d, 0.6, 0, false)
      }
      panel(inU0, inU0 + pw, midD + lowPanelSide * off)
      panel(inU1 - pw, inU1, midD - lowPanelSide * off)
      return parts
    }
    // Bypass: two solid overlapping panels, handles on the overlapping edges.
    solid(inU0, inU0 + pw, midD + lowPanelSide * off, true)
    solid(inU1 - pw, inU1, midD - lowPanelSide * off, false)
    return parts
  }

  // Hinged door: frame (jambs + head) and one ajar leaf, or two for a french door.
  // A glass french door keeps the opening colour itself on its frame, as the glass bypass does.
  const hingedFrameColor = op.variant === 'french-glass' ? frameColor : doorFrameColor
  box('frame', hingedFrameColor, cut.u0, inU0, cut.y0, cut.y1, midD, thick)
  box('frame', hingedFrameColor, inU1, cut.u1, cut.y0, cut.y1, midD, thick)
  box('frame', hingedFrameColor, inU0, inU1, head0, cut.y1, midD, thick)
  const leafH = head0 - cut.y0
  const beta = (DOOR_AJAR_DEG * Math.PI) / 180
  const leaf = (pivotU: number, e: 1 | -1, length: number) => {
    if (length <= EPS || leafH <= EPS) return
    // Leaf direction in the (u, d) plane: closed along e, turned ajar towards the swing side.
    const dirU = e * Math.cos(beta), dirD = side * Math.sin(beta)
    const alpha = Math.atan2(dirD, dirU)
    const cu = pivotU + dirU * length / 2, cd = midD + dirD * length / 2
    parts.push({
      kind: 'leaf', color: leafColor, u: cu, y: cut.y0 + leafH / 2, d: cd,
      su: length, sy: leafH, sd: DOOR_LEAF_CM, rotation: alpha, y0: cut.y0, y1: cut.y0 + leafH, solid: true,
    })
    // A small knob on both faces of the leaf, near the latch edge, about 100 cm above the floor.
    const hy = Math.max(cut.y0 + 3, Math.min(100, cut.y0 + leafH - 3))
    const lx = Math.max(length / 2, length - 7)
    const px = -Math.sin(alpha), py = Math.cos(alpha)
    for (const f of [-1, 1]) {
      const along = lx - length / 2, off = f * (DOOR_LEAF_CM / 2 + 1.5)
      parts.push({
        kind: 'handle', color: HANDLE_COLOR, u: cu + Math.cos(alpha) * along + px * off, y: hy,
        d: cd + Math.sin(alpha) * along + py * off,
        su: Math.min(8, length / 2), sy: 3, sd: 3, rotation: alpha, y0: hy - 1.5, y1: hy + 1.5, solid: true,
      })
    }
  }
  // Glass leaf: framed pane. Local axes: s along the leaf from the hinge (0) to the latch (length),
  // o across it. World (u, d) = pivot + a * s + p * o, with a = (cos, sin) of the leaf angle, p = (-sin, cos).
  const glassLeaf = (pivotU: number, e: 1 | -1, length: number) => {
    if (length <= EPS || leafH <= EPS) return
    const dirU = e * Math.cos(beta), dirD = side * Math.sin(beta)
    const alpha = Math.atan2(dirD, dirU)
    const ax = Math.cos(alpha), ay = Math.sin(alpha), px = -ay, py = ax
    const place = (k: OpeningPartKind, color: string, s0: number, s1: number, ya: number, yb: number, o: number, sd: number, solid: boolean) => {
      if (s1 - s0 <= EPS || yb - ya <= EPS) return
      const sm = (s0 + s1) / 2
      parts.push({
        kind: k, color, u: pivotU + ax * sm + px * o, y: (ya + yb) / 2, d: midD + ay * sm + py * o,
        su: s1 - s0, sy: yb - ya, sd, rotation: alpha, y0: ya, y1: yb, solid,
      })
    }
    const st = Math.min(GLASS_LEAF_STILE_CM, length / 4)
    const bot = Math.min(GLASS_LEAF_BOTTOM_RAIL_CM, leafH / 4), top = Math.min(GLASS_LEAF_TOP_RAIL_CM, leafH / 4)
    const ly0 = cut.y0, ly1 = cut.y0 + leafH
    place('panel', frameColor, 0, st, ly0, ly1, 0, DOOR_LEAF_CM, true)
    place('panel', frameColor, length - st, length, ly0, ly1, 0, DOOR_LEAF_CM, true)
    place('panel', frameColor, st, length - st, ly0, ly0 + bot, 0, DOOR_LEAF_CM, true)
    place('panel', frameColor, st, length - st, ly1 - top, ly1, 0, DOOR_LEAF_CM, true)
    // The pane is thinner than the frame bars and sits inside their opening: no shared faces, no z-fighting.
    place('glass', '#9fd3ff', st, length - st, ly0 + bot, ly1 - top, 0, 0.6, false)
    // A knob on both faces of the latch stile, about 100 cm above the floor.
    const hy = Math.max(ly0 + 3, Math.min(100, ly1 - 3))
    const hs = length - st / 2
    for (const f of [-1, 1]) {
      const o = f * (DOOR_LEAF_CM / 2 + 1.5)
      parts.push({
        kind: 'handle', color: HANDLE_COLOR, u: pivotU + ax * hs + px * o, y: hy, d: midD + ay * hs + py * o,
        su: Math.min(8, length / 2), sy: 3, sd: 3, rotation: alpha, y0: hy - 1.5, y1: hy + 1.5, solid: true,
      })
    }
  }
  if (op.variant === 'french-glass') {
    const half = (inU1 - inU0) / 2
    glassLeaf(inU0, 1, half)
    glassLeaf(inU1, -1, half)
  } else if (op.variant === 'french') {
    const half = (inU1 - inU0) / 2
    leaf(inU0, 1, half)
    leaf(inU1, -1, half)
  } else if (hingeLow) leaf(inU0, 1, inU1 - inU0)
  else leaf(inU1, -1, inU1 - inU0)
  return parts
}

function buildWalls(artboard: Artboard, rooms: Room[], heightCm: number): WallBuild[] {
  const thickness = wallThicknessOf(artboard)
  const edges: EdgeInfo[] = []
  for (const room of rooms) {
    const v = room.vertices
    for (let i = 0; i < v.length; i++) {
      const a = v[i], b = v[(i + 1) % v.length]
      const out = edgeOutwardNormal(room, i)
      if (!out) continue
      const lengthCm = Math.hypot(b.x - a.x, b.y - a.y)
      edges.push({
        room, index: i, id: wallId(room.id, i), a: toPt(a), b: toPt(b), lengthCm,
        dir: { x: (b.x - a.x) / lengthCm, z: (b.y - a.y) / lengthCm },
        n: { x: out.x, z: out.y }, covered: [],
      })
    }
  }
  const colorOf = (e: EdgeInfo) => e.room.wallColors?.[String(e.index)] ?? DEFAULT_WALL_INNER_COLOR
  const maxGap = thickness > 0 ? 2 * thickness : SHARED_FLUSH_CM + 1e-9

  // Shared walls: ONE unified wall per overlapping span of two facing edges.
  const shared: WallBuild[] = []
  const usedIds = new Set<string>()
  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      const ea = edges[i], eb = edges[j]
      const sp = sharedSpan(ea, eb, maxGap)
      if (!sp) continue
      if (ea.covered.some((c) => spanOverlap(sp.a[0], sp.a[1], c) > 1)) continue
      if (eb.covered.some((c) => spanOverlap(sp.b[0], sp.b[1], c) > 1)) continue
      ea.covered.push(sp.a)
      eb.covered.push(sp.b)
      const flush = sp.gap <= SHARED_FLUSH_CM
      // A shared wall is a fence only when BOTH rooms mark their edge as a fence: one solid side
      // still needs a full-height wall.
      const fence = isFenceWall(ea.room, ea.index) && isFenceWall(eb.room, eb.index)
      const t = fence ? FENCE_THICKNESS_CM : flush ? INTERIOR_WALL_CM : sp.gap
      const height = fence ? Math.min(heightCm, DEFAULT_FENCE_HEIGHT_CM) : heightCm
      const [u0, u1] = sp.a
      const start = { x: ea.a.x + ea.dir.x * u0, z: ea.a.z + ea.dir.z * u0 }
      const end = { x: ea.a.x + ea.dir.x * u1, z: ea.a.z + ea.dir.z * u1 }
      const shift = flush ? 0 : t / 2
      let id = `shared:${ea.id}|${eb.id}`
      for (let k = 2; usedIds.has(id); k++) id = `shared:${ea.id}|${eb.id}#${k}`
      usedIds.add(id)
      shared.push({
        dir: ea.dir, cuts: [], edgeSpan: null,
        wall: {
          id, roomId: ea.room.id, edgeIndex: ea.index, start, end,
          center: { x: (start.x + end.x) / 2 + ea.n.x * shift, z: (start.z + end.z) / 2 + ea.n.z * shift },
          lengthCm: u1 - u0, thicknessCm: t, thicknessSide: flush ? 'centered' : 'outward',
          kind: fence ? 'fence' : 'wall', heightCm: height,
          outwardNormal: ea.n, isInterior: true, cutawayGroupId: id, pairedWallIds: [ea.id, eb.id],
          innerColor: fence ? (ea.room.wallColors?.[String(ea.index)] ?? FENCE_COLOR) : colorOf(ea),
          outerColor: fence ? FENCE_COLOR : DEFAULT_WALL_OUTER_COLOR,
          oppositeColor: fence ? (eb.room.wallColors?.[String(eb.index)] ?? FENCE_COLOR) : colorOf(eb),
          footprint: [],
          pieces: [], windowPanes: [], openingModels: [],
        },
      })
    }
  }

  // Exterior walls: the part of each edge no shared wall covers.
  const exterior: WallBuild[] = []
  for (const e of edges) {
    const covered = [...e.covered].sort((p, q) => p[0] - q[0])
    const spans: [number, number][] = []
    let cur = 0
    for (const c of covered) {
      if (c[0] - cur > 1) spans.push([cur, c[0]])
      cur = Math.max(cur, c[1])
    }
    if (e.lengthCm - cur > 1) spans.push([cur, e.lengthCm])
    const whole = covered.length === 0
    const fence = isFenceWall(e.room, e.index)
    const fenceColor = e.room.wallColors?.[String(e.index)] ?? FENCE_COLOR
    const wallHeight = fence ? Math.min(heightCm, DEFAULT_FENCE_HEIGHT_CM) : heightCm
    spans.forEach(([u0, u1], k) => {
      const s0 = whole ? 0 : u0, s1 = whole ? e.lengthCm : u1
      const start = { x: e.a.x + e.dir.x * s0, z: e.a.z + e.dir.z * s0 }
      const end = { x: e.a.x + e.dir.x * s1, z: e.a.z + e.dir.z * s1 }
      const mid = { x: (start.x + end.x) / 2, y: (start.z + end.z) / 2 }
      let t: number
      if (fence) t = FENCE_THICKNESS_CM
      else if (thickness > 0) {
        const eff = effectiveWallThickness(rooms, e.room.id, mid, { x: e.n.x, y: e.n.z }, thickness)
        t = eff > 0 ? eff : INTERIOR_HALF_WALL_CM
      } else t = THIN_WALL_FALLBACK_CM
      const id = whole ? e.id : `${e.id}#${k}`
      exterior.push({
        dir: e.dir, cuts: [], edgeSpan: { u0: s0, u1: s1, edgeLengthCm: e.lengthCm },
        wall: {
          id, roomId: e.room.id, edgeIndex: e.index, start, end,
          center: { x: mid.x + e.n.x * t / 2, z: mid.y + e.n.z * t / 2 },
          lengthCm: s1 - s0, thicknessCm: t, thicknessSide: 'outward',
          kind: fence ? 'fence' : 'wall', heightCm: wallHeight,
          outwardNormal: e.n, isInterior: false, cutawayGroupId: id, pairedWallIds: [],
          innerColor: fence ? fenceColor : colorOf(e),
          outerColor: fence ? fenceColor : DEFAULT_WALL_OUTER_COLOR,
          footprint: [],
          pieces: [], windowPanes: [], openingModels: [],
        },
      })
    })
  }
  const builds = [...exterior, ...shared]

  // Openings: cut every wall built on the host edge, a shared wall included, once per opening.
  const onEdge = new Map<string, WallBuild[]>()
  const add = (key: string, b: WallBuild) => onEdge.set(key, [...(onEdge.get(key) ?? []), b])
  for (const b of exterior) add(wallId(b.wall.roomId, b.wall.edgeIndex), b)
  for (const b of shared) for (const key of b.wall.pairedWallIds) add(key, b)
  for (const op of artboard.openings) {
    const host = hostWallIn(rooms, op)
    if (!host) continue
    const targets = onEdge.get(wallId(host.room.id, host.edgeIndex))
    if (!targets) continue
    const sill = openingSillCm(op, heightCm)
    const h = openingHeightCm(op, heightCm)
    if (!(h > EPS)) continue
    const { start, end } = openingEndpoints(op)
    for (const t of targets) {
      const s = t.wall.start
      const u0 = (start.x - s.x) * t.dir.x + (start.y - s.z) * t.dir.z
      const u1 = (end.x - s.x) * t.dir.x + (end.y - s.z) * t.dir.z
      const lo = Math.max(0, Math.min(u0, u1)), hi = Math.min(t.wall.lengthCm, Math.max(u0, u1))
      if (hi - lo <= EPS) continue
      // Never cut above the wall itself: a door or gate on a fence leaves no lintel over the railing.
      const top = Math.min(sill + h, t.wall.heightCm)
      if (top - sill <= EPS) continue
      const cut = { u0: lo, u1: hi, y0: Math.min(sill, t.wall.heightCm), y1: top }
      const dup = (c: WallPieceData) =>
        Math.abs(c.u0 - cut.u0) < 1 && Math.abs(c.u1 - cut.u1) < 1 && Math.abs(c.y0 - cut.y0) < 1 && Math.abs(c.y1 - cut.y1) < 1
      if (!t.cuts.some(dup)) t.cuts.push(cut)
      if (op.kind === 'window') {
        const pane = { openingId: op.id, u0: lo, u1: hi, y0: cut.y0, y1: cut.y1 }
        // One pane per window, also when both rooms of a shared wall carry a window at the same place.
        if (!t.wall.windowPanes.some((q) => q.openingId === op.id || dup(q))) t.wall.windowPanes.push(pane)
      }
      const modelKind = openingModelKind(op)
      // One model per opening, also when both rooms of a shared wall carry an opening at the same place.
      if (modelKind && !t.wall.openingModels.some((m) => m.openingId === op.id || dup(m.bounds))) {
        const [o0, o1] = wallSideOffsets(t.wall)
        const rad = (op.angleDeg * Math.PI) / 180
        // Swing side across the wall: the 2D opening normal (-sin, cos) against the wall's outward normal.
        const along = -Math.sin(rad) * t.wall.outwardNormal.x + Math.cos(rad) * t.wall.outwardNormal.z
        const side = ((op.swing ?? 'in') === 'out' ? -1 : 1) * (along >= 0 ? 1 : -1) as 1 | -1
        const hingeIsStart = (op.hinge ?? 'left') === 'left'
        const hingeLow = hingeIsStart === (u0 <= u1)
        // The 2D bypass symbol puts the panel at the opening start on the +normal side.
        const lowPanelSide = ((u0 <= u1 ? 1 : -1) * (along >= 0 ? 1 : -1)) as 1 | -1
        t.wall.openingModels.push({
          openingId: op.id, kind: modelKind, bounds: cut,
          parts: buildOpeningParts(modelKind, op, cut, (o0 + o1) / 2, t.wall.thicknessCm, hingeLow, side, lowPanelSide, (along >= 0 ? 1 : -1) as 1 | -1),
        })
      }
    }
  }
  for (const b of builds) b.wall.pieces = splitWallPieces(b.wall.lengthCm, b.wall.heightCm, b.cuts)
  joinWallFootprints(rooms, builds)
  return builds
}

// ---------- wall joins (2D footprint polygons) ----------

function signedAreaXZ(poly: readonly Pt[]): number {
  let a = 0
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length]
    a += p.x * q.z - q.x * p.z
  }
  return a / 2
}

const polyAreaXZ = (poly: readonly Pt[]) => (poly.length < 3 ? 0 : Math.abs(signedAreaXZ(poly)))

/** Clip a convex polygon to the half-plane `(p - point) . normal >= 0`. */
function clipConvexPolygon(poly: readonly Pt[], point: Pt, normal: Pt): Pt[] {
  if (poly.length < 3) return []
  const out: Pt[] = []
  const dist = (p: Pt) => (p.x - point.x) * normal.x + (p.z - point.z) * normal.z
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length]
    const da = dist(a), db = dist(b)
    const inA = da >= -1e-7, inB = db >= -1e-7
    if (inA && inB) out.push(b)
    else if (inA && !inB) {
      const t = da / (da - db)
      out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t })
    } else if (!inA && inB) {
      const t = da / (da - db)
      out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t })
      out.push(b)
    }
  }
  const clean: Pt[] = []
  for (const p of out) {
    const prev = clean[clean.length - 1]
    if (!prev || Math.hypot(p.x - prev.x, p.z - prev.z) > 1e-5) clean.push(p)
  }
  if (clean.length > 1 && Math.hypot(clean[0].x - clean[clean.length - 1].x, clean[0].z - clean[clean.length - 1].z) <= 1e-5) {
    clean.pop()
  }
  return polyAreaXZ(clean) > 1e-4 ? clean : []
}

/** Intersection of two convex polygons (both wound with `signedAreaXZ > 0`). */
function intersectConvexPolygons(a: readonly Pt[], b: readonly Pt[]): Pt[] {
  if (a.length < 3 || b.length < 3) return []
  let poly: Pt[] = [...a]
  for (let i = 0; i < b.length; i++) {
    const p = b[i], q = b[(i + 1) % b.length]
    const ex = q.x - p.x, ez = q.z - p.z
    const len = Math.hypot(ex, ez)
    if (len < 1e-9) continue
    // For signedAreaXZ > 0, inward normal of p -> q is (-ez, ex) / len.
    poly = clipConvexPolygon(poly, p, { x: -ez / len, z: ex / len })
    if (poly.length < 3) return []
  }
  return poly
}

function polyBounds(poly: readonly Pt[]): { minX: number; maxX: number; minZ: number; maxZ: number } {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
  for (const p of poly) {
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.z < minZ) minZ = p.z
    if (p.z > maxZ) maxZ = p.z
  }
  return { minX, maxX, minZ, maxZ }
}

/** Unjoined rectangular footprint of a wall, wound with `signedAreaXZ > 0`. */
function baseWallFootprint(w: WallSegmentData): Pt[] {
  const [o0, o1] = wallSideOffsets(w)
  const n = w.outwardNormal
  const rect: Pt[] = [
    { x: w.start.x + n.x * o0, z: w.start.z + n.z * o0 },
    { x: w.end.x + n.x * o0, z: w.end.z + n.z * o0 },
    { x: w.end.x + n.x * o1, z: w.end.z + n.z * o1 },
    { x: w.start.x + n.x * o1, z: w.start.z + n.z * o1 },
  ]
  return signedAreaXZ(rect) >= 0 ? rect : rect.reverse()
}

/**
 * 2D footprint of one piece of a wall (clipped to `p.u0 .. p.u1` along `start -> end`).
 * Returns `[]` if the piece was completely trimmed away by a corner/junction join.
 */
export function wallPieceFootprint(
  w: Pick<WallSegmentData, 'start' | 'end' | 'footprint'>,
  p: Pick<WallPieceData, 'u0' | 'u1'>,
): Pt[] {
  const dx = w.end.x - w.start.x, dz = w.end.z - w.start.z
  const len = Math.hypot(dx, dz)
  if (len < EPS || w.footprint.length < 3) return []
  const dir = { x: dx / len, z: dz / len }
  let poly = clipConvexPolygon(w.footprint, { x: w.start.x + dir.x * p.u0, z: w.start.z + dir.z * p.u0 }, dir)
  if (poly.length < 3) return []
  poly = clipConvexPolygon(poly, { x: w.start.x + dir.x * p.u1, z: w.start.z + dir.z * p.u1 }, { x: -dir.x, z: -dir.z })
  return poly
}

/** Best clipping of `target` against an outward edge of `blocker` (removing the overlap with minimal excess). */
function bestClipOutside(target: readonly Pt[], blocker: readonly Pt[], overlapArea: number) {
  const targetArea = polyAreaXZ(target)
  let bestPoly: Pt[] | null = null
  let bestExcess = Infinity
  let bestKept = -1
  for (let i = 0; i < blocker.length; i++) {
    const p = blocker[i], q = blocker[(i + 1) % blocker.length]
    const ex = q.x - p.x, ez = q.z - p.z
    const len = Math.hypot(ex, ez)
    if (len < 1e-9) continue
    // Outward normal of blocker edge p -> q (signedAreaXZ > 0).
    const out = { x: ez / len, z: -ex / len }
    const clipped = clipConvexPolygon(target, p, out)
    const kept = polyAreaXZ(clipped)
    const excess = Math.max(0, (targetArea - kept) - overlapArea)
    if (excess < bestExcess - 1e-3 || (Math.abs(excess - bestExcess) <= 1e-3 && kept > bestKept)) {
      bestExcess = excess
      bestKept = kept
      bestPoly = clipped
    }
  }
  const lostFrac = targetArea > EPS ? (targetArea - Math.max(0, bestKept)) / targetArea : 1
  return { poly: bestPoly ?? [...target], excess: bestExcess, lostFrac }
}

/**
 * Trim/miter wall footprints so no two wall solids overlap at corners or T-junctions:
 * 1. Same-room reflex corners with matching height/kind get a clean miter join along `V -> M`.
 * 2. All other overlaps (T-junctions, different-height corners, cross-room corners) trim the yielding
 *    wall cleanly against the other wall's face. Lower walls always yield to higher walls.
 */
function joinWallFootprints(rooms: Room[], builds: WallBuild[]): void {
  for (const b of builds) b.wall.footprint = baseWallFootprint(b.wall)

  // Map exterior walls by edge id for same-room reflex corner detection.
  const ext = new Map<string, WallBuild[]>()
  const edgeIds = new Set<string>()
  for (const b of builds) {
    const key = wallId(b.wall.roomId, b.wall.edgeIndex)
    if (b.edgeSpan) ext.set(key, [...(ext.get(key) ?? []), b])
    if (!b.edgeSpan && b.wall.pairedWallIds.length) b.wall.pairedWallIds.forEach((k) => edgeIds.add(k))
    edgeIds.add(key)
  }

  const joined = new Set<string>()
  const pairKey = (a: number, b: number) => (a < b ? `${a}|${b}` : `${b}|${a}`)
  const indexOf = new Map(builds.map((b, idx) => [b, idx]))

  // 1. Same-room reflex corners.
  for (const room of rooms) {
    const n = room.vertices.length
    const s = signedArea(room.vertices) >= 0 ? 1 : -1
    for (let k = 0; k < n; k++) {
      const nextKey = wallId(room.id, k)
      let prevKey: string | undefined
      for (let j = 1; j < n && !prevKey; j++) {
        const key = wallId(room.id, (k - j + n * 2) % n)
        if (edgeIds.has(key)) prevKey = key
      }
      if (!prevKey || !edgeIds.has(nextKey)) continue
      const next = ext.get(nextKey)?.find((b) => (b.edgeSpan?.u0 ?? 1) < EPS)
      const prev = ext.get(prevKey)?.find((b) => b.edgeSpan !== null && b.edgeSpan.edgeLengthCm - b.edgeSpan.u1 < EPS)
      if (!prev || !next || prev === next) continue
      const cross = prev.dir.x * next.dir.z - prev.dir.z * next.dir.x
      if (cross * s >= -1e-3) continue // convex or straight

      const pi = indexOf.get(prev)!, ni = indexOf.get(next)!
      const v = next.wall.start
      const tp = prev.wall.thicknessCm, tn = next.wall.thicknessCm
      const sameHeightAndKind = Math.abs(prev.wall.heightCm - next.wall.heightCm) < EPS && prev.wall.kind === next.wall.kind
      if (sameHeightAndKind) {
        const a = { x: v.x + prev.wall.outwardNormal.x * tp, z: v.z + prev.wall.outwardNormal.z * tp }
        const b = { x: v.x + next.wall.outwardNormal.x * tn, z: v.z + next.wall.outwardNormal.z * tn }
        const t = ((b.x - a.x) * next.dir.z - (b.z - a.z) * next.dir.x) / cross
        const m = { x: a.x + prev.dir.x * t, z: a.z + prev.dir.z * t }
        const mvx = m.x - v.x, mvz = m.z - v.z
        const reach = Math.hypot(mvx, mvz)
        if (reach > 1e-4 && reach <= 6 * Math.max(tp, tn)) {
          // Normal to V -> M pointing towards prev's start for prev, and next's end for next.
          const n0 = { x: -mvz / reach, z: mvx / reach }
          const prevToStart = (prev.wall.start.x - v.x) * n0.x + (prev.wall.start.z - v.z) * n0.z
          const nPrev = prevToStart >= 0 ? n0 : { x: -n0.x, z: -n0.z }
          const nextToEnd = (next.wall.end.x - v.x) * n0.x + (next.wall.end.z - v.z) * n0.z
          const nNext = nextToEnd >= 0 ? n0 : { x: -n0.x, z: -n0.z }
          prev.wall.footprint = clipConvexPolygon(prev.wall.footprint, v, nPrev)
          next.wall.footprint = clipConvexPolygon(next.wall.footprint, v, nNext)
          joined.add(pairKey(pi, ni))
        }
      } else {
        // Lower wall (or fence) stops at the higher wall's face so it never pokes through.
        const prevYields = prev.wall.heightCm < next.wall.heightCm - EPS || (Math.abs(prev.wall.heightCm - next.wall.heightCm) <= EPS && prev.wall.kind === 'fence')
        if (prevYields) {
          const face = { x: v.x + next.wall.outwardNormal.x * tn, z: v.z + next.wall.outwardNormal.z * tn }
          prev.wall.footprint = clipConvexPolygon(prev.wall.footprint, face, next.wall.outwardNormal)
        } else {
          const face = { x: v.x + prev.wall.outwardNormal.x * tp, z: v.z + prev.wall.outwardNormal.z * tp }
          next.wall.footprint = clipConvexPolygon(next.wall.footprint, face, prev.wall.outwardNormal)
        }
        joined.add(pairKey(pi, ni))
      }
    }
  }

  // 2. General wall-vs-wall overlaps (T-junctions, cross-room corners, sharp reflex corners).
  for (let i = 0; i < builds.length; i++) {
    const wa = builds[i].wall
    if (wa.footprint.length < 3) continue
    for (let j = i + 1; j < builds.length; j++) {
      if (joined.has(pairKey(i, j))) continue
      const wb = builds[j].wall
      if (wb.footprint.length < 3) continue
      const ba = polyBounds(wa.footprint), bb = polyBounds(wb.footprint)
      if (ba.maxX <= bb.minX + 1e-4 || bb.maxX <= ba.minX + 1e-4 || ba.maxZ <= bb.minZ + 1e-4 || bb.maxZ <= ba.minZ + 1e-4) continue
      const overlap = intersectConvexPolygons(wa.footprint, wb.footprint)
      const overlapArea = polyAreaXZ(overlap)
      if (overlapArea <= 0.01) continue

      const clipA = bestClipOutside(wa.footprint, wb.footprint, overlapArea)
      const clipB = bestClipOutside(wb.footprint, wa.footprint, overlapArea)
      let aYields: boolean
      if (Math.abs(wa.heightCm - wb.heightCm) > EPS) {
        aYields = wa.heightCm < wb.heightCm
      } else if (wa.kind !== wb.kind) {
        aYields = wa.kind === 'fence'
      } else if (Math.abs(clipA.excess - clipB.excess) > 1e-2) {
        aYields = clipA.excess < clipB.excess
      } else {
        aYields = clipA.lostFrac <= clipB.lostFrac
      }
      if (aYields) {
        wa.footprint = clipA.poly
        if (wa.footprint.length < 3) break
      } else {
        wb.footprint = clipB.poly
      }
    }
  }
}

// ---------- corner posts ----------

/** Posts that fill the gap outside convex corners where two exterior walls meet. */
function buildCornerPosts(rooms: Room[], builds: WallBuild[], heightCm: number): CornerPostData[] {
  // Exterior walls by edge id, with the u-range of the edge they cover.
  const ext = new Map<string, WallBuild[]>()
  const edgeIds = new Set<string>()
  for (const b of builds) {
    const key = wallId(b.wall.roomId, b.wall.edgeIndex)
    if (b.edgeSpan) ext.set(key, [...(ext.get(key) ?? []), b])
    if (!b.edgeSpan && b.wall.pairedWallIds.length) b.wall.pairedWallIds.forEach((k) => edgeIds.add(k))
    edgeIds.add(key)
  }
  const posts: CornerPostData[] = []
  for (const room of rooms) {
    const n = room.vertices.length
    const s = signedArea(room.vertices) >= 0 ? 1 : -1
    for (let k = 0; k < n; k++) {
      const nextKey = wallId(room.id, k)
      // Previous edge: walk back over zero-length edges (duplicate vertices) so the corner keeps its post.
      let prevKey: string | undefined
      for (let j = 1; j < n && !prevKey; j++) {
        const key = wallId(room.id, (k - j + n * 2) % n)
        if (edgeIds.has(key)) prevKey = key
      }
      if (!prevKey || !edgeIds.has(nextKey)) continue
      // Only the exterior wall that starts the next edge and the one that ends the previous edge make a post.
      const next = ext.get(nextKey)?.find((b) => (b.edgeSpan?.u0 ?? 1) < EPS)
      const prev = ext.get(prevKey)?.find((b) => b.edgeSpan !== null && b.edgeSpan.edgeLengthCm - b.edgeSpan.u1 < EPS)
      if (!prev || !next) continue
      // Only two solid walls make a full-height post: a fence corner stays open, so no pillar
      // taller than the railing sticks out of a balcony corner.
      if (prev.wall.kind !== 'wall' || next.wall.kind !== 'wall') continue
      const cross = prev.dir.x * next.dir.z - prev.dir.z * next.dir.x
      // Convex corner: the room turns the same way as its winding. Near-straight corners need no post.
      if (cross * s <= 1e-3) continue
      const p = next.wall.start
      const tp = prev.wall.thicknessCm, tn = next.wall.thicknessCm
      const a = { x: p.x + prev.wall.outwardNormal.x * tp, z: p.z + prev.wall.outwardNormal.z * tp }
      const b = { x: p.x + next.wall.outwardNormal.x * tn, z: p.z + next.wall.outwardNormal.z * tn }
      // Mitre: crossing of the outer face lines of the two walls.
      const t = ((b.x - a.x) * next.dir.z - (b.z - a.z) * next.dir.x) / cross
      const m = { x: a.x + prev.dir.x * t, z: a.z + prev.dir.z * t }
      const reach = Math.hypot(m.x - p.x, m.z - p.z)
      const vertices = reach > 6 * Math.max(tp, tn) ? [{ x: p.x, z: p.z }, a, b] : [{ x: p.x, z: p.z }, a, m, b]
      posts.push({
        id: `${room.id}:post${k}`, roomId: room.id, vertexIndex: k, vertices, heightCm,
        wallIds: [prev.wall.id, next.wall.id],
      })
    }
  }
  posts.push(...buildGapNotchPosts(rooms, builds, ext, heightCm))
  return posts
}

/**
 * Fillers for the small outer notch (gap x thickness) at an exterior corner where two gap-separated rooms
 * meet. The unified gap wall ends flush with both rooms' vertices there, and their aligned outer walls
 * leave a hole outside it. A filler needs, at one end of a gap wall: the room A edge and the room B edge both
 * end exactly there (no room continues past: no T-junction), and each room has an exterior wall leaving that
 * vertex with the same outward normal, perpendicular to the gap wall, on one common line (aligned).
 * Flush rooms (gap wall 'centered') never get one. The filler follows the two exterior walls in cutaway.
 */
function buildGapNotchPosts(
  rooms: Room[], builds: WallBuild[], ext: Map<string, WallBuild[]>, heightCm: number,
): CornerPostData[] {
  const roomById = new Map(rooms.map((r) => [r.id, r]))
  const parse = (id: string) => {
    const c = id.lastIndexOf(':')
    const room = roomById.get(id.slice(0, c))
    const index = Number(id.slice(c + 1))
    if (!room || !Number.isInteger(index)) return null
    const v = room.vertices, n = v.length
    return { room, index, a: toPt(v[index]), b: toPt(v[(index + 1) % n]), next: (index + 1) % n }
  }
  const near = (p: Pt, q: Pt) => Math.hypot(p.x - q.x, p.z - q.z) < 1.5
  /** Exterior wall of `room` that ends (arriving) or starts (leaving) at vertex `vi`, skipping zero-length edges. */
  const adjacent = (room: Room, vi: number, arriving: boolean): WallBuild | undefined => {
    const n = room.vertices.length
    for (let j = 0; j < n; j++) {
      const k = arriving ? (vi - 1 - j + n * 2) % n : (vi + j) % n
      const hit = ext.get(wallId(room.id, k))?.find((b) =>
        arriving ? b.edgeSpan !== null && b.edgeSpan.edgeLengthCm - b.edgeSpan.u1 < EPS : (b.edgeSpan?.u0 ?? 1) < EPS)
      if (hit) return hit
      const a = room.vertices[k], b = room.vertices[(k + 1) % n]
      if (Math.hypot(a.x - b.x, a.y - b.y) > EPS) return undefined // a real edge without exterior wall
    }
    return undefined
  }
  const out: CornerPostData[] = []
  for (const sb of builds) {
    const w = sb.wall
    if (sb.edgeSpan || !w.isInterior || w.thicknessSide !== 'outward' || w.pairedWallIds.length !== 2) continue
    const ea = parse(w.pairedWallIds[0]), eb = parse(w.pairedWallIds[1])
    if (!ea || !eb) continue
    for (const end of [0, 1]) {
      const P = end === 0 ? w.start : w.end
      const other = end === 0 ? w.end : w.start
      // The span must end exactly on a vertex of room A's edge, and on the matching vertex of room B's edge.
      const aArriving = near(P, ea.a), aLeaving = near(P, ea.b)
      if (!aArriving && !aLeaving) continue
      const bArriving = near({ x: P.x + w.outwardNormal.x * w.thicknessCm, z: P.z + w.outwardNormal.z * w.thicknessCm }, eb.a)
      const bLeaving = near({ x: P.x + w.outwardNormal.x * w.thicknessCm, z: P.z + w.outwardNormal.z * w.thicknessCm }, eb.b)
      if (!bArriving && !bLeaving) continue
      const wa = adjacent(ea.room, aArriving ? ea.index : ea.next, aArriving)
      const wb = adjacent(eb.room, bArriving ? eb.index : eb.next, bArriving)
      if (!wa || !wb) continue
      // A fence corner keeps no full-height filler either: the railing must not grow a pillar.
      if (w.kind !== 'wall' || wa.wall.kind !== 'wall' || wb.wall.kind !== 'wall') continue
      const n = wa.wall.outwardNormal
      const nb = wb.wall.outwardNormal
      if (n.x * nb.x + n.z * nb.z < 0.99) continue
      // Adjacent walls are perpendicular to the gap wall, and point away from its body (outer corner).
      if (Math.abs(n.x * w.outwardNormal.x + n.z * w.outwardNormal.z) > 0.05) continue
      if ((P.x - other.x) * n.x + (P.z - other.z) * n.z <= 0) continue
      const q = { x: P.x + w.outwardNormal.x * w.thicknessCm, z: P.z + w.outwardNormal.z * w.thicknessCm }
      // Aligned: both outer walls lie on the same line.
      if (Math.abs((q.x - P.x) * n.x + (q.z - P.z) * n.z) > SHARED_FLUSH_CM) continue
      const ta = wa.wall.thicknessCm, tb = wb.wall.thicknessCm
      out.push({
        id: `${w.id}:notch${end}`, roomId: ea.room.id, vertexIndex: aArriving ? ea.index : ea.next,
        vertices: [P, q, { x: q.x + n.x * tb, z: q.z + n.z * tb }, { x: P.x + n.x * ta, z: P.z + n.z * ta }],
        heightCm, wallIds: [wa.wall.id, wb.wall.id],
      })
    }
  }
  return out
}

// ---------- furniture ----------

const clampRadius = (r: number | undefined, max: number) => Math.min(max, Math.max(0, finite(r ?? 0, 0)))

function resolveCornerRadii(f: FurnitureItem): [number, number, number, number] {
  const max = Math.max(0, Math.min(f.widthCm, f.depthCm) / 2)
  if (f.shape === 'circle') return [max, max, max, max]
  const raw: [number, number, number, number] = f.cornerRadiiCm ?? (() => {
    const r = f.cornerRadiusCm ?? 0
    return [r, r, r, r]
  })()
  let [tl, tr, br, bl] = raw.map((r) => clampRadius(r, max))
  if (f.flipX) [tl, tr, br, bl] = [tr, tl, bl, br]
  if (f.flipY) [tl, tr, br, bl] = [bl, br, tr, tl]
  return [tl, tr, br, bl]
}

function buildFurniture(f: FurnitureItem, simplified: boolean): FurnitureMeshData {
  const heightCm = furnitureHeightCm(f)
  const lift = heightCm <= RUG_MAX_HEIGHT_CM ? RUG_LIFT_CM : 0
  const cornerRadiiCm = resolveCornerRadii(f)
  return {
    id: f.id, name: f.name, shape: f.shape,
    x: f.xCm, y: heightCm / 2 + lift, z: f.yCm,
    widthCm: f.widthCm, depthCm: f.depthCm, heightCm,
    rotationY: (-f.rotationDeg * Math.PI) / 180,
    color: f.color,
    cornerRadiiCm,
    parts: furnitureParts(f, heightCm, cornerRadiiCm, { simplified }),
  }
}

// ---------- bounds ----------

function computeBounds(points: Pt[], maxY: number): SceneBounds {
  if (points.length === 0) {
    return { minX: -200, maxX: 200, minZ: -200, maxZ: 200, centerX: 0, centerZ: 0, sizeX: 400, sizeZ: 400, maxY }
  }
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
  for (const p of points) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x)
    minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z)
  }
  return {
    minX, maxX, minZ, maxZ,
    centerX: (minX + maxX) / 2, centerZ: (minZ + maxZ) / 2,
    sizeX: maxX - minX, sizeZ: maxZ - minZ, maxY,
  }
}

// ---------- entry point ----------

/** Build the 3D scene data of one artboard (artboard-local cm). Pure: no side effects. */
export function buildScene(artboard: Artboard): SceneData {
  const ceiling = Number.isFinite(artboard.ceilingHeightCm) && artboard.ceilingHeightCm > 0
    ? artboard.ceilingHeightCm
    : DEFAULT_CEILING_HEIGHT_CM
  const rooms = artboard.rooms.filter((r) => r.vertices.length >= 3)

  const floors: FloorMeshData[] = rooms.map((r) => ({
    roomId: r.id, name: r.name, vertices: floorOutline(r),
    fill: r.fill, floorPattern: r.floorPattern, floorPatternAngleDeg: r.floorPatternAngleDeg,
  }))

  const roomById = new Map(rooms.map((r) => [r.id, r]))
  const thresholds: DoorThresholdData[] = []
  for (const [roomId, quads] of roomDoorThresholds(rooms, artboard.openings, wallThicknessOf(artboard))) {
    const r = roomById.get(roomId)
    for (const q of quads) {
      thresholds.push({
        roomId, vertices: q.map(toPt),
        fill: r?.fill, floorPattern: r?.floorPattern, floorPatternAngleDeg: r?.floorPatternAngleDeg,
      })
    }
  }

  const builds = buildWalls(artboard, rooms, ceiling)
  const walls = builds.map((b) => b.wall)
  const cornerPosts = buildCornerPosts(rooms, builds, ceiling)
  const furniture = artboard.furniture.map((f) => buildFurniture(f, artboard.furniture.length > 60))

  const points: Pt[] = []
  for (const f of floors) points.push(...f.vertices)
  for (const t of thresholds) points.push(...t.vertices)
  for (const w of walls) {
    if (w.footprint.length >= 3) {
      points.push(...w.footprint)
    } else {
      const n = w.outwardNormal
      for (const o of wallSideOffsets(w)) {
        points.push(
          { x: w.start.x + n.x * o, z: w.start.z + n.z * o },
          { x: w.end.x + n.x * o, z: w.end.z + n.z * o },
        )
      }
    }
  }
  let maxY = ceiling
  artboard.furniture.forEach((f, i) => {
    const m = furniture[i]
    const rad = (f.rotationDeg * Math.PI) / 180
    const hx = (Math.abs(Math.cos(rad)) * f.widthCm + Math.abs(Math.sin(rad)) * f.depthCm) / 2
    const hz = (Math.abs(Math.sin(rad)) * f.widthCm + Math.abs(Math.cos(rad)) * f.depthCm) / 2
    points.push({ x: m.x - hx, z: m.z - hz }, { x: m.x + hx, z: m.z + hz })
    maxY = Math.max(maxY, m.y + m.heightCm / 2)
  })

  return { bounds: computeBounds(points, maxY), floors, thresholds, walls, cornerPosts, furniture }
}

// ---------- cutaway ----------

export type Pos3 = { x: number; y: number; z: number }

/**
 * Target height of every wall (by wall id) for a camera, in cm.
 * - 'on': full height. 'off': a curb (`curbCm`, default 10).
 * - 'cutaway' (Sims-like "back only"): every interior wall and every exterior wall that faces the
 *   camera drops to `cutawayStubCm` (default 30); only the exterior walls at the back (facing away
 *   from the camera) keep their full height.
 * A result never exceeds the wall height.
 */
export function computeWallTargetHeights(
  walls: WallSegmentData[],
  cameraPos: Pos3,
  _targetPos: Pos3,
  wallMode: WallViewMode,
  opts: { curbCm?: number; cutawayStubCm?: number } = {},
): Map<string, number> {
  const curb = opts.curbCm ?? DEFAULT_CURB_CM
  const stub = opts.cutawayStubCm ?? DEFAULT_CUTAWAY_STUB_CM
  const out = new Map<string, number>()
  if (wallMode === 'on') {
    for (const w of walls) out.set(w.id, w.heightCm)
    return out
  }
  if (wallMode === 'off') {
    for (const w of walls) out.set(w.id, Math.min(curb, w.heightCm))
    return out
  }
  for (const w of walls) {
    const drop = w.isInterior ||
      (cameraPos.x - w.center.x) * w.outwardNormal.x + (cameraPos.z - w.center.z) * w.outwardNormal.z > EPS
    out.set(w.id, drop ? Math.min(stub, w.heightCm) : w.heightCm)
  }
  return out
}
