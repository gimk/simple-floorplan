// Global solver: all rooms in ONE least-squares fit. Pure, cm, y points down.
//
// WALLS AT ANY ANGLE (docs/walls-plan.md phase 4b). Each wall (one "group" of room walls) has
// three unknowns:
//   d      offset of its CENTRE line: n . p = d, with n = (cos theta, sin theta) and p in cm;
//   t      its thickness;
//   theta  the angle of n. It is a constant when the wall is drawn horizontal or vertical and the
//          option `angles` is 'square' (the default, so the result equals the axis-aligned solver);
//          it is an unknown with prior = the drawn angle (sigma `angleSigmaDeg`) otherwise, and
//          always for a wall drawn at an angle.
// A room corner is the crossing of the two face lines (inside polygon) or of the two centre lines
// (centre polygon) of the walls that meet there. When the two lines are almost parallel
// (|sin| < 0.02) the corner gets one free unknown s along the line, with prior = the drawn
// position (as before this phase).
//
// A wall seen from two rooms is ONE wall (one centre line, one thickness), so loops of measured
// values across rooms give the thicknesses. Where no loop crosses a wall, its thickness stays at
// the prior of its wall type, and the report says that the data does not find it.
//
// Every row is written ONCE as a function of the unknowns, with its exact sparse gradient
// (./autodiff.ts): wall lengths (between two inside corners), diagonals, measured thicknesses,
// centre (W12-C) and outside face (W12-E) values of stored walls, surfaces (shoelace on the inside
// corners), walls in line, and the soft right-angle rules of the option `angles: 'free'`.
//
// LIMIT of the default mode ('square'): before this phase, a surface reference of a room with a
// wall at an angle, and a centre / outside value of a stored wall at an angle, had no row (their
// skip reason is kept). They have a row with `angles: 'free'`, where a room angle is an unknown, so
// its inside area is the shoelace of its corners and a value of a wall at an angle can be solved.
//
// Surface references (docs/walls-plan.md phase 2): a reference of `doc.apartment.references` is a
// surface written on a document (DPE, Carrez...). It adds one row on the area of the inside face
// polygon: 'match' pulls the area to the reference, 'guide' only blocks the wrong direction.
//
// The problem build (edges, walls, corners, rows, priors, x0) is one function, `buildModel`, used
// by solveGlobal and by solveGlobalWithModel. The second one keeps the model: the final x, the
// normal matrix at that x, and the gradient of any value that a new measurement could add. That is
// what `suggest.ts` scores (docs/walls-plan.md phase 2b).
import { DEFAULT_WALL_CM, innerWallLengths } from '../../model/geometry'
import { buildWallGraph, type GraphConflict } from '../../model/wallGraph'
import type { PlanDoc, Room, StoredNode, StoredWall, SurfaceReference, Vec, WallAlign } from '../../model/types'
import { thicknessLabel } from '../../model/survey'
import { outsideDims } from './outside/outsideDims'
import { outsideFaceSide, parseWallValueLabel, wallEnds, wallValueLabel, type RoomWallRef } from '../../model/wallValues'
import { sourceSigmaCm } from '../../model/measureSource'
import { SOURCE_LABELS } from '../apartment/logic'
import { wallProps } from './walls'
import { add, atan2, cos, cst, div, gradList, hypot, mul, scale, sin, sub, variable, type D } from './autodiff'

/** How the solver uses the surface references. */
export type SurfaceMode = 'off' | 'guide' | 'match'

/** How the solver treats the angle of a wall drawn horizontal or vertical. */
export type RoomAngles = 'square' | 'free'

/**
 * What the solver reads from a document. The stored wall graph (`walls` / `nodes`) is optional:
 * without it, the centre and outside face values of stored walls (W12-C, W12-E) have no row.
 */
export type SolveDoc = Pick<PlanDoc, 'rooms' | 'measurements'> & {
  apartment?: PlanDoc['apartment']
  nodes?: StoredNode[]
  walls?: StoredWall[]
}

export type GlobalOptions = {
  /** Two opposite walls of two rooms closer than this (cm) are the same wall. */
  pairTolCm?: number
  /** Two walls that continue each other, with reference lines drawn closer than this (cm), are kept in line (soft). */
  alignTolCm?: number
  /**
   * Scale of the accuracy of a measured wall or diagonal. The accuracy of one value is
   * sourceSigmaCm(source) * measureSigmaCm: laser 0.3 cm, tape 1 cm, plan 3 cm with the default 1.
   */
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
  /**
   * 'square' (default): a wall drawn horizontal or vertical keeps its drawn angle, so the result
   * equals the axis-aligned solver. 'free': every wall can turn, so a measured diagonal can show a
   * room that is not square. A wall drawn at an angle is always solved with its own angle.
   */
  angles?: RoomAngles
  /** Accuracy of the drawn angle of a wall whose angle is solved, in degrees (default 3). */
  angleSigmaDeg?: number
  /** Accuracy of the right-angle rule of two walls met at a corner, in degrees (default 0.5). */
  squareSigmaDeg?: number
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
  angles: 'square',
  angleSigmaDeg: 3,
  squareSigmaDeg: 0.5,
}

/** Radians per degree. */
const DEG = Math.PI / 180

/** |sin| of the angle between two lines under this = the lines are almost parallel. */
const PARALLEL_SIN = 0.02

type Orient = 'h' | 'v' | 'o'

/** One wall of one room (one edge of a room outline). */
type Edge = {
  room: number
  index: number
  orient: Orient
  /** Unit inward normal of the room wall (drawn). */
  nx: number
  ny: number
  /** Offset of the drawn centre line along the inward normal: n . p, cm. */
  c: number
  /** Unit direction of the room wall (drawn), following the room polygon. */
  dx: number
  dy: number
  /** Middle point of the drawn wall, cm. */
  mx: number
  my: number
  length: number
  thicknessCm: number
  /** Line of the wall that lines up with the next walls (wall props, seen from this room). */
  align: WallAlign
  group: number
  /** +1 when the room of this wall is on the side of larger n of its group. */
  sign: 1 | -1
}

export type WallGroup = {
  id: number
  /** Drawn direction class: 'h' horizontal, 'v' vertical, 'o' any other angle. */
  orient: Orient
  /** Labels of the room walls that make this wall, e.g. ["SB-4", "SE-6"]. */
  walls: string[]
  drawnCoord: number
  /** Offset of the solved centre line along its normal (cm). */
  coord: number
  /** Angle of the normal of the wall after the fit, in degrees. */
  angleDeg: number
  /** Standard deviation of that angle after the fit (degrees); 0 when the angle is fixed. */
  angleSdDeg: number
  priorThicknessCm: number
  thicknessCm: number
  /** Standard deviation of the thickness after the fit (cm). */
  thicknessSdCm: number
  /** True when the data (not the prior) sets the thickness. */
  determined: boolean
  /** Number of rooms that see the wall. */
  rooms: number
}

export type GlobalResidual = {
  label: string
  kind: 'wall' | 'diagonal' | 'thickness' | 'locked' | 'align' | 'surface' | 'centre' | 'outside' | 'angle'
  measuredCm: number
  solvedCm: number
  diffCm: number
  /** Accuracy of the row (cm, cm² for a surface, degrees for an angle). */
  sigmaCm: number
}

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

/** One room corner that the fit did not keep at a right angle ('free' angles only). */
export type OutOfSquare = { roomCode: string; deg: number }

export type GlobalSolved = {
  groups: WallGroup[]
  residuals: GlobalResidual[]
  /** Root-mean-square of the wall, diagonal, centre and outside residuals (cm). */
  rmsCm: number
  /** New centre line corners, per room id. */
  rooms: Record<string, Vec[]>
  /** Inside face corners, per room id. */
  inner: Record<string, Vec[]>
  /** One line of report per surface reference (empty when the mode is 'off'). */
  surfaces: GlobalSurface[]
  /** Rooms whose corners are not right angles, most out of square first ('free' angles only). */
  outOfSquare: OutOfSquare[]
  skipped: { label: string; reason: string }[]
  iterations: number
  /** Rooms that overlap or nearly touch, found by the wall graph. */
  conflicts: GraphConflict[]
}

/** How the outside face of a stored wall ends at a node, in the row W*-E. */
type EndMode = 'far' | 'near' | 'centre'

/** Unknowns of one wall group. */
type GroupVar = {
  /** Index of the offset unknown. */
  d: number
  /** Index of the thickness unknown. */
  t: number
  /** Index of the angle unknown (-1: the angle is a constant). */
  theta: number
  /** Drawn angle of the normal, radians. */
  drawnTheta: number
  /** Value of the normal angle when it is a constant. */
  fixedTheta: number
  /** Drawn offset along the normal, cm. */
  drawn: number
  /** Prior of the thickness, cm. */
  prior: number
  /** Reference line = centre + k * thickness / 2 (the line that lines up with the next walls). */
  k: number
  drawnRef: number
  orient: Orient
  edges: Edge[]
  /** Unit direction along the wall (drawn). */
  ux: number
  uy: number
  /** End points of the room walls of this group, for the in-line rule. */
  pts: Vec[]
}

/** One room corner, as a pair of wall groups and (when almost parallel) one free unknown. */
type CornerSetup = {
  /** Index of the group of the wall before the corner. */
  prev: number
  /** Index of the group of the wall after the corner. */
  next: number
  /** Sign of the room side of the wall before / after the corner, in the normal of its group. */
  prevSign: 1 | -1
  nextSign: 1 | -1
  /** True when the two lines are almost parallel: the corner is a free point on the first line. */
  parallel: boolean
  /** Unknown of the free position along the line (-1 when the corner is a crossing). */
  free: number
}

/** The two parts of the model that the corners and the angles are built from. */
type Model = Pick<Built, 'groupVars' | 'cornerSetups'>

/** The value of every expression at one x: the normals, the offsets and the corners. */
type Ctx = {
  xs: number[]
  /** Unit normal (cos theta, sin theta) of each group. */
  n: { nx: D; ny: D }[]
  /** Offset of the centre line of each group. */
  d: D[]
  /** Thickness of each group. */
  t: D[]
  /** Corner k of room ri: the crossing of the centre lines (cx, cy) and of the inside faces (fx, fy). */
  corners: { cx: D; cy: D; fx: D; fy: D }[][]
}

/** One row of the fit: a value of the plan compared with a measured value. */
type Row = {
  label: string
  kind: GlobalResidual['kind']
  target: number
  sigma: number
  /** The value at the current unknowns, with its exact gradient. */
  value: (c: Ctx) => D
  /**
   * Surface row of the Guide mode: one-sided. Active only when the value passes `t0` on the given
   * side; it then pulls back to `t0`. An inactive row gives a zero residual.
   */
  hinge?: { t0: number; above: boolean }
}

/** Centre and outside face length of one stored wall, as functions of the unknowns. */
type WallLins = { centre?: (c: Ctx) => D; outside?: (c: Ctx) => D }

/** One surface reference, ready for a row. */
type SurfaceEntry = { label: string; roomCode?: string; referenceM2: number; rooms: number[] }

/**
 * Everything the fit needs, built from the document. solveGlobal and solveGlobalWithModel use
 * the same build, so a candidate row is scored on exactly the system that was solved.
 */
type Built = {
  o: Required<GlobalOptions>
  rooms: Room[]
  edgeOf: Edge[][]
  groupVars: GroupVar[]
  cornerSetups: CornerSetup[][]
  rows: Row[]
  priors: Row[]
  skipped: { label: string; reason: string }[]
  surfaceEntries: SurfaceEntry[]
  wallLins: Map<string, WallLins>
  x0: number[]
  label: (e: Edge) => string
  conflicts: GraphConflict[]
}

/** Exact unit normal of an angle that is a multiple of 90 degrees (no float noise), else cos/sin. */
function exactNormal(theta: number): { nx: number; ny: number } {
  const k = Math.round(theta / (Math.PI / 2))
  if (Math.abs(theta - k * (Math.PI / 2)) < 1e-9) {
    const q = ((k % 4) + 4) % 4
    return q === 0 ? { nx: 1, ny: 0 } : q === 1 ? { nx: 0, ny: 1 } : q === 2 ? { nx: -1, ny: 0 } : { nx: 0, ny: -1 }
  }
  return { nx: Math.cos(theta), ny: Math.sin(theta) }
}

/** Angle of a vector, in radians in (-pi, pi]. */
const angleOf = (x: number, y: number) => Math.atan2(y, x)

/** The angle in (-pi, pi]. */
const wrapPi = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))

// ---- expressions ----

/** Normal of a group at xs: a variable (cos, sin of theta) or a constant. */
function normalD(xs: number[], g: GroupVar): { nx: D; ny: D } {
  if (g.theta < 0) {
    const n = exactNormal(g.fixedTheta)
    return { nx: cst(n.nx), ny: cst(n.ny) }
  }
  const th = variable(g.theta, xs[g.theta])
  return { nx: cos(th), ny: sin(th) }
}

/**
 * Crossing of the two lines n1 . p = r1 and n2 . p = r2.
 * When the corner is almost parallel, the point is a free position s along the FIRST line:
 * p = r1 * n1 + s * u1, with u1 = (-n1.y, n1.x). One unknown gives both the inside corner and the
 * centre corner, as before this phase.
 */
function crossLines(c: Ctx, parallel: boolean, free: number, i1: number, r1: D, i2: number, r2: D): { x: D; y: D } {
  const n1 = c.n[i1], n2 = c.n[i2]
  if (parallel) {
    const s = free >= 0 ? variable(free, c.xs[free]) : cst(0)
    return {
      x: sub(mul(r1, n1.nx), mul(s, n1.ny)),
      y: add(mul(r1, n1.ny), mul(s, n1.nx)),
    }
  }
  const det = sub(mul(n1.nx, n2.ny), mul(n1.ny, n2.nx))
  return {
    x: div(sub(mul(r1, n2.ny), mul(n1.ny, r2)), det),
    y: div(sub(mul(n1.nx, r2), mul(n2.nx, r1)), det),
  }
}

/** Inside face line of a corner side: the centre line moved into the room by half the thickness. */
const faceOffset = (d: D, t: D, sign: 1 | -1): D => add(d, scale(t, sign / 2))

/** All values of the model at xs. */
function buildCtx(b: Model, xs: number[]): Ctx {
  const n = b.groupVars.map((g) => normalD(xs, g))
  const d = b.groupVars.map((g) => variable(g.d, xs[g.d]))
  const t = b.groupVars.map((g) => variable(g.t, xs[g.t]))
  const c: Ctx = { xs, n, d, t, corners: [] }
  c.corners = b.cornerSetups.map((list) => list.map((cs) => {
    const cp = cs.parallel, free = cs.free
    const centre = crossLines(c, cp, free, cs.prev, d[cs.prev], cs.next, d[cs.next])
    const inside = crossLines(
      c, cp, free,
      cs.prev, faceOffset(d[cs.prev], t[cs.prev], cs.prevSign),
      cs.next, faceOffset(d[cs.next], t[cs.next], cs.nextSign),
    )
    return { cx: centre.x, cy: centre.y, fx: inside.x, fy: inside.y }
  }))
  return c
}

/** Distance between two points of the model, as an expression. */
const distance = (ax: D, ay: D, bx: D, by: D): D => hypot(sub(bx, ax), sub(by, ay))

/**
 * Area of inside polygons (cm²) and its gradient, as an expression. Each polygon keeps the sign of
 * its own shoelace sum, so a sum of rooms stays correct when the rooms are drawn in different
 * directions.
 */
function areaD(c: Ctx, rooms: number[]): D {
  let total: D | null = null
  for (const ri of rooms) {
    const cs = c.corners[ri]
    const n = cs.length
    let sum: D | null = null
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n
      // fxi * fyj - fxj * fyi
      const term = sub(mul(cs[i].fx, cs[j].fy), mul(cs[j].fx, cs[i].fy))
      sum = sum ? add(sum, term) : term
    }
    if (!sum) continue
    const signed = sum.v >= 0 ? sum : scale(sum, -1)
    total = total ? add(total, signed) : signed
  }
  return scale(total ?? cst(0), 0.5)
}

function buildModel(doc: SolveDoc, options: GlobalOptions = {}): Built {
  // The references come from the options, or from the document (doc.apartment.references).
  const o = { ...DEFAULTS, ...options, references: options.references ?? doc.apartment?.references ?? [] }
  const rooms = doc.rooms

  // ---- edges ----
  // Each room wall gives its drawn line: the inward normal, its offset and its direction. A wall
  // drawn within about 1 degree of an axis counts as horizontal or vertical (as in the graph).
  const edges: Edge[] = []
  const edgeOf: Edge[][] = []
  rooms.forEach((r, ri) => {
    const v = r.vertices
    const n = v.length
    const s = shoelaceSign(v)
    edgeOf.push(v.map((a, i) => {
      const b = v[(i + 1) % n]
      const dx = b.x - a.x, dy = b.y - a.y
      const l = Math.hypot(dx, dy) || 1
      const ux = dx / l, uy = dy / l
      const inward = { x: -uy * s, y: ux * s }
      const orient: Orient = Math.abs(dx) / l < 0.02 ? 'v' : Math.abs(dy) / l < 0.02 ? 'h' : 'o'
      const e: Edge = {
        room: ri, index: i, orient,
        nx: inward.x, ny: inward.y,
        c: inward.x * a.x + inward.y * a.y,
        dx: ux, dy: uy,
        mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2,
        length: l,
        thicknessCm: wallProps(r, a.id).thicknessCm,
        align: wallProps(r, a.id).align ?? 'room',
        group: -1,
        sign: 1,
      }
      edges.push(e)
      return e
    }))
  })

  // ---- walls: one group per wall of the wall graph ----
  // The graph (src/model/wallGraph.ts) does the grouping, in any direction: facing walls of two
  // rooms and in-line walls of one room. The group of a room wall is the wall of its first face.
  const graph = buildWallGraph(rooms, { pairTolCm: o.pairTolCm, alignTolCm: o.alignTolCm })
  const wallKeyOf = (e: Edge): string => {
    const fi = graph.roomFaces[rooms[e.room].id]?.[e.index]?.faceIndexes[0]
    const wallId = fi === undefined ? undefined : graph.faces[fi]?.wallId
    // A wall with no face (zero length) keeps its own group.
    return wallId ?? `own:${e.room}:${e.index}`
  }

  // ---- unknowns ----
  const x0: number[] = []
  const priors: Row[] = []
  const newVar = (start: number, sigma: number) => {
    const k = x0.length
    x0.push(start)
    priors.push({ label: `#${k}`, kind: 'align', target: start, sigma, value: (c) => variable(k, c.xs[k]) })
    return k
  }
  const label = (e: Edge) => `${rooms[e.room].code}-${e.index + 1}`
  const groupVars: GroupVar[] = []
  const keyToGroup = new Map<string, number>()
  edges.forEach((e) => {
    const key = wallKeyOf(e)
    let g = keyToGroup.get(key)
    if (g === undefined) {
      g = groupVars.length
      keyToGroup.set(key, g)
      groupVars.push({
        d: -1, t: -1, theta: -1, drawnTheta: 0, fixedTheta: 0, drawn: 0, prior: 0, k: 0, drawnRef: 0,
        orient: e.orient, edges: [], ux: 1, uy: 0, pts: [],
      })
    }
    e.group = g
    groupVars[g].edges.push(e)
  })
  // Owner of a wall: the room wall of the room first in the walk-through (it sets the line that
  // lines up with the next walls, as before this phase).
  const ownerOf = (g: GroupVar) => g.edges.reduce((a, e) => {
    const ra = rooms[a.room], re = rooms[e.room]
    return re.walkOrder < ra.walkOrder || (re.walkOrder === ra.walkOrder && re.code < ra.code) ? e : a
  })
  for (const g of groupVars) {
    const owner = ownerOf(g)
    // Canonical normal: the axis normal for a wall drawn horizontal or vertical (so the offset is
    // the x or y of the old solver), else the inward normal of the owner.
    let n: { x: number; y: number }
    if (owner.orient === 'h') n = { x: 0, y: 1 }
    else if (owner.orient === 'v') n = { x: 1, y: 0 }
    else n = { x: owner.nx, y: owner.ny }
    g.drawnTheta = owner.orient === 'h' ? Math.PI / 2 : owner.orient === 'v' ? 0 : angleOf(n.x, n.y)
    g.fixedTheta = g.drawnTheta
    g.orient = owner.orient
    g.ux = -n.y
    g.uy = n.x
    // The drawn line is the mean of the drawn lines of its room walls, in the normal of the wall.
    g.drawn = g.edges.reduce((sum, e) => sum + (e.nx * n.x + e.ny * n.y >= 0 ? 1 : -1) * e.c, 0) / g.edges.length
    g.prior = Math.max(...g.edges.map((e) => e.thicknessCm))
    for (const e of g.edges) e.sign = e.nx * n.x + e.ny * n.y >= 0 ? 1 : -1
    g.k = owner.align === 'center' ? 0 : owner.align === 'room' ? owner.sign : -owner.sign
    g.drawnRef = g.drawn + (g.k * g.prior) / 2
    g.pts = g.edges.flatMap((e) => [{ x: e.mx - (e.dx * e.length) / 2, y: e.my - (e.dy * e.length) / 2 }, { x: e.mx + (e.dx * e.length) / 2, y: e.my + (e.dy * e.length) / 2 }])
    g.d = newVar(g.drawn, o.positionSigmaCm)
    g.t = newVar(g.prior, o.thicknessSigmaCm)
    // A wall drawn at an angle is always solved with its own angle. A wall drawn horizontal or
    // vertical keeps its drawn angle with the option 'square' (the default).
    if (g.orient === 'o' || o.angles === 'free') g.theta = newVar(g.drawnTheta, o.angleSigmaDeg * DEG)
  }

  // Corner k of room r is between the wall before it and the wall after it. Almost parallel lines
  // get one free unknown for the position of the corner along the first line.
  const cornerSetups: CornerSetup[][] = rooms.map((r, ri) => {
    const es = edgeOf[ri]
    const n = es.length
    return r.vertices.map((_, k) => {
      const prev = es[(k + n - 1) % n], next = es[k]
      const gp = groupVars[prev.group], gn = groupVars[next.group]
      const parallel = Math.abs(Math.sin(gn.drawnTheta - gp.drawnTheta)) < PARALLEL_SIN
      let free = -1
      if (parallel) {
        // Prior of the free position: the drawn corner, projected on the first line.
        const nn = exactNormal(gp.drawnTheta)
        const s0 = -nn.ny * r.vertices[k].x + nn.nx * r.vertices[k].y
        free = newVar(s0, o.positionSigmaCm)
      }
      return { prev: prev.group, next: next.group, prevSign: prev.sign, nextSign: next.sign, parallel, free }
    })
  })

  // ---- measurements ----
  const rows: Row[] = []
  // Current inside lengths, for locked walls with no measured value.
  const innerLengths = rooms.map((r) => innerWallLengths(r))
  const skipped: { label: string; reason: string }[] = []
  const thickRow = (gi: number, target: number, sigma: number, lab: string, kind: GlobalResidual['kind']): Row =>
    ({ label: lab, kind, target, sigma, value: (c) => c.t[gi] })
  rooms.forEach((r, ri) => {
    edgeOf[ri].forEach((e, i) => {
      // Measured thickness (CODE-n-T): a direct value for the wall.
      const tLab = thicknessLabel(r.code, i)
      const tm = doc.measurements[tLab]?.actualCm
      if (tm && tm > 0) rows.push(thickRow(e.group, tm, o.thicknessMeasureSigmaCm, tLab, 'thickness'))
      const lab = `${r.code}-${i + 1}`
      const measuredCm = doc.measurements[lab]?.actualCm
      const hasValue = !!(measuredCm && Number.isFinite(measuredCm) && measuredCm > 0)
      // A locked wall keeps its value (measured) or its current inside length (no value), strongly.
      const locked = o.keepLocked && !!wallProps(r, r.vertices[i].id).locked
      if (!hasValue && !locked) return
      const m = hasValue ? measuredCm! : innerLengths[ri][i]
      const sigma = locked ? o.lockedSigmaCm : sourceSigmaCm(doc.measurements[lab]?.source) * o.measureSigmaCm
      const kind: GlobalResidual['kind'] = hasValue ? 'wall' : 'locked'
      const j = (i + 1) % edgeOf[ri].length
      // Wall length: the distance between the two inside face corners, in any direction.
      rows.push({ label: lab, kind, target: m, sigma, value: (c) => distance(c.corners[ri][i].fx, c.corners[ri][i].fy, c.corners[ri][j].fx, c.corners[ri][j].fy) })
    })
    const d = doc.measurements[`${r.code}-D`]?.actualCm
    if (r.diagonal && d && d > 0) {
      const [i, j] = r.diagonal
      if (edgeOf[ri][i] && edgeOf[ri][j]) {
        rows.push({
          label: `${r.code}-D`, kind: 'diagonal', target: d,
          sigma: sourceSigmaCm(doc.measurements[`${r.code}-D`]?.source) * o.measureSigmaCm,
          value: (c) => distance(c.corners[ri][i].fx, c.corners[ri][i].fy, c.corners[ri][j].fx, c.corners[ri][j].fy),
        })
      }
    }
  })

  // ---- centre line and outside face values of stored walls (docs/walls-plan.md phase 5b/4b) ----
  // W12-C: the length between the CENTRE lines of the walls at its two ends (the crossing of the
  //        centre line of this wall with the centre line of each end wall).
  // W12-E: the length between the OUTSIDE faces: the crossing of the outside face of this wall with
  //        the face of each end wall that the outside face meets: the face away from this wall at an
  //        outside corner, the NEAR face at an inside corner and at a T junction (outside rows).
  // In any direction these are distances between two crossings, so a facade value finds the
  // thickness of an exterior wall that no loop crosses, also for a wall at an angle.
  // A centre value read on a plan has no source more often than not: no source counts as 'plan'.
  const wallLins = new Map<string, WallLins>()
  const storedNodes: StoredNode[] = doc.nodes ?? []
  const storedWalls: StoredWall[] = doc.walls ?? []
  const nodeAt = new Map(storedNodes.map((n) => [n.id, n]))
  // A value of a wall has a row only when the document has the stored wall graph.
  if (!storedWalls.length) {
    for (const lab of Object.keys(doc.measurements)) {
      if (parseWallValueLabel(lab)) skipped.push({ label: lab, reason: 'the plan has no stored wall graph' })
    }
  }
  /** Group of a room wall, and the drawn angle of its normal. */
  const groupOfRoomWall = (ref: RoomWallRef | null): { g: number; theta: number } | null => {
    if (!ref) return null
    const e = edgeOf[ref.roomIndex]?.[ref.index]
    if (!e || e.group < 0) return null
    return { g: e.group, theta: groupVars[e.group].drawnTheta }
  }
  /** Group of the room wall drawn on a stored wall, and the drawn angle of its normal. */
  const groupOfStoredWall = (w: StoredWall): { g: number; theta: number } | null => {
    const ref = w.faces.find((f) => f.roomId !== undefined && f.wallStart !== undefined)
    if (!ref || ref.roomId === undefined) return null
    const ri = rooms.findIndex((r) => r.id === ref.roomId)
    const k = ri < 0 ? -1 : rooms[ri].vertices.findIndex((v) => v.id === ref.wallStart)
    const e = k < 0 ? undefined : edgeOf[ri]?.[k]
    return e && e.group >= 0 ? { g: e.group, theta: groupVars[e.group].drawnTheta } : null
  }
  // The outside rows of the plan, by label: the planned length of W*-E is the chain segment.
  const plannedSegments = new Map<string, { a: Vec; b: Vec }>()
  if (storedWalls.length) {
    for (const run of outsideDims({ rooms, nodes: storedNodes, walls: storedWalls, measurements: doc.measurements })) {
      for (const seg of run.segments) if (seg.label) plannedSegments.set(seg.label, { a: seg.a, b: seg.b })
    }
  }
  for (const wall of storedWalls) {
    const na = nodeAt.get(wall.a), nb = nodeAt.get(wall.b)
    if (!na || !nb) continue
    const dx = nb.x - na.x, dy = nb.y - na.y
    const centreCm = Math.hypot(dx, dy)
    if (centreCm < 1) continue
    const centreLabel = wallValueLabel(wall.id, 'centre')
    const outsideLabel = wallValueLabel(wall.id, 'outside')
    const centreValue = doc.measurements[centreLabel]?.actualCm
    const outsideValue = doc.measurements[outsideLabel]?.actualCm
    const hasCentre = !!centreValue && Number.isFinite(centreValue) && centreValue > 0
    const hasOutside = !!outsideValue && Number.isFinite(outsideValue) && outsideValue > 0
    const entry: WallLins = {}
    wallLins.set(wall.id, entry)
    const ends = wallEnds(rooms, storedNodes, wall)
    const gA = groupOfRoomWall(ends.a), gB = groupOfRoomWall(ends.b)
    const endReason = !ends.a || !ends.b
      ? 'no perpendicular wall at one end of this wall'
      : 'the lines of the walls at one end do not cross'
    // The line of this wall: the group of a room wall drawn on it (so the fit moves it), else its
    // drawn line as a constant.
    const ownRef = wall.faces.find((f) => f.roomId !== undefined && f.wallStart !== undefined)
    let own: { g: number; theta: number } | null = null
    if (ownRef && ownRef.roomId !== undefined) {
      const ri = rooms.findIndex((r) => r.id === ownRef.roomId)
      const k = ri < 0 ? -1 : rooms[ri].vertices.findIndex((v) => v.id === ownRef.wallStart)
      const e = k < 0 ? undefined : edgeOf[ri]?.[k]
      if (e && e.group >= 0) own = { g: e.group, theta: groupVars[e.group].drawnTheta }
    }
    const ux = dx / centreCm, uy = dy / centreCm
    const left = { x: -uy, y: ux }
    const ownTheta = own ? own.theta : angleOf(left.x, left.y)
    const ownNormal = exactNormal(ownTheta)
    const mid = { x: (na.x + nb.x) / 2, y: (na.y + nb.y) / 2 }
    /** +1 when the middle of this wall is on the side of larger n of an end wall. */
    const sgnOf = (g: { g: number; theta: number }) => {
      const n = exactNormal(g.theta)
      return n.nx * mid.x + n.ny * mid.y - groupVars[g.g].drawn >= 0 ? 1 : -1
    }
    const side = outsideFaceSide(wall, centreCm)
    const outsideNormal = side === 'L' ? left : { x: -left.x, y: -left.y }
    const outsideSign: 1 | -1 = outsideNormal.x * ownNormal.nx + outsideNormal.y * ownNormal.ny >= 0 ? 1 : -1
    const sgnA = gA ? sgnOf(gA) : 1
    const sgnB = gB ? sgnOf(gB) : 1
    /** The lines of this wall and of an end wall must cross, else there is no length to give. */
    const crosses = (g: { theta: number } | null) => !!g && Math.abs(Math.sin(g.theta - ownTheta)) > PARALLEL_SIN
    /**
     * The end of the outside row of the plan (facadePlannedLengths: one source): the wall and the
     * face (or centre line) that the end point lies on, so the row of the solver uses the same
     * geometry as the row on the plan. null when the wall has no row, or no wall with a room wall
     * holds the end point.
     */
    const plannedEnd = (endIndex: 0 | 1): { g: number; s: -1 | 0 | 1 } | null => {
      const seg = plannedSegments.get(outsideLabel)
      if (!seg) return null
      const pa = ux * seg.a.x + uy * seg.a.y <= ux * seg.b.x + uy * seg.b.y ? seg.a : seg.b
      const pb = pa === seg.a ? seg.b : seg.a
      const pt = endIndex === 0 ? pa : pb
      let best: { g: number; s: -1 | 0 | 1; gap: number } | null = null
      for (const w of storedWalls) {
        if (w.id === wall.id) continue
        const wa = nodeAt.get(w.a), wb = nodeAt.get(w.b)
        if (!wa || !wb) continue
        const wl = Math.hypot(wb.x - wa.x, wb.y - wa.y)
        if (wl < 1) continue
        const wd = { x: (wb.x - wa.x) / wl, y: (wb.y - wa.y) / wl }
        if (Math.abs(wd.x * uy - wd.y * ux) <= PARALLEL_SIN) continue
        const gw = groupOfStoredWall(w)
        if (!gw) continue
        const off = (pt.x - wa.x) * -wd.y + (pt.y - wa.y) * wd.x
        const along = (pt.x - wa.x) * wd.x + (pt.y - wa.y) * wd.y
        const gap = Math.max(-along, along - wl, 0)
        if (gap > (w.thicknessCm ?? DEFAULT_WALL_CM)) continue
        const half = (w.thicknessCm ?? DEFAULT_WALL_CM) / 2
        const kind = Math.abs(off) <= 0.5 ? 0 : Math.abs(Math.abs(off) - half) <= 0.5 ? (off > 0 ? 1 : -1) : null
        if (kind === null) continue
        // The line of the group has its own normal: flip the face when the normals are opposed.
        const gn = exactNormal(gw.theta)
        const flip = gn.nx * -wd.y + gn.ny * wd.x >= 0 ? 1 : -1
        const spec = { g: gw.g, s: (kind * flip) as -1 | 0 | 1, gap }
        if (!best || gap < best.gap) best = spec
      }
      return best
    }
    /**
     * Length between the two crossings with the end walls, along the centre line of this wall, or
     * along its outside face. The face of an end wall that is used: the one away from this wall at
     * an outside corner, the near one at an inside corner or a T junction.
     */
    const lengthRow = (outside: boolean): ((c: Ctx) => D) | undefined => {
      if (!own || !gA || !gB || !crosses(gA) || !crosses(gB)) return undefined
      const og = own.g
      const ownLine = (c: Ctx): D => (outside ? faceOffset(c.d[og], c.t[og], outsideSign) : c.d[og])
      // The face of the end wall that the outside face of this wall meets, as the outside rows
      // (outsideDims) do: the far face at an outside corner, the NEAR face at an inside corner (the
      // end wall leaves the node on the outside side of this wall) or when a wall passes through the
      // node (T junction), and the CENTRE line of the end wall when the outside face goes on in line
      // past the node (the chain of the row is cut there).
      // `s` is the face of the end wall group: its line is d + s * t / 2 (s = 0: the centre line).
      const endLine = (c: Ctx, g: number, s: -1 | 0 | 1): D =>
        outside && s !== 0 ? add(c.d[g], scale(c.t[g], s / 2)) : c.d[g]
      const point = (c: Ctx, g: number, s: -1 | 0 | 1): { x: D; y: D } =>
        crossLines(c, false, -1, og, ownLine(c), g, endLine(c, g, s))
      const outsideDir = side === 'L' ? 1 : -1
      const modeAt = (ref: RoomWallRef | null, nodeId: string): EndMode => {
        const at = nodeAt.get(nodeId)
        if (!at) return 'far'
        let near = !!ref && (Math.abs(ref.farOffsetCm) <= 0.5 || ref.farOffsetCm * outsideDir > 0)
        for (const w of storedWalls) {
          if (w.id === wall.id) continue
          const pa = nodeAt.get(w.a), pb = nodeAt.get(w.b)
          if (!pa || !pb) continue
          const len = Math.hypot(pb.x - pa.x, pb.y - pa.y)
          if (len < 1) continue
          const wd = { x: (pb.x - pa.x) / len, y: (pb.y - pa.y) / len }
          const along = (at.x - pa.x) * wd.x + (at.y - pa.y) * wd.y
          const off = (at.x - pa.x) * -wd.y + (at.y - pa.y) * wd.x
          if (Math.abs(off) > 1) continue
          const parallel = Math.abs(wd.x * uy - wd.y * ux) <= PARALLEL_SIN
          const isEnd = w.a === nodeId || w.b === nodeId
          if (parallel) {
            // A wall in line that goes on from this node with an outside face on the same side.
            if (!isEnd) continue
            const wl = { x: -wd.y, y: wd.x }
            const ws = outsideFaceSide(w, len)
            if (!ws) continue
            const wn = ws === 'L' ? wl : { x: -wl.x, y: -wl.y }
            const sameFace = wn.x * outsideNormal.x + wn.y * outsideNormal.y > 0.5
              && Math.abs((w.thicknessCm ?? DEFAULT_WALL_CM) - (wall.thicknessCm ?? DEFAULT_WALL_CM)) <= 1
            const away = (w.a === nodeId ? wd.x : -wd.x) * (nodeId === wall.a ? -ux : ux)
              + (w.a === nodeId ? wd.y : -wd.y) * (nodeId === wall.a ? -uy : uy)
            if (sameFace && away > 0.5) return 'centre'
          } else if (!isEnd && along > 1 && along < len - 1) {
            near = true
          }
        }
        return near ? 'near' : 'far'
      }
      const specOf = (g: { g: number }, sgn: 1 | -1, mode: EndMode): { g: number; s: -1 | 0 | 1 } =>
        ({ g: g.g, s: mode === 'centre' ? 0 : mode === 'near' ? sgn : (-sgn as 1 | -1) })
      const specA = (outside && plannedEnd(0)) || specOf(gA, sgnA, modeAt(ends.a, wall.a))
      const specB = (outside && plannedEnd(1)) || specOf(gB, sgnB, modeAt(ends.b, wall.b))
      return (c: Ctx) => {
        const a = point(c, specA.g, specA.s)
        const b = point(c, specB.g, specB.s)
        return hypot(sub(b.x, a.x), sub(b.y, a.y))
      }
    }
    entry.centre = lengthRow(false)
    entry.outside = side ? lengthRow(true) : undefined
    if (hasCentre) {
      if (!entry.centre) skipped.push({ label: centreLabel, reason: endReason })
      else {
        // No source counts as 'plan': the value of a centre line is usually read on a plan.
        rows.push({
          label: centreLabel, kind: 'centre', target: centreValue!,
          sigma: sourceSigmaCm(doc.measurements[centreLabel]?.source ?? 'plan') * o.measureSigmaCm,
          value: entry.centre,
        })
      }
    }
    if (hasOutside) {
      if (!side) skipped.push({ label: outsideLabel, reason: 'the wall has no outside face on its whole length' })
      else if (!entry.outside) skipped.push({ label: outsideLabel, reason: endReason })
      else {
        rows.push({
          label: outsideLabel, kind: 'outside', target: outsideValue!,
          sigma: sourceSigmaCm(doc.measurements[outsideLabel]?.source) * o.measureSigmaCm,
          value: entry.outside,
        })
      }
    }
  }

  // ---- surface references (docs/walls-plan.md phase 2) ----
  // One row per reference: the area of the inside face polygon of its room, or the sum of the
  // inside areas of every indoor room. Sigma is a small % of the surface, so a measured wall
  // (1 cm) always wins over the reference.
  const surfaceEntries: SurfaceEntry[] = []
  if (o.surfaceMode !== 'off') {
    // A room drawn with a wall at an angle keeps its drawn area with Room angles = Square (before
    // this phase its surface was skipped); with 'free' the shoelace of its corners gives the area.
    // Every room counts, whatever the direction of its walls (a wall at an angle has its own angle unknown).
    const usable = (ri: number) => !rooms[ri].outdoor
    const indoor = rooms.map((_, ri) => ri).filter(usable)
    for (const ref of o.references) {
      const lab = ref.label?.trim() || SOURCE_LABELS[ref.source]
      const sigma = (ref.surfaceM2 * 10000 * o.surfaceSigmaPct) / 100
      if (!(ref.surfaceM2 > 0) || !Number.isFinite(sigma) || !(sigma > 0)) {
        skipped.push({ label: lab, reason: 'the reference surface is not a positive number' })
        continue
      }
      let roomIndexes: number[]
      let roomCode: string | undefined
      if (ref.roomCode) {
        const code = ref.roomCode.trim().toLowerCase()
        const ri = rooms.findIndex((r) => r.code.trim().toLowerCase() === code)
        if (ri < 0) {
          skipped.push({ label: lab, reason: `the plan has no room ${ref.roomCode}` })
          continue
        }
        roomCode = rooms[ri].code
        roomIndexes = [ri]
      } else {
        if (!indoor.length) {
          skipped.push({ label: lab, reason: 'the plan has no indoor room' })
          continue
        }
        roomIndexes = indoor
      }
      const targetCm2 = ref.surfaceM2 * 10000
      surfaceEntries.push({ label: lab, roomCode, referenceM2: ref.surfaceM2, rooms: roomIndexes })
      const a0 = areaD(buildCtx({ groupVars, cornerSetups }, x0), roomIndexes).v
      if (o.surfaceMode === 'match') {
        rows.push({ label: lab, kind: 'surface', target: targetCm2, sigma, value: (c) => areaD(c, roomIndexes) })
      } else if (Math.abs(a0 - targetCm2) > 1e-6) {
        // Guide: hinge on the drawn area. Below the reference the plan must not go smaller,
        // above it the plan must not go bigger.
        rows.push({ label: lab, kind: 'surface', target: a0, sigma, hinge: { t0: a0, above: a0 > targetCm2 }, value: (c) => areaD(c, roomIndexes) })
      }
    }
  }

  // ---- walls in line (soft) ----
  // Two walls that continue each other (end to end, drawn on one line) keep their REFERENCE lines
  // in line: by default the face in the room, so a 30 cm wall and a 10 cm wall are flush inside.
  const proj = (u: { x: number; y: number }, p: Vec) => u.x * p.x + u.y * p.y
  for (let a = 0; a < groupVars.length; a++) {
    for (let b = a + 1; b < groupVars.length; b++) {
      const A = groupVars[a], B = groupVars[b]
      const na = exactNormal(A.drawnTheta), nb = exactNormal(B.drawnTheta)
      const same = na.nx * nb.nx + na.ny * nb.ny
      // Parallel within 2 degrees (the direction of the normals can be opposite).
      if (Math.abs(same) < Math.cos(2 * DEG)) continue
      const flip = same >= 0 ? 1 : -1
      if (Math.abs(A.drawnRef - flip * B.drawnRef) > o.alignTolCm) continue
      const u = { x: A.ux, y: A.uy }
      const pa = A.pts.map((p) => proj(u, p)), pb = B.pts.map((p) => proj(u, p))
      const gap = Math.max(Math.min(...pa), Math.min(...pb)) - Math.min(Math.max(...pa), Math.max(...pb))
      if (gap > o.pairTolCm) continue
      rows.push({
        label: `${label(A.edges[0])} / ${label(B.edges[0])}`, kind: 'align', target: 0, sigma: o.alignSigmaCm,
        value: (c) => sub(add(c.d[a], scale(c.t[a], A.k / 2)), scale(add(c.d[b], scale(c.t[b], B.k / 2)), flip)),
      })
    }
  }

  // ---- right angles (soft), only with Room angles = Free ----
  // Two walls that meet at a room corner and were drawn at a right angle (within 3 degrees) or
  // parallel keep that relation. With Room angles = Square the drawn directions are fixed, so the
  // rule is not needed.
  if (o.angles === 'free') {
    const seen = new Set<string>()
    rooms.forEach((_r, ri) => {
      edgeOf[ri].forEach((e, i) => {
        const j = (i + 1) % edgeOf[ri].length
        const a = e.group, b = edgeOf[ri][j].group
        if (a === b) return
        const A = groupVars[a], B = groupVars[b]
        const key = a < b ? `${a}<${b}` : `${b}<${a}`
        if (seen.has(key)) return
        const drawn = wrapPi(B.drawnTheta - A.drawnTheta)
        const target = Math.round(drawn / (Math.PI / 2)) * (Math.PI / 2)
        if (Math.abs(wrapPi(drawn - target)) > 3 * DEG) return
        seen.add(key)
        // The angle from the normal of A to the normal of B, in degrees: atan2 of the cross and
        // the dot product of the two normals.
        const angleDeg = (c: Ctx) => {
          const na = c.n[a], nb = c.n[b]
          const cross = sub(mul(na.nx, nb.ny), mul(na.ny, nb.nx))
          const dot = add(mul(na.nx, nb.nx), mul(na.ny, nb.ny))
          return scale(atan2(cross, dot), 1 / DEG)
        }
        rows.push({
          label: `${label(e)} / ${label(edgeOf[ri][j])}`, kind: 'angle', target: target / DEG, sigma: o.squareSigmaDeg,
          value: angleDeg,
        })
      })
    })
  }

  return {
    o, rooms, edgeOf, groupVars, cornerSetups, rows, priors, skipped, surfaceEntries, wallLins, x0, label,
    conflicts: graph.conflicts,
  }
}

// ---- Gauss-Newton ----

/** Residual and gradient (divided by sigma) of one row, at the values of ctx. */
function residualAndGrad(row: Row, c: Ctx): { r: number; g: [number, number][] } {
  const d = row.value(c)
  // The Guide hinge is active only when the value went past t0 on the given side, so it lets the
  // value move the right way and blocks the wrong way only. Activity is tested again at each
  // iteration, with the current value.
  let target = row.target
  if (row.hinge) {
    const { t0, above } = row.hinge
    if (above ? d.v <= t0 : d.v >= t0) return { r: 0, g: [] }
    target = t0
  }
  return { r: (d.v - target) / row.sigma, g: gradList(d).map(([v, k]) => [v, k / row.sigma] as [number, number]) }
}

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

/** The fit itself: x at the end, the normal matrix there, and its Cholesky factor. */
function fitModel(b: Built): { x: number[]; normal: number[][]; chol: number[][] | null; iterations: number } {
  const all = [...b.rows, ...b.priors]
  const nv = b.x0.length
  let x = [...b.x0]
  const normal = (xs: number[]) => {
    const c = buildCtx(b, xs)
    const N = Array.from({ length: nv }, () => new Array<number>(nv).fill(0))
    const rhs = new Array<number>(nv).fill(0)
    for (const row of all) {
      const { r, g } = residualAndGrad(row, c)
      for (const [i, gi] of g) {
        rhs[i] -= gi * r
        for (const [j, gj] of g) N[i][j] += gi * gj
      }
    }
    return { N, b: rhs }
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

/** Sign of the shoelace sum of a polygon (1 = its own direction, -1 = the other one). */
function shoelaceSign(p: Vec[]): number {
  let s = 0
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length]
    s += a.x * b.y - b.x * a.y
  }
  return s > 0 ? 1 : -1
}

/**
 * Report of one fit. Also the single place that turns `x` into user values, so the solved plan and
 * the model used by the suggestions always agree.
 */
function reportModel(b: Built, fitted: { x: number[]; chol: number[][] | null; iterations: number }): GlobalSolved {
  const { x, chol, iterations } = fitted
  const { o, rooms, groupVars, rows, skipped, surfaceEntries, x0, label } = b
  const nv = x0.length
  const c = buildCtx(b, x)
  const variance = (k: number) => {
    if (!chol || k < 0) return NaN
    const e = new Array<number>(nv).fill(0)
    e[k] = 1
    return cholSolve(chol, e)[k]
  }

  // ---- report ----
  const groups: WallGroup[] = groupVars.map((g, id) => {
    const sd = Math.sqrt(variance(g.t))
    const angleSd = g.theta < 0 ? 0 : Math.sqrt(Math.max(0, variance(g.theta))) / DEG
    return {
      id, orient: g.orient,
      walls: g.edges.map(label),
      drawnCoord: g.drawn, coord: x[g.d],
      angleDeg: (g.theta < 0 ? g.fixedTheta : x[g.theta]) / DEG,
      angleSdDeg: angleSd,
      priorThicknessCm: g.prior, thicknessCm: x[g.t], thicknessSdCm: sd,
      determined: sd < o.thicknessSigmaCm * 0.5,
      rooms: new Set(g.edges.map((e) => e.room)).size,
    }
  })
  const residuals: GlobalResidual[] = rows.map((row) => {
    const solved = row.hinge ? row.hinge.t0 : row.value(c).v
    return { label: row.label, kind: row.kind, measuredCm: row.target, solvedCm: solved, diffCm: row.target - solved, sigmaCm: row.sigma }
  })
  // Surface and angle rows are weak rules and stay out of rmsCm. A centre or outside face value is
  // a length of the plan too: it counts in rmsCm.
  const fit = residuals.filter((r) => r.kind === 'wall' || r.kind === 'diagonal' || r.kind === 'centre' || r.kind === 'outside')
  const rmsCm = fit.length ? Math.sqrt(fit.reduce((s, r) => s + r.diffCm ** 2, 0) / fit.length) : 0
  const out: Record<string, Vec[]> = {}
  const inner: Record<string, Vec[]> = {}
  rooms.forEach((r: Room, ri) => {
    out[r.id] = c.corners[ri].map((p) => ({ x: p.cx.v, y: p.cy.v }))
    inner[r.id] = c.corners[ri].map((p) => ({ x: p.fx.v, y: p.fy.v }))
  })
  const surfaces: GlobalSurface[] = surfaceEntries.map((e) => {
    const beforeM2 = areaD(buildCtx(b, x0), e.rooms).v / 10000
    const afterM2 = areaD(c, e.rooms).v / 10000
    return {
      label: e.label,
      ...(e.roomCode ? { roomCode: e.roomCode } : {}),
      referenceM2: e.referenceM2,
      beforeM2,
      afterM2,
      diffPct: ((afterM2 - e.referenceM2) / e.referenceM2) * 100,
    }
  })
  // Rooms that the fit did not keep square: the turn of each inside corner against 90 degrees.
  const outOfSquare: OutOfSquare[] = o.angles !== 'free' ? [] : rooms.map((r) => {
    const p = inner[r.id]
    let worst = 0
    for (let k = 0; k < p.length; k++) {
      const a = p[(k + p.length - 1) % p.length], b = p[k], d = p[(k + 1) % p.length]
      const v1 = { x: b.x - a.x, y: b.y - a.y }, v2 = { x: d.x - b.x, y: d.y - b.y }
      // The turn from one wall to the next is 90 degrees at a right angle, in both directions.
      const turn = Math.abs(Math.atan2(v1.x * v2.y - v1.y * v2.x, v1.x * v2.x + v1.y * v2.y)) / DEG
      worst = Math.max(worst, Math.abs(turn - 90))
    }
    return { roomCode: r.code, deg: worst }
  }).filter((e) => e.deg > 0.2).sort((a, z) => z.deg - a.deg)
  return { groups, residuals, rmsCm, rooms: out, inner, surfaces, outOfSquare, skipped, iterations, conflicts: b.conflicts }
}

/** Defaults of the solver, for callers that must use the same sigmas (see the suggestions). */
export const GLOBAL_SOLVE_DEFAULTS: Required<GlobalOptions> = DEFAULTS

/** All rooms in one least-squares fit. */
export function solveGlobal(doc: SolveDoc, options: GlobalOptions = {}): GlobalSolved {
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
  /** Centre line length of a stored wall (label 'W12-C'). */
  | { kind: 'centre'; wallId: string }
  /** Outside face length of a stored facade wall (label 'W12-E'). */
  | { kind: 'outside'; wallId: string }

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
  /**
   * Unknown index of the offset, of the thickness and of the angle of each wall group (same order
   * as solved.groups). `angle` is -1 when the angle of the wall is a constant.
   */
  groupVars: { coord: number; thick: number; angle: number }[]
  /** Value and gradient at x, or null when the quantity cannot be a row. */
  quantity(q: CandidateQuantity): QuantityAtX | null
}

/**
 * Same fit as solveGlobal, and the model behind it: the covariance of the unknowns (from `chol`)
 * and the gradient of a candidate row score how much a new measurement would help.
 */
export function solveGlobalWithModel(doc: SolveDoc, options: GlobalOptions = {}): SolveModel {
  const b = buildModel(doc, options)
  const fitted = fitModel(b)
  const solved = reportModel(b, fitted)
  const x = fitted.x
  const c = buildCtx(b, x)
  const quantity = (q: CandidateQuantity): QuantityAtX | null => {
    if (q.kind === 'thickness') {
      const g = b.groupVars[q.groupId]
      return g ? { value: x[g.t], grad: [[g.t, 1]] } : null
    }
    if (q.kind === 'centre' || q.kind === 'outside') {
      const f = b.wallLins.get(q.wallId)?.[q.kind]
      return f ? fromD(f(c)) : null
    }
    const ri = b.rooms.findIndex((r) => r.id === q.roomId)
    if (ri < 0) return null
    const corners = c.corners[ri]
    if (!corners) return null
    if (q.kind === 'wall') {
      const j = (q.wallIndex + 1) % corners.length
      const a = corners[q.wallIndex], z = corners[j]
      return a && z ? fromD(distance(a.fx, a.fy, z.fx, z.fy)) : null
    }
    const a = corners[q.i], z = corners[q.j]
    return a && z ? fromD(distance(a.fx, a.fy, z.fx, z.fy)) : null
  }
  return {
    solved, x, normal: fitted.normal, chol: fitted.chol,
    groupVars: b.groupVars.map((g) => ({ coord: g.d, thick: g.t, angle: g.theta })),
    quantity,
  }
}

/** Value and gradient of an expression. */
const fromD = (d: D): QuantityAtX => ({ value: d.v, grad: gradList(d) })
