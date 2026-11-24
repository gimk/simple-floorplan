// Traced walls (docs/walls-plan.md phase 6): pure helpers, cm. No React here.
//
// In a v1 document a trace is the centre line of a wall drawn with the Wall tool: a drawing aid
// that the Make room tool turns into a room. A v2 document has no traces: the Wall tool writes
// real walls (`addWallSegment` -> `addStandaloneWall`), and a load converts the traces it finds
// (src/model/v2/ensure.ts, `tracesToWalls`). The functions below keep working for both, so the
// tool and the tests do not need to know which kind of document they get.
import { dist, dot, norm, sub } from '../../model/geometry'
import { uid } from '../../model/store'
import type { FaceSegment } from '../../model/faces'
import type { PlanDoc, TraceWall, Vec, WallProps } from '../../model/types'
import { isV2Doc } from '../../model/v2/targets'
import { addStandaloneWall, removeWall } from '../../model/v2/write'
import { DEFAULT_THICKNESS } from './walls'

/** Traced walls of a doc (older documents have no field). */
export const tracesOf = (doc: Pick<PlanDoc, 'traces'>): TraceWall[] => doc.traces ?? []

/** Length of a trace's centre line, cm. */
export const traceLength = (t: TraceWall) => dist(t.a, t.b)

/** Add one traced wall to the doc (one undo step when used inside `update`). */
export function addTrace(
  doc: PlanDoc,
  a: Vec,
  b: Vec,
  props: WallProps,
  id = uid('trace'),
): PlanDoc {
  const trace: TraceWall = { id, a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y }, thicknessCm: props.thicknessCm, type: props.type }
  return { ...doc, traces: [...tracesOf(doc), trace] }
}

/**
 * Add one segment of the Wall tool: a STORED WALL in a v2 document (standalone: true, the thickness
 * and the type of the tool), a trace in a v1 document. One undo step per segment, as before.
 * `wallId` is the id of the segment (a stored wall id in a v2 document), or null when the segment
 * added nothing (a dot, or a wall that is already there).
 */
export function addWallSegment(
  doc: PlanDoc,
  a: Vec,
  b: Vec,
  props: WallProps,
  id = uid('trace'),
): { doc: PlanDoc; wallId: string | null } {
  if (isV2Doc(doc)) return addStandaloneWall(doc, a, b, props)
  return { doc: addTrace(doc, a, b, props, id), wallId: id }
}

/**
 * Remove the segment that the Wall tool added last (Backspace): the stored wall of a v2 document
 * (refused while a room uses it, so a room never opens), or the trace of a v1 document.
 */
export function removeWallSegment(doc: PlanDoc, id: string): PlanDoc {
  if ((doc.walls ?? []).some((w) => w.id === id)) return removeWall(doc, id).doc
  return deleteTrace(doc, id)
}

/** Remove one traced wall from the doc. */
export function deleteTrace(doc: PlanDoc, id: string): PlanDoc {
  const traces = tracesOf(doc)
  if (!traces.some((t) => t.id === id)) return doc
  return { ...doc, traces: traces.filter((t) => t.id !== id) }
}

/** Wall properties of the trace with this id, or null when it is gone. */
export function traceProps(doc: Pick<PlanDoc, 'traces'>, traceId: string): WallProps | null {
  const t = tracesOf(doc).find((x) => x.id === traceId)
  return t ? { type: t.type, thicknessCm: t.thicknessCm } : null
}

/**
 * Thickness and type of one wall of one room (default: partition, 10 cm). Only these two are
 * copied to a new room: a lock, a renovation state or an alignment belongs to the old room wall.
 */
export function roomWallProps(doc: Pick<PlanDoc, 'rooms'>, roomId: string, vertexId: string): WallProps | null {
  const room = doc.rooms.find((r) => r.id === roomId)
  if (!room || !room.vertices.some((v) => v.id === vertexId)) return null
  const w = room.walls[vertexId]
  return w ? { type: w.type, thicknessCm: w.thicknessCm } : { type: 'partition', thicknessCm: DEFAULT_THICKNESS.partition }
}

/** The document parts that the centre-line segments come from. */
export type SegmentSource = Pick<PlanDoc, 'rooms' | 'traces'> & Partial<Pick<PlanDoc, 'nodes' | 'walls' | 'schemaVersion'>>

/**
 * All centre-line segments of the plan, as `findEnclosingCycle` reads them:
 *   - v2 document: `wall:<wallId>` for each stored wall (the walls are the source, and a room wall
 *     is a face of a stored wall, so it is not a second segment);
 *   - v1 document: `trace:<id>` for a traced wall, `room:<roomId>:<vertexId>` for a room wall.
 */
export function docSegments(doc: SegmentSource): FaceSegment[] {
  const out: FaceSegment[] = []
  if (isV2Doc(doc)) {
    const nodes = new Map((doc.nodes ?? []).map((n) => [n.id, { x: n.x, y: n.y }]))
    for (const w of doc.walls ?? []) {
      const a = nodes.get(w.a)
      const b = nodes.get(w.b)
      if (!a || !b || dist(a, b) < 1) continue
      out.push({ id: `wall:${w.id}`, a, b })
    }
    return out
  }
  for (const t of tracesOf(doc)) out.push({ id: `trace:${t.id}`, a: t.a, b: t.b })
  for (const r of doc.rooms) {
    const n = r.vertices.length
    r.vertices.forEach((v, i) => {
      out.push({ id: `room:${r.id}:${v.id}`, a: { x: v.x, y: v.y }, b: r.vertices[(i + 1) % n] })
    })
  }
  return out
}

/**
 * Wall properties that a cycle edge takes: from the stored wall it lies on, else from the trace,
 * else from the room wall.
 */
export function propsOfSegment(doc: SegmentSource, segmentId: string): WallProps | null {
  if (segmentId.startsWith('wall:')) {
    const id = segmentId.slice('wall:'.length)
    const w = (doc.walls ?? []).find((x) => x.id === id)
    return w ? { type: w.type ?? 'partition', thicknessCm: w.thicknessCm ?? DEFAULT_THICKNESS.partition } : null
  }
  if (segmentId.startsWith('trace:')) return traceProps(doc, segmentId.slice('trace:'.length))
  if (segmentId.startsWith('room:')) {
    const rest = segmentId.slice('room:'.length)
    const cut = rest.lastIndexOf(':')
    if (cut <= 0) return null
    return roomWallProps(doc, rest.slice(0, cut), rest.slice(cut + 1))
  }
  return null
}

export type EdgeRef = { id?: string; a: Vec; b: Vec }

/** Distance from p to the line through o with unit direction d. */
const distToLine = (p: Vec, o: Vec, d: Vec) => Math.abs((p.x - o.x) * d.y - (p.y - o.y) * d.x)

/** Point of the trace at `u` cm from its start `a`. */
const pointAt = (t: TraceWall, u: number, d: Vec): Vec => ({ x: t.a.x + d.x * u, y: t.a.y + d.y * u })

/** Spans of a trace that an edge covers, in cm from the trace start. */
function coveredSpans(t: TraceWall, edges: EdgeRef[], tolCm: number, L: number, d: Vec): [number, number][] {
  const out: [number, number][] = []
  for (const e of edges) {
    // The edge must lie on the line of the trace: both of its ends close to that line.
    if (distToLine(e.a, t.a, d) > tolCm || distToLine(e.b, t.a, d) > tolCm) continue
    const u0 = dot(sub(e.a, t.a), d)
    const u1 = dot(sub(e.b, t.a), d)
    const lo = Math.max(0, Math.min(u0, u1))
    const hi = Math.min(L, Math.max(u0, u1))
    if (hi - lo > tolCm) out.push([lo, hi])
  }
  return out
}

/** Merge overlapping spans, in order. */
function mergeSpans(spans: [number, number][]): [number, number][] {
  const sorted = [...spans].sort((x, y) => x[0] - y[0])
  const out: [number, number][] = []
  for (const s of sorted) {
    const last = out[out.length - 1]
    if (last && s[0] <= last[1] + 1e-9) last[1] = Math.max(last[1], s[1])
    else out.push([s[0], s[1]])
  }
  return out
}

/**
 * Remove from the traces the parts that the given edges (the walls of a new room) now cover.
 * A trace that is only partly covered is cut into the pieces that stay; a fully covered trace is
 * removed, because that wall is a room wall now. The first piece keeps the trace id, the other
 * pieces get `-2`, `-3`... so a wall is never stored twice (docs/walls-plan.md phase 6).
 */
export function subtractCovered(traces: TraceWall[], edges: EdgeRef[], tolCm = 1): TraceWall[] {
  const out: TraceWall[] = []
  let changed = false
  for (const t of traces) {
    const L = dist(t.a, t.b)
    if (L < tolCm) { changed = true; continue } // a dot is not a wall
    const d = norm(sub(t.b, t.a))
    const covered = mergeSpans(coveredSpans(t, edges, tolCm, L, d))
    if (!covered.length) { out.push(t); continue }
    changed = true
    // The parts that stay, between the covered spans.
    const keep: [number, number][] = []
    let cursor = 0
    for (const [lo, hi] of covered) {
      if (lo - cursor > tolCm) keep.push([cursor, lo])
      cursor = Math.max(cursor, hi)
    }
    if (L - cursor > tolCm) keep.push([cursor, L])
    keep.forEach(([lo, hi], i) => {
      out.push({
        ...t,
        id: i === 0 ? t.id : `${t.id}-${i + 1}`,
        a: pointAt(t, lo, d),
        b: pointAt(t, hi, d),
      })
    })
  }
  // Same array when nothing was covered: no undo step, no snapshot.
  return changed ? out : traces
}
