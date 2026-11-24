// Wall tool logic (docs/walls-plan.md phase 6). Pure helpers, cm. No React here.
//
// The Wall tool draws a CHAIN of centre lines. Each finished segment is stored at once - a stored
// wall in a v2 document (`traces.addWallSegment`), a trace in a v1 document - so every click is one
// undo step: a wrong segment costs one Ctrl+Z, not the whole chain. The chain only exists while the
// tool draws it (the last point is the current one).
import { dist, fmtCm } from '../../model/geometry'
import { DEFAULT_THICKNESS } from './walls'
import type { PlanDoc, Vec, WallProps, WallType } from '../../model/types'

/** Points of the chain being drawn. The last point is the current point. */
export type Chain = Vec[]

/** Two clicks closer than this are the same point (a double-click must not add a segment). */
export const SAME_POINT_CM = 1

/** Add a point to the chain, unless it is the same place as the last one. */
export function addChainPoint(chain: Chain, p: Vec, minCm = SAME_POINT_CM): Chain {
  const last = chain[chain.length - 1]
  if (last && dist(last, p) < minCm) return chain
  return [...chain, p]
}

/** Remove the last point of the chain (Backspace). */
export function removeChainPoint(chain: Chain): Chain {
  return chain.slice(0, -1)
}

/** Segments of the chain: pairs of consecutive points. */
export function chainSegments(chain: Chain): [Vec, Vec][] {
  const out: [Vec, Vec][] = []
  for (let i = 0; i + 1 < chain.length; i++) out.push([chain[i], chain[i + 1]])
  return out
}

/** The chain plus the rubber band from its last point to `end` (no end = the chain as it is). */
export function segmentsWith(chain: Chain, end: Vec | null): [Vec, Vec][] {
  const out = chainSegments(chain)
  const last = chain[chain.length - 1]
  if (end && last && dist(last, end) >= SAME_POINT_CM) out.push([last, end])
  return out
}

/**
 * Direction of a segment as a survey bearing, in degrees: 0 = up (north on screen), 90 = right,
 * 180 = down, 270 = left. y points down, so the angle grows clockwise.
 */
export function bearingDeg(a: Vec, b: Vec): number {
  const deg = (Math.atan2(b.x - a.x, a.y - b.y) * 180) / Math.PI
  const norm = deg < 0 ? deg + 360 : deg
  // 359,9999 must show as 0, not 360.
  return norm >= 360 - 1e-9 ? 0 : norm
}

/** "45°" or "45,5°" (comma decimal, like every other length in the app). 360 shows as 0. */
export const fmtAngle = (deg: number) => {
  const d = Math.round((deg % 360) * 10) / 10
  return `${String(d === 360 ? 0 : d).replace('.', ',')}°`
}

/** Label of the rubber band: length and bearing, e.g. "412 · 45°". */
export function previewLabel(a: Vec, b: Vec): string {
  return `${fmtCm(dist(a, b))} · ${fmtAngle(bearingDeg(a, b))}`
}

export type SnapTargets = {
  /** Points to snap onto: room corners, trace end points, wall nodes, the chain points placed. */
  vertices: Vec[]
  /** Lines to snap onto: room wall centre lines, traces and stored walls (a T junction). */
  edges: [Vec, Vec][]
}

/** The document parts that the snapping targets come from. */
export type SnapSource = Pick<PlanDoc, 'rooms' | 'traces'> & Partial<Pick<PlanDoc, 'nodes' | 'walls'>>

/**
 * Snapping targets of the Wall tool: room corners and room wall centre lines, the end points and
 * centre lines of the traces, and the nodes and centre lines of the stored walls (so a new wall
 * meets an existing wall on its node, or takes a node on its middle). The points of the chain are
 * added too, so a chain can close on its own start point exactly.
 */
export function snapTargets(doc: SnapSource, chain: Chain = []): SnapTargets {
  const vertices: Vec[] = []
  const edges: [Vec, Vec][] = []
  for (const r of doc.rooms) {
    const n = r.vertices.length
    r.vertices.forEach((v, i) => {
      vertices.push(v)
      edges.push([v, r.vertices[(i + 1) % n]])
    })
    // Hole corners are corners of the plan too (a shaft or a column).
    for (const h of r.holes) for (const v of h) vertices.push(v)
  }
  for (const t of doc.traces ?? []) {
    vertices.push(t.a, t.b)
    edges.push([t.a, t.b])
  }
  // The walls of a v2 document: their nodes and their centre lines.
  const nodes = new Map((doc.nodes ?? []).map((n) => [n.id, { x: n.x, y: n.y }]))
  for (const n of doc.nodes ?? []) vertices.push({ x: n.x, y: n.y })
  for (const w of doc.walls ?? []) {
    const a = nodes.get(w.a)
    const b = nodes.get(w.b)
    if (a && b) edges.push([a, b])
  }
  for (const p of chain) vertices.push(p)
  return { vertices, edges }
}

/** Wall type of the next segment; an unknown value falls back to partition. */
export const safeType = (type: string): WallType =>
  type === 'bearing' || type === 'exterior' ? type : 'partition'

/** Wall properties of the next segment: a positive thickness, else the typical one for the type. */
export function nextWallProps(thicknessCm: number, type: string): WallProps {
  const t = safeType(type)
  const cm = Number.isFinite(thicknessCm) && thicknessCm > 0 ? thicknessCm : DEFAULT_THICKNESS[t]
  return { type: t, thicknessCm: cm }
}
