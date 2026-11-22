// Wall outline geometry. A wall used to be a stroked `<line>` with square caps, so at
// non-90° corners the caps stuck out of the band and overlapped (spikes at obtuse
// corners). Here every wall becomes a polygon whose ends are MITERED against the
// neighbouring walls: both faces are offset by half the thickness and intersected with
// the neighbour's faces. Neighbours share the exact corner point, so the band is closed
// at any angle, also when the two walls have different thicknesses.
//
// World units = cm. Pure functions only (no React, no store).
import type { Room, Vec } from '../../model/types'

/** Half thickness of the wall that starts at `startId` (same key as `room.walls`). */
export type HalfWidthOf = (startId: string) => number

/** One wall as a closed polygon. */
export type WallQuad = {
  /** Wall index in `room.vertices` order (wall i = vertices[i] -> vertices[i + 1]). */
  index: number
  /** Start vertex id, i.e. the key used by `room.walls`. */
  startId: string
  /**
   * Corners in this order: start+ , start- , end- , end+ .
   * The "+" face is on the `perp(dir) = (-dir.y, dir.x)` side of the centerline,
   * the "-" face on the opposite side.
   */
  points: [Vec, Vec, Vec, Vec]
}

/** Max miter length, as a multiple of the half thickness (clamped below). */
export const MITER_LIMIT = 4

const EPS = 1e-9

export const perp = (d: Vec): Vec => ({ x: -d.y, y: d.x })
const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y })
const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y })
const mul = (a: Vec, k: number): Vec => ({ x: a.x * k, y: a.y * k })
const cross = (a: Vec, b: Vec) => a.x * b.y - a.y * b.x
const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y)

/**
 * Corner point where the `side` face of the wall arriving at `v` meets the `side` face of
 * the wall leaving `v`. Both walls of a corner call this with the same arguments, so their
 * quads share the point exactly.
 *
 * `side` = +1 / -1 selects the face. Returns null when the two walls are collinear (no
 * usable intersection: straight continuation or 180° spike) — the caller then falls back
 * to its own face, which gives a small bevel instead of a spike.
 *
 * Very sharp angles (< ~20°) send the miter point far away: the miter is clamped to
 * `limit * half thickness`, which reads as a small bevel too.
 */
export function faceCorner(
  v: Vec, inDir: Vec, inHalf: number, outDir: Vec, outHalf: number, side: number, limit = MITER_LIMIT,
): Vec | null {
  const aIn = add(v, mul(perp(inDir), side * inHalf))
  const aOut = add(v, mul(perp(outDir), side * outHalf))
  const denom = cross(inDir, outDir)
  if (Math.abs(denom) < 1e-6) return null
  const t = cross(sub(aOut, aIn), outDir) / denom
  const p = add(aIn, mul(inDir, t))
  const maxLen = limit * Math.max(inHalf, outHalf, EPS)
  const d = dist(p, v)
  if (d <= maxLen || d < EPS) return p
  return add(v, mul(mul(sub(p, v), 1 / d), maxLen))
}

/** Corner point for one wall face, with the collinear fallback on the wall's own face. */
const corner = (
  at: Vec, inDir: Vec, inHalf: number, outDir: Vec, outHalf: number,
  side: number, ownDir: Vec, ownHalf: number, limit: number,
): Vec =>
  faceCorner(at, inDir, inHalf, outDir, outHalf, side, limit) ?? add(at, mul(perp(ownDir), side * ownHalf))

/** Outline of every wall of `room`, in polygon order. */
export const wallQuads = (room: Room, halfWidthOf: HalfWidthOf, limit = MITER_LIMIT): WallQuad[] => {
  const v = room.vertices
  const n = v.length
  if (n < 2) return []
  const dirs = v.map((a, i) => {
    const b = v[(i + 1) % n]
    const l = Math.hypot(b.x - a.x, b.y - a.y) || 1
    return { x: (b.x - a.x) / l, y: (b.y - a.y) / l }
  })
  const half = v.map((a) => Math.max(halfWidthOf(a.id), 0))
  return v.map((a, i) => {
    const j = (i + 1) % n
    const prev = (i - 1 + n) % n
    const b = v[j]
    return {
      index: i,
      startId: a.id,
      points: [
        // start vertex: the wall arriving here is `prev`, the one leaving is `i`
        corner(a, dirs[prev], half[prev], dirs[i], half[i], 1, dirs[i], half[i], limit),
        corner(a, dirs[prev], half[prev], dirs[i], half[i], -1, dirs[i], half[i], limit),
        // end vertex: the wall arriving here is `i`, the one leaving is `j`
        corner(b, dirs[i], half[i], dirs[j], half[j], -1, dirs[i], half[i], limit),
        corner(b, dirs[i], half[i], dirs[j], half[j], 1, dirs[i], half[i], limit),
      ],
    }
  })
}

/** Closed path for a polygon. */
export const polygonPath = (points: Vec[]) =>
  'M' + points.map((p) => `${p.x} ${p.y}`).join('L') + 'Z'

/** Open path through points (used for the two wall faces: their caps are shared). */
export const polylinePath = (points: Vec[]) =>
  points.length ? 'M' + points.map((p) => `${p.x} ${p.y}`).join('L') : ''

/** The two faces of a wall: `[plus, minus]`, each from its start corner to its end corner. */
export const wallFaces = (q: WallQuad): [Vec[], Vec[]] => {
  const [sp, sm, em, ep] = q.points
  return [[sp, ep], [sm, em]]
}
