// Outside dimension chains around the plan (docs/measurements-plan.md section 3). Pure: no store,
// no side effect. Units are cm, y points down.
//
// The outside of the plan is made of the OUTSIDE faces of the stored walls: the spans of a wall
// side that no room covers (see wallSides.ts, `storedWallView`). Those spans are measured on the
// OUTER FACE line of the wall: the centre line moved half a thickness towards the outside.
//
// Spans that are in line (same direction within 0.5 degree, same outer face line within 1 cm) and
// that touch end to end make one straight RUN (a facade of the plan). A run gives two dimension
// rows on the plan:
//   row 1 = the CHAIN: one segment per span, cut at the wall ends and at the T junctions where
//           another wall of the graph meets the wall (the same spans as in the drawing);
//   row 2 = the OVERALL length of the run.
// The ends of a run are moved to the corner: at an outside (convex) corner by half the thickness
// of the wall that continues the run; at an inside (concave) corner back to the outer face of the
// wall it meets (so no dimension goes into that wall), also when that wall passes through the node, so a chain segment measures from outside corner to outside corner, like the
// facade value 'W12-E'. A chain point closer to the previous one than the thickness of the wall is
// a sliver of that join, not a span: it is merged, so the chain always adds up to the overall.
//
// Only the real facade of the building is measured. A face that looks into a GAP between rooms (a
// shaft, a duct, the hatched space between two rooms, see gaps.ts) is not a facade: its span is
// dropped. Three test points on the span (quarters and middle) are moved 3 cm along the span
// normal, and the span goes when at least two of them fall inside the gaps. When gapAreas fails,
// every span stays.
import type { MultiPolygon, Pair, Polygon } from 'polygon-clipping'
import { dist } from '../../../model/geometry'
import type { PlanDoc, Room, StoredNode, StoredWall, Vec } from '../../../model/types'
import { deriveWallFaces, storedWallProps } from '../../../model/v2/materialize'
import { outsideFaceSide, wallValueLabel } from '../../../model/wallValues'
import { dimLine, type DimLine } from '../dims/dimLine'
import { gapAreas } from '../gaps'

/** Two spans are in line when their directions differ by less than this (0.5 degree). */
const PARALLEL_SIN = Math.sin((0.5 * Math.PI) / 180)
/** Points this close (cm) are the same point; two lines this close are the same line. */
const TOL_CM = 1
/** Longest move of a run end to an outside corner (cm): keeps a bad join from stretching a row. */
const MAX_EXTEND_CM = 30
/** Distance (cm) a test point of a span moves along its normal to look for a gap in front of it. */
const GAP_PROBE_CM = 3

const SIDES: readonly ('L' | 'R')[] = ['L', 'R']

export type OutsideSpanDoc = Pick<PlanDoc, 'rooms' | 'nodes' | 'walls' | 'measurements'>

/** One outside face span of one side of one stored wall, on its outer face line. */
export type OutsideSpan = {
  wallId: string
  side: 'L' | 'R'
  /** Node of the wall at the start of the span, and at its end. */
  fromNode: string
  toNode: string
  /** Start and end of the span on the outer face line, cm. */
  a: Vec
  b: Vec
  /** Unit direction a -> b of the span. */
  dir: Vec
  /** Unit normal of the wall on the outside of this side (away from the wall). */
  normal: Vec
  lengthCm: number
  /** Thickness of the wall of the span, cm (a chain point closer than this is a sliver). */
  thicknessCm: number
  /** Facade value label of the span ('W12-E') when the WHOLE side of the wall is outside. */
  label: string | null
  /** Value measured on that facade, cm, or null. */
  measuredCm: number | null
  /** Points on the span where another wall of the graph meets the wall (T junction). */
  cuts: Vec[]
}

/** One segment of a chain row: an outside span, or a part of it between two T junctions. */
export type OutsideDimSegment = {
  a: Vec
  b: Vec
  lengthCm: number
  /** 'W12-E' when this segment is one whole outside side of a wall, else null. */
  label: string | null
  /** Value measured on that facade, cm, or null. */
  measuredCm: number | null
}

/** A straight run of outside faces: one chain row (segments) and one overall row. */
export type OutsideDimRun = {
  /** Stable key of the run: '<wallId>:<side>' of its first span. */
  key: string
  /** First and last point of the run on the outer face line (outside corners when there is one). */
  a: Vec
  b: Vec
  /** Unit direction a -> b. The dimension text turns with it. */
  dir: Vec
  /** Unit normal of the run, away from the building. The rows are drawn on that side. */
  normal: Vec
  /** Chain points, in order: the run ends and the points where the span changes. */
  points: Vec[]
  /** One segment between two chain points. */
  segments: OutsideDimSegment[]
  /** Length of the whole run, cm. */
  overallCm: number
}

const unit = (v: Vec): Vec => {
  const len = Math.hypot(v.x, v.y)
  return len < 1e-9 ? { x: 0, y: 0 } : { x: v.x / len, y: v.y / len }
}

const nodeMap = (nodes: StoredNode[] | undefined) => new Map((nodes ?? []).map((n) => [n.id, { x: n.x, y: n.y }]))

/** Even-odd ray cast (a ray to +x) against one closed ring of [x, y] pairs. */
function ringHasPoint(rg: Pair[], p: Vec): boolean {
  let inside = false
  for (let i = 0, j = rg.length - 1; i < rg.length; j = i++) {
    const [xi, yi] = rg[i]
    const [xj, yj] = rg[j]
    if (yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** True when `p` is inside one polygon [outer, ...holes]; a point in a hole is outside. */
function polygonHasPoint(poly: Polygon, p: Vec): boolean {
  if (!ringHasPoint(poly[0], p)) return false
  return !poly.slice(1).some((hole) => ringHasPoint(hole, p))
}

/** True when `p` is inside the multipolygon (one of its polygons holds it). */
function multiPolygonHasPoint(m: MultiPolygon, p: Vec): boolean {
  return m.some((poly) => polygonHasPoint(poly, p))
}

/**
 * The spans that do not look into a gap between rooms (a shaft, a duct, the hatched space between
 * two rooms). Three test points on the span (quarters and middle) are moved GAP_PROBE_CM along the
 * span normal; when at least two of them fall inside the gaps, the face is not a facade and its
 * span goes. A gap failure keeps every span.
 */
function withoutGapFaces(spans: OutsideSpan[], rooms: Room[]): OutsideSpan[] {
  let gaps: MultiPolygon
  try {
    gaps = gapAreas(rooms)
  } catch {
    return spans
  }
  if (!gaps.length) return spans
  return spans.filter((s) => {
    let hits = 0
    for (const t of [0.25, 0.5, 0.75]) {
      const p = {
        x: s.a.x + (s.b.x - s.a.x) * t + s.normal.x * GAP_PROBE_CM,
        y: s.a.y + (s.b.y - s.a.y) * t + s.normal.y * GAP_PROBE_CM,
      }
      if (multiPolygonHasPoint(gaps, p)) hits++
    }
    return hits < 2
  })
}

/**
 * Outside face spans of the document, on their outer face lines.
 * A side that a room covers on its whole length has no span; a side covered only in part gives the
 * spans that no room covers (a recess, the free side of a wall). A span that looks into a gap
 * between rooms is dropped: only the facade of the building is measured.
 */
export function outsideSpans(doc: OutsideSpanDoc): OutsideSpan[] {
  const walls = deriveWallFaces(doc)
  const nodes = doc.nodes ?? []
  const at = nodeMap(nodes)
  const out: OutsideSpan[] = []
  for (const wall of walls) {
    const pa = at.get(wall.a)
    const pb = at.get(wall.b)
    if (!pa || !pb) continue
    const len = dist(pa, pb)
    if (len < TOL_CM) continue
    // A wall that no room uses (drawn with the Wall tool) has no inside: it is not a facade.
    if (!wall.faces.some((f) => f.roomId !== undefined)) continue
    const d = { x: (pb.x - pa.x) / len, y: (pb.y - pa.y) / len }
    const left = { x: -d.y, y: d.x }
    const half = storedWallProps(wall).thicknessCm / 2
    // T junctions: nodes of the graph on the centre line, between the two ends of the wall.
    const cuts = nodes
      .filter((n) => n.id !== wall.a && n.id !== wall.b)
      .map((n) => ({
        along: (n.x - pa.x) * d.x + (n.y - pa.y) * d.y,
        off: (n.x - pa.x) * left.x + (n.y - pa.y) * left.y,
      }))
      .filter((c) => Math.abs(c.off) <= TOL_CM && c.along > TOL_CM && c.along < len - TOL_CM)
      .map((c) => c.along)
    const facade = outsideFaceSide(wall, len)
    for (const side of SIDES) {
      const mine = wall.faces.filter((f) => f.side === side && f.roomId === undefined)
      if (!mine.length) continue
      const sign = side === 'L' ? 1 : -1
      const normal = { x: left.x * sign, y: left.y * sign }
      const label = facade === side ? wallValueLabel(wall.id, 'outside') : null
      const measuredCm = label ? doc.measurements[label]?.actualCm ?? null : null
      // A point of the outer face line, at a distance `along` from node a of the wall.
      const onFace = (along: number): Vec => ({
        x: pa.x + d.x * along + normal.x * half,
        y: pa.y + d.y * along + normal.y * half,
      })
      for (const f of mine) {
        const from = Math.min(f.from, f.to)
        const to = Math.max(f.from, f.to)
        if (to - from < TOL_CM) continue
        out.push({
          wallId: wall.id,
          side,
          fromNode: wall.a,
          toNode: wall.b,
          a: onFace(from),
          b: onFace(to),
          dir: d,
          normal,
          lengthCm: to - from,
          thicknessCm: half * 2,
          label,
          measuredCm,
          cuts: cuts.filter((c) => c > from + TOL_CM && c < to - TOL_CM).map(onFace),
        })
      }
    }
  }
  return withoutGapFaces(out, doc.rooms)
}

/** Sides of `w` that are outside (no room) and that reach `node`. */
function outsideSidesAtNode(w: StoredWall, node: string, len: number): ('L' | 'R')[] {
  const atStart = w.a === node
  return SIDES.filter((side) =>
    w.faces.some((f) => {
      if (f.side !== side || f.roomId !== undefined) return false
      return atStart ? Math.min(f.from, f.to) <= TOL_CM : Math.max(f.from, f.to) >= len - TOL_CM
    }),
  )
}

/**
 * Signed distance (cm) along the run direction to move a run end to reach the outside corner: the
 * crossing of the outer face line of the run with the outer face line of a wall that continues the
 * outside at that node. A wall in line with the run gives no corner (it is the same run), and a
 * wall that is outside on both sides gives no clear side, so both give 0. 0 also when the crossing
 * is further than MAX_EXTEND_CM (a shallow corner) or when no wall continues the outside there.
 */
function cornerShiftCm(
  node: string, runDir: Vec, runNormal: Vec, p: Vec, walls: StoredWall[], nodes: Map<string, Vec>,
  bodySign: 1 | -1,
): number {
  let best = 0
  // Shift given by a face that runs through the node: it wins over the end faces of other walls.
  let through: number | null = null
  const at = nodes.get(node)
  for (const w of walls) {
    const pa = nodes.get(w.a)
    const pb = nodes.get(w.b)
    if (!pa || !pb) continue
    const len = dist(pa, pb)
    if (len < TOL_CM) continue
    const d = { x: (pb.x - pa.x) / len, y: (pb.y - pa.y) / len }
    const den = runDir.x * d.y - runDir.y * d.x
    if (Math.abs(den) <= PARALLEL_SIN) continue
    let sides: ('L' | 'R')[]
    let isThrough = false
    if (w.a === node || w.b === node) {
      sides = outsideSidesAtNode(w, node, len)
      if (sides.length !== 1) continue
    } else {
      // A wall that passes THROUGH the node (the run meets it at a T junction: an inside corner).
      // Its outside face that stops at the node and leaves it towards the outside of the run is
      // the face that continues the outside round that corner.
      if (!at) continue
      isThrough = true
      const along = (at.x - pa.x) * d.x + (at.y - pa.y) * d.y
      const off = (at.x - pa.x) * -d.y + (at.y - pa.y) * d.x
      if (Math.abs(off) > TOL_CM || along <= TOL_CM || along >= len - TOL_CM) continue
      sides = SIDES.filter((side) =>
        w.faces.some((f) => {
          if (f.side !== side || f.roomId !== undefined) return false
          const lo = Math.min(f.from, f.to)
          const hi = Math.max(f.from, f.to)
          const startsHere = Math.abs(lo - along) <= TOL_CM
          const endsHere = Math.abs(hi - along) <= TOL_CM
          if (!startsHere && !endsHere) {
            // A face that runs THROUGH the node (a T junction where another wall also ends, round
            // 2 finding: W14 at the node of W5 and W4 in the demo): the face line goes on on both
            // sides, so it is the outside face of the corner when it looks towards the body of
            // the run. `bodySign` is +1 at the start of the run and -1 at its end.
            if (!(lo < along - TOL_CM && hi > along + TOL_CM)) return false
            const sideSign = side === 'L' ? 1 : -1
            const nx = -d.y * sideSign
            const ny = d.x * sideSign
            return (nx * runDir.x + ny * runDir.y) * bodySign > 0.5
          }
          if (startsHere === endsHere) return false
          const away = startsHere ? 1 : -1
          return (d.x * runNormal.x + d.y * runNormal.y) * away > 0.5
        }),
      )
      if (sides.length !== 1) continue
    }
    // A point of the outer face of that wall, at the node: the corner is on this line.
    const sign = sides[0] === 'L' ? 1 : -1
    const half = storedWallProps(w).thicknessCm / 2
    const q = { x: pa.x - d.y * half * sign, y: pa.y + d.x * half * sign }
    const s = ((q.x - p.x) * d.y - (q.y - p.y) * d.x) / den
    if (Math.abs(s) > MAX_EXTEND_CM) continue
    if (isThrough && wholeThrough(w, node, nodes, d)) {
      if (through === null || Math.abs(s) > Math.abs(through)) through = s
      continue
    }
    if (Math.abs(s) <= Math.abs(best)) continue
    best = s
  }
  return through ?? best
}

/** True when a face of the wall runs through the node (not only stops at it). */
function wholeThrough(w: StoredWall, node: string, nodes: Map<string, Vec>, d: Vec): boolean {
  const at = nodes.get(node)
  const pa = nodes.get(w.a)
  if (!at || !pa) return false
  const along = (at.x - pa.x) * d.x + (at.y - pa.y) * d.y
  return w.faces.some((f) => f.roomId === undefined && Math.min(f.from, f.to) < along - TOL_CM && Math.max(f.from, f.to) > along + TOL_CM)
}

/** Two spans that make one straight run: same direction, same outer face line, touching. */
function sameRun(s: OutsideSpan, t: OutsideSpan): boolean {
  if (Math.abs(s.dir.x * t.dir.y - s.dir.y * t.dir.x) > PARALLEL_SIN) return false
  if (s.normal.x * t.normal.x + s.normal.y * t.normal.y < 1 - 1e-3) return false
  const offLine = (p: Vec) => Math.abs((p.x - s.a.x) * s.normal.x + (p.y - s.a.y) * s.normal.y)
  if (offLine(t.a) > TOL_CM || offLine(t.b) > TOL_CM) return false
  return (
    dist(s.a, t.a) <= TOL_CM || dist(s.a, t.b) <= TOL_CM || dist(s.b, t.a) <= TOL_CM || dist(s.b, t.b) <= TOL_CM
  )
}

/** Groups of spans that make one straight run (each group in the order of `spans`). */
export function groupRuns(spans: OutsideSpan[]): OutsideSpan[][] {
  const parent = spans.map((_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  for (let i = 0; i < spans.length; i++) {
    for (let j = i + 1; j < spans.length; j++) {
      if (!sameRun(spans[i], spans[j])) continue
      const ri = find(i)
      const rj = find(j)
      if (ri !== rj) parent[rj] = ri
    }
  }
  const groups = new Map<number, OutsideSpan[]>()
  spans.forEach((s, i) => {
    const r = find(i)
    const g = groups.get(r)
    if (g) g.push(s)
    else groups.set(r, [s])
  })
  return [...groups.values()]
}

/** The span of a group that holds a point of the run (the middle of a segment). */
function spanAt(spans: OutsideSpan[], p: Vec): OutsideSpan | null {
  for (const s of spans) {
    const along = (p.x - s.a.x) * s.dir.x + (p.y - s.a.y) * s.dir.y
    const off = Math.abs((p.x - s.a.x) * s.normal.x + (p.y - s.a.y) * s.normal.y)
    if (along >= -TOL_CM && along <= s.lengthCm + TOL_CM && off <= TOL_CM) return s
  }
  return null
}

const samePoint = (p: Vec, q: Vec) => dist(p, q) <= TOL_CM

/**
 * The node at a run end: the node that lies on the centre line under the end point. A span that
 * stops at a T junction has its end at a node that is not an end of its wall, so the nearest node
 * is taken first; the end node of the wall is the fallback.
 */
function endNodeOf(span: OutsideSpan, p: Vec, nodes: Map<string, Vec>): string {
  const half = span.thicknessCm / 2
  const c = { x: p.x - span.normal.x * half, y: p.y - span.normal.y * half }
  let best: string | null = null
  let bestD = TOL_CM
  for (const [id, n] of nodes) {
    const d = dist(n, c)
    if (d <= bestD) {
      best = id
      bestD = d
    }
  }
  if (best) return best
  return samePoint(span.a, p) ? span.fromNode : span.toNode
}

/** One straight run of spans: chain points, segments (with their facade value) and overall length. */
function buildRun(spans: OutsideSpan[], walls: StoredWall[], nodes: Map<string, Vec>): OutsideDimRun {
  const dir0 = spans[0].dir
  const along = (p: Vec) => p.x * dir0.x + p.y * dir0.y
  // Chain points: both ends of every span, and the T junctions that cut a span.
  const found = spans.flatMap((s) => [s.a, s.b, ...s.cuts]).sort((p, q) => along(p) - along(q))
  const points: Vec[] = []
  for (const p of found) {
    const last = points[points.length - 1]
    if (!last || Math.abs(along(p) - along(last)) > TOL_CM) points.push(p)
  }
  // The ends of the run go to the outside corner, when a wall continues the outside there.
  const lastAt = points.length - 1
  const runDir = unit({ x: points[lastAt].x - points[0].x, y: points[lastAt].y - points[0].y })
  const firstSpan = spans.find((s) => samePoint(s.a, points[0]) || samePoint(s.b, points[0]))
  const lastSpan = spans.find((s) => samePoint(s.a, points[lastAt]) || samePoint(s.b, points[lastAt]))
  if (firstSpan && lastSpan && runDir.x * runDir.x + runDir.y * runDir.y > 0) {
    // A chain point that sits closer to the run end than the wall thickness is a sliver of the
    // corner join (round 2 finding: W14 starts 7 cm above the node where W5 and W4 meet it). The
    // corner is at that point, not at the end of the wall, so the shift is taken from there.
    const sliver = Math.max(...spans.map((sp) => sp.thicknessCm))
    const startIdx = points.length > 2 && dist(points[0], points[1]) <= sliver ? 1 : 0
    const endIdx = points.length > 2 && dist(points[lastAt], points[lastAt - 1]) <= sliver ? lastAt - 1 : lastAt
    const startNode = endNodeOf(firstSpan, points[startIdx], nodes)
    const endNode = endNodeOf(lastSpan, points[endIdx], nodes)
    const startShift = cornerShiftCm(startNode, runDir, spans[0].normal, points[startIdx], walls, nodes, 1)
    const endShift = cornerShiftCm(endNode, runDir, spans[0].normal, points[endIdx], walls, nodes, -1)
    // A shift must not pass the next chain point: that would turn a segment around.
    const next = points[startIdx + 1]
    const before = points[endIdx - 1]
    const startRoom = next ? dist(points[startIdx], next) - TOL_CM : 0
    const endRoom = before ? dist(points[endIdx], before) - TOL_CM : 0
    const s0 = Math.abs(startShift) < startRoom ? startShift : 0
    const s1 = Math.abs(endShift) < endRoom ? endShift : 0
    const origin = points[startIdx]
    const last = points[endIdx]
    points[0] = startIdx ? { x: origin.x + runDir.x * s0, y: origin.y + runDir.y * s0 } : { x: points[0].x + runDir.x * s0, y: points[0].y + runDir.y * s0 }
    points[lastAt] = endIdx !== lastAt ? { x: last.x + runDir.x * s1, y: last.y + runDir.y * s1 } : { x: points[lastAt].x + runDir.x * s1, y: points[lastAt].y + runDir.y * s1 }
  }
  // A chain point closer to the previous one than the thickness of the wall is not a span of the
  // facade: it is a sliver of the corner join (two walls that meet a few cm from the corner, round
  // 1 finding R1-6: W14:L showed 7 + 214 while the run is 221). The sliver is merged into its
  // neighbour, so the chain always has the same two ends as the overall row.
  const sliverCm = Math.max(...spans.map((s) => s.thicknessCm))
  const chain: Vec[] = [points[0]]
  for (let i = 1; i < lastAt; i++) {
    if (dist(points[i], chain[chain.length - 1]) > sliverCm) chain.push(points[i])
  }
  chain.push(points[lastAt])
  // The span that holds the middle of each chain segment.
  const middleOf = (i: number): OutsideSpan | null =>
    spanAt(spans, { x: (chain[i].x + chain[i + 1].x) / 2, y: (chain[i].y + chain[i + 1].y) / 2 })
  const segmentSpans = chain.slice(1).map((_, i) => middleOf(i))
  const segments: OutsideDimSegment[] = segmentSpans.map((span, i) => {
    const a = chain[i]
    const b = chain[i + 1]
    // A facade value names the WHOLE outside side of a wall: a side that the chain cuts in two (a T
    // junction) or that the run covers with several segments must not show it on a shorter segment.
    const whole = span !== null && segmentSpans.indexOf(span) === segmentSpans.lastIndexOf(span)
    return {
      a,
      b,
      lengthCm: dist(a, b),
      label: whole && span ? span.label : null,
      measuredCm: whole && span ? span.measuredCm : null,
    }
  })
  return {
    key: `${spans[0].wallId}:${spans[0].side}`,
    a: chain[0],
    b: chain[chain.length - 1],
    dir: runDir,
    normal: spans[0].normal,
    points: chain,
    segments,
    overallCm: dist(chain[0], chain[chain.length - 1]),
  }
}

/** The outside dimension runs of a document: one chain row and one overall row for each run. */
export function outsideDims(doc: OutsideSpanDoc): OutsideDimRun[] {
  const spans = outsideSpans(doc)
  if (!spans.length) return []
  const walls = deriveWallFaces(doc)
  const nodes = nodeMap(doc.nodes)
  return groupRuns(spans).map((group) => buildRun(group, walls, nodes))
}

/**
 * Screen sizes of the outside rows, in ONE place: the plan layer (OutsideDimsLayer.tsx), the badge
 * mask (dims/outsideTextBoxes.ts) and the export (export/svgDims.ts) all read them.
 */
export const OUTSIDE_ROWS_PX = { chain: 28, overall: 52 }
/** Start of the extension lines off the outer face, screen px. */
export const OUTSIDE_EXT_GAP_PX = 4

/** One row of an outside run: the face it measures, its normal and the distance of the row. */
export type OutsideRowInput = {
  start: Vec
  end: Vec
  /** Unit normal of the run, away from the wall: the side the text goes. */
  normal: Vec
  /** Distance of the row line from the outer face line, cm (from OUTSIDE_ROWS_PX). */
  offsetCm: number
  /** Screen px per cm. */
  zoom: number
  text: string
  /** End the text goes past when it does not fit between the ticks. */
  outsideEnd: 'start' | 'end'
}

/**
 * The dimension line of one outside row, with its text. ONE rule for the plan layer, the badge
 * mask (dims/outsideTextBoxes.ts) and the export (export/svgDims.ts).
 *
 * A text that does not fit between the ticks of its segment goes past the end of its line (round 1
 * suggestion 4: never on a tick, never on the text of the neighbouring segment), but it keeps the
 * STANDARD distance from the row line, like every other label of the plan. It used to go one step
 * further out (a gap of 6 px more): on a short row that put it between two rows, and its end
 * touched the corner of the dimension line of the next run (UI test report
 * docs/ui-test-report-storage.md, "Look": the '95' between two storages touched the line of the
 * neighbouring storage). The values and the runs are the same as before.
 */
export function outsideRowLine(input: OutsideRowInput): DimLine | null {
  const base = {
    start: input.start,
    end: input.end,
    normal: input.normal,
    offsetCm: input.offsetCm,
    zoom: input.zoom,
    text: input.text,
  }
  const first = dimLine(base)
  if (!first) return null
  if (!first.outside) return first
  return dimLine({ ...base, textPlace: 'outside', outsideEnd: input.outsideEnd }) ?? first
}

/**
 * Level of detail of the outside rows, screen px. When the plan is zoomed out, the rows of the
 * small runs (recesses, shafts, wall ends) fill the plan with texts that no one can read:
 *   - a run shorter than MIN_RUN on screen is not drawn (no row, no extension line);
 *   - a run with a chain segment shorter than MIN_SEGMENT on screen keeps its overall row only.
 * The plan layer and the badge mask apply the same rule (outsideDimsLod); the export does not
 * (it has a fixed scale).
 */
export const OUTSIDE_LOD_PX = { minRun: 64, minSegment: 40 }

/** The runs that the plan draws at this zoom (px per cm), after the level-of-detail rule. */
export function outsideDimsLod(runs: OutsideDimRun[], zoom: number): OutsideDimRun[] {
  const out: OutsideDimRun[] = []
  for (const run of runs) {
    if (run.overallCm * zoom < OUTSIDE_LOD_PX.minRun) continue
    const tooShort = run.segments.length > 1 && run.segments.some((s) => s.lengthCm * zoom < OUTSIDE_LOD_PX.minSegment)
    if (!tooShort) {
      out.push(run)
      continue
    }
    // The chain row goes: the run becomes one segment, drawn once on the overall row.
    out.push({
      ...run,
      points: [run.a, run.b],
      segments: [{ a: run.a, b: run.b, lengthCm: run.overallCm, label: null, measuredCm: null }],
    })
  }
  return out
}

/**
 * Planned length of the OUTSIDE face of each facade wall, by label ('W12-E'): the length of the
 * chain segment that carries the label. ONE source for the row on the plan and for the planned
 * length in Measuring Mode and on the wall card, so the two cannot differ. A wall with no such
 * segment (its side is cut by a T junction, or not drawn) is not in the map.
 */
export function facadePlannedLengths(doc: Omit<OutsideSpanDoc, 'measurements'> & Partial<Pick<OutsideSpanDoc, 'measurements'>>): Map<string, number> {
  const out = new Map<string, number>()
  for (const run of outsideDims({ ...doc, measurements: doc.measurements ?? {} })) {
    for (const seg of run.segments) if (seg.label) out.set(seg.label, seg.lengthCm)
  }
  return out
}
