// Pure geometry and snapping for furniture (no React, no store). Units: cm, degrees, y points down.
//
// Local frame of an item: the centre is (xCm, yCm) in artboard-local cm, `widthCm` runs along local X
// and `depthCm` along local Y. `rotationDeg` turns the item clockwise on screen (y down), so the world
// offset of a local point (lx, ly) is (lx*cos - ly*sin, lx*sin + ly*cos).
// The FRONT edge of an item is the local -Y (top) edge, for every rotation: a bed, a sofa and a desk
// all face the same way, and a 0 degree item faces up on screen.
import { pointInPolygon } from '../../model/geometry'
import type { Vec } from '../../model/geometry'
import type { Artboard, FurnitureItem } from '../../model/types'

export const MIN_FURNITURE_CM = 15
export const MAX_FURNITURE_CM = 1000

const EPS = 1e-9
const RAD = Math.PI / 180

/** Round v to precisionCm (0.1 cm when the precision is missing or not positive). */
const roundP = (v: number, precisionCm?: number): number => {
  const p = precisionCm && precisionCm > 0 ? precisionCm : 0.1
  const r = Math.round(v / p) * p
  return Math.round(r * 1e6) / 1e6 + 0 // trim float noise; "+ 0" turns -0 into 0
}

/** Normalize an angle in degrees to [0, 360). */
export function normalizeAngle(deg: number): number {
  const m = deg % 360
  const n = m < 0 ? m + 360 : m
  // Removes -0 and values that rounded to exactly 360 after the shift.
  return n >= 360 ? 0 : n + 0
}

/** Snap an angle to the nearest multiple of stepDeg, normalized to [0, 360). */
export function snapRotation(deg: number, stepDeg: number): number {
  if (!(stepDeg > 0)) return normalizeAngle(deg)
  return normalizeAngle(Math.round(deg / stepDeg) * stepDeg)
}

type ItemBox = Pick<FurnitureItem, 'xCm' | 'yCm' | 'widthCm' | 'depthCm' | 'rotationDeg'>
type ItemShape = ItemBox & Pick<FurnitureItem, 'shape'>

/** World corners of the item box, in artboard cm: [TL, TR, BR, BL] of the unrotated local box. */
export function furnitureWorldCorners(item: ItemBox): [Vec, Vec, Vec, Vec] {
  const a = item.rotationDeg * RAD
  const cos = Math.cos(a), sin = Math.sin(a)
  const hw = item.widthCm / 2, hd = item.depthCm / 2
  const at = (lx: number, ly: number): Vec => ({
    x: item.xCm + lx * cos - ly * sin,
    y: item.yCm + lx * sin + ly * cos,
  })
  return [at(-hw, -hd), at(hw, -hd), at(hw, hd), at(-hw, hd)]
}

/** Axis-aligned bounds of the item in artboard cm. A circle is an ellipse of rx = w/2, ry = d/2. */
export function furnitureAxisBounds(item: ItemShape): { minX: number; minY: number; maxX: number; maxY: number } {
  if (item.shape === 'circle') {
    const a = item.rotationDeg * RAD
    const cos = Math.cos(a), sin = Math.sin(a)
    const rx = item.widthCm / 2, ry = item.depthCm / 2
    // Half extents of the rotated ellipse.
    const ex = Math.hypot(rx * cos, ry * sin)
    const ey = Math.hypot(rx * sin, ry * cos)
    return { minX: item.xCm - ex, minY: item.yCm - ey, maxX: item.xCm + ex, maxY: item.yCm + ey }
  }
  const c = furnitureWorldCorners(item)
  return {
    minX: Math.min(...c.map((p) => p.x)),
    minY: Math.min(...c.map((p) => p.y)),
    maxX: Math.max(...c.map((p) => p.x)),
    maxY: Math.max(...c.map((p) => p.y)),
  }
}

/** Axis-aligned box in artboard-local cm. */
export type ItemBounds = { minX: number; minY: number; maxX: number; maxY: number }

/**
 * Ids of the items whose axis-aligned bounds overlap `box` (artboard-local cm), in stack order.
 * A box that only touches an edge counts, like the room marquee of Plan mode.
 */
export function findFurnitureInBox(box: ItemBounds, artboard: Artboard): string[] {
  return artboard.furniture
    .filter((f) => {
      const b = furnitureAxisBounds(f)
      return b.minX <= box.maxX && b.maxX >= box.minX && b.minY <= box.maxY && b.maxY >= box.minY
    })
    .map((f) => f.id)
}

/** Resize handle of a selection box: -1 = left / top side, 0 = that axis is not dragged, 1 = right / bottom. */
export type ResizeHandle = { sx: -1 | 0 | 1; sy: -1 | 0 | 1 }

export type ResizeResult = { widthCm: number; depthCm: number; xCm: number; yCm: number }

/** A corner handle: both axes move. */
export type CornerHandle = { sx: -1 | 1; sy: -1 | 1 }
/** An edge handle: one axis moves, the other keeps its centre line. */
export type EdgeHandle = { sx: -1 | 1; sy: 0 } | { sx: 0; sy: -1 | 1 }

/** The 4 corners of a selection box, in screen order: top-left, top-right, bottom-right, bottom-left. */
export const CORNER_HANDLES: CornerHandle[] = [
  { sx: -1, sy: -1 },
  { sx: 1, sy: -1 },
  { sx: 1, sy: 1 },
  { sx: -1, sy: 1 },
]
/** The 4 edges of a selection box: left, right, top, bottom. */
export const EDGE_HANDLES: EdgeHandle[] = [
  { sx: -1, sy: 0 },
  { sx: 1, sy: 0 },
  { sx: 0, sy: -1 },
  { sx: 0, sy: 1 },
]

/** Round a size like the room ops do: 0 or negative precision keeps the value. */
export const roundSize = (v: number, precisionCm: number): number => (precisionCm > 0 ? roundP(v, precisionCm) : v)

/**
 * Apply Shift axis-lock to a move target relative to `start`. Locks the axis with smaller movement
 * since drag start; returns the locked position and which axis ('x' | 'y' | null) is locked.
 */
export function applyAxisLock(
  start: Vec,
  current: Vec,
  lock: boolean,
): { pos: Vec; lockedAxis: 'x' | 'y' | null } {
  if (!lock) return { pos: current, lockedAxis: null }
  const dx = current.x - start.x
  const dy = current.y - start.y
  return Math.abs(dx) >= Math.abs(dy)
    ? { pos: { x: current.x, y: start.y }, lockedAxis: 'y' }
    : { pos: { x: start.x, y: current.y }, lockedAxis: 'x' }
}

/**
 * New size and centre of an item when one handle of its selection box is dragged to `p` (the pointer
 * in artboard-local cm). Pure: no store, no React.
 *
 * The handle names the sides that move: sx = -1 is the left side, sx = 1 the right one, sx = 0 no
 * side of that axis. Normally the OPPOSITE side stays where it is; when `opts.alt` is true, the
 * centre stays fixed and both opposite sides grow symmetrically (2x the delta).
 *  - corner (sx and sy both set): both dimensions follow the pointer; Shift keeps the aspect ratio
 *    and the bigger of the two factors wins;
 *  - edge (sx or sy is 0): only the dimension of the dragged axis changes; Shift scales the other
 *    dimension by the same factor around the centre line, so the item grows symmetrically there.
 * Sizes are clamped to MIN/MAX_FURNITURE_CM and rounded to `precisionCm`. A handle of {0, 0} returns
 * the item unchanged.
 */
export function resizeFurnitureFromHandle(
  item: Pick<FurnitureItem, 'xCm' | 'yCm' | 'widthCm' | 'depthCm' | 'rotationDeg'>,
  handle: ResizeHandle,
  p: Vec,
  opts: { shift: boolean; alt?: boolean; precisionCm: number },
): ResizeResult {
  const w0 = item.widthCm, d0 = item.depthCm
  const a = item.rotationDeg * RAD
  const cos = Math.cos(a), sin = Math.sin(a)
  const dx = p.x - item.xCm, dy = p.y - item.yCm
  // Pointer in the start frame of the item: local X along the width, local Y along the depth.
  const lx = dx * cos + dy * sin
  const ly = -dx * sin + dy * cos
  if (handle.sx === 0 && handle.sy === 0) {
    return { widthCm: w0, depthCm: d0, xCm: item.xCm, yCm: item.yCm }
  }
  const fromCenter = !!opts.alt
  // The fixed side (or corner) in the start frame. 0 = that axis keeps its centre line.
  const o = {
    x: fromCenter || handle.sx === 0 ? 0 : (-handle.sx * w0) / 2,
    y: fromCenter || handle.sy === 0 ? 0 : (-handle.sy * d0) / 2,
  }
  const mult = fromCenter ? 2 : 1
  let w = handle.sx === 0 ? w0 : (lx - o.x) * handle.sx * mult
  let d = handle.sy === 0 ? d0 : (ly - o.y) * handle.sy * mult
  if (opts.shift) {
    // Corners: the bigger factor wins, as before. Edges: the dragged axis gives the factor.
    const s =
      handle.sx !== 0 && handle.sy !== 0 ? Math.max(w / w0, d / d0) : handle.sx !== 0 ? w / w0 : d / d0
    const lo = Math.max(MIN_FURNITURE_CM / w0, MIN_FURNITURE_CM / d0)
    const hi = Math.min(MAX_FURNITURE_CM / w0, MAX_FURNITURE_CM / d0)
    const k = Math.min(hi, Math.max(lo, s))
    w = w0 * k
    d = d0 * k
  }
  const clamp = (v: number) => Math.min(MAX_FURNITURE_CM, Math.max(MIN_FURNITURE_CM, v))
  w = clamp(roundSize(w, opts.precisionCm))
  d = clamp(roundSize(d, opts.precisionCm))
  // New centre: fixed at (0, 0) when resizing from center, else midway between fixed and dragged side.
  const cl = fromCenter ? { x: 0, y: 0 } : { x: o.x + (handle.sx * w) / 2, y: o.y + (handle.sy * d) / 2 }
  return {
    widthCm: w,
    depthCm: d,
    xCm: item.xCm + cl.x * cos - cl.y * sin,
    yCm: item.yCm + cl.x * sin + cl.y * cos,
  }
}

/** Smallest correction (candidate - mine) with |correction| <= threshold, or null. */
const bestShift = (mine: number[], candidates: number[], thresholdCm: number): number | null => {
  let best: number | null = null
  for (const m of mine) for (const c of candidates) {
    const d = c - m
    if (Math.abs(d) <= thresholdCm && (best === null || Math.abs(d) < Math.abs(best))) best = d
  }
  return best
}

/** X and Y lines to snap to: every room wall endpoint, plus the bounds and centre of the other items. */
const collectSnapLines = (artboard: Artboard, exceptId?: string) => {
  const xs: number[] = []
  const ys: number[] = []
  for (const room of artboard.rooms) {
    const v = room.vertices
    for (const p of v) { xs.push(p.x); ys.push(p.y) }
  }
  for (const f of artboard.furniture) {
    if (f.id === exceptId) continue
    const b = furnitureAxisBounds(f)
    xs.push(b.minX, (b.minX + b.maxX) / 2, b.maxX)
    ys.push(b.minY, (b.minY + b.maxY) / 2, b.maxY)
  }
  return { xs, ys }
}

/**
 * Magnetic move of an item to (targetX, targetY). The item's left, centre or right X is pulled onto the
 * nearest candidate X line within thresholdCm (same for top, centre and bottom Y). An axis that finds
 * no line is rounded to the artboard drawing precision. `disableSnap` (Alt held) skips all of it.
 */
export function snapFurnitureMove(
  item: FurnitureItem,
  targetX: number,
  targetY: number,
  artboard: Artboard,
  thresholdCm: number,
  opts?: { disableSnap?: boolean },
): { xCm: number; yCm: number; snappedX: boolean; snappedY: boolean } {
  if (opts?.disableSnap) return { xCm: targetX, yCm: targetY, snappedX: false, snappedY: false }
  const box = furnitureAxisBounds({ ...item, xCm: targetX, yCm: targetY })
  const { xs, ys } = collectSnapLines(artboard, item.id)
  const dx = bestShift([box.minX, (box.minX + box.maxX) / 2, box.maxX], xs, thresholdCm)
  const dy = bestShift([box.minY, (box.minY + box.maxY) / 2, box.maxY], ys, thresholdCm)
  return {
    xCm: dx === null ? roundP(targetX, artboard.precisionCm) : targetX + dx,
    yCm: dy === null ? roundP(targetY, artboard.precisionCm) : targetY + dy,
    snappedX: dx !== null,
    snappedY: dy !== null,
  }
}

/** A live distance from one item edge to the wall it faces. */
export type DistanceGuide = { axis: 'x' | 'y'; x1: number; y1: number; x2: number; y2: number; distCm: number }

export const DEFAULT_MAX_GUIDE_DIST_CM = 600
/** A hit closer than this is the edge the ray starts on, not a wall to measure. */
const MIN_HIT_CM = 0.5

/**
 * Distance along ray `o + t*d` (t > 0) to segment ab, or null when they do not cross.
 * Parallel and zero-length segments give null.
 */
const rayHit = (o: Vec, d: Vec, a: Vec, b: Vec): number | null => {
  const s = { x: b.x - a.x, y: b.y - a.y }
  const den = d.x * s.y - d.y * s.x
  if (Math.abs(den) < EPS) return null
  const aq = { x: a.x - o.x, y: a.y - o.y }
  const t = (aq.x * s.y - aq.y * s.x) / den
  const u = (aq.x * d.y - aq.y * d.x) / den
  if (u < -EPS || u > 1 + EPS) return null
  return t
}

/**
 * Nearest wall distance in each of the 4 cardinal directions from `box`, measured from the
 * edges at the centre line, using the room that contains the box centre (or [] if none).
 * A direction with no wall within maxDistCm gives no guide.
 */
export function computeDistanceGuidesForBox(
  box: ItemBounds,
  artboard: Artboard,
  maxDistCm = DEFAULT_MAX_GUIDE_DIST_CM,
): DistanceGuide[] {
  const cx = (box.minX + box.maxX) / 2, cy = (box.minY + box.maxY) / 2
  const room = artboard.rooms.find((r) => pointInPolygon({ x: cx, y: cy }, r.vertices))
  if (!room) return []
  const rays: { axis: 'x' | 'y'; from: Vec; dir: Vec }[] = [
    { axis: 'x', from: { x: box.minX, y: cy }, dir: { x: -1, y: 0 } },
    { axis: 'x', from: { x: box.maxX, y: cy }, dir: { x: 1, y: 0 } },
    { axis: 'y', from: { x: cx, y: box.minY }, dir: { x: 0, y: -1 } },
    { axis: 'y', from: { x: cx, y: box.maxY }, dir: { x: 0, y: 1 } },
  ]
  const walls = room.vertices.map((p, i) => [p, room.vertices[(i + 1) % room.vertices.length]] as [Vec, Vec])
  const out: DistanceGuide[] = []
  for (const ray of rays) {
    let best: number | null = null
    for (const [a, w] of walls) {
      const t = rayHit(ray.from, ray.dir, a, w)
      if (t === null || t <= MIN_HIT_CM || t > maxDistCm) continue
      if (best === null || t < best) best = t
    }
    if (best === null) continue
    const to = { x: ray.from.x + ray.dir.x * best, y: ray.from.y + ray.dir.y * best }
    out.push({
      axis: ray.axis,
      x1: ray.from.x, y1: ray.from.y,
      x2: to.x, y2: to.y,
      distCm: roundP(best, artboard.precisionCm),
    })
  }
  return out
}

/**
 * Nearest wall distance in each of the 4 cardinal directions from the item's bounds, measured from the
 * edges at the centre line. A direction with no wall within maxDistCm gives no guide.
 */
export function computeDistanceGuides(item: FurnitureItem, artboard: Artboard, maxDistCm = DEFAULT_MAX_GUIDE_DIST_CM): DistanceGuide[] {
  return computeDistanceGuidesForBox(furnitureAxisBounds(item), artboard, maxDistCm)
}

// ---------- Option/Alt measure tool ----------

/** What the cursor points at while the measure tool is held: an item, a wall, or nothing. */
export type MeasureTarget =
  | { kind: 'furniture'; item: FurnitureItem }
  | { kind: 'wall'; a: Vec; b: Vec }
  | { kind: 'none' }

/** Distance from p to segment ab, in cm. */
const distToSegment = (p: Vec, a: Vec, b: Vec): number => {
  const sx = b.x - a.x, sy = b.y - a.y
  const len2 = sx * sx + sy * sy
  if (len2 < EPS) return Math.hypot(p.x - a.x, p.y - a.y)
  const t = Math.min(1, Math.max(0, ((p.x - a.x) * sx + (p.y - a.y) * sy) / len2))
  return Math.hypot(p.x - (a.x + sx * t), p.y - (a.y + sy * t))
}

/** True when the artboard-local point p is inside the outline of the item (rect box or ellipse). */
const hitsItem = (p: Vec, item: FurnitureItem): boolean => {
  const a = -item.rotationDeg * RAD
  const cos = Math.cos(a), sin = Math.sin(a)
  const dx = p.x - item.xCm, dy = p.y - item.yCm
  const lx = dx * cos - dy * sin
  const ly = dx * sin + dy * cos
  const hw = item.widthCm / 2, hd = item.depthCm / 2
  if (!(hw > 0) || !(hd > 0)) return false
  if (item.shape === 'circle') return (lx / hw) ** 2 + (ly / hd) ** 2 <= 1 + EPS
  return Math.abs(lx) <= hw + EPS && Math.abs(ly) <= hd + EPS
}

/**
 * What the cursor at artboard-local point p points at. Items win, top of the stack first, and any
 * item in `excludedIds` is never a target; then the closest room wall within wallTolCm; else 'none'.
 */
export function pickMeasureTarget(
  p: Vec,
  artboard: Artboard,
  excludedIds: string | ReadonlySet<string>,
  wallTolCm: number,
): MeasureTarget {
  const isExcluded = (id: string): boolean =>
    typeof excludedIds === 'string' ? id === excludedIds : excludedIds.has(id)
  for (let i = artboard.furniture.length - 1; i >= 0; i--) {
    const f = artboard.furniture[i]
    if (isExcluded(f.id)) continue
    if (hitsItem(p, f)) return { kind: 'furniture', item: f }
  }
  let best: { d: number; a: Vec; b: Vec } | null = null
  for (const room of artboard.rooms) {
    const v = room.vertices
    for (let i = 0; i < v.length; i++) {
      const a = v[i], b = v[(i + 1) % v.length]
      const d = distToSegment(p, a, b)
      if (d <= wallTolCm && (best === null || d < best.d)) best = { d, a, b }
    }
  }
  return best ? { kind: 'wall', a: best.a, b: best.b } : { kind: 'none' }
}

const boxCorners = (b: ItemBounds): [Vec, Vec, Vec, Vec] => [
  { x: b.minX, y: b.minY },
  { x: b.maxX, y: b.minY },
  { x: b.maxX, y: b.maxY },
  { x: b.minX, y: b.maxY },
]

/**
 * Display-only distance guides between `box` and what the cursor points at.
 * 'none' falls back to the 4 nearest-wall distances. No guide with a distance <= 0 is returned.
 */
export function computeMeasureGuidesForBox(
  box: ItemBounds,
  target: MeasureTarget,
  artboard: Artboard,
  corners: readonly Vec[] = boxCorners(box),
): DistanceGuide[] {
  const A = box
  const acx = (A.minX + A.maxX) / 2, acy = (A.minY + A.maxY) / 2
  const out: DistanceGuide[] = []
  const push = (axis: 'x' | 'y', x1: number, y1: number, x2: number, y2: number) => {
    const distCm = roundP(Math.hypot(x2 - x1, y2 - y1), artboard.precisionCm)
    if (!(distCm > 0)) return
    out.push({ axis, x1, y1, x2, y2, distCm })
  }

  if (target.kind === 'none') return computeDistanceGuidesForBox(A, artboard)

  if (target.kind === 'furniture') {
    const B = furnitureAxisBounds(target.item)
    const gapX = B.minX >= A.maxX ? [A.maxX, B.minX] : B.maxX <= A.minX ? [A.minX, B.maxX] : null
    const gapY = B.minY >= A.maxY ? [A.maxY, B.minY] : B.maxY <= A.minY ? [A.minY, B.maxY] : null
    const oy1 = Math.max(A.minY, B.minY), oy2 = Math.min(A.maxY, B.maxY)
    const ox1 = Math.max(A.minX, B.minX), ox2 = Math.min(A.maxX, B.maxX)
    // The gap line sits on the middle of the shared span, or on the centre line when there is none.
    const gy = oy1 <= oy2 ? (oy1 + oy2) / 2 : acy
    const gx = ox1 <= ox2 ? (ox1 + ox2) / 2 : acx
    if (gapX) push('x', gapX[0], gy, gapX[1], gy)
    if (gapY) push('y', gx, gapY[0], gx, gapY[1])
    if (gapX || gapY) return out
    // Boxes overlap or one contains the other: report the inner edge distances that are visible.
    const inner = (axis: 'x' | 'y', x1: number, y1: number, x2: number, y2: number) => {
      const d = roundP(Math.hypot(x2 - x1, y2 - y1), artboard.precisionCm)
      if (d > 0.5) out.push({ axis, x1, y1, x2, y2, distCm: d })
    }
    inner('x', A.minX, acy, B.minX, acy)
    inner('x', A.maxX, acy, B.maxX, acy)
    inner('y', acx, A.minY, acx, B.minY)
    inner('y', acx, A.maxY, acx, B.maxY)
    return out
  }

  const { a, b } = target
  if (Math.abs(a.y - b.y) < 0.01) {
    const wy = a.y
    const x = Math.min(Math.max(acx, Math.min(a.x, b.x)), Math.max(a.x, b.x))
    if (wy <= A.minY) push('y', x, A.minY, x, wy)
    else if (wy >= A.maxY) push('y', x, A.maxY, x, wy)
    return out
  }
  if (Math.abs(a.x - b.x) < 0.01) {
    const wx = a.x
    const y = Math.min(Math.max(acy, Math.min(a.y, b.y)), Math.max(a.y, b.y))
    if (wx <= A.minX) push('x', A.minX, y, wx, y)
    else if (wx >= A.maxX) push('x', A.maxX, y, wx, y)
    return out
  }
  // Slanted wall: shortest distance from any corner of the box.
  let best: { d: number; from: Vec; to: Vec } | null = null
  const sx = b.x - a.x, sy = b.y - a.y
  const len2 = sx * sx + sy * sy
  for (const c of corners) {
    const t = len2 < EPS ? 0 : Math.min(1, Math.max(0, ((c.x - a.x) * sx + (c.y - a.y) * sy) / len2))
    const to = { x: a.x + sx * t, y: a.y + sy * t }
    const d = Math.hypot(c.x - to.x, c.y - to.y)
    if (best === null || d < best.d) best = { d, from: c, to }
  }
  if (best && best.d >= 0.5) push('x', best.from.x, best.from.y, best.to.x, best.to.y)
  return out
}

/**
 * Display-only distance guides between the selected item and what the cursor points at.
 * 'none' falls back to the 4 nearest-wall distances. No guide with a distance <= 0 is returned.
 */
export function computeMeasureGuides(selected: FurnitureItem, target: MeasureTarget, artboard: Artboard): DistanceGuide[] {
  return computeMeasureGuidesForBox(furnitureAxisBounds(selected), target, artboard, furnitureWorldCorners(selected))
}

/** Corner radius of a 'rect' item, in cm. Default 4 cm, never more than half of the shorter side. */
export function furnitureCornerRadiusCm(widthCm: number, depthCm: number, cornerRadiusCm?: number): number {
  return Math.max(0, Math.min(cornerRadiusCm ?? 4, widthCm / 2, depthCm / 2))
}

/** The three points of the subtle front-direction chevron of one item, in local cm. */
export type DirectionArrow = {
  /** Tip, just inside the local -Y (front) edge. */
  tip: Vec
  /** Back end of the left wing. */
  left: Vec
  /** Back end of the right wing. */
  right: Vec
}

/**
 * Geometry of the optional front-direction chevron: it points to local -Y, its wings go back at 45°
 * and it never grows past the item. `u` turns screen px into cm, so it keeps its on-screen size.
 * Returns null when the item is too small to hold it.
 */
export function directionArrowGeometry(widthCm: number, depthCm: number, u: (px: number) => number): DirectionArrow | null {
  const halfW = Math.min(u(4.5), widthCm * 0.22)
  const rise = Math.min(halfW, depthCm * 0.22)
  const inset = Math.min(u(4), depthCm * 0.15)
  if (!(halfW > 0) || !(rise > 0)) return null
  const tipY = -depthCm / 2 + inset
  return { tip: { x: 0, y: tipY }, left: { x: -halfW, y: tipY + rise }, right: { x: halfW, y: tipY + rise } }
}
