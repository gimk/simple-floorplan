// Solver for "Apply measured lengths": new room outline from verified wall lengths and diagonal. Pure, cm.
// No store or DOM imports: the API worker (core/commands.ts) uses this file too.
import { cross, dot, len, norm, roomWalls, sub } from '../../model/geometry'
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

export type SolveMode = 'lsq'

/** One measured value after the fit. diffCm = measuredCm - solvedCm. index = wall index, or 'D' for the diagonal. */
export type SolveResidual = { index: number | 'D'; measuredCm: number; solvedCm: number; diffCm: number }

export type Solved = {
  points: Vec[]
  /** Root-mean-square of the measurement residuals (measured walls and diagonal), in cm. */
  closingErrorCm: number
  oppositeDiffCm: number
  mode: SolveMode
  residuals: SolveResidual[]
}

const DEG = 180 / Math.PI
const dotArr = (a: number[], b: number[]) => a.reduce((s, x, k) => s + x * b[k], 0)
const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))

/** Solve A x = b by Gaussian elimination with partial pivoting. Null when A is singular. */
function solveLinear(A: number[][], b: number[]): number[] | null {
  const n = b.length
  const M = A.map((row, i) => [...row, b[i]])
  for (let c = 0; c < n; c++) {
    let p = c
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r
    if (Math.abs(M[p][c]) < 1e-12) return null
    const tmp = M[c]
    M[c] = M[p]
    M[p] = tmp
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c]
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]
    }
  }
  const x = new Array<number>(n).fill(0)
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n]
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k]
    x[r] = s / M[r][r]
  }
  return x
}

type Corner = { prev: number; at: number; next: number; kind: 'right' | 'straight' | 'free'; meanLen: number; drawnTurn: number }

/**
 * One least-squares fit per room. Measured walls and the measured diagonal are constraints; the drawn
 * right angles are kept strongly; the other corners and the unmeasured walls keep their drawn shape weakly.
 * Vertex 0 is fixed and wall 0 keeps its direction (vertex 1 slides along it).
 *
 * Weights (cm residuals): measured wall 1.0, diagonal 1.0, right angle 10 x mean adjacent length (dot of
 * unit edges), straight corner 10 x mean length (cross of unit edges), other corner 0.05 x mean length
 * (turn angle in radians), unmeasured wall 0.01.
 */
export function solveRoomLsq(room: Room, measured: (number | null)[], diagonalCm?: number | null): Solved {
  const n = room.vertices.length
  const w = roomWalls(room)
  const drawn: Vec[] = room.vertices.map((v) => ({ x: v.x, y: v.y }))
  const drawnLen = w.map((x) => x.length)
  const d0 = w[0].dir
  const diag = room.diagonal && diagonalCm && diagonalCm > 0 && room.diagonal.every((k) => k >= 0 && k < n)
    ? { i: room.diagonal[0], j: room.diagonal[1], cm: diagonalCm }
    : null

  const corners: Corner[] = drawn.map((p, k) => {
    const prev = (k + n - 1) % n, next = (k + 1) % n
    const cosA = dot(norm(sub(drawn[prev], p)), norm(sub(drawn[next], p)))
    const angle = Math.acos(Math.max(-1, Math.min(1, cosA))) * DEG
    const da = norm(sub(p, drawn[prev])), db = norm(sub(drawn[next], p))
    const kind = Math.abs(angle - 90) <= 3 ? 'right' : Math.abs(angle - 180) <= 3 ? 'straight' : 'free'
    return {
      prev, at: k, next, kind,
      meanLen: (drawnLen[prev] + drawnLen[k]) / 2,
      drawnTurn: Math.atan2(cross(da, db), dot(da, db)),
    }
  })

  // Unknowns: s = length of wall 0, then x and y of vertices 2..n-1.
  const toPoints = (p: number[]): Vec[] => {
    const pts: Vec[] = [drawn[0], { x: drawn[0].x + d0.x * p[0], y: drawn[0].y + d0.y * p[0] }]
    for (let k = 2; k < n; k++) pts.push({ x: p[2 * k - 3], y: p[2 * k - 2] })
    return pts
  }
  const start = [drawnLen[0]]
  for (let k = 2; k < n; k++) start.push(drawn[k].x, drawn[k].y)

  const residuals = (p: number[]): number[] => {
    const v = toPoints(p)
    const out: number[] = []
    for (let i = 0; i < n; i++) {
      const e = len(sub(v[(i + 1) % n], v[i]))
      const L = measured[i]
      out.push(L != null ? e - L : (e - drawnLen[i]) * 0.01)
    }
    if (diag) out.push(len(sub(v[diag.j], v[diag.i])) - diag.cm)
    for (const c of corners) {
      const a = norm(sub(v[c.at], v[c.prev])), b = norm(sub(v[c.next], v[c.at]))
      if (c.kind === 'right') out.push(dot(a, b) * c.meanLen * 10)
      else if (c.kind === 'straight') out.push(cross(a, b) * c.meanLen * 10)
      else out.push(wrapAngle(Math.atan2(cross(a, b), dot(a, b)) - c.drawnTurn) * c.meanLen * 0.05)
    }
    return out
  }

  const cost = (r: number[]) => r.reduce((s, x) => s + x * x, 0)
  const H = 1e-3
  let p = start
  let r = residuals(p)
  let c = cost(r)
  let lambda = 1e-3
  for (let iter = 0; iter < 100; iter++) {
    // Numeric Jacobian (central differences), one column per unknown.
    const cols: number[][] = []
    for (let q = 0; q < p.length; q++) {
      const plus = [...p]
      plus[q] += H
      const minus = [...p]
      minus[q] -= H
      const rp = residuals(plus), rm = residuals(minus)
      cols.push(rp.map((x, k) => (x - rm[k]) / (2 * H)))
    }
    const JtJ = cols.map((a) => cols.map((b) => dotArr(a, b)))
    const Jtr = cols.map((a) => dotArr(a, r))
    let step: number[] | null = null
    let accepted = false
    for (let tries = 0; tries < 20 && !accepted; tries++) {
      // Levenberg-Marquardt damping on the diagonal.
      const A = JtJ.map((row, a) => row.map((x, b) => (a === b ? x * (1 + lambda) + 1e-9 : x)))
      const delta = solveLinear(A, Jtr.map((x) => -x))
      if (!delta) {
        lambda *= 10
        continue
      }
      const cand = p.map((x, k) => x + delta[k])
      const rc = residuals(cand)
      const cc = cost(rc)
      if (cc < c) {
        p = cand
        r = rc
        c = cc
        lambda = Math.max(lambda / 3, 1e-12)
        accepted = true
        step = delta
      } else {
        lambda *= 4
      }
    }
    if (!accepted || !step || Math.sqrt(dotArr(step, step)) < 1e-6) break
  }

  const pts = toPoints(p)
  const fit: SolveResidual[] = []
  for (let i = 0; i < n; i++) {
    const m = measured[i]
    if (m == null) continue
    const solvedCm = len(sub(pts[(i + 1) % n], pts[i]))
    fit.push({ index: i, measuredCm: m, solvedCm, diffCm: m - solvedCm })
  }
  if (diag) {
    const solvedCm = len(sub(pts[diag.j], pts[diag.i]))
    fit.push({ index: 'D', measuredCm: diag.cm, solvedCm, diffCm: diag.cm - solvedCm })
  }
  const rms = fit.length ? Math.sqrt(fit.reduce((s, x) => s + x.diffCm * x.diffCm, 0) / fit.length) : 0
  return { points: pts, closingErrorCm: rms, oppositeDiffCm: 0, mode: 'lsq', residuals: fit }
}

/** Solve the room outline from its measured walls and (optional) measured diagonal. */
export function solveRoom(room: Room, measured: (number | null)[], diagonalCm?: number | null): Solved {
  return solveRoomLsq(room, measured, diagonalCm)
}
