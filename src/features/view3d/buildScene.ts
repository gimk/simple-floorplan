// Pure 3D scene geometry for the Views mode (docs/3d-and-finishes.md). No React, no Three.js, no DOM.
// It turns one artboard into plain data that a renderer can draw without any geometry maths.
//
// Space: artboard-local cm (artboard.xCm/yCm are NOT added). 2D (xCm, yCm) -> 3D (X = xCm, Y = height, Z = yCm).
// Rotation about the Y axis: rotationY = -deg * PI / 180 (a 2D clockwise-on-screen turn is a negative
// turn about +Y, because Y points up while 2D y points down).
//
// Walls follow the 2D model: a room keeps its interior polygon and the wall is a box built OUTWARD from
// the room edge. For every wall:
//   - `start` / `end` are the room edge corners (the inner face line), in the ORIGINAL vertex order, so
//     `edgeIndex` and `wallColors` keep working whatever the winding of the room is;
//   - `thicknessSide` says where the box sits against the edge line start -> end:
//       'outward' (exterior walls): the box spans 0..thicknessCm along outwardNormal (inner face ON the room edge);
//       'inward' (halves of a shared wall): the box spans -thicknessCm..0, inside its own room, so each room
//       sees its own inner face and the two halves meet back to back on the shared line (no overlap, no z-fight,
//       no protrusion into the neighbour room);
//   - `center` is the middle of the wall box: edge middle + outwardNormal * (+-thicknessCm / 2);
//   - pieces and window panes use `u` = distance in cm from `start` along start -> end (0..lengthCm)
//     and `y` = height above the floor in cm.
import { signedArea } from '../../model/geometry'
import type { Vec } from '../../model/geometry'
import { DEFAULT_CEILING_HEIGHT_CM, furnitureHeightCm, openingHeightCm, openingSillCm } from '../../model/defaults'
import type { Artboard, FloorPattern, FurnitureItem, Room, WallViewMode } from '../../model/types'
import { openingEndpoints } from '../openings/geometry'
import { hostWallIn } from '../openings/sync'
import { FLUSH_GAP_CM, edgeOutwardNormal, effectiveWallThickness, roomDoorThresholds, wallThicknessOf } from '../rooms/walls'

/** Default paint of the room side of a wall. */
export const DEFAULT_WALL_INNER_COLOR = '#d9d6d0'
/** Default paint of the outer side of a wall. */
export const DEFAULT_WALL_OUTER_COLOR = '#b9b5ad'
/** Visual wall thickness used when the artboard turns thick walls off (thickness 0), in cm. */
export const THIN_WALL_FALLBACK_CM = 6
/** Thickness of each half of a shared (interior) wall, in cm. Two halves make one thin wall. */
export const INTERIOR_HALF_WALL_CM = THIN_WALL_FALLBACK_CM / 2
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
  /** Side of the edge line the box sits on: 'outward' (exterior) or 'inward' (half of a shared wall). */
  thicknessSide: 'outward' | 'inward'
  heightCm: number
  /** Unit normal in the floor plane, pointing away from the room. */
  outwardNormal: Pt
  /** True when another room has a flush wall on this wall (a shared wall). */
  isInterior: boolean
  /** Same value for walls that are paired sides of one shared wall; the wall id when not paired. */
  cutawayGroupId: string
  /** Ids of the flush walls of other rooms (empty when exterior). */
  pairedWallIds: string[]
  innerColor: string
  outerColor: string
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
  /** Walls of other rooms that face this wall across a gap (0.5 cm .. 2 x thickness), with that gap in cm. */
  gapPartners: { build: WallBuild; gapCm: number }[]
}

/** Overlap in cm of the two collinear edges a and b along the direction of a. */
function overlapAlong(a: WallBuild, b: WallBuild): number {
  const start = a.wall.start, dir = a.dir
  const ub0 = (b.wall.start.x - start.x) * dir.x + (b.wall.start.z - start.z) * dir.z
  const ub1 = (b.wall.end.x - start.x) * dir.x + (b.wall.end.z - start.z) * dir.z
  const lo = Math.max(0, Math.min(ub0, ub1))
  const hi = Math.min(a.wall.lengthCm, Math.max(ub0, ub1))
  return hi - lo
}

/** True when walls a and b are the two sides of one shared wall: flush, opposite direction, rooms on opposite sides. */
function arePaired(a: WallBuild, b: WallBuild): boolean {
  if (a.wall.roomId === b.wall.roomId) return false
  if (a.dir.x * b.dir.x + a.dir.z * b.dir.z > -0.999) return false
  const na = a.wall.outwardNormal, nb = b.wall.outwardNormal
  if (na.x * nb.x + na.z * nb.z > -0.9) return false
  // Distance from both ends of b to the line of a must be within the flush gap.
  for (const p of [b.wall.start, b.wall.end]) {
    const d = (p.x - a.wall.start.x) * na.x + (p.z - a.wall.start.z) * na.z
    if (Math.abs(d) > FLUSH_GAP_CM) return false
  }
  return overlapAlong(a, b) > 1
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

/**
 * Gap in cm between wall a and wall b when they face each other across a gap: opposite directions,
 * b lies beyond a along a's outward normal, and they overlap along the wall. Null otherwise.
 */
function facingGap(a: WallBuild, b: WallBuild): number | null {
  if (a.wall.roomId === b.wall.roomId) return null
  if (a.dir.x * b.dir.x + a.dir.z * b.dir.z > -0.999) return null
  const na = a.wall.outwardNormal
  const ds = [b.wall.start, b.wall.end].map((p) => (p.x - a.wall.start.x) * na.x + (p.z - a.wall.start.z) * na.z)
  if (Math.abs(ds[0] - ds[1]) > FLUSH_GAP_CM) return null
  const d = (ds[0] + ds[1]) / 2
  if (d <= FLUSH_GAP_CM) return null
  return overlapAlong(a, b) > 1 ? d : null
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
  const builds: WallBuild[] = []
  for (const room of rooms) {
    const v = room.vertices
    for (let i = 0; i < v.length; i++) {
      const a = v[i], b = v[(i + 1) % v.length]
      const out = edgeOutwardNormal(room, i)
      if (!out) continue
      const lengthCm = Math.hypot(b.x - a.x, b.y - a.y)
      const dir = { x: (b.x - a.x) / lengthCm, z: (b.y - a.y) / lengthCm }
      const id = wallId(room.id, i)
      builds.push({
        dir,
        cuts: [],
        gapPartners: [],
        wall: {
          id, roomId: room.id, edgeIndex: i,
          start: toPt(a), end: toPt(b), center: toPt(a),
          lengthCm, thicknessCm: 0, thicknessSide: 'outward', heightCm,
          outwardNormal: { x: out.x, z: out.y },
          isInterior: false, cutawayGroupId: id, pairedWallIds: [],
          innerColor: room.wallColors?.[String(i)] ?? DEFAULT_WALL_INNER_COLOR,
          outerColor: DEFAULT_WALL_OUTER_COLOR,
          pieces: [], windowPanes: [],
        },
      })
    }
  }

  // Pair flush walls of different rooms and group them (union-find on wall ids).
  const parent = new Map<string, string>(builds.map((b) => [b.wall.id, b.wall.id]))
  const find = (x: string): string => {
    let r = x
    while (parent.get(r) !== r) r = parent.get(r) as string
    return r
  }
  for (let i = 0; i < builds.length; i++) {
    for (let j = i + 1; j < builds.length; j++) {
      if (!arePaired(builds[i], builds[j])) continue
      builds[i].wall.pairedWallIds.push(builds[j].wall.id)
      builds[j].wall.pairedWallIds.push(builds[i].wall.id)
      parent.set(find(builds[i].wall.id), find(builds[j].wall.id))
    }
  }
  const members = new Map<string, string[]>()
  for (const b of builds) {
    const root = find(b.wall.id)
    members.set(root, [...(members.get(root) ?? []), b.wall.id])
  }
  for (const b of builds) {
    if (b.wall.pairedWallIds.length === 0) continue
    b.wall.isInterior = true
    b.wall.cutawayGroupId = `pair:${[...(members.get(find(b.wall.id)) ?? [])].sort()[0]}`
  }

  // Walls of two rooms that face each other across a gap smaller than two wall thicknesses would fill
  // the same space (z-fighting, and an opening cut in one wall hidden by the other). They share the gap.
  if (thickness > 0) {
    for (const a of builds) {
      if (a.wall.isInterior) continue
      for (const b of builds) {
        if (b.wall.isInterior) continue
        const d = facingGap(a, b)
        if (d !== null && d < 2 * thickness) a.gapPartners.push({ build: b, gapCm: d })
      }
    }
  }

  // Thickness and centre.
  for (const b of builds) {
    const w = b.wall
    let t: number
    if (w.isInterior) t = INTERIOR_HALF_WALL_CM
    else if (thickness > 0) {
      const mid = { x: (w.start.x + w.end.x) / 2, y: (w.start.z + w.end.z) / 2 }
      const eff = effectiveWallThickness(rooms, w.roomId, mid, { x: w.outwardNormal.x, y: w.outwardNormal.z }, thickness)
      t = eff > 0 ? eff : INTERIOR_HALF_WALL_CM
    } else t = THIN_WALL_FALLBACK_CM
    // Each side takes half of a shared gap: back to back, no overlap.
    for (const g of b.gapPartners) t = Math.min(t, g.gapCm / 2)
    w.thicknessCm = t
    w.thicknessSide = w.isInterior ? 'inward' : 'outward'
    const shift = w.isInterior ? -t / 2 : t / 2
    w.center = {
      x: (w.start.x + w.end.x) / 2 + w.outwardNormal.x * shift,
      z: (w.start.z + w.end.z) / 2 + w.outwardNormal.z * shift,
    }
  }

  // Openings: cut the host wall and, on a shared wall, the paired walls too.
  const byId = new Map(builds.map((b) => [b.wall.id, b]))
  for (const op of artboard.openings) {
    const host = hostWallIn(rooms, op)
    if (!host) continue
    const hostBuild = byId.get(wallId(host.room.id, host.edgeIndex))
    if (!hostBuild) continue
    const sill = openingSillCm(op, heightCm)
    const h = openingHeightCm(op, heightCm)
    if (!(h > EPS)) continue
    const { start, end } = openingEndpoints(op)
    const targets = [
      hostBuild,
      ...hostBuild.wall.pairedWallIds.map((id) => byId.get(id)).filter((x): x is WallBuild => !!x),
      ...hostBuild.gapPartners.map((g) => g.build),
    ]
    for (const t of targets) {
      const s = t.wall.start
      const u0 = (start.x - s.x) * t.dir.x + (start.y - s.z) * t.dir.z
      const u1 = (end.x - s.x) * t.dir.x + (end.y - s.z) * t.dir.z
      const lo = Math.max(0, Math.min(u0, u1)), hi = Math.min(t.wall.lengthCm, Math.max(u0, u1))
      if (hi - lo <= EPS) continue
      t.cuts.push({ u0: lo, u1: hi, y0: sill, y1: sill + h })
      if (t === hostBuild && op.kind === 'window') {
        t.wall.windowPanes.push({ openingId: op.id, u0: lo, u1: hi, y0: sill, y1: Math.min(sill + h, heightCm) })
      }
    }
  }
  for (const b of builds) b.wall.pieces = splitWallPieces(b.wall.lengthCm, heightCm, b.cuts)
  return builds
}

// ---------- corner posts ----------

/** Posts that fill the gap outside convex corners where two exterior walls meet. */
function buildCornerPosts(rooms: Room[], builds: WallBuild[], heightCm: number): CornerPostData[] {
  const byId = new Map(builds.map((b) => [b.wall.id, b]))
  const posts: CornerPostData[] = []
  for (const room of rooms) {
    const n = room.vertices.length
    const s = signedArea(room.vertices) >= 0 ? 1 : -1
    for (let k = 0; k < n; k++) {
      const next = byId.get(wallId(room.id, k))
      // Previous wall: walk back over zero-length edges (duplicate vertices) so the corner keeps its post.
      let prev: WallBuild | undefined
      for (let j = 1; j < n && !prev; j++) prev = byId.get(wallId(room.id, (k - j + n * 2) % n))
      if (!prev || !next || prev.wall.isInterior || next.wall.isInterior) continue
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
  return posts
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
    const n = w.outwardNormal, t = w.thicknessSide === 'inward' ? -w.thicknessCm : w.thicknessCm
    points.push(
      w.start, w.end,
      { x: w.start.x + n.x * t, z: w.start.z + n.z * t },
      { x: w.end.x + n.x * t, z: w.end.z + n.z * t },
    )
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
    const t = segmentCrossing(cam, tgt, w.start, w.end)
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
