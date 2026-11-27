// Pure smart-guide snapping and item/wall distance guides for furniture drags (single and group).
// No React, no store. Units: cm, y points down.
import type { Vec } from '../../model/geometry'
import type { Artboard } from '../../model/types'
import { DEFAULT_MAX_GUIDE_DIST_CM, furnitureAxisBounds } from './geometry'
import type { DistanceGuide, ItemBounds } from './geometry'

const EPS = 1e-9
const MIN_DIST_CM = 0.5

/** A snap alignment guide line along `axis` at `coord`, spanning `[from, to]` on the other axis. */
export type SnapGuideLine = {
  axis: 'x' | 'y'
  coord: number
  from: number
  to: number
}

type SnapCandidate = {
  coord: number
  from: number
  to: number
}

const roundP = (v: number, precisionCm?: number): number => {
  const p = precisionCm && precisionCm > 0 ? precisionCm : 0.1
  const r = Math.round(v / p) * p
  return Math.round(r * 1e6) / 1e6 + 0
}

/** Collect X and Y snap candidates from room walls and non-excluded furniture items. */
function collectBoxSnapCandidates(
  artboard: Artboard,
  excludeIds: ReadonlySet<string>,
): { xs: SnapCandidate[]; ys: SnapCandidate[] } {
  const xs: SnapCandidate[] = []
  const ys: SnapCandidate[] = []

  for (const room of artboard.rooms) {
    const v = room.vertices
    for (let i = 0; i < v.length; i++) {
      const a = v[i]
      const b = v[(i + 1) % v.length]
      if (Math.abs(a.x - b.x) < 0.01) {
        xs.push({ coord: a.x, from: Math.min(a.y, b.y), to: Math.max(a.y, b.y) })
      } else {
        xs.push({ coord: a.x, from: a.y, to: a.y })
      }
      if (Math.abs(a.y - b.y) < 0.01) {
        ys.push({ coord: a.y, from: Math.min(a.x, b.x), to: Math.max(a.x, b.x) })
      } else {
        ys.push({ coord: a.y, from: a.x, to: a.x })
      }
    }
  }

  for (const f of artboard.furniture) {
    if (excludeIds.has(f.id)) continue
    const b = furnitureAxisBounds(f)
    const cx = (b.minX + b.maxX) / 2
    const cy = (b.minY + b.maxY) / 2
    xs.push(
      { coord: b.minX, from: b.minY, to: b.maxY },
      { coord: cx, from: b.minY, to: b.maxY },
      { coord: b.maxX, from: b.minY, to: b.maxY },
    )
    ys.push(
      { coord: b.minY, from: b.minX, to: b.maxX },
      { coord: cy, from: b.minX, to: b.maxX },
      { coord: b.maxY, from: b.minX, to: b.maxX },
    )
  }

  return { xs, ys }
}

/**
 * Find the smallest delta `c.coord - m` within `thresholdCm`, or null when nothing is within range.
 */
function bestSnapDelta(
  refs: readonly number[],
  candidates: readonly SnapCandidate[],
  thresholdCm: number,
): number | null {
  let bestDelta: number | null = null
  for (const r of refs) {
    for (const c of candidates) {
      const d = c.coord - r
      if (Math.abs(d) <= thresholdCm && (bestDelta === null || Math.abs(d) < Math.abs(bestDelta))) {
        bestDelta = d
      }
    }
  }
  return bestDelta
}

/** Build one SnapGuideLine per unique snapped coordinate, spanning both the snapped box and targets. */
function buildSnapLines(
  refs: readonly number[],
  delta: number,
  candidates: readonly SnapCandidate[],
  boxSpanFrom: number,
  boxSpanTo: number,
  axis: 'x' | 'y',
): SnapGuideLine[] {
  const byCoord = new Map<number, { from: number; to: number }>()
  for (const r of refs) {
    const snappedRef = r + delta
    for (const c of candidates) {
      if (Math.abs(c.coord - snappedRef) > 0.05) continue
      const key = Math.round(c.coord * 100) / 100
      const prev = byCoord.get(key)
      const from = Math.min(boxSpanFrom, c.from)
      const to = Math.max(boxSpanTo, c.to)
      if (prev) {
        prev.from = Math.min(prev.from, from)
        prev.to = Math.max(prev.to, to)
      } else {
        byCoord.set(key, { from, to })
      }
    }
  }
  const lines: SnapGuideLine[] = []
  for (const [coord, span] of byCoord) {
    lines.push({ axis, coord, from: span.from, to: span.to })
  }
  return lines
}

/**
 * Snap a dragged bounding box (single item or group) to left/center/right and top/middle/bottom
 * of other furniture items in `artboard` and to room walls, returning the delta `(dx, dy)` and
 * alignment guide lines. Respects `disableSnap` (Alt held) and `lockAxis` (Shift axis-lock).
 */
export function snapBoxMove(
  box: ItemBounds,
  artboard: Artboard,
  excludeIds: ReadonlySet<string>,
  thresholdCm: number,
  opts?: { disableSnap?: boolean; lockAxis?: 'x' | 'y'; precisionCm?: number },
): { dx: number; dy: number; snappedX: boolean; snappedY: boolean; snapLines: SnapGuideLine[] } {
  if (opts?.disableSnap) {
    return { dx: 0, dy: 0, snappedX: false, snappedY: false, snapLines: [] }
  }

  const { xs, ys } = collectBoxSnapCandidates(artboard, excludeIds)
  const bxCenter = (box.minX + box.maxX) / 2
  const byCenter = (box.minY + box.maxY) / 2
  const precision = opts?.precisionCm ?? artboard.precisionCm
  const xRefs = [box.minX, bxCenter, box.maxX]
  const yRefs = [box.minY, byCenter, box.maxY]

  const xDelta = opts?.lockAxis === 'x' ? null : bestSnapDelta(xRefs, xs, thresholdCm)
  const yDelta = opts?.lockAxis === 'y' ? null : bestSnapDelta(yRefs, ys, thresholdCm)

  const dx =
    opts?.lockAxis === 'x'
      ? 0
      : xDelta !== null
        ? xDelta
        : roundP(bxCenter, precision) - bxCenter
  const dy =
    opts?.lockAxis === 'y'
      ? 0
      : yDelta !== null
        ? yDelta
        : roundP(byCenter, precision) - byCenter

  const finalMinX = box.minX + dx
  const finalMaxX = box.maxX + dx
  const finalMinY = box.minY + dy
  const finalMaxY = box.maxY + dy

  const snapLines: SnapGuideLine[] = [
    ...(xDelta !== null ? buildSnapLines(xRefs, xDelta, xs, finalMinY, finalMaxY, 'x') : []),
    ...(yDelta !== null ? buildSnapLines(yRefs, yDelta, ys, finalMinX, finalMaxX, 'y') : []),
  ]

  return {
    dx,
    dy,
    snappedX: xDelta !== null,
    snappedY: yDelta !== null,
    snapLines,
  }
}

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
 * Distance guides on each of the 4 sides (left, right, top, bottom) from `box` to the nearest
 * aligned furniture item or room wall within `maxDistCm`. Aligned items on the perpendicular axis
 * win when closer than the wall on that side.
 */
export function computeDragDistanceGuides(
  box: ItemBounds,
  artboard: Artboard,
  excludeIds: ReadonlySet<string>,
  maxDistCm = DEFAULT_MAX_GUIDE_DIST_CM,
): DistanceGuide[] {
  const precision = artboard.precisionCm
  const cx = (box.minX + box.maxX) / 2
  const cy = (box.minY + box.maxY) / 2

  type Side = 'left' | 'right' | 'top' | 'bottom'
  const best: Record<Side, DistanceGuide | null> = { left: null, right: null, top: null, bottom: null }

  const consider = (side: Side, g: DistanceGuide) => {
    if (g.distCm < MIN_DIST_CM || g.distCm > maxDistCm) return
    const cur = best[side]
    if (!cur || g.distCm < cur.distCm) best[side] = g
  }

  for (const f of artboard.furniture) {
    if (excludeIds.has(f.id)) continue
    const b = furnitureAxisBounds(f)
    const oy1 = Math.max(box.minY, b.minY)
    const oy2 = Math.min(box.maxY, b.maxY)
    if (oy2 > oy1) {
      const gy = (oy1 + oy2) / 2
      if (b.maxX <= box.minX) {
        consider('left', {
          axis: 'x',
          x1: box.minX,
          y1: gy,
          x2: b.maxX,
          y2: gy,
          distCm: roundP(box.minX - b.maxX, precision),
        })
      }
      if (b.minX >= box.maxX) {
        consider('right', {
          axis: 'x',
          x1: box.maxX,
          y1: gy,
          x2: b.minX,
          y2: gy,
          distCm: roundP(b.minX - box.maxX, precision),
        })
      }
    }

    const ox1 = Math.max(box.minX, b.minX)
    const ox2 = Math.min(box.maxX, b.maxX)
    if (ox2 > ox1) {
      const gx = (ox1 + ox2) / 2
      if (b.maxY <= box.minY) {
        consider('top', {
          axis: 'y',
          x1: gx,
          y1: box.minY,
          x2: gx,
          y2: b.maxY,
          distCm: roundP(box.minY - b.maxY, precision),
        })
      }
      if (b.minY >= box.maxY) {
        consider('bottom', {
          axis: 'y',
          x1: gx,
          y1: box.maxY,
          x2: gx,
          y2: b.minY,
          distCm: roundP(b.minY - box.maxY, precision),
        })
      }
    }
  }

  const walls = artboard.rooms.flatMap((r) =>
    r.vertices.map((p, i) => [p, r.vertices[(i + 1) % r.vertices.length]] as [Vec, Vec]),
  )
  const rays: { side: Side; axis: 'x' | 'y'; from: Vec; dir: Vec }[] = [
    { side: 'left', axis: 'x', from: { x: box.minX, y: cy }, dir: { x: -1, y: 0 } },
    { side: 'right', axis: 'x', from: { x: box.maxX, y: cy }, dir: { x: 1, y: 0 } },
    { side: 'top', axis: 'y', from: { x: cx, y: box.minY }, dir: { x: 0, y: -1 } },
    { side: 'bottom', axis: 'y', from: { x: cx, y: box.maxY }, dir: { x: 0, y: 1 } },
  ]
  for (const ray of rays) {
    let wallDist: number | null = null
    for (const [a, w] of walls) {
      const t = rayHit(ray.from, ray.dir, a, w)
      if (t === null || t <= MIN_DIST_CM || t > maxDistCm) continue
      if (wallDist === null || t < wallDist) wallDist = t
    }
    if (wallDist === null) continue
    consider(ray.side, {
      axis: ray.axis,
      x1: ray.from.x,
      y1: ray.from.y,
      x2: ray.from.x + ray.dir.x * wallDist,
      y2: ray.from.y + ray.dir.y * wallDist,
      distCm: roundP(wallDist, precision),
    })
  }

  return (['left', 'right', 'top', 'bottom'] as const)
    .map((s) => best[s])
    .filter((g): g is DistanceGuide => g !== null)
}
