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
import type { Artboard, FloorPattern, FurnitureItem, Room, WallKind, WallViewMode } from '../../model/types'
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
  pieces: WallPieceData[]
  windowPanes: WindowPaneData[]
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
          pieces: [], windowPanes: [],
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
          pieces: [], windowPanes: [],
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
    }
  }
  for (const b of builds) b.wall.pieces = splitWallPieces(b.wall.lengthCm, b.wall.heightCm, b.cuts)
  return builds
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

function buildFurniture(f: FurnitureItem): FurnitureMeshData {
  const heightCm = furnitureHeightCm(f)
  const lift = heightCm <= RUG_MAX_HEIGHT_CM ? RUG_LIFT_CM : 0
  return {
    id: f.id, name: f.name, shape: f.shape,
    x: f.xCm, y: heightCm / 2 + lift, z: f.yCm,
    widthCm: f.widthCm, depthCm: f.depthCm, heightCm,
    rotationY: (-f.rotationDeg * Math.PI) / 180,
    color: f.color,
    cornerRadiiCm: resolveCornerRadii(f),
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
  const furniture = artboard.furniture.map(buildFurniture)

  const points: Pt[] = []
  for (const f of floors) points.push(...f.vertices)
  for (const t of thresholds) points.push(...t.vertices)
  for (const w of walls) {
    const n = w.outwardNormal
    for (const o of wallSideOffsets(w)) {
      points.push(
        { x: w.start.x + n.x * o, z: w.start.z + n.z * o },
        { x: w.end.x + n.x * o, z: w.end.z + n.z * o },
      )
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
 * Parameter t (0 = p, 1 = q) where segment p-q meets segment a-b (touching counts), or null.
 * Floor plane coordinates. Parallel and collinear segments give null.
 */
function segmentCrossing(p: Pt, q: Pt, a: Pt, b: Pt): number | null {
  const rx = q.x - p.x, rz = q.z - p.z, sx = b.x - a.x, sz = b.z - a.z
  const den = rx * sz - rz * sx
  if (Math.abs(den) < 1e-12) return null
  const t = ((a.x - p.x) * sz - (a.z - p.z) * sx) / den
  const u = ((a.x - p.x) * rz - (a.z - p.z) * rx) / den
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : null
}

/**
 * Target height of every wall (by wall id) for a camera, in cm.
 * - 'on': full height. 'off': a curb (`curbCm`, default 10).
 * - 'cutaway': an exterior wall that faces the camera drops to `cutawayStubCm` (default 30); an
 *   interior wall that the line of sight camera -> target crosses drops, with its paired side, to the
 *   stub (only when the sight line is still below the wall top where it crosses the wall, so a camera
 *   high above looks over it); every other wall keeps its full height. A camera straight above the
 *   target (same floor position) has no sight line in plan: only the facing rule applies.
 * A result never exceeds the wall height.
 */
export function computeWallTargetHeights(
  walls: WallSegmentData[],
  cameraPos: Pos3,
  targetPos: Pos3,
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
  const cam: Pt = { x: cameraPos.x, z: cameraPos.z }
  const tgt: Pt = { x: targetPos.x, z: targetPos.z }
  const blockedGroups = new Set<string>()
  for (const w of walls) {
    if (!w.isInterior) continue
    // Test against the middle line of the wall box, so a thick gap wall blocks like a thin one.
    const [o0, o1] = wallSideOffsets(w), off = (o0 + o1) / 2
    const mid0 = { x: w.start.x + w.outwardNormal.x * off, z: w.start.z + w.outwardNormal.z * off }
    const mid1 = { x: w.end.x + w.outwardNormal.x * off, z: w.end.z + w.outwardNormal.z * off }
    const t = segmentCrossing(cam, tgt, mid0, mid1)
    if (t === null) continue
    const rayY = cameraPos.y + t * (targetPos.y - cameraPos.y)
    if (rayY < w.heightCm) blockedGroups.add(w.cutawayGroupId)
  }
  for (const w of walls) {
    let drop: boolean
    if (w.isInterior) drop = blockedGroups.has(w.cutawayGroupId)
    else drop = (cam.x - w.center.x) * w.outwardNormal.x + (cam.z - w.center.z) * w.outwardNormal.z > EPS
    out.set(w.id, drop ? Math.min(stub, w.heightCm) : w.heightCm)
  }
  return out
}
