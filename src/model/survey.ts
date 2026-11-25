// Survey IDs for Measuring Mode (see docs/plan.md 2.5.1).
// CODE-1..n = walls in polygon order, CODE-D = diagonal (if room.diagonal), CODE-H = ceiling height,
// CODE-n-T = thickness of wall n (optional, measured at a door or window frame).
// W12-C / W12-E = centre line and outside face of a stored wall (optional, phase 5b).
import { facadePlannedLengths } from '../features/rooms/outside/outsideDims'
import { DEFAULT_WALL_CM, dist, roomInnerRing, roomWalls } from './geometry'
import type { PlanDoc, Room, StoredNode, StoredWall } from './types'
import { ownsWall } from './wallSides'
import {
  outsideFaceSide, wallCentreCm, wallOutsidePlanCm, wallValueLabel, type WallValueKind,
} from './wallValues'

export type SurveyId = {
  label: string
  roomId: string
  kind: 'wall' | 'diagonal' | 'height' | 'thickness'
  /** Not needed to finish the room: not counted in progress, never flagged. */
  optional?: boolean
  /** For walls and thicknesses: start vertex id of the wall. */
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
  // Planned values are inside faces (corners moved in by half the walls), like on-site values.
  const q = roomInnerRing(r)
  const ids: SurveyId[] = roomWalls(r).map((w) => ({
    label: `${r.code}-${w.index + 1}`, roomId: r.id, kind: 'wall', wallStart: w.start.id,
    plannedCm: dist(q[w.index], q[(w.index + 1) % q.length]),
  }))
  if (r.diagonal) {
    const [i, j] = r.diagonal
    const a = q[i], b = q[j]
    if (a && b) ids.push({ label: `${r.code}-D`, roomId: r.id, kind: 'diagonal', plannedCm: dist(a, b) })
  }
  ids.push({ label: `${r.code}-H`, roomId: r.id, kind: 'height', plannedCm: plannedCeilingCm(r, defaultCeilingCm) })
  return ids
}

/**
 * Thickness IDs of a room (optional). A thickness belongs to the WALL, not to the room: a wall
 * between two rooms has one ID only, held by the room that comes first in the walk-through
 * (see ownsWall). A room wall that already has a value keeps its ID, so no value is hidden.
 */
export const thicknessIds = (d: Pick<PlanDoc, 'rooms' | 'measurements'>, r: Room): SurveyId[] =>
  roomWalls(r)
    .filter((w) => ownsWall(d, r, w.index) || d.measurements[thicknessLabel(r.code, w.index)] != null)
    .map((w) => ({
      label: thicknessLabel(r.code, w.index), roomId: r.id, kind: 'thickness', wallStart: w.start.id, optional: true,
      plannedCm: r.walls[w.start.id]?.thicknessCm ?? DEFAULT_WALL_CM,
    }))

/** Survey IDs that a room needs to be complete (no optional ones). */
export const requiredSurveyIds = (r: Room, defaultCeilingCm?: number) => surveyIds(r, defaultCeilingCm).filter((s) => !s.optional)

/** Label of the thickness of wall `index` (0-based): "SE-6-T" for the 6th wall. */
export const thicknessLabel = (code: string, index: number) => `${code}-${index + 1}-T`

/** "SE-6-T" -> { code: "SE", index: 5 }. null for other labels. */
export function parseThicknessLabel(label: string): { code: string; index: number } | null {
  const m = /^(.+)-(\d+)-T$/.exec(label)
  return m && Number(m[2]) > 0 ? { code: m[1], index: Number(m[2]) - 1 } : null
}

/** Room code of a survey label: "SE-6", "SE-D", "SE-6-T" -> "SE". Room codes contain no "-". */
export const labelRoomCode = (label: string) => {
  const dash = label.indexOf('-')
  return dash > 0 ? label.slice(0, dash) : ''
}

export const roomsInWalkOrder = (d: PlanDoc) => [...d.rooms].sort((a, b) => a.walkOrder - b.walkOrder)

/** All survey IDs in walk order: for each room its walls, diagonal, height, then its wall thicknesses. */
export const allSurveyIds = (d: PlanDoc) =>
  roomsInWalkOrder(d).flatMap((r) => [...surveyIds(r, d.apartment?.defaultCeilingCm), ...thicknessIds(d, r)])

export const allRequiredSurveyIds = (d: PlanDoc) => allSurveyIds(d).filter((s) => !s.optional)

/** Next free room code, e.g. "R1", "R2". */
export const nextRoomCode = (d: PlanDoc) => {
  let n = 1
  const used = new Set(d.rooms.map((r) => r.code))
  while (used.has(`R${n}`)) n++
  return `R${n}`
}

// ---------- values of a stored wall (docs/walls-plan.md phase 5b) ----------

/**
 * A value of one stored wall: 'W12-C' (centre line, usually from the architect plan) or 'W12-E'
 * (outside face length of a facade wall). Both are optional: a plan is complete without them.
 */
export type WallSurveyId = {
  label: string
  kind: WallValueKind
  /** Stable id of the stored wall, e.g. 'W12'. */
  wallId: string
  /** Value from the traced plan. For the outside face: centre + half of the two end thicknesses. */
  plannedCm?: number
  optional?: boolean
}

/**
 * The wall values of one stored wall: its centre length, and its outside face length when the wall
 * has an outside face on its whole length. `plannedCm` comes from the drawing, never from a solve.
 */
export function wallValueIds(
  d: { rooms: Room[]; nodes?: StoredNode[]; walls?: StoredWall[] },
  wall: StoredWall,
  /** Planned outside lengths by label (facadePlannedLengths); computed here when not given. */
  planned: Map<string, number> = facadePlannedLengths({ rooms: d.rooms, nodes: d.nodes, walls: d.walls ?? [wall] }),
): WallSurveyId[] {
  const nodes = d.nodes ?? []
  const centre = wallCentreCm(nodes, wall)
  if (centre === null) return []
  const out: WallSurveyId[] = [
    { label: wallValueLabel(wall.id, 'centre'), kind: 'centre', wallId: wall.id, plannedCm: centre, optional: true },
  ]
  if (outsideFaceSide(wall, centre)) {
    out.push({
      label: wallValueLabel(wall.id, 'outside'), kind: 'outside', wallId: wall.id,
      // The length of the outside row on the plan (one source); the end formula only as a fallback.
      plannedCm: planned.get(wallValueLabel(wall.id, 'outside')) ?? wallOutsidePlanCm(d.rooms, nodes, wall) ?? centre,
      optional: true,
    })
  }
  return out
}

/**
 * Every wall value of the plan, in the order of the stored walls: W1-C, W1-E, W2-C... These are
 * optional values, so they are not part of `allSurveyIds` (progress of the rooms).
 */
export const wallSurveyIds = (d: Pick<PlanDoc, 'rooms' | 'walls' | 'nodes'>): WallSurveyId[] => {
  const planned = facadePlannedLengths(d)
  return (d.walls ?? []).flatMap((w) => wallValueIds(d, w, planned))
}
