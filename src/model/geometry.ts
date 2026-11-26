// Basic 2D helpers shared by all features. Units: cm. Feature-specific math goes in the feature folder.
export type Vec = { x: number; y: number }

export const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y })
export const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y })
export const mul = (a: Vec, k: number): Vec => ({ x: a.x * k, y: a.y * k })
export const dot = (a: Vec, b: Vec) => a.x * b.x + a.y * b.y
export const cross = (a: Vec, b: Vec) => a.x * b.y - a.y * b.x
export const len = (a: Vec) => Math.hypot(a.x, a.y)
export const dist = (a: Vec, b: Vec) => len(sub(a, b))
export const lerp = (a: Vec, b: Vec, t: number): Vec => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
export const norm = (a: Vec): Vec => { const l = len(a) || 1; return { x: a.x / l, y: a.y / l } }

/** Signed area (positive = clockwise on screen, because y points down). */
export const signedArea = (pts: Vec[]) => {
  let a = 0
  pts.forEach((p, i) => { const q = pts[(i + 1) % pts.length]; a += p.x * q.y - q.x * p.y })
  return a / 2
}
export const area = (pts: Vec[]) => Math.abs(signedArea(pts))

export const centroid = (pts: Vec[]): Vec => {
  const a = signedArea(pts)
  if (Math.abs(a) < 1e-9) return mul(pts.reduce(add, { x: 0, y: 0 }), 1 / pts.length)
  let cx = 0, cy = 0
  pts.forEach((p, i) => {
    const q = pts[(i + 1) % pts.length], f = p.x * q.y - q.x * p.y
    cx += (p.x + q.x) * f; cy += (p.y + q.y) * f
  })
  return { x: cx / (6 * a), y: cy / (6 * a) }
}

/** Closest point on segment ab to p, with t in [0,1]. */
export const projectOnSegment = (p: Vec, a: Vec, b: Vec) => {
  const ab = sub(b, a), l2 = dot(ab, ab) || 1
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2))
  const point = lerp(a, b, t)
  return { t, point, distance: dist(p, point) }
}

export const pointInPolygon = (p: Vec, pts: Vec[]) => {
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j]
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

/** Format a length in cm for display: "412" or "412,5". */
export const fmtCm = (cm: number) => String(Math.round(cm * 10) / 10).replace('.', ',')

/** Distance from p to the nearest edge of the rings (outer ring first, then holes). */
const edgeDistance = (p: Vec, rings: Vec[][]) => {
  let d = Infinity
  for (const r of rings) for (let i = 0; i < r.length; i++) d = Math.min(d, projectOnSegment(p, r[i], r[(i + 1) % r.length]).distance)
  return d
}

const insideRings = (p: Vec, rings: Vec[][]) => pointInPolygon(p, rings[0]) && !rings.slice(1).some((h) => pointInPolygon(p, h))

type LabelSpot = { p: Vec; d: number }

/** Centroid, and points inside the room (centroid + a 41×41 grid) with their distance to the walls. */
function labelSpots(rings: Vec[][]): { c: Vec; spots: LabelSpot[] } {
  const outer = rings[0]
  const c = centroid(outer)
  if (outer.length < 3) return { c, spots: [] }
  const xs = outer.map((p) => p.x), ys = outer.map((p) => p.y)
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys)
  const N = 40
  const spots: LabelSpot[] = []
  if (insideRings(c, rings)) spots.push({ p: c, d: edgeDistance(c, rings) })
  for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
    const p = { x: x0 + ((x1 - x0) * (i + 0.5)) / (N + 1), y: y0 + ((y1 - y0) * (j + 0.5)) / (N + 1) }
    if (insideRings(p, rings)) spots.push({ p, d: edgeDistance(p, rings) })
  }
  return { c, spots }
}

/** Among spots at least 80 % as far from the walls as the widest one, the nearest to c. */
function pickSpot(c: Vec, spots: LabelSpot[]): Vec | null {
  if (!spots.length) return null
  const best = Math.max(...spots.map((x) => x.d))
  let out = spots[0], od = Infinity
  for (const x of spots) {
    if (x.d < best * 0.8) continue
    const dc = dist(x.p, c)
    if (dc < od) { od = dc; out = x }
  }
  return out.p
}

/**
 * Where to write a room name: a point inside the room (not in a hole), far from the walls.
 * Among the points at least 80 % as far from the walls as the widest spot, the one nearest
 * the centroid wins, so a rectangle keeps its centre and an L or a corridor gets its widest part.
 */
export function labelPoint(rings: Vec[][]): Vec {
  const { c, spots } = labelSpots(rings)
  return pickSpot(c, spots) ?? c
}

/** True when segment ab passes through the open box (x0,y0)-(x1,y1) (Liang–Barsky). */
const segmentHitsBox = (a: Vec, b: Vec, x0: number, y0: number, x1: number, y1: number) => {
  let t0 = 0, t1 = 1
  const dx = b.x - a.x, dy = b.y - a.y
  const clip = (p: number, q: number) => {
    if (Math.abs(p) < 1e-12) return q > 0
    const r = q / p
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r } else { if (r < t0) return false; if (r < t1) t1 = r }
    return true
  }
  const e = 1e-6
  return clip(-dx, a.x - (x0 + e)) && clip(dx, x1 - e - a.x) && clip(-dy, a.y - (y0 + e)) && clip(dy, y1 - e - a.y) && t0 < t1
}

/** True when a w×h box centred on p lies inside the rings (outer ring, holes). */
export const boxFits = (p: Vec, w: number, h: number, rings: Vec[][]) => {
  const x0 = p.x - w / 2, x1 = p.x + w / 2, y0 = p.y - h / 2, y1 = p.y + h / 2
  if (!insideRings(p, rings)) return false
  for (const r of rings) for (let i = 0; i < r.length; i++) {
    if (segmentHitsBox(r[i], r[(i + 1) % r.length], x0, y0, x1, y1)) return false
  }
  return true
}

/**
 * Where to write a room name of size w×h (cm): like `labelPoint`, but only where the text box
 * fits inside the room. If only a turned box fits (narrow corridor), `vertical` is true.
 * If nothing fits, the plain label point.
 */
export function labelPlacement(rings: Vec[][], w: number, h: number, m = 0): { p: Vec; vertical: boolean } {
  const { c, spots } = labelSpots(rings)
  // Flat with the margin m (cm on each side), flat, turned with the margin, turned.
  const tries: [number, number, boolean][] = [[w + 2 * m, h + 2 * m, false], [w, h, false], [h + 2 * m, w + 2 * m, true], [h, w, true]]
  for (const [bw, bh, vertical] of tries) {
    const p = pickSpot(c, spots.filter((x) => boxFits(x.p, bw, bh, rings)))
    if (p) return { p, vertical }
  }
  return { p: pickSpot(c, spots) ?? c, vertical: false }
}

// ---------- inside faces ----------
// Inside outline of a polygon: each edge moved into the polygon by a given offset.

/**
 * Inside outline of a polygon whose edge i (pts[i] -> pts[i+1]) is moved into the polygon by
 * half[i]. Vertex k of the result is the inside corner at pts[k].
 */
export function innerRing(pts: Vec[], half: number[]): Vec[] {
  const n = pts.length
  if (n < 3) return pts.map((p) => ({ x: p.x, y: p.y }))
  const s = signedArea(pts) > 0 ? 1 : -1
  const degenerate = pts.map((a, i) => dist(a, pts[(i + 1) % n]) < 1e-6)
  if (degenerate.every(Boolean)) return pts.map((p) => ({ x: p.x, y: p.y }))
  const lines = pts.map((a, i) => {
    const b = pts[(i + 1) % n]
    const d = norm(sub(b, a))
    const inward = { x: -d.y * s, y: d.x * s }
    return { p: add(a, mul(inward, half[i] ?? 0)), d }
  })
  // A zero-length wall (two corners at the same place) has no direction: it takes the line of
  // the next real wall, so the corner before it is the crossing of the two real walls.
  for (let i = n - 1, guard = 0; guard < 2 * n; guard++, i = (i + n - 1) % n) {
    if (degenerate[i]) lines[i] = lines[(i + 1) % n]
  }
  const out = pts.map((_, k) => {
    const A = lines[(k + n - 1) % n], B = lines[k]
    const den = cross(A.d, B.d)
    // Straight corner (or folded back): no crossing, use the moved point of the next wall.
    if (Math.abs(den) < 1e-9) return B.p
    const t = cross(sub(B.p, A.p), B.d) / den
    return add(A.p, mul(A.d, t))
  })
  // The corner after a zero-length wall is the same inside corner as the one before it.
  for (let k = 0, guard = 0; guard < 2 * n; guard++, k = (k + 1) % n) {
    if (degenerate[k]) out[(k + 1) % n] = out[k]
  }
  return out
}
