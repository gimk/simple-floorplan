// Closed areas of a set of wall centre lines (docs/walls-plan.md, phase 6). Pure, cm.
// STUB: the contract is fixed; the implementation comes in its own round.
import type { Vec } from './types'

/** One centre-line segment: a traced wall or a room wall. */
export type FaceSegment = { id: string; a: Vec; b: Vec }

export type EnclosingCycle = {
  /** Corners of the smallest closed area around the point, in order, no repeated first point. */
  points: Vec[]
  /** For each edge i (points[i] -> points[i+1]): the id of the segment it lies on. */
  segmentIds: string[]
}

/**
 * The smallest closed area around `p` formed by the segments, or null when `p` is not inside one.
 * Segments are split at their crossings and at end points that lie on other segments (within
 * `tolCm`); end points closer than `tolCm` are one point.
 */
export function findEnclosingCycle(segments: FaceSegment[], p: Vec, tolCm = 1): EnclosingCycle | null {
  void segments; void p; void tolCm
  return null
}
