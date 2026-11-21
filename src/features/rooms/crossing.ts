// Self-intersection checks for polygon rings (cm). Pure functions.
import { cross, dist, dot, projectOnSegment, sub } from '../../model/geometry'
import type { Vec } from '../../model/types'

const EPS = 1e-7

const orient = (a: Vec, b: Vec, c: Vec) => {
  const v = cross(sub(b, a), sub(c, a))
  return Math.abs(v) < EPS ? 0 : v > 0 ? 1 : -1
}

const onSeg = (a: Vec, b: Vec, p: Vec) =>
  Math.min(a.x, b.x) - EPS <= p.x && p.x <= Math.max(a.x, b.x) + EPS &&
  Math.min(a.y, b.y) - EPS <= p.y && p.y <= Math.max(a.y, b.y) + EPS

/** Do segments p1p2 and p3p4 share at least one point (touching counts)? */
export function segmentsIntersect(p1: Vec, p2: Vec, p3: Vec, p4: Vec): boolean {
  const o1 = orient(p1, p2, p3), o2 = orient(p1, p2, p4), o3 = orient(p3, p4, p1), o4 = orient(p3, p4, p2)
  if (o1 !== o2 && o3 !== o4) return true
  if (o1 === 0 && onSeg(p1, p2, p3)) return true
  if (o2 === 0 && onSeg(p1, p2, p4)) return true
  if (o3 === 0 && onSeg(p3, p4, p1)) return true
  if (o4 === 0 && onSeg(p3, p4, p2)) return true
  return false
}

/** Two edges that share an endpoint fold back onto each other (collinear, opposite directions). */
const foldsBack = (a: Vec, shared: Vec, c: Vec) => {
  const d1 = sub(shared, a), d2 = sub(c, shared)
  return Math.abs(cross(d1, d2)) < 1e-6 * (Math.hypot(d1.x, d1.y) * Math.hypot(d2.x, d2.y) || 1) && dot(d1, d2) < 0
}

/** True if the closed ring crosses or touches itself (adjacent edges excepted), or folds back on itself. */
export function selfIntersects(ring: Vec[]): boolean {
  const n = ring.length
  if (n < 3) return false
  for (let i = 0; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n]
    if (foldsBack(a, b, ring[(i + 2) % n])) return true
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue // adjacent through the closing edge
      if (segmentsIntersect(a, b, ring[j], ring[(j + 1) % n])) return true
    }
  }
  return false
}

/**
 * Would adding point `p` to the open path `pts` create an edge (last -> p) that crosses an earlier edge?
 * Used by the polygon tool before a point is accepted.
 */
export function newEdgeCrosses(pts: Vec[], p: Vec): boolean {
  const n = pts.length
  if (n < 2) return false
  const last = pts[n - 1]
  if (dist(last, p) < 0.5) return false
  for (let k = 0; k < n - 2; k++) {
    if (segmentsIntersect(last, p, pts[k], pts[k + 1])) return true
  }
  // Adjacent edge: only a fold back along it is a problem.
  return projectOnSegment(p, pts[n - 2], last).distance < 0.5
}
