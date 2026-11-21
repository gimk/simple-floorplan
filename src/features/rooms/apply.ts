// "Apply measured lengths": re-solve a room polygon from verified wall lengths (plan 2.5.7 / 5.4). Pure, cm.
import { dist, dot, len, norm, roomWalls, sub } from '../../model/geometry'
import { surveyIds } from '../../model/survey'
import type { PlanDoc, Room, Vec, WallProps } from '../../model/types'
import { moveVertices, movableLinked, type VMove } from './ops'
import { wallProps } from './walls'

export type VerifiedWall = { index: number; wallStart: string; label: string; cm: number }

/** Walls of the room that have an on-site value (label CODE-n). */
export function verifiedWalls(doc: Pick<PlanDoc, 'measurements'>, room: Room): VerifiedWall[] {
  const out: VerifiedWall[] = []
  surveyIds(room).forEach((s, index) => {
    if (s.kind !== 'wall' || !s.wallStart) return
    const m = doc.measurements[s.label]
    if (m && Number.isFinite(m.actualCm) && m.actualCm > 0) out.push({ index, wallStart: s.wallStart, label: s.label, cm: m.actualCm })
  })
  return out
}

/** 4 vertices, every corner within ~1 degree of a right angle. */
export function isRightAngledQuad(room: Room): boolean {
  const v = room.vertices
  if (v.length !== 4) return false
  return v.every((b, i) => {
    const a = v[(i + 3) % 4], c = v[(i + 1) % 4]
    const d1 = norm(sub(a, b)), d2 = norm(sub(c, b))
    return Math.abs(dot(d1, d2)) < 0.02
  })
}

export type ApplyReport = {
  roomId: string
  code: string
  /** 'none' = nothing applied (see `skipped`). */
  mode: 'rect' | 'polygon' | 'none'
  appliedWalls: number
  /** Gap left when walking the walls with the verified lengths (0 for rectangles), in cm. */
  closingErrorCm: number
  /** Rectangles: largest difference between two measured opposite walls, in cm. */
  oppositeDiffCm: number
  /** Check against CODE-D when measured. */
  diagonal?: { measuredCm: number; planCm: number; diffCm: number }
  skipped?: string
}

type Solved = { points: Vec[]; closingErrorCm: number; oppositeDiffCm: number; mode: 'rect' | 'polygon' }

function solveRect(room: Room, measured: (number | null)[]): Solved {
  const w = roomWalls(room)
  const pair = (i: number, j: number) => {
    const a = measured[i], b = measured[j]
    if (a !== null && b !== null) return { v: (a + b) / 2, diff: Math.abs(a - b) }
    if (a !== null) return { v: a, diff: 0 }
    if (b !== null) return { v: b, diff: 0 }
    return { v: (w[i].length + w[j].length) / 2, diff: 0 }
  }
  const A = pair(0, 2), B = pair(1, 3)
  const d0 = w[0].dir
  let n = { x: -d0.y, y: d0.x }
  if (dot(n, w[1].dir) < 0) n = { x: -n.x, y: -n.y }
  const p0 = room.vertices[0]
  const p1 = { x: p0.x + d0.x * A.v, y: p0.y + d0.y * A.v }
  const p2 = { x: p1.x + n.x * B.v, y: p1.y + n.y * B.v }
  const p3 = { x: p0.x + n.x * B.v, y: p0.y + n.y * B.v }
  return { points: [{ x: p0.x, y: p0.y }, p1, p2, p3], closingErrorCm: 0, oppositeDiffCm: Math.max(A.diff, B.diff), mode: 'rect' }
}

function solvePolygon(room: Room, measured: (number | null)[]): Solved {
  const w = roomWalls(room), n = w.length
  const L = w.map((x, i) => measured[i] ?? x.length)
  const v0 = room.vertices[0]
  // Walk with the kept directions.
  const walk: Vec[] = [{ x: v0.x, y: v0.y }]
  for (let i = 0; i < n; i++) {
    const p = walk[i]
    walk.push({ x: p.x + w[i].dir.x * L[i], y: p.y + w[i].dir.y * L[i] })
  }
  const e = sub(walk[n], v0)
  const closingErrorCm = len(e)
  const unmeasured = w.map((_, i) => i).filter((i) => measured[i] === null)
  if (!unmeasured.length) {
    // All measured: the last wall closes the polygon.
    return { points: walk.slice(0, n), closingErrorCm, oppositeDiffCm: 0, mode: 'polygon' }
  }
  const total = unmeasured.reduce((s, i) => s + L[i], 0) || 1
  const pts: Vec[] = [{ x: v0.x, y: v0.y }]
  for (let i = 0; i < n - 1; i++) {
    const share = measured[i] === null ? L[i] / total : 0
    const p = pts[i]
    pts.push({ x: p.x + w[i].dir.x * L[i] - e.x * share, y: p.y + w[i].dir.y * L[i] - e.y * share })
  }
  return { points: pts, closingErrorCm, oppositeDiffCm: 0, mode: 'polygon' }
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
  const solved = isRightAngledQuad(room) ? solveRect(room, measured) : solvePolygon(room, measured)

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
    for (const ref of movableLinked(doc, roomId, v.id)) moves.push({ ...ref, x: to.x, y: to.y })
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
  if (r.oppositeDiffCm > 0.5) parts.push(`opposite walls differ by ${f(r.oppositeDiffCm)} cm (averaged)`)
  if (r.diagonal && r.diagonal.diffCm > 1) parts.push(`diagonal check: measured ${f(r.diagonal.measuredCm)}, plan ${f(r.diagonal.planCm)} (${f(r.diagonal.diffCm)} cm off)`)
  return parts.join('; ') + '.'
}
