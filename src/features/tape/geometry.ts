// Pure geometry and snapping for the quick Tape measure (no React, no store).
// All points are world cm (artboard-local point + artboard origin); y points down.
import { dist, projectOnSegment } from '../../model/geometry'
import type { Vec } from '../../model/geometry'
import type { Artboard } from '../../model/types'
import { furnitureWorldCorners } from '../furniture/geometry'
import { constrainAngle45 } from '../rooms/ops'

const EPS = 1e-9

export type TapeSnap = {
  point: Vec
  /** True when the point was pulled onto a vertex, a furniture corner or a wall. */
  snapped: boolean
}

export type TapeSnapOpts = {
  /** Skip snapping (Alt held): the point is returned as given, after the Shift constraint. */
  disableSnap?: boolean
  /** First point of the measurement. Needed for the Shift 45 degree lock. */
  anchor?: Vec
  /** Shift held: lock the point onto the nearest 45 degree ray from `anchor`. */
  shift?: boolean
}

const worldVertex = (v: Vec, ab: Artboard): Vec => ({ x: v.x + ab.xCm, y: v.y + ab.yCm })

/**
 * Snap a world point for the Tape tool.
 *
 * 1. Shift + anchor: the point is first projected onto the nearest 45 degree ray from `anchor`
 *    (0, 45, 90, 135, ... degrees).
 * 2. Alt (`disableSnap`): no candidate is looked for.
 * 3. Otherwise the nearest candidate within `thresholdCm` wins, in this priority order:
 *    a) a room vertex, b) a furniture corner, c) the closest point on a room wall segment.
 *    A candidate of a higher priority wins even when a lower one is closer.
 */
export function snapTapePoint(
  worldPt: Vec,
  artboards: readonly Artboard[],
  thresholdCm: number,
  opts: TapeSnapOpts = {},
): TapeSnap {
  const point = opts.shift && opts.anchor ? constrainAngle45(opts.anchor, worldPt) : worldPt
  if (opts.disableSnap) return { point, snapped: false }
  const thr = thresholdCm > 0 ? thresholdCm : 0
  let best: Vec | null = null
  let bestD = thr

  // (a) Room vertices, in world cm.
  for (const ab of artboards) {
    for (const room of ab.rooms) {
      for (const v of room.vertices) {
        const w = worldVertex(v, ab)
        const d = dist(point, w)
        if (d <= bestD) { bestD = d; best = w }
      }
    }
  }
  if (best) return { point: best, snapped: true }

  // (b) Corners of the furniture boxes, in world cm.
  bestD = thr
  for (const ab of artboards) {
    for (const item of ab.furniture) {
      for (const c of furnitureWorldCorners(item)) {
        const w = worldVertex(c, ab)
        const d = dist(point, w)
        if (d <= bestD) { bestD = d; best = w }
      }
    }
  }
  if (best) return { point: best, snapped: true }

  // (c) Closest point on a room wall segment, in world cm.
  bestD = thr
  for (const ab of artboards) {
    for (const room of ab.rooms) {
      const vs = room.vertices
      if (vs.length < 2) continue
      for (let i = 0; i < vs.length; i++) {
        const a = worldVertex(vs[i], ab)
        const b = worldVertex(vs[(i + 1) % vs.length], ab)
        const pr = projectOnSegment(point, a, b)
        if (pr.distance <= bestD) { bestD = pr.distance; best = pr.point }
      }
    }
  }
  if (best) return { point: best, snapped: true }
  return { point, snapped: false }
}

/** Length, signed deltas and direction (0-360 degrees, y down) of the measurement a -> b. */
export function measureSegment(a: Vec, b: Vec): { distCm: number; dxCm: number; dyCm: number; angleDeg: number } {
  const dxCm = b.x - a.x
  const dyCm = b.y - a.y
  const distCm = Math.hypot(dxCm, dyCm)
  const raw = distCm < EPS ? 0 : (Math.atan2(dyCm, dxCm) * 180) / Math.PI
  const angleDeg = raw < 0 ? raw + 360 : raw + 0 // "+ 0" turns -0 into 0
  return { distCm, dxCm, dyCm, angleDeg }
}

/** Label of a length, rounded to 0.1 cm: "142.5 cm". */
export function fmtTapeCm(cm: number): string {
  const r = Math.round(cm * 10) / 10
  return `${Math.abs(r) < 1e-9 ? 0 : r} cm`
}
