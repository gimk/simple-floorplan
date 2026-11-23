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
//
// The problem build (edges, walls, corners, rows, priors, x0) is one function, `buildModel`, used
// by solveGlobal and by solveGlobalWithModel. The second one keeps the model: the final x, the
// normal matrix at that x, and the gradient of any value that a new measurement could add. That is
// what `suggest.ts` scores (docs/walls-plan.md phase 2b).
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

/** The geometry of the fit: rooms, their walls, and the corner expressions. */
type Geom = { rooms: Room[]; edgeOf: Edge[][]; corners: CornerLin[][] }

/** Unknowns of one wall: its centre line and its thickness. */
type GroupVar = {
  coord: number; thick: number; edges: Edge[]; orient: 'h' | 'v'; drawn: number; prior: number
  /** Reference line = centre + k * thickness / 2. */
  k: number
  drawnRef: number
  lo: number
  hi: number
}

/** Corner k of a room: x and y of the centre line, and of the inside face. */
type CornerLin = { cx: Lin; cy: Lin; fx: Lin; fy: Lin; okX: boolean; okY: boolean }

/** One surface reference, ready for a row. */
type SurfaceEntry = { label: string; roomCode?: string; referenceM2: number; polys: AreaPoly[] }

/**
 * Everything the fit needs, built from the document. solveGlobal and solveGlobalWithModel use
 * the same build, so a candidate row is scored on exactly the system that was solved.
 */
type Built = {
  o: Required<GlobalOptions>
  rooms: Room[]
  edgeOf: Edge[][]
  groupVars: GroupVar[]
  corners: CornerLin[][]
  rows: Row[]
  priors: Row[]
  meta: { label: string; kind: GlobalResidual['kind'] }[]
  skipped: { label: string; reason: string }[]
  surfaceEntries: SurfaceEntry[]
  x0: number[]
  label: (e: Edge) => string
}

/**
 * Inside-length row of wall i of room ri, as in the measurements section: a positive length
 * between the two inside face corners. Null when the wall cannot carry a row.
 */
function wallLenLin(g: Geom, ri: number, i: number): Lin | null {
  const r = g.rooms[ri]
  const e = g.edgeOf[ri][i]
  if (!r || !e || e.orient === 'o') return null
  const n = r.vertices.length
  const a = g.corners[ri][i], b = g.corners[ri][(i + 1) % n]
  if (!(e.orient === 'h' ? a.okX && b.okX : a.okY && b.okY)) return null
  const va = r.vertices[i], vb = r.vertices[(i + 1) % n]
  const s = e.orient === 'h' ? Math.sign(vb.x - va.x) : Math.sign(vb.y - va.y)
  return scaleLin(e.orient === 'h' ? subLin(b.fx, a.fx) : subLin(b.fy, a.fy), s)
}

/** Inside-corner points of the diagonal between corners i and j of room ri. Null when not possible. */
function diagonalLins(g: Geom, ri: number, i: number, j: number) {
  const a = g.corners[ri]?.[i], b = g.corners[ri]?.[j]
  return a && b ? { ax: a.fx, ay: a.fy, bx: b.fx, by: b.fy } : null
}

/**
 * Distance between two points at xs, with its gradient in cm per cm (not divided by a sigma).
 * The gradient of a length row is the same expression, with or without the row in the fit.
 */
function distAt(d: { ax: Lin; ay: Lin; bx: Lin; by: Lin }, xs: number[]): { value: number; grad: [number, number][] } {
  const dx = evalLin(d.bx, xs) - evalLin(d.ax, xs), dy = evalLin(d.by, xs) - evalLin(d.ay, xs)
  const L = Math.hypot(dx, dy) || 1e-9
  return {
    value: Math.hypot(dx, dy),
    grad: [
      ...d.bx.t.map(([v, k]) => [v, (k * dx) / L] as [number, number]),
      ...d.ax.t.map(([v, k]) => [v, (-k * dx) / L] as [number, number]),
      ...d.by.t.map(([v, k]) => [v, (k * dy) / L] as [number, number]),
      ...d.ay.t.map(([v, k]) => [v, (-k * dy) / L] as [number, number]),
    ],
  }
}

/** Sum the terms that use the same unknown, so a gradient has one term per unknown. */
function mergeGrad(t: [number, number][]): [number, number][] {
  const m = new Map<number, number>()
  for (const [v, k] of t) m.set(v, (m.get(v) ?? 0) + k)
  return [...m].filter(([, k]) => k !== 0)
}

const shoelace = (p: Vec[]) => p.reduce((s, a, i) => {  const b = p[(i + 1) % p.length]
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

function buildModel(doc: Pick<PlanDoc, 'rooms' | 'measurements' | 'apartment'>, options: GlobalOptions = {}): Built {
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

  // The geometry of the fit, for the row builders (walls, diagonals).
  const geom: Geom = { rooms, edgeOf, corners }

  // ---- measurements ----
  const rows: Row[] = []
  // Current inside lengths, for locked walls with no measured value.
  const innerLengths = rooms.map((r) => innerWallLengths(r))
  const meta: { label: string; kind: GlobalResidual['kind'] }[] = []
  const skipped: { label: string; reason: string }[] = []
  rooms.forEach((r, ri) => {
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
      const l = wallLenLin(geom, ri, i)
      if (!l) {
        const reason = e.orient === 'o' ? 'wall is not horizontal or vertical' : 'a wall at its end is not horizontal or vertical'
        return skipped.push({ label: lab, reason }), undefined
      }
      rows.push({ kind: 'lin', l, target: m, sigma })
      meta.push({ label: lab, kind })
    })
    const d = doc.measurements[`${r.code}-D`]?.actualCm
    if (r.diagonal && d && d > 0) {
      const [i, j] = r.diagonal
      const dl = diagonalLins(geom, ri, i, j)
      if (dl) {
        rows.push({ kind: 'dist', ...dl, target: d, sigma: o.measureSigmaCm })
        meta.push({ label: `${r.code}-D`, kind: 'diagonal' })
      }
    }
  })

  // ---- surface references (docs/walls-plan.md phase 2) ----
  // One row per reference: the area of the inside face polygon of its room, or the sum of the
  // inside areas of every indoor room. Sigma is a small % of the surface, so a measured wall
  // (1 cm) always wins over the reference.
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

  return { o, rooms, edgeOf, groupVars, corners, rows, priors, meta, skipped, surfaceEntries, x0, label }
}

// ---- Gauss-Newton ----

/** Residual and gradient (divided by sigma) of one row, at xs. */
function residualAndGrad(row: Row, xs: number[]): { r: number; g: [number, number][] } {
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
  const d = distAt(row, xs)
  return { r: (d.value - row.target) / row.sigma, g: d.grad.map(([v, k]) => [v, k / row.sigma]) }
}

/** The fit itself: x at the end, the normal matrix there, and its Cholesky factor. */
function fitModel(b: Built): { x: number[]; normal: number[][]; chol: number[][] | null; iterations: number } {
  const all = [...b.rows, ...b.priors]
  const nv = b.x0.length
  let x = [...b.x0]
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
  let chol: number[][] | null = null
  for (; iterations < 20; iterations++) {
    const { N, b: rhs } = normal(x)
    chol = cholesky(N)
    if (!chol) break
    const dx = cholSolve(chol, rhs)
    x = x.map((v, k) => v + dx[k])
    if (Math.hypot(...dx) < 1e-6) break
  }
  // The normal matrix and its factor at the final x: they give the covariance of the unknowns.
  const N = normal(x).N
  return { x, normal: N, chol: cholesky(N), iterations }
}

/**
 * Report of one fit. Also the single place that turns `x` into user values, so the solved plan and
 * the model used by the suggestions always agree.
 */
function reportModel(b: Built, fitted: { x: number[]; chol: number[][] | null; iterations: number }): GlobalSolved {
  const { x, chol, iterations } = fitted
  const { o, rooms, groupVars, corners, rows, meta, skipped, surfaceEntries, x0, label } = b
  const nv = x0.length
  const variance = (k: number) => {
    if (!chol) return NaN
    const e = new Array<number>(nv).fill(0)
    e[k] = 1
    return cholSolve(chol, e)[k]
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

/** Defaults of the solver, for callers that must use the same sigmas (see the suggestions). */
export const GLOBAL_SOLVE_DEFAULTS: Required<GlobalOptions> = DEFAULTS

/** All rooms in one least-squares fit. Same result as before the model was split out. */
export function solveGlobal(doc: Pick<PlanDoc, 'rooms' | 'measurements' | 'apartment'>, options: GlobalOptions = {}): GlobalSolved {
  const b = buildModel(doc, options)
  return reportModel(b, fitModel(b))
}

/** A gradient of one quantity: the change of that quantity per unit of each unknown. */
export type Grad = [number, number][]

/**
 * C g, with C = inverse of the normal matrix (the covariance of the unknowns, in cm²).
 * Used by the suggestions: gᵀ C g is the variance of a candidate value, and the term C g is what a
 * new measurement takes away from the uncertainty of everything else.
 */
export function covarianceTimes(chol: number[][] | null, grad: Grad): number[] | null {
  if (!chol) return null
  const dense = new Array<number>(chol.length).fill(0)
  for (const [v, k] of grad) dense[v] += k
  return cholSolve(chol, dense)
}

/** A quantity that can become a measurement. */
export type CandidateQuantity =
  | { kind: 'wall'; roomId: string; wallIndex: number }
  | { kind: 'diagonal'; roomId: string; i: number; j: number }
  | { kind: 'thickness'; groupId: number }

/** Value of a quantity at x (cm, or cm² for a surface), with its unscaled gradient. */
export type QuantityAtX = { value: number; grad: Grad }

/**
 * The solved plan, plus what a "next best measurement" needs: the final x, the normal matrix, the
 * unknown of each wall, and the gradient of any candidate row at the final x.
 */
export type SolveModel = {
  solved: GlobalSolved
  /** Final values of the unknowns. */
  x: number[]
  /** Gauss-Newton normal matrix (all rows, priors included) at the final x. */
  normal: number[][]
  /** Cholesky factor of `normal` (N = L Lᵀ). Null when N is not positive definite. */
  chol: number[][] | null
  /** Unknown index of the centre line and of the thickness of each wall group (same order as solved.groups). */
  groupVars: { coord: number; thick: number }[]
  /** Value and gradient at x, or null when the quantity cannot be a row. */
  quantity(q: CandidateQuantity): QuantityAtX | null
}

/**
 * Same fit as solveGlobal, and the model behind it: the covariance of the unknowns (from `chol`)
 * and the gradient of a candidate row score how much a new measurement would help.
 */
export function solveGlobalWithModel(doc: Pick<PlanDoc, 'rooms' | 'measurements' | 'apartment'>, options: GlobalOptions = {}): SolveModel {
  const b = buildModel(doc, options)
  const fitted = fitModel(b)
  const solved = reportModel(b, fitted)
  const x = fitted.x
  const geom: Geom = { rooms: b.rooms, edgeOf: b.edgeOf, corners: b.corners }
  const quantity = (q: CandidateQuantity): QuantityAtX | null => {
    if (q.kind === 'thickness') {
      const g = b.groupVars[q.groupId]
      return g ? { value: x[g.thick], grad: [[g.thick, 1]] } : null
    }
    const ri = b.rooms.findIndex((r) => r.id === q.roomId)
    if (ri < 0) return null
    if (q.kind === 'wall') {
      const l = wallLenLin(geom, ri, q.wallIndex)
      return l ? { value: evalLin(l, x), grad: mergeGrad(l.t) } : null
    }
    const d = diagonalLins(geom, ri, q.i, q.j)
    return d ? distAt(d, x) : null
  }
  return {
    solved, x, normal: fitted.normal, chol: fitted.chol,
    groupVars: b.groupVars.map((g) => ({ coord: g.coord, thick: g.thick })),
    quantity,
  }
}
