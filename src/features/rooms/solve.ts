// Solvers for "Apply measured lengths": new room outline from verified wall lengths. Pure, cm.
// No store or DOM imports: the API worker (core/commands.ts) uses this file too.
import { dot, len, norm, roomWalls, sub } from '../../model/geometry'
import { surveyIds } from '../../model/survey'
import type { PlanDoc, Room, Vec } from '../../model/types'

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

/** Does the room have at least one wall with an on-site value? */
export const hasVerifiedWalls = (doc: Pick<PlanDoc, 'measurements'>, room: Room): boolean => verifiedWalls(doc, room).length > 0

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

const AXIS_TOL = 0.02

/** Every wall is parallel or perpendicular to wall 1 (within ~1 degree): an L, T or U shaped room. */
export function isRectilinear(room: Room): boolean {
  const w = roomWalls(room)
  if (w.length < 4 || w.some((x) => x.length < 1e-6)) return false
  const u = w[0].dir
  return w.every((x) => Math.abs(dot(x.dir, u)) < AXIS_TOL || Math.abs(Math.abs(dot(x.dir, u)) - 1) < AXIS_TOL)
}

export type SolveMode = 'rect' | 'rectilinear' | 'polygon'

export type Solved = { points: Vec[]; closingErrorCm: number; oppositeDiffCm: number; mode: SolveMode }

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

/**
 * Rectilinear room (all walls on two perpendicular axes): keep every corner at a right angle.
 * The walls along each axis must sum to zero. The gap on each axis is spread over the
 * unmeasured walls of that axis (by length), or over all its walls when every one is measured.
 */
function solveRectilinear(room: Room, measured: (number | null)[]): Solved {
  const w = roomWalls(room), n = w.length
  const u = w[0].dir, v = { x: -u.y, y: u.x }
  const onU = w.map((x) => Math.abs(dot(x.dir, u)) > 0.5)
  const sign = w.map((x, i) => (dot(x.dir, onU[i] ? u : v) >= 0 ? 1 : -1))
  const L = w.map((x, i) => measured[i] ?? x.length)
  const gap = (axisU: boolean) => w.reduce((s, _, i) => (onU[i] === axisU ? s + sign[i] * L[i] : s), 0)
  const eU = gap(true), eV = gap(false)
  const out = [...L]
  for (const [axisU, e] of [[true, eU], [false, eV]] as const) {
    const axis = w.map((_, i) => i).filter((i) => onU[i] === axisU)
    const free = axis.filter((i) => measured[i] === null)
    if (free.length) {
      const total = free.reduce((s, i) => s + L[i], 0) || 1
      for (const i of free) out[i] -= sign[i] * e * (L[i] / total)
    } else {
      for (const i of axis) out[i] -= sign[i] * e / axis.length
    }
  }
  const pts: Vec[] = [{ x: room.vertices[0].x, y: room.vertices[0].y }]
  for (let i = 0; i < n - 1; i++) {
    const d = onU[i] ? u : v, p = pts[i]
    pts.push({ x: p.x + d.x * sign[i] * out[i], y: p.y + d.y * sign[i] * out[i] })
  }
  return { points: pts, closingErrorCm: Math.hypot(eU, eV), oppositeDiffCm: 0, mode: 'rectilinear' }
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

/** Pick the solver for the room's shape: rectangle, right-angled polygon, or free polygon. */
export function solveRoom(room: Room, measured: (number | null)[]): Solved {
  if (isRightAngledQuad(room)) return solveRect(room, measured)
  if (isRectilinear(room)) return solveRectilinear(room, measured)
  return solvePolygon(room, measured)
}
