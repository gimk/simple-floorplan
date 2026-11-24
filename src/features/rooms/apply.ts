// "Apply measured lengths": re-solve a room polygon from verified wall lengths (plan 2.5.7 / 5.4). Pure, cm.
import { dist, roomWalls } from '../../model/geometry'
import { planPrecision, roundVec } from '../../model/precision'
import type { PlanDoc, Room, WallProps } from '../../model/types'
import { moveVertices, movableLinked, type VMove } from './ops'
import { hasVerifiedWalls, measuredNeighbours, solveRoom, twinValues, verifiedWalls, type SolveMode, type SolveResidual } from './solve'
import { wallProps } from './walls'

export { hasVerifiedWalls, isRectilinear, isRightAngledQuad, solveRoom, verifiedWalls, type SolveMode, type SolveResidual, type Solved, type VerifiedWall } from './solve'

export type ApplyReport = {
  roomId: string
  code: string
  /** 'none' = nothing applied (see `skipped`). */
  mode: SolveMode | 'none'
  appliedWalls: number
  /** Root-mean-square of the measurement residuals (walls and diagonal), in cm. */
  closingErrorCm: number
  /** Same value as closingErrorCm: the fit error in cm rms. */
  rmsCm: number
  /** Fit per measured wall and for the diagonal (measured minus solved). */
  residuals: SolveResidual[]
  /** Always 0 with the least-squares fit (kept for the report shape). */
  oppositeDiffCm: number
  /** Check against CODE-D when measured. */
  diagonal?: { measuredCm: number; planCm: number; diffCm: number }
  skipped?: string
}

/**
 * Corners of other rooms that follow a moved corner. A room with its own verified walls
 * does not follow: its shape comes from its own values, and dragging one of its corners
 * would bend it before it is solved.
 */
export function followersForApply(doc: Pick<PlanDoc, 'rooms' | 'measurements'>, roomId: string, vertexId: string) {
  return movableLinked(doc, roomId, vertexId).filter((ref) => {
    const rm = doc.rooms.find((r) => r.id === ref.roomId)
    return !!rm && !hasVerifiedWalls(doc, rm)
  })
}

const none = (room: Room, skipped: string): ApplyReport => ({
  roomId: room.id, code: room.code, mode: 'none', appliedWalls: 0, closingErrorCm: 0, rmsCm: 0, residuals: [], oppositeDiffCm: 0, skipped,
})

/** Apply the verified wall lengths of one room. Corners shared with other (unlocked) rooms follow. */
export function applyMeasured(doc: PlanDoc, roomId: string): { doc: PlanDoc; report: ApplyReport } {
  const room = doc.rooms.find((r) => r.id === roomId)
  if (!room) return { doc, report: { ...none({ id: roomId, code: '?' } as Room, 'Room not found') } }
  const ver = verifiedWalls(doc, room)
  if (!ver.length) return { doc, report: none(room, 'No measured wall lengths') }

  const measured: (number | null)[] = room.vertices.map(() => null)
  for (const v of ver) measured[v.index] = v.cm
  // A shared wall with no value here keeps the centre line of the wall measured from the next room.
  const centre: (number | null)[] = room.vertices.map(() => null)
  for (const t of twinValues(doc, room)) centre[t.index] = t.cm
  const diagonalCm = doc.measurements[`${room.code}-D`]?.actualCm ?? null
  const raw = solveRoom(room, measured, diagonalCm, centre)
  // Corners take the precision of the plan (0.5 or 1 cm), if the user chose one.
  const step = planPrecision(doc)
  const solved = step ? { ...raw, points: raw.points.map((p) => roundVec(p, step)) } : raw

  const walls = roomWalls({ ...room, vertices: room.vertices.map((v, i) => ({ ...v, ...solved.points[i] })) })
  if (walls.some((x) => x.length < 1)) return { doc, report: none(room, 'A wall would collapse') }

  // Lock a verified wall only when the fit keeps it within 0.5 cm of its value.
  const props: Record<string, WallProps> = { ...room.walls }
  for (const v of ver) {
    const res = solved.residuals.find((x) => x.index === v.index)
    if (res && Math.abs(res.diffCm) <= 0.5) props[v.wallStart] = { ...wallProps(room, v.wallStart), locked: true }
  }

  const moves: VMove[] = []
  room.vertices.forEach((v, i) => {
    const to = solved.points[i]
    if (dist(v, to) < 0.01) return
    moves.push({ roomId, vertexId: v.id, x: to.x, y: to.y })
    for (const ref of followersForApply(doc, roomId, v.id)) moves.push({ ...ref, x: to.x, y: to.y })
  })
  const moved = moveVertices(doc, moves)
  const next: PlanDoc = { ...moved, rooms: moved.rooms.map((r) => (r.id === roomId ? { ...r, walls: props } : r)) }

  const report: ApplyReport = {
    roomId, code: room.code, mode: solved.mode, appliedWalls: ver.length,
    closingErrorCm: solved.closingErrorCm, rmsCm: solved.closingErrorCm, residuals: solved.residuals, oppositeDiffCm: solved.oppositeDiffCm,
  }
  if (room.diagonal) {
    const [i, j] = room.diagonal
    const m = doc.measurements[`${room.code}-D`]
    if (m && m.actualCm > 0 && solved.points[i] && solved.points[j]) {
      const planCm = dist(solved.points[i], solved.points[j])
      report.diagonal = { measuredCm: m.actualCm, planCm, diffCm: Math.abs(m.actualCm - planCm) }
    }
  }
  return { doc: next, report }
}

/**
 * Apply one room, then the rooms with their own values that share a measured wall with it:
 * they read that value for their side of the wall, so both sides keep the same length.
 */
export function applyMeasuredNear(doc: PlanDoc, roomId: string): { doc: PlanDoc; reports: ApplyReport[] } {
  // Find the neighbours before the room moves: solving it can move its corners by a wall thickness.
  const before = doc.rooms.find((r) => r.id === roomId)
  const near = before ? measuredNeighbours(doc, before).map((r) => r.id) : []
  const first = applyMeasured(doc, roomId)
  if (first.report.mode === 'none') return { doc: first.doc, reports: [first.report] }
  const rest = applyMeasuredAll(first.doc, near)
  return { doc: rest.doc, reports: [first.report, ...rest.reports] }
}

/** Apply to several rooms (default: all). One resulting doc, so one undo step. */
export function applyMeasuredAll(doc: PlanDoc, roomIds?: string[]): { doc: PlanDoc; reports: ApplyReport[] } {
  let cur = doc
  const reports: ApplyReport[] = []
  for (const id of roomIds ?? doc.rooms.map((r) => r.id)) {
    const r = applyMeasured(cur, id)
    cur = r.doc
    reports.push(r.report)
  }
  return { doc: cur, reports }
}

/** Lock or unlock every verified wall of a room. */
export function setVerifiedLocked(doc: PlanDoc, roomId: string, locked: boolean): PlanDoc {
  const room = doc.rooms.find((r) => r.id === roomId)
  if (!room) return doc
  const ver = verifiedWalls(doc, room)
  if (!ver.length) return doc
  const walls = { ...room.walls }
  for (const v of ver) walls[v.wallStart] = { ...wallProps(room, v.wallStart), locked }
  return { ...doc, rooms: doc.rooms.map((r) => (r.id === roomId ? { ...r, walls } : r)) }
}

/** Are all verified walls locked (and is there at least one)? */
export function verifiedAllLocked(doc: Pick<PlanDoc, 'measurements'>, room: Room): boolean {
  const ver = verifiedWalls(doc, room)
  return ver.length > 0 && ver.every((v) => !!room.walls[v.wallStart]?.locked)
}

/** One-line summary for the panel. */
export function describeReport(r: ApplyReport): string {
  if (r.mode === 'none') return `${r.code}: ${r.skipped ?? 'nothing applied'}.`
  const f = (n: number) => n.toFixed(1).replace('.', ',')
  const parts = [`${r.code}: applied ${r.appliedWalls} measured wall${r.appliedWalls === 1 ? '' : 's'}`]
  if (r.rmsCm >= 0.3) {
    const worst = r.residuals.reduce<SolveResidual | null>((a, x) => (!a || Math.abs(x.diffCm) > Math.abs(a.diffCm) ? x : a), null)
    let text = `fit error ${f(r.rmsCm)} cm rms`
    if (worst) {
      const label = worst.index === 'D' ? `${r.code}-D` : `${r.code}-${worst.index + 1}`
      text += `; largest: ${label} ${worst.diffCm >= 0 ? '+' : ''}${f(worst.diffCm)} cm`
    }
    parts.push(text)
  }
  if (r.diagonal && r.diagonal.diffCm > 1) parts.push(`diagonal check: measured ${f(r.diagonal.measuredCm)}, plan ${f(r.diagonal.planCm)} (${f(r.diagonal.diffCm)} cm off)`)
  return parts.join('; ') + '.'
}
