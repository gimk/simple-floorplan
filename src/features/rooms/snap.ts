// Pure snapping logic (cm). Priority: existing vertex > angle (+ alignment) > alignment > grid.
import type { Vec } from '../../model/types'

export type SnapOpts = { grid: boolean; gridCm: number; angles: boolean; vertices: boolean }

export type SnapGuide =
  | { kind: 'vertex'; at: Vec }
  | { kind: 'angle'; from: Vec; to: Vec }
  | { kind: 'x'; from: Vec; to: Vec }
  | { kind: 'y'; from: Vec; to: Vec }

export type SnapContext = {
  opts: SnapOpts
  /** Anchor points for 45°/90° angle snapping (previous / adjacent vertices). */
  refs?: Vec[]
  /** Existing vertices to snap to / align with. */
  vertices?: Vec[]
  /** Snap tolerance in cm (use px(10)). */
  tolCm: number
  /** Alt key held: no snapping. */
  disabled?: boolean
}

export type SnapResult = { point: Vec; guides: SnapGuide[]; snapped: boolean }

const gridRound = (v: number, g: number) => (g > 0 ? Math.round(v / g) * g : v)
const D = Math.SQRT1_2

/** 8 directions: 0°, 45°, ... (unit vectors). Lines are infinite so 4 axes suffice. */
const AXES: Vec[] = [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: D, y: D }, { x: D, y: -D }]

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

  // Alignment candidates (x / y of other vertices).
  let ax: Vec | null = null, ay: Vec | null = null
  if (opts.vertices) {
    let dx = tolCm, dy = tolCm
    for (const v of verts) {
      if (Math.abs(v.x - p.x) <= dx) { dx = Math.abs(v.x - p.x); ax = v }
      if (Math.abs(v.y - p.y) <= dy) { dy = Math.abs(v.y - p.y); ay = v }
    }
  }

  // 2. Angle from an anchor.
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

  // 3. Alignment and/or grid.
  let x = p.x, y = p.y, snapped = false
  if (ax) { x = ax.x; guides.push({ kind: 'x', from: ax, to: { x, y } }); snapped = true }
  else if (opts.grid) { x = gridRound(x, opts.gridCm); snapped = true }
  if (ay) { y = ay.y; guides.push({ kind: 'y', from: ay, to: { x, y } }); snapped = true }
  else if (opts.grid) { y = gridRound(y, opts.gridCm); snapped = true }
  // Fix guide endpoints now that both coordinates are known.
  for (const g of guides) if (g.kind === 'x' || g.kind === 'y') g.to = { x, y }
  return { point: { x, y }, guides, snapped }
}
