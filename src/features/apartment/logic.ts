// Pure apartment-level helpers (zero React, zero DOM, no store imports):
// totals for the panels/queries and the plan-vs-document surface comparison.
import { innerWallLengths, roomAreaM2 } from '../../model/geometry'
import type { PlanDoc, Room, SurfaceReference, SurfaceReferenceSource } from '../../model/types'
import { effectiveCeilingCm, hasOwnCeiling } from '../export/calc'
import { docProgress } from '../measure/logic'

/** Human labels for the reference sources (French legal surfaces + usual documents). */
export const SOURCE_LABELS: Record<SurfaceReferenceSource, string> = {
  dpe: 'DPE',
  carrez: 'Loi Carrez',
  boutin: 'Loi Boutin',
  deed: 'Deed',
  listing: 'Listing',
  other: 'Other',
}

export const SOURCE_VALUES: SurfaceReferenceSource[] = ['dpe', 'carrez', 'boutin', 'deed', 'listing', 'other']

const round2 = (n: number) => Math.round(n * 100) / 100

/** Sum of the floor area of the given rooms, in m² (holes are subtracted, see roomAreaM2). */
export const totalAreaM2 = (rooms: Room[]): number => rooms.reduce((s, r) => s + roomAreaM2(r), 0)

export type ApartmentTotals = {
  /** Rooms of the apartment, built-in storage excluded (it is not a room of its own). */
  roomCount: number
  /** Indoor rooms, built-in storage excluded. */
  indoorRoomCount: number
  outdoorRoomCount: number
  /** Sum of the indoor floor areas, m² (outdoor rooms excluded). */
  indoorAreaM2: number
  /** Sum of the outdoor floor areas, m². */
  outdoorAreaM2: number
  /** Sum of every indoor room perimeter, m. Shared walls are counted once per room. */
  wallPerimeterM: number
  defaultCeilingCm: number | null
  /** Rooms that set their own ceiling height, so the apartment default does not apply. */
  roomsWithOwnCeiling: number
  /** Indoor rooms whose effective ceiling height is unknown (no height, no default). */
  roomsWithoutCeiling: number
  /** Indoor volume, m³: sum of (area × effective ceiling), rounded to 2 decimals. */
  volumeM3: number
  /** Survey progress: measured survey IDs / all survey IDs. */
  measured: { done: number; total: number }
}

export function apartmentTotals(doc: PlanDoc): ApartmentTotals {
  const indoor = doc.rooms.filter((r) => !r.outdoor)
  const outdoor = doc.rooms.filter((r) => r.outdoor)
  let volumeM3 = 0
  let roomsWithoutCeiling = 0
  for (const r of indoor) {
    const cm = effectiveCeilingCm(doc, r)
    if (cm === null) {
      roomsWithoutCeiling++
      continue
    }
    volumeM3 += roomAreaM2(r) * (cm / 100)
  }
  return {
    // A built-in storage is shown inside its parent room (docs/storage-plan.md), so the ROOM
    // count leaves it out. Its area stays in the areas below.
    roomCount: doc.rooms.filter((r) => !r.storage).length,
    indoorRoomCount: indoor.filter((r) => !r.storage).length,
    outdoorRoomCount: outdoor.length,
    indoorAreaM2: round2(totalAreaM2(indoor)),
    outdoorAreaM2: round2(totalAreaM2(outdoor)),
    // Inside faces, like the takeoffs (paint, baseboards).
    wallPerimeterM: round2(indoor.reduce((s, r) => s + innerWallLengths(r).reduce((a, l) => a + l, 0), 0) / 100),
    defaultCeilingCm: doc.apartment?.defaultCeilingCm ?? null,
    roomsWithOwnCeiling: doc.rooms.filter((r) => hasOwnCeiling(r)).length,
    roomsWithoutCeiling,
    volumeM3: round2(volumeM3),
    measured: docProgress(doc),
  }
}

export type ComparisonLevel = 'ok' | 'warn' | 'bad' | 'unknown'

export type ReferenceComparison = {
  /** Plan surface used for the comparison, m² (null when the referenced room is missing). */
  planM2: number | null
  /** plan − reference, m² (positive = the plan is bigger than the document). */
  diffM2: number | null
  /** Difference as a percentage of the reference surface. */
  diffPct: number | null
  /** ok ≤ 2 %, warn ≤ 5 %, bad > 5 %, unknown when it cannot be computed. */
  level: ComparisonLevel
  /** True when the reference names a room code that no longer exists. */
  missingRoom: boolean
  /** The area compared: one room, or the whole indoor area. */
  scope: 'room' | 'apartment'
}

/**
 * Compare a reference surface with the plan.
 * A reference with `roomCode` is compared with that room's area; otherwise with the
 * whole indoor area (outdoor rooms excluded).
 */
export function compareReference(doc: PlanDoc, ref: SurfaceReference): ReferenceComparison {
  const scope: 'room' | 'apartment' = ref.roomCode ? 'room' : 'apartment'
  let planM2: number | null
  let missingRoom = false
  if (ref.roomCode) {
    const room = doc.rooms.find((r) => r.code === ref.roomCode)
    if (room) planM2 = roomAreaM2(room)
    else {
      planM2 = null
      missingRoom = true
    }
  } else {
    planM2 = totalAreaM2(doc.rooms.filter((r) => !r.outdoor))
  }

  if (planM2 === null || !(ref.surfaceM2 > 0)) {
    return { planM2, diffM2: null, diffPct: null, level: 'unknown', missingRoom, scope }
  }

  const diffM2 = round2(planM2 - ref.surfaceM2)
  const diffPct = Math.round(((planM2 - ref.surfaceM2) / ref.surfaceM2) * 1000) / 10
  const abs = Math.abs(diffPct)
  const level: ComparisonLevel = abs <= 2 ? 'ok' : abs <= 5 ? 'warn' : 'bad'
  return { planM2: round2(planM2), diffM2, diffPct, level, missingRoom, scope }
}

/** Parse a height typed by a user: accepts comma decimals, trims spaces. null when invalid. */
export function parseCeilingInput(text: string): number | null {
  const t = text.trim().replace(',', '.')
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) && n > 0 ? n : null
}

/** Parse a surface typed by a user (m², comma decimals). null when invalid. */
export function parseSurfaceInput(text: string): number | null {
  const t = text.trim().replace(',', '.')
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) && n > 0 ? n : null
}
