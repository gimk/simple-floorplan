// Measured values of a room against its plan: rms of (measured − plan), plus the diagonal
// check. Pure, cm. Moved out of RoomsPanel.tsx so the Solve tab can read the same number
// (docs/sidebar-plan-3.md); RoomsPanel.tsx re-exports it for the old imports.
import { innerWallLengths, roomInnerRing } from '../../model/geometry'
import type { PlanDoc, Room } from '../../model/types'
import { verifiedWalls } from './solve'

export type FitCheck = {
  /** Root-mean-square of the residuals, in cm. */
  rmsCm: number
  /** Number of measured values in the fit (walls + the diagonal, when measured). */
  count: number
  diagonal?: { measuredCm: number; planCm: number }
}

/** Measured values of a room against its plan, or null when the room has no measured value. */
export function fitCheck(doc: Pick<PlanDoc, 'measurements'>, room: Room): FitCheck | null {
  // Inside faces: measured values are taken inside the room.
  const q = roomInnerRing(room)
  const inner = innerWallLengths(room)
  const diffs = verifiedWalls(doc, room).map((v) => v.cm - inner[v.index])
  let diagonal: { measuredCm: number; planCm: number } | undefined
  const dm = doc.measurements[`${room.code}-D`]?.actualCm
  if (room.diagonal && dm && dm > 0) {
    const a = q[room.diagonal[0]], b = q[room.diagonal[1]]
    if (a && b) { diagonal = { measuredCm: dm, planCm: Math.hypot(b.x - a.x, b.y - a.y) }; diffs.push(dm - diagonal.planCm) }
  }
  if (!diffs.length) return null
  return { rmsCm: Math.sqrt(diffs.reduce((s, d) => s + d * d, 0) / diffs.length), count: diffs.length, diagonal }
}
