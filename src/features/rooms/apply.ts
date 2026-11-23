// "Apply measured lengths": re-solve a room polygon from verified wall lengths (plan 2.5.7 / 5.4). Pure, cm.
import { dist, roomWalls } from '../../model/geometry'
import type { PlanDoc, Room, WallProps } from '../../model/types'
import { moveVertices, movableLinked, type VMove } from './ops'
import { hasVerifiedWalls, solveRoom, verifiedWalls, type SolveMode } from './solve'
import { wallProps } from './walls'

export { hasVerifiedWalls, isRectilinear, isRightAngledQuad, solveRoom, verifiedWalls, type SolveMode, type Solved, type VerifiedWall } from './solve'

export type ApplyReport = {
  roomId: string
  code: string
  /** 'none' = nothing applied (see `skipped`). */
  mode: SolveMode | 'none'
  appliedWalls: number
  /** Gap left when walking the walls with the verified lengths (0 for rectangles), in cm. */
  closingErrorCm: number
  /** Rectangles: largest difference between two measured opposite walls, in cm. */
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
  roomId: room.id, code: room.code, mode: 'none', appliedWalls: 0, closingErrorCm: 0, oppositeDiffCm: 0, skipped,
})

/** Apply the verified wall lengths of one room. Corners shared with other (unlocked) rooms follow. */
export function applyMeasured(doc: PlanDoc, roomId: string): { doc: PlanDoc; report: ApplyReport } {
  const room = doc.rooms.find((r) => r.id === roomId)
  if (!room) return { doc, report: { ...none({ id: roomId, code: '?' } as Room, 'Room not found') } }
  const ver = verifiedWalls(doc, room)
  if (!ver.length) return { doc, report: none(room, 'No verified wall lengths') }

  const measured: (number | null)[] = room.vertices.map(() => null)
  for (const v of ver) measured[v.index] = v.cm
  const solved = solveRoom(room, measured)

  const walls = roomWalls({ ...room, vertices: room.vertices.map((v, i) => ({ ...v, ...solved.points[i] })) })
  if (walls.some((x) => x.length < 1)) return { doc, report: none(room, 'A wall would collapse') }

  // Lock verified walls (a wall bent by the closing step is not locked).
  const props: Record<string, WallProps> = { ...room.walls }
  for (const v of ver) {
    const got = walls[v.index].length
    if (solved.mode === 'rect' || Math.abs(got - v.cm) <= 0.5) props[v.wallStart] = { ...wallProps(room, v.wallStart), locked: true }
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
    closingErrorCm: solved.closingErrorCm, oppositeDiffCm: solved.oppositeDiffCm,
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
  const f = (n: number) => (Math.round(n * 10) / 10).toString().replace('.', ',')
  const parts = [`${r.code}: applied ${r.appliedWalls} measured wall${r.appliedWalls === 1 ? '' : 's'}`]
  if (r.mode === 'polygon') parts.push(`closing error ${f(r.closingErrorCm)} cm`)
  if (r.mode === 'rectilinear' && r.closingErrorCm > 0.5) parts.push(`closing error ${f(r.closingErrorCm)} cm (spread over the walls, right angles kept)`)
  if (r.oppositeDiffCm > 0.5) parts.push(`opposite walls differ by ${f(r.oppositeDiffCm)} cm (averaged)`)
  if (r.diagonal && r.diagonal.diffCm > 1) parts.push(`diagonal check: measured ${f(r.diagonal.measuredCm)}, plan ${f(r.diagonal.planCm)} (${f(r.diagonal.diffCm)} cm off)`)
  return parts.join('; ') + '.'
}
