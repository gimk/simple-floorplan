// Pure snapping logic (cm). Priority, highest first. A higher priority within tolerance always wins,
// even if a lower one is closer:
//   1. existing vertex (vertex on vertex)
//   2. wall (segment) of another room: point onto the wall, or the wall crossed by a 45/90° ray from a ref.
//      For a translation (whole room / group drag): an edge of the moving room flush with a parallel
//      wall, or a moving vertex onto an axis-aligned wall.
//   3. 45/90° angle from a ref (+ alignment of the ray with another vertex)
//   4. x/y alignment with other vertices
//   5. grid
// Alt (ctx.disabled) turns all snapping off.
import type { Vec } from '../../model/types'

export type SnapOpts = { grid: boolean; gridCm: number; angles: boolean; vertices: boolean }

export type SnapGuide =
  | { kind: 'vertex'; at: Vec }
  | { kind: 'angle'; from: Vec; to: Vec }
  | { kind: 'x'; from: Vec; to: Vec }
  | { kind: 'y'; from: Vec; to: Vec }
  | { kind: 'edge'; from: Vec; to: Vec }

export type SnapContext = {
  opts: SnapOpts
  /** Anchor points for 45°/90° angle snapping (previous / adjacent vertices). */
  refs?: Vec[]
  /** Existing vertices to snap to / align with. */
  vertices?: Vec[]
  /** Walls of other rooms, as segments [start, end]. */
  edges?: [Vec, Vec][]
  /** Snap tolerance in cm (use px(10)). */
  tolCm: number
  /** Alt key held: no snapping. */
  disabled?: boolean
}

export type SnapResult = { point: Vec; guides: SnapGuide[]; snapped: boolean }

const gridRound = (v: number, g: number) => (g > 0 ? Math.round(v / g) * g : v)
const D = Math.SQRT1_2
const EPS = 1e-6

/** 8 directions: 0°, 45°, ... (unit vectors). Lines are infinite so 4 axes suffice. */
const AXES: Vec[] = [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: D, y: D }, { x: D, y: -D }]

/**
 * Priority 2 for a point: a 45/90° ray from a ref that crosses a wall near p (preferred, the crossing
 * point is used), else the nearest point of a wall whose projection lies inside the segment.
 */
function snapToEdge(p: Vec, edges: [Vec, Vec][], tolCm: number, refs: Vec[]): SnapResult | null {
  let rayHit: { point: Vec; guides: SnapGuide[]; d: number } | null = null
  for (const [a, b] of edges) {
    const ab = { x: b.x - a.x, y: b.y - a.y }
    for (const r of refs) for (const dir of AXES) {
      const den = dir.x * ab.y - dir.y * ab.x
      if (Math.abs(den) < 1e-9) continue
      // Solve r + s·dir = a + u·ab with the 2D cross product.
      const w = { x: a.x - r.x, y: a.y - r.y }
      const s = (w.x * ab.y - w.y * ab.x) / den
      const u = (w.x * dir.y - w.y * dir.x) / den
      if (u < -EPS || u > 1 + EPS) continue
      const X = { x: r.x + dir.x * s, y: r.y + dir.y * s }
      const d = Math.hypot(X.x - p.x, X.y - p.y)
      if (d <= tolCm * 1.5 && (!rayHit || d < rayHit.d)) {
        rayHit = { point: X, guides: [{ kind: 'edge', from: a, to: b }, { kind: 'angle', from: r, to: X }], d }
      }
    }
  }
  if (rayHit) return { point: rayHit.point, guides: rayHit.guides, snapped: true }

  let near: { point: Vec; guides: SnapGuide[]; d: number } | null = null
  for (const [a, b] of edges) {
    const ab = { x: b.x - a.x, y: b.y - a.y }
    const len2 = ab.x * ab.x + ab.y * ab.y
    if (len2 < 1e-12) continue
    const t = ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / len2
    if (t < 0 || t > 1) continue
    const q = { x: a.x + ab.x * t, y: a.y + ab.y * t }
    const d = Math.hypot(q.x - p.x, q.y - p.y)
    if (d <= tolCm && (!near || d < near.d)) near = { point: q, guides: [{ kind: 'edge', from: a, to: b }], d }
  }
  return near ? { point: near.point, guides: near.guides, snapped: true } : null
}

export function snapPoint(p: Vec, ctx: SnapContext): SnapResult {
  const { opts, tolCm } = ctx
  if (ctx.disabled) return { point: p, guides: [], snapped: false }
  const verts = ctx.vertices ?? []

  // 1. Existing vertex.
  if (opts.vertices) {
    let best: Vec | null = null, bd = tolCm
    for (const v of verts) {
      const d = Math.hypot(v.x - p.x, v.y - p.y)
      if (d <= bd) { bd = d; best = v }
    }
    if (best) return { point: { x: best.x, y: best.y }, guides: [{ kind: 'vertex', at: best }], snapped: true }
  }

  // 2. Wall of another room (gated by the vertices flag, like vertices).
  if (opts.vertices && ctx.edges?.length) {
    const hit = snapToEdge(p, ctx.edges, tolCm, opts.angles ? ctx.refs ?? [] : [])
    if (hit) return hit
  }

  // Alignment candidates (x / y of other vertices).
  let ax: Vec | null = null, ay: Vec | null = null
  if (opts.vertices) {
    let dx = tolCm, dy = tolCm
    for (const v of verts) {
      if (Math.abs(v.x - p.x) <= dx) { dx = Math.abs(v.x - p.x); ax = v }
      if (Math.abs(v.y - p.y) <= dy) { dy = Math.abs(v.y - p.y); ay = v }
    }
  }

  // 3. Angle from an anchor.
  let angleHit: { anchor: Vec; dir: Vec; point: Vec; d: number } | null = null
  if (opts.angles) {
    for (const a of ctx.refs ?? []) {
      for (const dir of AXES) {
        const rel = { x: p.x - a.x, y: p.y - a.y }
        const t = rel.x * dir.x + rel.y * dir.y
        const proj = { x: a.x + dir.x * t, y: a.y + dir.y * t }
        const d = Math.hypot(proj.x - p.x, proj.y - p.y)
        if (d <= tolCm && (!angleHit || d < angleHit.d)) angleHit = { anchor: a, dir, point: proj, d }
      }
    }
  }

  const guides: SnapGuide[] = []
  if (angleHit) {
    const { anchor, dir } = angleHit
    let pt = angleHit.point
    // Intersect the ray with an alignment line if one is close.
    const tryX = ax && Math.abs(dir.x) > 1e-9 ? { x: ax.x, y: anchor.y + ((ax.x - anchor.x) / dir.x) * dir.y } : null
    const tryY = ay && Math.abs(dir.y) > 1e-9 ? { x: anchor.x + ((ay.y - anchor.y) / dir.y) * dir.x, y: ay.y } : null
    const near = (q: Vec | null) => q && Math.hypot(q.x - p.x, q.y - p.y) <= tolCm * 1.5
    if (near(tryX)) { pt = tryX!; guides.push({ kind: 'x', from: ax!, to: pt }) }
    else if (near(tryY)) { pt = tryY!; guides.push({ kind: 'y', from: ay!, to: pt }) }
    else if (opts.grid) {
      if (Math.abs(dir.x) < 1e-9) pt = { x: pt.x, y: gridRound(pt.y, opts.gridCm) }
      else if (Math.abs(dir.y) < 1e-9) pt = { x: gridRound(pt.x, opts.gridCm), y: pt.y }
      else { const dx = gridRound(pt.x - anchor.x, opts.gridCm); pt = { x: anchor.x + dx, y: anchor.y + Math.sign(dir.x * dir.y) * dx } }
    }
    guides.push({ kind: 'angle', from: anchor, to: pt })
    return { point: pt, guides, snapped: true }
  }

  // 4. Alignment and/or grid.
  let x = p.x, y = p.y, snapped = false
  if (ax) { x = ax.x; guides.push({ kind: 'x', from: ax, to: { x, y } }); snapped = true }
  else if (opts.grid) { x = gridRound(x, opts.gridCm); snapped = true }
  if (ay) { y = ay.y; guides.push({ kind: 'y', from: ay, to: { x, y } }); snapped = true }
  else if (opts.grid) { y = gridRound(y, opts.gridCm); snapped = true }
  // Fix guide endpoints now that both coordinates are known.
  for (const g of guides) if (g.kind === 'x' || g.kind === 'y') g.to = { x, y }
  return { point: { x, y }, guides, snapped }
}

type Cand = { prio: number; c: number; make: (fin: Vec) => SnapGuide }

/**
 * Snap a whole translation (room or group drag). `moving` are the start positions of the moving
 * vertices, `d` the raw pointer offset, `movingEdges` the walls of the moving rooms. Each axis is
 * resolved on its own, by priority then by the smallest correction:
 *   1. a moving vertex on another vertex (fixes both axes, returned at once)
 *   2. a moving axis-aligned wall flush with a parallel wall (spans overlap), or a moving vertex
 *      onto an axis-aligned wall
 *   4. x / y alignment of a moving vertex with another vertex
 *   5. grid, applied to moving[0] + d, only when nothing else snapped on that axis
 */
export function snapTranslation(
  moving: Vec[], d: Vec, ctx: SnapContext & { movingEdges?: [Vec, Vec][] },
): { d: Vec; guides: SnapGuide[] } {
  const { opts, tolCm } = ctx
  if (ctx.disabled || moving.length === 0) return { d, guides: [] }
  const verts = ctx.vertices ?? []
  const edges = ctx.edges ?? []
  const mEdges = ctx.movingEdges ?? []
  const shifted = (m: Vec): Vec => ({ x: m.x + d.x, y: m.y + d.y })
  const comp = (v: Vec, i: number) => (i === 0 ? v.x : v.y)

  // 1. Vertex on vertex: fixes both axes.
  if (opts.vertices) {
    let best: { c: Vec; v: Vec; dist: number } | null = null
    for (const m of moving) {
      const q = shifted(m)
      for (const v of verts) {
        const dist = Math.hypot(v.x - q.x, v.y - q.y)
        if (dist <= tolCm && (!best || dist < best.dist)) best = { c: { x: v.x - q.x, y: v.y - q.y }, v, dist }
      }
    }
    if (best) return { d: { x: d.x + best.c.x, y: d.y + best.c.y }, guides: [{ kind: 'vertex', at: best.v }] }
  }

  const out = [d.x, d.y]
  const chosen: Cand[] = []
  for (const k of [0, 1]) {
    const o = 1 - k
    const kind = k === 0 ? 'x' : 'y'
    const cands: Cand[] = []
    if (opts.vertices) {
      for (const m of moving) {
        const q = shifted(m)
        // 4. Alignment with another vertex.
        for (const v of verts) {
          const c = comp(v, k) - comp(q, k)
          if (Math.abs(c) <= tolCm) cands.push({ prio: 4, c, make: (fin) => ({ kind, from: v, to: { x: m.x + fin.x, y: m.y + fin.y } }) })
        }
        // 2. Moving vertex onto an axis-aligned wall (perpendicular correction).
        for (const [a, b] of edges) {
          if (Math.abs(comp(a, k) - comp(b, k)) > EPS) continue
          const c = comp(a, k) - comp(q, k)
          if (Math.abs(c) > tolCm) continue
          const lo = Math.min(comp(a, o), comp(b, o)), hi = Math.max(comp(a, o), comp(b, o))
          if (comp(q, o) < lo - EPS || comp(q, o) > hi + EPS) continue
          cands.push({ prio: 2, c, make: () => ({ kind: 'edge', from: a, to: b }) })
        }
      }
      // 2. Axis-aligned moving wall flush with a parallel wall, with overlapping spans.
      for (const [p, q] of mEdges) {
        if (Math.abs(comp(p, k) - comp(q, k)) > EPS || Math.abs(comp(p, o) - comp(q, o)) <= EPS) continue
        const line = comp(p, k) + comp(d, k)
        const lo = Math.min(comp(p, o), comp(q, o)) + comp(d, o), hi = Math.max(comp(p, o), comp(q, o)) + comp(d, o)
        for (const [a, b] of edges) {
          if (Math.abs(comp(a, k) - comp(b, k)) > EPS) continue
          const c = comp(a, k) - line
          if (Math.abs(c) > tolCm) continue
          const elo = Math.min(comp(a, o), comp(b, o)), ehi = Math.max(comp(a, o), comp(b, o))
          if (Math.min(hi, ehi) - Math.max(lo, elo) <= EPS) continue
          cands.push({ prio: 2, c, make: () => ({ kind: 'edge', from: a, to: b }) })
        }
      }
    }
    let pick: Cand | null = null
    for (const c of cands) {
      if (!pick || c.prio < pick.prio || (c.prio === pick.prio && Math.abs(c.c) < Math.abs(pick.c))) pick = c
    }
    if (pick) { out[k] += pick.c; chosen.push(pick) }
    else if (opts.grid && opts.gridCm > 0) {
      // 5. Grid, on the first moving vertex only.
      const base = comp(moving[0], k) + comp(d, k)
      out[k] += gridRound(base, opts.gridCm) - base
    }
  }
  const fin = { x: out[0], y: out[1] }
  return { d: fin, guides: chosen.map((c) => c.make(fin)) }
}
