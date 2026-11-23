// Closed areas of a set of wall centre lines (docs/walls-plan.md, phase 6). Pure, cm, y down.
//
// Method. Each step is a small pure pass over the data:
//   1. Merge end points closer than tolCm into one vertex. STABLE RULE "first seen wins": the
//      vertex keeps the exact position of the first end point in input order. Points found later
//      (crossings) snap onto such a vertex when they are closer than tolCm.
//   2. Split every segment at its crossings with other segments and at end points that lie on it
//      (T junctions, within tolCm). Zero-length pieces are dropped. Two pieces between the same
//      two vertices are ONE edge that remembers every segment id on it and reports the first id in
//      input order (the id of the earliest segment in the array).
//   3. Build the planar graph of half-edges. At each vertex the outgoing edges are sorted by angle
//      (atan2, ascending).
//   4. Trace every face with the rule "next edge = the outgoing edge just BEFORE the back edge in
//      that angular order". This traces each bounded face with a positive shoelace area and the
//      outer face (and the two sides of a dangling edge) with a negative or zero area.
//   5. Clean each traced ring: a trace that goes out along a dangling edge and comes back is a
//      spike (two opposite half-edges one after the other) and both edges are removed. A corner
//      that only a split made (degree 2, straight angle, the same segment id on both sides) is
//      removed too. A corner between two different segment ids stays: the room needs it for the
//      per-wall thickness.
//
// The returned points follow the trace order, so `signedArea(points) > 0` (see geometry.ts: that
// is clockwise on screen, because y points down). segmentIds[i] is the id of the segment that
// holds the edge points[i] -> points[i+1].
import { pointInPolygon, signedArea } from './geometry'
import type { Vec } from './types'

/** One centre-line segment: a traced wall or a room wall. */
export type FaceSegment = { id: string; a: Vec; b: Vec }

export type EnclosingCycle = {
  /** Corners of the smallest closed area around the point, in order, no repeated first point. */
  points: Vec[]
  /** For each edge i (points[i] -> points[i+1]): the id of the segment it lies on. */
  segmentIds: string[]
}

/** A length below this is zero (cm). */
const ZERO = 1e-9
/** A point closer than this to a line is on it (cm). Used only to call an angle "straight". */
const STRAIGHT = 1e-6
/** An area below this is no area (cm²). */
const MIN_AREA = 1e-6

/** One edge of the planar graph. `id`/`seg` are the first segment on it (input order). */
type Edge = { a: number; b: number; id: string; seg: number }

/** One segment after the end points are merged. `splits` are the points that cut it. */
type Seg = { id: string; seg: number; va: number; vb: number; splits: { t: number; v: number }[] }

/** True when m is between a and b, in line with them. */
function straightBetween(a: Vec, m: Vec, b: Vec): boolean {
  const abx = b.x - a.x, aby = b.y - a.y
  const l = Math.hypot(abx, aby)
  if (l <= ZERO) return false
  const off = Math.abs((m.x - a.x) * aby - (m.y - a.y) * abx) / l
  const forward = (m.x - a.x) * (b.x - m.x) + (m.y - a.y) * (b.y - m.y) > 0
  return off <= STRAIGHT && forward
}

/**
 * The smallest closed area around `p` formed by the segments, or null when `p` is not inside one.
 * Segments are split at their crossings and at end points that lie on other segments (within
 * `tolCm`); end points closer than `tolCm` are one point.
 */
export function findEnclosingCycle(segments: FaceSegment[], p: Vec, tolCm = 1): EnclosingCycle | null {
  const tol = Math.max(tolCm, 1e-6)

  // ---- 1. vertex store: a grid of tolCm cells finds the nearest vertex in O(1) ----------------
  const verts: Vec[] = []
  const grid = new Map<string, number[]>()
  const key = (x: number, y: number) => x + ':' + y
  /** The vertex within tol of q, or a new vertex at q. */
  const snap = (q: Vec): number => {
    const cx = Math.floor(q.x / tol), cy = Math.floor(q.y / tol)
    let best = -1, bestD = tol
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const list = grid.get(key(cx + dx, cy + dy))
        if (!list) continue
        for (const vi of list) {
          const d = Math.hypot(verts[vi].x - q.x, verts[vi].y - q.y)
          if (d > bestD) continue
          // Closer wins. Same distance: the lowest index wins, so the result does not depend on
          // the order of the grid cells.
          if (best < 0 || d < bestD - 1e-12 || vi < best) { best = vi; bestD = d }
        }
      }
    }
    if (best >= 0) return best
    const vi = verts.length
    verts.push({ x: q.x, y: q.y })
    const k = key(cx, cy)
    const list = grid.get(k)
    if (list) list.push(vi)
    else grid.set(k, [vi])
    return vi
  }

  // End points closer than tolCm are one vertex (first seen wins: snap keeps the first position).
  const segs: Seg[] = []
  segments.forEach((s, k) => {
    if (Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y) <= ZERO) return
    const va = snap(s.a), vb = snap(s.b)
    if (va === vb) return
    segs.push({ id: s.id, seg: k, va, vb, splits: [] })
  })
  if (segs.length === 0) return null

  // ---- 2a. split at vertices that lie on a segment (T junctions) ------------------------------
  for (const s of segs) {
    const A = verts[s.va], B = verts[s.vb]
    const abx = B.x - A.x, aby = B.y - A.y
    const l2 = abx * abx + aby * aby
    for (let v = 0; v < verts.length; v++) {
      if (v === s.va || v === s.vb) continue
      const P = verts[v]
      const t = ((P.x - A.x) * abx + (P.y - A.y) * aby) / l2
      if (t <= 0 || t >= 1) continue
      const off = Math.abs((P.x - A.x) * aby - (P.y - A.y) * abx) / Math.sqrt(l2)
      if (off > tol) continue
      s.splits.push({ t, v })
    }
  }

  // ---- 2b. split at crossings of two segments -------------------------------------------------
  const addSplit = (s: Seg, v: number) => {
    if (v === s.va || v === s.vb) return
    if (s.splits.some((sp) => sp.v === v)) return
    const A = verts[s.va], B = verts[s.vb]
    const rx = B.x - A.x, ry = B.y - A.y
    const t = ((verts[v].x - A.x) * rx + (verts[v].y - A.y) * ry) / (rx * rx + ry * ry)
    if (t <= 0 || t >= 1) return
    s.splits.push({ t, v })
  }
  const ENDS = 1e-9 // a crossing that near an end point is done by 2a (the end point is there)
  for (let i = 0; i < segs.length; i++) {
    const s1 = segs[i]
    const A = verts[s1.va]
    const B = verts[s1.vb]
    const rx = B.x - A.x, ry = B.y - A.y
    for (let j = i + 1; j < segs.length; j++) {
      const s2 = segs[j]
      const C = verts[s2.va], D = verts[s2.vb]
      const sx = D.x - C.x, sy = D.y - C.y
      const den = rx * sy - ry * sx
      if (Math.abs(den) < 1e-12) continue // parallel: a collinear overlap is done by 2a
      const qx = C.x - A.x, qy = C.y - A.y
      const t = (qx * sy - qy * sx) / den
      const u = (qx * ry - qy * rx) / den
      if (t <= ENDS || t >= 1 - ENDS || u <= ENDS || u >= 1 - ENDS) continue
      const v = snap({ x: A.x + rx * t, y: A.y + ry * t })
      addSplit(s1, v)
      addSplit(s2, v)
    }
  }

  // ---- 2c. pieces. Two pieces between the same two vertices are one edge ----------------------
  const edgeMap = new Map<string, Edge>()
  const ekey = (a: number, b: number) => (a < b ? a + '_' + b : b + '_' + a)
  for (const s of segs) {
    s.splits.sort((x, y) => x.t - y.t || x.v - y.v)
    const chain: number[] = [s.va]
    for (const sp of s.splits) if (chain[chain.length - 1] !== sp.v) chain.push(sp.v)
    if (chain[chain.length - 1] !== s.vb) chain.push(s.vb)
    for (let i = 0; i + 1 < chain.length; i++) {
      const a = chain[i], b = chain[i + 1]
      if (a === b) continue
      if (Math.hypot(verts[a].x - verts[b].x, verts[a].y - verts[b].y) <= ZERO) continue
      const k = ekey(a, b)
      const found = edgeMap.get(k)
      if (!found) edgeMap.set(k, { a, b, id: s.id, seg: s.seg })
      else if (s.seg < found.seg) { found.seg = s.seg; found.id = s.id }
    }
  }
  const edges = [...edgeMap.values()]

  // ---- 3. half-edges, outgoing edges sorted by angle -------------------------------------------
  const heCount = edges.length * 2
  const heFrom = new Int32Array(heCount)
  const heTo = new Int32Array(heCount)
  const heEdge = new Int32Array(heCount)
  const heAngle = new Float64Array(heCount)
  edges.forEach((e, i) => {
    for (const side of [0, 1]) {
      const h = 2 * i + side
      heFrom[h] = side === 0 ? e.a : e.b
      heTo[h] = side === 0 ? e.b : e.a
      heEdge[h] = i
      heAngle[h] = Math.atan2(verts[heTo[h]].y - verts[heFrom[h]].y, verts[heTo[h]].x - verts[heFrom[h]].x)
    }
  })
  const out: number[][] = verts.map(() => [])
  for (let h = 0; h < heCount; h++) out[heFrom[h]].push(h)
  const pos = new Int32Array(heCount)
  for (const list of out) {
    list.sort((h1, h2) => heAngle[h1] - heAngle[h2] || h1 - h2)
    list.forEach((h, i) => { pos[h] = i })
  }
  /** Next half-edge of the face: the one just before the back edge in the angular order. */
  const nextEdge = (h: number): number => {
    const list = out[heTo[h]]
    return list[(pos[h ^ 1] - 1 + list.length) % list.length]
  }

  // ---- 4. trace all faces, clean them, keep the bounded ones -----------------------------------
  const seen = new Uint8Array(heCount)
  const faces: { points: Vec[]; ids: string[]; area: number }[] = []
  for (let h0 = 0; h0 < heCount; h0++) {
    if (seen[h0]) continue
    const cycle: number[] = []
    let h = h0
    do {
      seen[h] = 1
      cycle.push(h)
      h = nextEdge(h)
    } while (h !== h0 && cycle.length <= heCount)
    const cleaned = buildRing(cycle, verts, heFrom, heEdge, edges, out)
    if (cleaned && cleaned.points.length >= 3) {
      const area = signedArea(cleaned.points)
      if (area > MIN_AREA) faces.push({ points: cleaned.points, ids: cleaned.ids, area })
    }
  }

  // ---- 5. the smallest bounded face around p --------------------------------------------------
  let best: EnclosingCycle | null = null
  let bestArea = Infinity
  for (const f of faces) {
    if (f.area >= bestArea) continue
    if (!pointInPolygon(p, f.points)) continue
    bestArea = f.area
    best = { points: f.points, segmentIds: f.ids }
  }
  return best
}

/**
 * Half-edge cycle -> ring of points and segment ids. Removes spikes (an edge and its back edge one
 * after the other: a dangling wall walked in and out) and collinear corners that only a split made.
 */
function buildRing(
  cycle: number[],
  verts: Vec[],
  heFrom: Int32Array,
  heEdge: Int32Array,
  edges: Edge[],
  out: number[][],
): { points: Vec[]; ids: string[] } | null {
  // Spike removal: two opposite half-edges in a row cancel out. Repeat, because a shorter ring can
  // show a new spike.
  let c = cycle.slice()
  let changed = true
  while (changed && c.length > 1) {
    changed = false
    for (let i = 0; i < c.length; i++) {
      const j = (i + 1) % c.length
      if (c[j] !== (c[i] ^ 1)) continue
      const hi = Math.max(i, j), lo = Math.min(i, j)
      c.splice(hi, 1)
      c.splice(lo, 1)
      changed = true
      break
    }
  }
  if (c.length < 3) return null

  const points: Vec[] = []
  const ids: string[] = []
  const vids: number[] = []
  for (const h of c) {
    points.push(verts[heFrom[h]])
    ids.push(edges[heEdge[h]].id)
    vids.push(heFrom[h])
  }

  // Collinear corner removal: degree 2 in the graph, straight angle, the same segment id on both
  // sides. A corner between two different segment ids stays (per-wall thickness needs it).
  let removed = true
  while (removed && points.length > 3) {
    removed = false
    for (let i = 0; i < points.length; i++) {
      const prev = (i - 1 + points.length) % points.length
      const next = (i + 1) % points.length
      if (out[vids[i]].length !== 2) continue
      if (ids[prev] !== ids[i]) continue
      if (!straightBetween(points[prev], points[i], points[next])) continue
      points.splice(i, 1)
      ids.splice(i, 1)
      vids.splice(i, 1)
      removed = true
      break
    }
  }
  return { points, ids }
}
