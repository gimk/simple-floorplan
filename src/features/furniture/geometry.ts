// Pure geometry and snapping for furniture (no React, no store). Units: cm, degrees, y points down.
//
// Local frame of an item: the centre is (xCm, yCm) in artboard-local cm, `widthCm` runs along local X
// and `depthCm` along local Y. `rotationDeg` turns the item clockwise on screen (y down), so the world
// offset of a local point (lx, ly) is (lx*cos - ly*sin, lx*sin + ly*cos).
// The FRONT edge of an item is the local -Y (top) edge, for every rotation: a bed, a sofa and a desk
// all face the same way, and a 0 degree item faces up on screen.
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
 * Nearest wall distance in each of the 4 cardinal directions from the item's bounds, measured from the
 * edges at the centre line. A direction with no wall within maxDistCm gives no guide.
 */
export function computeDistanceGuides(item: FurnitureItem, artboard: Artboard, maxDistCm = DEFAULT_MAX_GUIDE_DIST_CM): DistanceGuide[] {
  const b = furnitureAxisBounds(item)
  const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2
  const rays: { axis: 'x' | 'y'; from: Vec; dir: Vec }[] = [
    { axis: 'x', from: { x: b.minX, y: cy }, dir: { x: -1, y: 0 } },
    { axis: 'x', from: { x: b.maxX, y: cy }, dir: { x: 1, y: 0 } },
    { axis: 'y', from: { x: cx, y: b.minY }, dir: { x: 0, y: -1 } },
    { axis: 'y', from: { x: cx, y: b.maxY }, dir: { x: 0, y: 1 } },
  ]
  const walls = artboard.rooms.flatMap((r) =>
    r.vertices.map((p, i) => [p, r.vertices[(i + 1) % r.vertices.length]] as [Vec, Vec]),
  )
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
