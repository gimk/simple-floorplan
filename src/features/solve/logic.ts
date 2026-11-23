// Solve tab: the progress of the whole plan, as plain data (docs/sidebar-plan-3.md).
// Pure: no store, no React. One row per room, in document order.
import { roomWalls } from '../../model/geometry'
import type { PlanDoc } from '../../model/types'
import { verifiedAllLocked, verifiedWalls } from '../rooms/apply'
import { fitCheck } from '../rooms/fit'

export type ProgressRow = {
  roomId: string
  code: string
  name: string
  /** Number of walls with a measured value. */
  verified: number
  /** Number of walls of the room. */
  walls: number
  /** Fit error of the measured values against the plan, in cm rms. Null when there is none. */
  residualCm: number | null
  /** Every verified wall is locked (and there is at least one). */
  allLocked: boolean
}

/** One row per room, in document order. */
export function progressRows(doc: PlanDoc): ProgressRow[] {
  return doc.rooms.map((room) => {
    const fit = fitCheck(doc, room)
    return {
      roomId: room.id,
      code: room.code,
      name: room.name,
      verified: verifiedWalls(doc, room).length,
      walls: roomWalls(room).length,
      residualCm: fit ? fit.rmsCm : null,
      allLocked: verifiedAllLocked(doc, room),
    }
  })
}

export type ProgressTotals = {
  rooms: number
  walls: number
  verified: number
  /** Rooms whose verified walls are all locked. */
  lockedRooms: number
  /** Fit error over the rooms, in cm rms (each room weighs the same). Null when no room has one. */
  residualCm: number | null
}

/** Totals of the apartment, for the line under the progress list. */
export function progressTotals(rows: readonly ProgressRow[]): ProgressTotals {
  const residuals = rows.flatMap((r) => (r.residualCm === null ? [] : [r.residualCm]))
  return {
    rooms: rows.length,
    walls: rows.reduce((s, r) => s + r.walls, 0),
    verified: rows.reduce((s, r) => s + r.verified, 0),
    lockedRooms: rows.filter((r) => r.allLocked).length,
    residualCm: residuals.length
      ? Math.sqrt(residuals.reduce((s, v) => s + v * v, 0) / residuals.length)
      : null,
  }
}
