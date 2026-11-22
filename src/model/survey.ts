// Survey IDs for Measuring Mode (see docs/plan.md 2.5.1).
// CODE-1..n = walls in polygon order, CODE-D = diagonal (if room.diagonal), CODE-H = ceiling height.
import { dist, roomWalls } from './geometry'
import type { PlanDoc, Room } from './types'

export type SurveyId = {
  label: string
  roomId: string
  kind: 'wall' | 'diagonal' | 'height'
  /** For walls: start vertex id. */
  wallStart?: string
  /** Value from the traced plan, if any (estimated). */
  plannedCm?: number
}

const positive = (v: number | undefined): number | undefined =>
  v !== undefined && Number.isFinite(v) && v > 0 ? v : undefined

/**
 * Planned ceiling height of a room, in cm: the room's own value, else the apartment
 * default. Never the measured value: `plannedCm` is the traced plan, not the site.
 */
const plannedCeilingCm = (r: Room, defaultCeilingCm?: number): number | undefined =>
  positive(r.ceilingCm) ?? positive(defaultCeilingCm)

/**
 * Survey IDs of one room. Pass `doc.apartment?.defaultCeilingCm` when the document is
 * known, so `<CODE>-H` shows the height that takeoffs really use (see effectiveCeilingCm).
 */
export const surveyIds = (r: Room, defaultCeilingCm?: number): SurveyId[] => {
  const ids: SurveyId[] = roomWalls(r).map((w) => ({
    label: `${r.code}-${w.index + 1}`, roomId: r.id, kind: 'wall', wallStart: w.start.id, plannedCm: w.length,
  }))
  if (r.diagonal) {
    const [i, j] = r.diagonal
    const a = r.vertices[i], b = r.vertices[j]
    if (a && b) ids.push({ label: `${r.code}-D`, roomId: r.id, kind: 'diagonal', plannedCm: dist(a, b) })
  }
  ids.push({ label: `${r.code}-H`, roomId: r.id, kind: 'height', plannedCm: plannedCeilingCm(r, defaultCeilingCm) })
  return ids
}

export const roomsInWalkOrder = (d: PlanDoc) => [...d.rooms].sort((a, b) => a.walkOrder - b.walkOrder)

export const allSurveyIds = (d: PlanDoc) =>
  roomsInWalkOrder(d).flatMap((r) => surveyIds(r, d.apartment?.defaultCeilingCm))

/** Next free room code, e.g. "R1", "R2". */
export const nextRoomCode = (d: PlanDoc) => {
  let n = 1
  const used = new Set(d.rooms.map((r) => r.code))
  while (used.has(`R${n}`)) n++
  return `R${n}`
}
