// Global solver (prototype): all rooms in ONE least-squares fit. Pure, cm.
//
// Unknowns: for each wall, the position of its centre line and its thickness.
// Measured values are inside faces: face = centre line moved into the room by half the thickness.
// A wall seen from two rooms is ONE wall (one centre line, one thickness), so loops of measured
// values across rooms give the thicknesses. Where no loop crosses a wall, its thickness stays at
// the prior of its wall type, and the report says that the data does not find it.
//
// Scope of the prototype: axis-aligned walls (x or y constant). Other walls keep their drawn place.
//
// Surface references (docs/walls-plan.md phase 2): a reference of `doc.apartment.references` is a
// surface written on a document (DPE, Carrez...). It adds one row on the area of the inside face
// polygon: 'match' pulls the area to the reference, 'guide' only blocks the wrong direction.
import { innerWallLengths } from '../../model/geometry'
import type { PlanDoc, Room, SurfaceReference, Vec, WallAlign } from '../../model/types'
import { thicknessLabel } from '../../model/survey'
import { SOURCE_LABELS } from '../apartment/logic'
import { wallProps } from './walls'

/** How the solver uses the surface references. */
export type SurfaceMode = 'off' | 'guide' | 'match'

export type GlobalOptions = {
  /** Two opposite walls of two rooms closer than this (cm) are the same wall. */
  pairTolCm?: number
  /** Two walls that continue each other, with reference lines drawn closer than this (cm), are kept in line (soft). */
  alignTolCm?: number
  measureSigmaCm?: number
  /** Accuracy of a measured thickness (CODE-n-T), cm. */
  thicknessMeasureSigmaCm?: number
  alignSigmaCm?: number
  thicknessSigmaCm?: number
  positionSigmaCm?: number
  /** Keep locked walls: their measured value or their current inside length, with lockedSigmaCm. */
  keepLocked?: boolean
  lockedSigmaCm?: number
  /** 'off' = no surface row, 'guide' = one-sided hinge, 'match' = normal weak row. */
  surfaceMode?: SurfaceMode
  /** Accuracy of a surface reference, in % of its surface (1.5 % makes a measured wall win). */
  surfaceSigmaPct?: number
  /** The references to use (normally doc.apartment.references). */
  references?: SurfaceReference[]
}

const DEFAULTS: Required<GlobalOptions> = {
  pairTolCm: 35,
  alignTolCm: 4,
  measureSigmaCm: 1,
  thicknessMeasureSigmaCm: 0.5,
  alignSigmaCm: 1,
  thicknessSigmaCm: 5,
  positionSigmaCm: 100,
  keepLocked: true,
  lockedSigmaCm: 0.05,
  surfaceMode: 'off',
  surfaceSigmaPct: 1.5,
  references: [],
}

type Orient = 'h' | 'v' | 'o'

/** One wall of one room. h: y is constant, v: x is constant, o: other direction. */
type Edge = {
  room: number
  index: number
  orient: Orient
  /** Drawn x (v) or y (h) of the centre line. */
  coord: number
  lo: number
  hi: number
  /** +1 when the room is on the side of larger x (v) or larger y (h). */
  side: 1 | -1
  thicknessCm: number
  /** Line of the wall that lines up with the next walls (wall props, seen from this room). */
  align: WallAlign
  group: number
}

/** Offset of the reference line from the centre line, in half thicknesses, toward larger x / y. */
const refSign = (e: Edge) => (e.align === 'center' ? 0 : e.align === 'room' ? e.side : -e.side)

export type WallGroup = {
  id: number
  orient: 'h' | 'v'
  /** Labels of the room walls that make this wall, e.g. ["SB-4", "SE-6"]. */
  walls: string[]
  drawnCoord: number
  coord: number
  priorThicknessCm: number
  thicknessCm: number
  /** Standard deviation of the thickness after the fit (cm). */
  thicknessSdCm: number
  /** True when the data (not the prior) sets the thickness. */
  determined: boolean
  /** Number of rooms that see the wall. */
  rooms: number
}

export type GlobalResidual = { label: string; kind: 'wall' | 'diagonal' | 'thickness' | 'locked' | 'align' | 'surface'; measuredCm: number; solvedCm: number; diffCm: number }

/** One surface reference, before and after the fit (m²). */
export type GlobalSurface = {
  label: string
  /** Code of the room of the reference, when the reference is about one room. */
  roomCode?: string
  referenceM2: number
  /** Inside area of the drawn plan, m². */
  beforeM2: number
  /** Inside area after the fit, m². */
  afterM2: number
  /** (after − reference) in % of the reference. */
  diffPct: number
}

export type GlobalSolved = {
  groups: WallGroup[]
  residuals: GlobalResidual[]
  /** Root-mean-square of the wall and diagonal residuals (cm). */
  rmsCm: number
  /** New centre line corners, per room id. */
  rooms: Record<string, Vec[]>
  /** Inside face corners, per room id. */
  inner: Record<string, Vec[]>
  /** One line of report per surface reference (empty when the mode is 'off'). */
  surfaces: GlobalSurface[]
  skipped: { label: string; reason: string }[]
  iterations: number
}

/** a + sum coef * x[var] */
type Lin = { c: number; t: [number, number][] }
const lin = (c: number, ...t: [number, number][]): Lin => ({ c, t })
const evalLin = (l: Lin, x: number[]) => l.t.reduce((s, [v, k]) => s + k * x[v], l.c)
const subLin = (a: Lin, b: Lin): Lin => ({ c: a.c - b.c, t: [...a.t, ...b.t.map(([v, k]) => [v, -k] as [number, number])] })
const scaleLin = (a: Lin, s: number): Lin => ({ c: a.c * s, t: a.t.map(([v, k]) => [v, k * s] as [number, number]) })

/** One closed polygon of inside face corners, as linear expressions. */
type AreaPoly = { fx: Lin[]; fy: Lin[] }

type Row =
  | { kind: 'lin'; l: Lin; target: number; sigma: number }
  | { kind: 'dist'; ax: Lin; ay: Lin; bx: Lin; by: Lin; target: number; sigma: number }
  /**
   * Surface row: the area of one or more inside face polygons, in cm².
   * With `hinge` it is one-sided: active only when the area passes `t0` on the given side,
   * and it then pulls back to `t0` (Guide mode). Inactive rows give a zero residual.
   */
  | { kind: 'area'; polys: AreaPoly[]; target: number; sigma: number; hinge?: { t0: number; above: boolean } }

const shoelace = (p: Vec[]) => p.reduce((s, a, i) => {
  const b = p[(i + 1) % p.length]
  return s + a.x * b.y - b.x * a.y
}, 0)

/**
 * Area of the inside polygons (cm²) and the gradient of that area (d area / d x_k), at xs.
 * Each polygon keeps the sign of its own shoelace sum, so a sum of rooms stays correct when the
 * rooms are drawn in different directions.
 */
function evalArea(polys: AreaPoly[], xs: number[]): { area: number; grad: [number, number][] } {
  let area = 0
  const total = new Map<number, number>()
  const addTo = (m: Map<number, number>, v: number, k: number) => m.set(v, (m.get(v) ?? 0) + k)
  for (const poly of polys) {
    const n = poly.fx.length
    let s = 0
    const ds = new Map<number, number>()
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n
      const fxi = evalLin(poly.fx[i], xs), fyi = evalLin(poly.fy[i], xs)
      const fxj = evalLin(poly.fx[j], xs), fyj = evalLin(poly.fy[j], xs)
      s += fxi * fyj - fxj * fyi
      // Product rule on fxi * fyj - fxj * fyi.
      for (const [v, c] of poly.fx[i].t) addTo(ds, v, c * fyj)
      for (const [v, c] of poly.fy[j].t) addTo(ds, v, fxi * c)
      for (const [v, c] of poly.fx[j].t) addTo(ds, v, -c * fyi)
      for (const [v, c] of poly.fy[i].t) addTo(ds, v, -fxj * c)
    }
    const sign = s >= 0 ? 1 : -1
    area += (sign * s) / 2
    for (const [v, c] of ds) addTo(total, v, (sign * c) / 2)
  }
  return { area, grad: [...total].map(([v, c]) => [v, c] as [number, number]) }
}

/** Area of the inside polygons at xs, in cm². */
const areaValue = (polys: AreaPoly[], xs: number[]) => evalArea(polys, xs).area

/** Cholesky solve of the SPD system N x = b. Null when N is not positive definite. */
function cholesky(N: number[][]): number[][] | null {
  const n = N.length
  const L = N.map(() => new Array<number>(n).fill(0))
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = N[i][j]
      for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k]
      if (i === j) {
        if (s <= 0) return null
        L[i][i] = Math.sqrt(s)
      } else L[i][j] = s / L[j][j]
    }
  }
  return L
}

function cholSolve(L: number[][], b: number[]): number[] {
  const n = b.length
  const y = new Array<number>(n).fill(0)
  for (let i = 0; i < n; i++) {
    let s = b[i]
    for (let k = 0; k < i; k++) s -= L[i][k] * y[k]
    y[i] = s / L[i][i]
  }
  const x = new Array<number>(n).fill(0)
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i]
    for (let k = i + 1; k < n; k++) s -= L[k][i] * x[k]
    x[i] = s / L[i][i]
  }
  return x
}

export function solveGlobal(doc: Pick<PlanDoc, 'rooms' | 'measurements' | 'apartment'>, options: GlobalOptions = {}): GlobalSolved {
  // The references come from the options, or from the document (doc.apartment.references).
  const o = { ...DEFAULTS, ...options, references: options.references ?? doc.apartment?.references ?? [] }
  const rooms = doc.rooms

  // ---- edges ----
  const edges: Edge[] = []
  const edgeOf: Edge[][] = []
  rooms.forEach((r, ri) => {
    const v = r.vertices
    const n = v.length
    const s = shoelace(v) > 0 ? 1 : -1
    edgeOf.push(v.map((a, i) => {
      const b = v[(i + 1) % n]
      const dx = b.x - a.x, dy = b.y - a.y
      const l = Math.hypot(dx, dy) || 1
      const inward = { x: (-dy / l) * s, y: (dx / l) * s }
      const orient: Orient = Math.abs(dx) / l < 0.02 ? 'v' : Math.abs(dy) / l < 0.02 ? 'h' : 'o'
      const e: Edge = {
        room: ri, index: i, orient,
        coord: orient === 'v' ? (a.x + b.x) / 2 : (a.y + b.y) / 2,
        lo: orient === 'v' ? Math.min(a.y, b.y) : Math.min(a.x, b.x),
        hi: orient === 'v' ? Math.max(a.y, b.y) : Math.max(a.x, b.x),
        side: orient === 'v' ? (inward.x > 0 ? 1 : -1) : (inward.y > 0 ? 1 : -1),
        thicknessCm: wallProps(r, a.id).thicknessCm,
        align: wallProps(r, a.id).align ?? 'room',
        group: -1,
      }
      edges.push(e)
      return e
    }))
  })

  // ---- walls: union of room walls that are the same wall ----
  // Candidate pairs, nearest first. A merge is refused when the wall would get two faces on one
  // side that are not in line (the drawing is not precise, so the first, nearest pairs win).
  const parent = edges.map((_, i) => i)
  const members = edges.map((_, i) => [i])
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  const fits = (ga: number[], gb: number[]) => ga.every((a) => gb.every((b) => {
    const A = edges[a], B = edges[b]
    const d = Math.abs(A.coord - B.coord)
    return A.side === B.side ? d <= o.alignTolCm : d <= o.pairTolCm
  }))
  const union = (a: number, b: number) => {
    const ra = find(a), rb = find(b)
    if (ra === rb || !fits(members[ra], members[rb])) return
    parent[ra] = rb
    members[rb].push(...members[ra])
  }
  const MIN_OVERLAP = 20
  const pairs: [number, number, number][] = []
  for (let a = 0; a < edges.length; a++) {
    const A = edges[a]
    if (A.orient === 'o') continue
    for (let b = a + 1; b < edges.length; b++) {
      const B = edges[b]
      if (B.orient !== A.orient || B.room === A.room) continue
      const overlap = Math.min(A.hi, B.hi) - Math.max(A.lo, B.lo)
      const d = Math.abs(A.coord - B.coord)
      // Opposite sides: the wall is between the two rooms. Same side: two rooms on top of each other.
      // Walls that continue each other on one line stay separate walls (their thickness can
      // change): they are kept in line by their reference lines, below.
      if (A.side !== B.side && overlap > MIN_OVERLAP && d <= o.pairTolCm) pairs.push([d, a, b])
    }
  }
  // Two walls of one room in line (a straight corner) are one wall.
  edgeOf.forEach((es) => es.forEach((e, i) => {
    const f = es[(i + 1) % es.length]
    if (e.orient !== 'o' && e.orient === f.orient && Math.abs(e.coord - f.coord) < 1) pairs.push([0, edges.indexOf(e), edges.indexOf(f)])
  }))
  pairs.sort((p, q) => p[0] - q[0]).forEach(([, a, b]) => union(a, b))

  // ---- unknowns ----
  const x0: number[] = []
  const priors: Row[] = []
  const newVar = (start: number, sigma: number) => {
    const k = x0.length
    x0.push(start)
    priors.push({ kind: 'lin', l: lin(0, [k, 1]), target: start, sigma })
    return k
  }
  const label = (e: Edge) => `${rooms[e.room].code}-${e.index + 1}`
  type GroupVar = {
    coord: number; thick: number; edges: Edge[]; orient: 'h' | 'v'; drawn: number; prior: number
    /** Reference line = centre + k * thickness / 2. */
    k: number
    drawnRef: number
    lo: number
    hi: number
  }
  const groupVars: GroupVar[] = []
  const rootToGroup = new Map<number, number>()
  edges.forEach((e, i) => {
    if (e.orient === 'o') return
    const root = find(i)
    let g = rootToGroup.get(root)
    if (g === undefined) {
      g = groupVars.length
      rootToGroup.set(root, g)
      groupVars.push({ coord: -1, thick: -1, edges: [], orient: e.orient, drawn: 0, prior: 0, k: 0, drawnRef: 0, lo: 0, hi: 0 })
    }
    e.group = g
    groupVars[g].edges.push(e)
  })
  for (const g of groupVars) {
    g.drawn = g.edges.reduce((s, e) => s + e.coord, 0) / g.edges.length
    g.prior = Math.max(...g.edges.map((e) => e.thicknessCm))
    // The wall's reference line comes from its owner: the room first in the walk-through.
    const owner = g.edges.reduce((a, e) => {
      const ra = rooms[a.room], re = rooms[e.room]
      return re.walkOrder < ra.walkOrder || (re.walkOrder === ra.walkOrder && re.code < ra.code) ? e : a
    })
    g.k = refSign(owner)
    g.drawnRef = g.drawn + (g.k * g.prior) / 2
    g.lo = Math.min(...g.edges.map((e) => e.lo))
    g.hi = Math.max(...g.edges.map((e) => e.hi))
    g.coord = newVar(g.drawn, o.positionSigmaCm)
    g.thick = newVar(g.prior, o.thicknessSigmaCm)
  }

  // Corner k of room r: x and y of the centre line, and of the inside face.
  // The x comes from the vertical wall at the corner, the y from the horizontal one.
  // A corner with no wall in one direction gets a free unknown there.
  type CornerLin = { cx: Lin; cy: Lin; fx: Lin; fy: Lin; okX: boolean; okY: boolean }
  const corners: CornerLin[][] = rooms.map((r, ri) => {
    const es = edgeOf[ri]
    const n = es.length
    return r.vertices.map((p, k) => {
      const prev = es[(k + n - 1) % n], next = es[k]
      const pick = (axis: 'h' | 'v') => (prev.orient === axis ? prev : next.orient === axis ? next : null)
      const vx = pick('v'), hy = pick('h')
      const along = (e: Edge | null, drawn: number): { c: Lin; f: Lin; ok: boolean } => {
        if (!e) {
          const k2 = newVar(drawn, o.positionSigmaCm)
          return { c: lin(0, [k2, 1]), f: lin(0, [k2, 1]), ok: false }
        }
        const g = groupVars[e.group]
        return { c: lin(0, [g.coord, 1]), f: lin(0, [g.coord, 1], [g.thick, e.side / 2]), ok: true }
      }
      const X = along(vx, p.x), Y = along(hy, p.y)
      return { cx: X.c, cy: Y.c, fx: X.f, fy: Y.f, okX: X.ok, okY: Y.ok }
    })
  })

  // ---- measurements ----
  const rows: Row[] = []
  // Current inside lengths, for locked walls with no measured value.
  const innerLengths = rooms.map((r) => innerWallLengths(r))
  const meta: { label: string; kind: GlobalResidual['kind'] }[] = []
  const skipped: { label: string; reason: string }[] = []
  rooms.forEach((r, ri) => {
    const n = r.vertices.length
    edgeOf[ri].forEach((e, i) => {
      // Measured thickness (CODE-n-T): a direct value for the wall.
      const tLab = thicknessLabel(r.code, i)
      const tm = doc.measurements[tLab]?.actualCm
      if (tm && tm > 0) {
        if (e.orient === 'o') skipped.push({ label: tLab, reason: 'wall is not horizontal or vertical' })
        else {
          rows.push({ kind: 'lin', l: lin(0, [groupVars[e.group].thick, 1]), target: tm, sigma: o.thicknessMeasureSigmaCm })
          meta.push({ label: tLab, kind: 'thickness' })
        }
      }
      const lab = `${r.code}-${i + 1}`
      const measuredCm = doc.measurements[lab]?.actualCm
      const hasValue = !!(measuredCm && Number.isFinite(measuredCm) && measuredCm > 0)
      // A locked wall keeps its value (measured) or its current inside length (no value), strongly.
      const locked = o.keepLocked && !!wallProps(r, r.vertices[i].id).locked
      if (!hasValue && !locked) return
      const m = hasValue ? measuredCm! : innerLengths[ri][i]
      const sigma = locked ? o.lockedSigmaCm : o.measureSigmaCm
      const kind: GlobalResidual['kind'] = hasValue ? 'wall' : 'locked'
      if (e.orient === 'o') return skipped.push({ label: lab, reason: 'wall is not horizontal or vertical' }), undefined
      const a = corners[ri][i], b = corners[ri][(i + 1) % n]
      const ok = e.orient === 'h' ? a.okX && b.okX : a.okY && b.okY
      if (!ok) return skipped.push({ label: lab, reason: 'a wall at its end is not horizontal or vertical' }), undefined
      const va = r.vertices[i], vb = r.vertices[(i + 1) % n]
      const s = e.orient === 'h' ? Math.sign(vb.x - va.x) : Math.sign(vb.y - va.y)
      const l = e.orient === 'h' ? subLin(b.fx, a.fx) : subLin(b.fy, a.fy)
      rows.push({ kind: 'lin', l: scaleLin(l, s), target: m, sigma })
      meta.push({ label: lab, kind })
    })
    const d = doc.measurements[`${r.code}-D`]?.actualCm
    if (r.diagonal && d && d > 0) {
      const [i, j] = r.diagonal
      const a = corners[ri][i], b = corners[ri][j]
      if (a && b) {
        rows.push({ kind: 'dist', ax: a.fx, ay: a.fy, bx: b.fx, by: b.fy, target: d, sigma: o.measureSigmaCm })
        meta.push({ label: `${r.code}-D`, kind: 'diagonal' })
      }
    }
  })

  // ---- surface references (docs/walls-plan.md phase 2) ----
  // One row per reference: the area of the inside face polygon of its room, or the sum of the
  // inside areas of every indoor room. Sigma is a small % of the surface, so a measured wall
  // (1 cm) always wins over the reference.
  type SurfaceEntry = { label: string; roomCode?: string; referenceM2: number; polys: AreaPoly[] }
  const surfaceEntries: SurfaceEntry[] = []
  if (o.surfaceMode !== 'off') {
    const insidePoly = (ri: number): AreaPoly => ({ fx: corners[ri].map((c) => c.fx), fy: corners[ri].map((c) => c.fy) })
    // Walls that are not horizontal or vertical keep their drawn place, so their area is fixed.
    const axisAligned = (ri: number) => edgeOf[ri].every((e) => e.orient !== 'o')
    const indoor = rooms.map((_, ri) => ri).filter((ri) => !rooms[ri].outdoor && axisAligned(ri))
    for (const ref of o.references) {
      const label = ref.label?.trim() || SOURCE_LABELS[ref.source]
      const sigma = (ref.surfaceM2 * 10000 * o.surfaceSigmaPct) / 100
      if (!(ref.surfaceM2 > 0) || !Number.isFinite(sigma) || !(sigma > 0)) {
        skipped.push({ label, reason: 'the reference surface is not a positive number' })
        continue
      }
      let polys: AreaPoly[]
      let roomCode: string | undefined
      if (ref.roomCode) {
        const code = ref.roomCode.trim().toLowerCase()
        const ri = rooms.findIndex((r) => r.code.trim().toLowerCase() === code)
        if (ri < 0) {
          skipped.push({ label, reason: `the plan has no room ${ref.roomCode}` })
          continue
        }
        if (!axisAligned(ri)) {
          skipped.push({ label, reason: `room ${rooms[ri].code} has a wall that is not horizontal or vertical` })
          continue
        }
        roomCode = rooms[ri].code
        polys = [insidePoly(ri)]
      } else {
        if (!indoor.length) {
          skipped.push({ label, reason: 'the plan has no indoor room with only horizontal and vertical walls' })
          continue
        }
        const leftOut = rooms.filter((_, ri) => !rooms[ri].outdoor && !axisAligned(ri)).map((r) => r.code)
        if (leftOut.length) {
          skipped.push({ label, reason: `${leftOut.join(', ')} left out of the sum: a wall is not horizontal or vertical` })
        }
        polys = indoor.map(insidePoly)
      }
      const targetCm2 = ref.surfaceM2 * 10000
      const a0 = areaValue(polys, x0)
      surfaceEntries.push({ label, roomCode, referenceM2: ref.surfaceM2, polys })
      if (o.surfaceMode === 'match') {
        rows.push({ kind: 'area', polys, target: targetCm2, sigma })
        meta.push({ label, kind: 'surface' })
      } else if (Math.abs(a0 - targetCm2) > 1e-6) {
        // Guide: hinge on the drawn area. Below the reference the plan must not go smaller,
        // above it the plan must not go bigger.
        rows.push({ kind: 'area', polys, target: a0, sigma, hinge: { t0: a0, above: a0 > targetCm2 } })
        meta.push({ label, kind: 'surface' })
      }
    }
  }

  // ---- walls in line (soft) ----
  // Two walls that continue each other (end to end, drawn on one line) keep their REFERENCE lines
  // in line: by default the face in the room, so a 30 cm wall and a 10 cm wall are flush inside.
  for (let a = 0; a < groupVars.length; a++) {
    for (let b = a + 1; b < groupVars.length; b++) {
      const A = groupVars[a], B = groupVars[b]
      if (A.orient !== B.orient || Math.abs(A.drawnRef - B.drawnRef) > o.alignTolCm) continue
      const gap = Math.max(A.lo, B.lo) - Math.min(A.hi, B.hi)
      if (gap > o.pairTolCm) continue
      const ref = (g: GroupVar): [number, number][] => [[g.coord, 1], [g.thick, g.k / 2]]
      rows.push({ kind: 'lin', l: lin(0, ...ref(A), ...ref(B).map(([v, k]) => [v, -k] as [number, number])), target: 0, sigma: o.alignSigmaCm })
      meta.push({ label: `${label(A.edges[0])} / ${label(B.edges[0])}`, kind: 'align' })
    }
  }

  // ---- Gauss-Newton ----
  const all = [...rows, ...priors]
  const nv = x0.length
  let x = [...x0]
  const residualAndGrad = (row: Row, xs: number[]): { r: number; g: [number, number][] } => {
    if (row.kind === 'lin') return { r: (evalLin(row.l, xs) - row.target) / row.sigma, g: row.l.t.map(([v, k]) => [v, k / row.sigma]) }
    if (row.kind === 'area') {
      const { area, grad } = evalArea(row.polys, xs)
      // The Guide hinge is active only when the area went past t0 on the given side, so it lets
      // the area move the right way and blocks the wrong way only. Activity is tested again at
      // each iteration, with the current area.
      const target = row.hinge ? (row.hinge.above ? (area > row.hinge.t0 ? row.hinge.t0 : null) : (area < row.hinge.t0 ? row.hinge.t0 : null)) : row.target
      if (target === null) return { r: 0, g: [] }
      return { r: (area - target) / row.sigma, g: grad.map(([v, k]) => [v, k / row.sigma]) }
    }
    const dx = evalLin(row.bx, xs) - evalLin(row.ax, xs), dy = evalLin(row.by, xs) - evalLin(row.ay, xs)
    const L = Math.hypot(dx, dy) || 1e-9
    const g: [number, number][] = [
      ...row.bx.t.map(([v, k]) => [v, (k * dx) / L / row.sigma] as [number, number]),
      ...row.ax.t.map(([v, k]) => [v, (-k * dx) / L / row.sigma] as [number, number]),
      ...row.by.t.map(([v, k]) => [v, (k * dy) / L / row.sigma] as [number, number]),
      ...row.ay.t.map(([v, k]) => [v, (-k * dy) / L / row.sigma] as [number, number]),
    ]
    return { r: (L - row.target) / row.sigma, g }
  }
  const normal = (xs: number[]) => {
    const N = Array.from({ length: nv }, () => new Array<number>(nv).fill(0))
    const b = new Array<number>(nv).fill(0)
    for (const row of all) {
      const { r, g } = residualAndGrad(row, xs)
      for (const [i, gi] of g) {
        b[i] -= gi * r
        for (const [j, gj] of g) N[i][j] += gi * gj
      }
    }
    return { N, b }
  }
  let iterations = 0
  let L: number[][] | null = null
  for (; iterations < 20; iterations++) {
    const { N, b } = normal(x)
    L = cholesky(N)
    if (!L) break
    const dx = cholSolve(L, b)
    x = x.map((v, k) => v + dx[k])
    if (Math.hypot(...dx) < 1e-6) break
  }
  L = cholesky(normal(x).N)
  const variance = (k: number) => {
    if (!L) return NaN
    const e = new Array<number>(nv).fill(0)
    e[k] = 1
    return cholSolve(L, e)[k]
  }

  // ---- report ----
  const groups: WallGroup[] = groupVars.map((g, id) => {
    const sd = Math.sqrt(variance(g.thick))
    return {
      id, orient: g.orient,
      walls: g.edges.map(label),
      drawnCoord: g.drawn, coord: x[g.coord],
      priorThicknessCm: g.prior, thicknessCm: x[g.thick], thicknessSdCm: sd,
      determined: sd < o.thicknessSigmaCm * 0.5,
      rooms: new Set(g.edges.map((e) => e.room)).size,
    }
  })
  const residuals: GlobalResidual[] = rows.map((row, k) => {
    const solved = row.kind === 'lin'
      ? evalLin(row.l, x)
      : row.kind === 'area'
        ? areaValue(row.polys, x)
        : Math.hypot(evalLin(row.bx, x) - evalLin(row.ax, x), evalLin(row.by, x) - evalLin(row.ay, x))
    return { label: meta[k].label, kind: meta[k].kind, measuredCm: row.target, solvedCm: solved, diffCm: row.target - solved }
  })
  // Surface rows are in cm² and they are weak: they stay out of rmsCm.
  const fit = residuals.filter((r) => r.kind === 'wall' || r.kind === 'diagonal')
  const rmsCm = fit.length ? Math.sqrt(fit.reduce((s, r) => s + r.diffCm ** 2, 0) / fit.length) : 0
  const out: Record<string, Vec[]> = {}
  const inner: Record<string, Vec[]> = {}
  rooms.forEach((r: Room, ri) => {
    out[r.id] = corners[ri].map((c) => ({ x: evalLin(c.cx, x), y: evalLin(c.cy, x) }))
    inner[r.id] = corners[ri].map((c) => ({ x: evalLin(c.fx, x), y: evalLin(c.fy, x) }))
  })
  const surfaces: GlobalSurface[] = surfaceEntries.map((e) => {
    const beforeM2 = areaValue(e.polys, x0) / 10000
    const afterM2 = areaValue(e.polys, x) / 10000
    return {
      label: e.label,
      ...(e.roomCode ? { roomCode: e.roomCode } : {}),
      referenceM2: e.referenceM2,
      beforeM2,
      afterM2,
      diffPct: ((afterM2 - e.referenceM2) / e.referenceM2) * 100,
    }
  })
  return { groups, residuals, rmsCm, rooms: out, inner, surfaces, skipped, iterations }
}
