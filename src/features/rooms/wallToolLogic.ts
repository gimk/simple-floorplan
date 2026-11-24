// Wall tool logic (docs/walls-plan.md phase 6). Pure helpers, cm. No React here.
//
// The Wall tool draws a CHAIN of centre lines. Each finished segment is stored at once - a stored
// wall in a v2 document (`traces.addWallSegment`), a trace in a v1 document - so every click is one
// undo step: a wrong segment costs one Ctrl+Z, not the whole chain. The chain only exists while the
// tool draws it (the last point is the current one).
import { add, cross, dist, fmtCm, mul, norm, sub } from '../../model/geometry'
import { uid } from '../../model/store'
import { addWallSegment } from './traces'
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

// ---------- typed length and angle (measurements plan, section 7) ----------

/**
 * End point of a segment from `from`, given a length in cm and a bearing in degrees (same
 * convention as `bearingDeg`: 0 = up, 90 = right). y points down, so up is -y.
 */
export function pointFromLengthAngle(from: Vec, lengthCm: number, angleDeg: number): Vec {
  const r = (angleDeg * Math.PI) / 180
  return { x: from.x + lengthCm * Math.sin(r), y: from.y - lengthCm * Math.cos(r) }
}

/**
 * End point of a TYPED segment: the angle the user typed when there is one, else the direction of
 * the pointer preview. Null when there is nothing to place (no length, no angle and no pointer,
 * or a length of 0).
 */
export function typedEnd(from: Vec, pointer: Vec | null, lengthCm: number | null, angleDeg: number | null): Vec | null {
  if (lengthCm == null || !Number.isFinite(lengthCm) || lengthCm <= SAME_POINT_CM) return null
  if (angleDeg != null && Number.isFinite(angleDeg)) return pointFromLengthAngle(from, lengthCm, angleDeg)
  if (!pointer || dist(from, pointer) < SAME_POINT_CM) return null
  return pointFromLengthAngle(from, lengthCm, bearingDeg(from, pointer))
}

/** The angle field text for the current preview direction: "45" or "45,5", "" with no pointer. */
export function angleFieldText(from: Vec | undefined, pointer: Vec | null): string {
  if (!from || !pointer || dist(from, pointer) < SAME_POINT_CM) return ''
  const d = Math.round(bearingDeg(from, pointer) * 10) / 10
  return String(d === 360 ? 0 : d).replace('.', ',')
}

// ---------- drawing reference (centre / side A / side B) ----------

/**
 * Drawing reference of the Wall tool: the clicked points are on this line of the wall.
 * 'centre' (today), 'A' (the left face of the drawing direction) or 'B' (the right face).
 */
export type DrawAlign = 'centre' | 'A' | 'B'

/** S cycles the reference: centre -> side A -> side B -> centre. */
export const nextAlign = (a: DrawAlign): DrawAlign => (a === 'centre' ? 'A' : a === 'A' ? 'B' : 'centre')

/** Letter drawn near the pointer: C (centre), A (side A), B (side B). */
export const alignBadge = (a: DrawAlign): 'C' | 'A' | 'B' => (a === 'centre' ? 'C' : a)

/**
 * Left normal of a direction on screen (y points down): the left hand of someone who walks along
 * the direction sees the screen left side of it. (dx, dy) -> (dy, -dx).
 */
export const leftNormal = (d: Vec): Vec => ({ x: d.y, y: -d.x })

/**
 * Offset of the stored CENTRE line from the clicked (face) line, cm, along the left normal of the
 * drawing direction. Side A is the left face: the centre line is then half a thickness to the
 * right of the clicked points, so the face runs through them. Side B is the other way, the centre
 * reference does not move.
 */
export function centreLineOffsetCm(a: DrawAlign, thicknessCm: number): number {
  const half = (Number.isFinite(thicknessCm) ? Math.abs(thicknessCm) : 0) / 2
  return a === 'A' ? -half : a === 'B' ? half : 0
}

/** The two ends of one segment moved by `k` cm along the left normal of the segment. */
export function offsetSegment(a: Vec, b: Vec, k: number): [Vec, Vec] {
  const n = leftNormal(norm(sub(b, a)))
  return [add(a, mul(n, k)), add(b, mul(n, k))]
}

/**
 * The centre line of a chain whose clicked points are on a face: every point moves by `k` cm along
 * the left normal of its segment, and an inner point becomes the MITRE - the crossing of the two
 * offset lines - so consecutive segments still join at the corner. Two segments in line (or an
 * exact fold back) and a zero-length segment keep the simple offset of their segment.
 */
export function offsetChain(chain: Chain, k: number): Chain {
  if (!chain.length || k === 0) return chain
  const dirs = chainSegments(chain).map(([a, b]) => norm(sub(b, a)))
  if (!dirs.length) return chain
  return chain.map((p, i) => {
    const dIn = i > 0 ? dirs[i - 1] : null
    const dOut = i < dirs.length ? dirs[i] : null
    const nIn = dIn ? leftNormal(dIn) : null
    const nOut = dOut ? leftNormal(dOut) : null
    if (!dIn || !nIn) return add(p, mul(nOut!, k))
    if (!dOut || !nOut) return add(p, mul(nIn, k))
    const a1 = add(p, mul(nIn, k))
    const a2 = add(p, mul(nOut, k))
    const cr = cross(dIn, dOut)
    // In line (or a zero-length segment): the two offset lines are the same line.
    if (Math.abs(cr) < 1e-3) return a2
    const w = sub(a2, a1)
    return add(a1, mul(dIn, cross(w, dOut) / cr))
  })
}

/**
 * Move the end of the segment that the Wall tool added last to the mitre point of the next corner
 * (same undo step as the new segment, so a chain of offset segments joins). The end nearest to
 * `near` moves. A stored wall whose node another wall or a room face uses is NOT touched: moving it
 * would move a room. A v1 trace moves its own end.
 */
export function moveSegmentEnd(doc: PlanDoc, id: string, to: Vec, near: Vec): PlanDoc {
  const trace = (doc.traces ?? []).find((t) => t.id === id)
  if (trace) {
    const end = dist(trace.a, near) <= dist(trace.b, near) ? 'a' : 'b'
    return { ...doc, traces: (doc.traces ?? []).map((t) => (t.id === id ? { ...t, [end]: { x: to.x, y: to.y } } : t)) }
  }
  const wall = (doc.walls ?? []).find((w) => w.id === id)
  const nodes = doc.nodes ?? []
  if (!wall) return doc
  const na = nodes.find((n) => n.id === wall.a)
  const nb = nodes.find((n) => n.id === wall.b)
  if (!na || !nb) return doc
  const pA = { x: na.x, y: na.y }
  const pB = { x: nb.x, y: nb.y }
  const node = dist(pA, near) <= dist(pB, near) ? na : nb
  // The node must belong to this wall alone (no other wall, no room face): a shared node is a
  // corner of the plan and moves only with the objects that use it.
  if ((doc.walls ?? []).some((w) => w.id !== id && (w.a === node.id || w.b === node.id))) return doc
  if (doc.rooms.some((r) => (r.cycle ?? []).some((f) => f.wallId === id))) return doc
  if (dist({ x: node.x, y: node.y }, to) < 0.01) return doc
  return { ...doc, nodes: nodes.map((n) => (n.id === node.id ? { ...n, x: to.x, y: to.y } : n)) }
}

/**
 * The segment that one click (or one typed length) adds to the chain. The clicked point `p` is on
 * the reference line of the tool: the chain is offset and mitred to the centre line of the wall
 * when the reference is a face, the end of the previous segment moves to the new corner, and the
 * segment is stored at once - ONE UNDO STEP for the caller. `wallId` is null when the segment added
 * nothing, and the chain is then unchanged too.
 */
export function placePoint(
  doc: PlanDoc,
  chain: Chain,
  lastId: string | null,
  p: Vec,
  props: WallProps,
  offsetCm: number,
  id = uid('trace'),
): { doc: PlanDoc; wallId: string | null; chain: Chain } {
  const last = chain[chain.length - 1]
  if (!last || dist(last, p) < SAME_POINT_CM) return { doc, wallId: null, chain }
  const centre = offsetChain([...chain, p], offsetCm)
  const a = centre[centre.length - 2]
  const b = centre[centre.length - 1]
  let draft = doc
  if (lastId && offsetCm !== 0) {
    // The stored end of the previous segment: its own simple offset (a short segment must not
    // give its start away).
    const prev = chain[chain.length - 2]
    const prevEnd = prev ? add(last, mul(leftNormal(norm(sub(last, prev))), offsetCm)) : last
    draft = moveSegmentEnd(draft, lastId, a, prevEnd)
  }
  const segment = addWallSegment(draft, a, b, props, id)
  if (segment.doc === draft && draft === doc) return { doc, wallId: null, chain }
  return { doc: segment.doc, wallId: segment.wallId, chain: addChainPoint(chain, p) }
}
