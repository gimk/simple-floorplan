// Space between rooms (wall mass, ducts, small voids), found by a morphological closing (square):
// grow the room union by `r`, shrink it back by `r`, then remove the rooms.
// Gaps up to 2·r wide are filled; the outside of the building stays empty.
import polygonClipping, { type MultiPolygon, type Pair, type Polygon } from 'polygon-clipping'
import type { Room, Vec } from '../../model/types'

/** Half of the widest gap between rooms that is filled (cm). */
export const GAP_FILL_CM = 50

// Square structuring element: it fits square inner corners of the building, so they stay empty.
const SQUARE: Pair[] = [[1, 1], [1, -1], [-1, 1], [-1, -1]]

const cross = (o: Pair, a: Pair, b: Pair) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

/** Convex hull (monotone chain), counter-clockwise, not closed. */
function hull(pts: Pair[]): Pair[] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const lower: Pair[] = []
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop()
    lower.push(q)
  }
  const upper: Pair[] = []
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop()
    upper.push(q)
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)]
}

/** Round to 1 mm: polygon-clipping fails on many nearly equal float points. */
const snap = (p: Pair): Pair => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]
const snapAll = (m: MultiPolygon): MultiPolygon => m.map((poly) => poly.map((rg) => rg.map(snap)))

/** The segment a→b swept by a square of half side r. */
function sweep(a: Pair, b: Pair, r: number): Polygon {
  const h = hull(SQUARE.flatMap(([c, s]) => [[a[0] + c * r, a[1] + s * r], [b[0] + c * r, b[1] + s * r]] as Pair[]).map(snap))
  return [[...h, h[0]]]
}

/** Bands of width 2r around every edge of the rings of a multipolygon. */
function bands(m: MultiPolygon, r: number): Polygon[] {
  const out: Polygon[] = []
  for (const poly of m) for (const ring of poly) {
    for (let i = 0; i + 1 < ring.length; i++) out.push(sweep(ring[i], ring[i + 1], r))
  }
  return out
}

const ring = (vs: Vec[]): Pair[] => [...vs.map((v) => [v.x, v.y] as Pair), [vs[0].x, vs[0].y]]

const area = (rg: Pair[]) => {
  let s = 0
  for (let i = 0; i + 1 < rg.length; i++) s += rg[i][0] * rg[i + 1][1] - rg[i + 1][0] * rg[i][1]
  return Math.abs(s) / 2
}

/** Areas between rooms, as a multipolygon in cm. Slivers under 1 cm² are dropped. */
export function gapAreas(rooms: Room[], r = GAP_FILL_CM): MultiPolygon {
  const valid = rooms.filter((x) => x.vertices.length >= 3)
  if (!valid.length) return []
  try {
    const outers: Polygon[] = valid.map((x) => [ring(x.vertices)])
    const union = polygonClipping.union(outers[0], ...outers.slice(1))
    const grown = snapAll(polygonClipping.union(union, ...bands(union, r)))
    const cut = polygonClipping.union(...(bands(grown, r) as [Polygon, ...Polygon[]]))
    const shrunk = polygonClipping.difference(grown, cut)
    // Room holes (shafts, pillars) count as space between rooms.
    const full: Polygon[] = valid.map((x) => [ring(x.vertices), ...x.holes.filter((h) => h.length >= 3).map(ring)])
    const gaps = polygonClipping.difference(shrunk, ...full)
    return gaps.filter((p) => area(p[0]) >= 1)
  } catch (e) {
    console.warn('gapAreas failed', e)
    return []
  }
}

/** SVG path of a multipolygon (use fill-rule evenodd). */
export const multiPath = (m: MultiPolygon) =>
  m.flatMap((p) => p.map((rg) => 'M' + rg.slice(0, -1).map(([x, y]) => `${x} ${y}`).join('L') + 'Z')).join('')
