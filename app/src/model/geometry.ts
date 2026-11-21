// Basic 2D helpers shared by all features. Units: cm. Feature-specific math goes in the feature folder.
import type { Room, Vec, Vertex } from './types'

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

/** Room area in m², holes subtracted. */
export const roomAreaM2 = (r: Room) =>
  (area(r.vertices) - r.holes.reduce((s, h) => s + area(h), 0)) / 10000

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

export type Wall = { index: number; start: Vertex; end: Vertex; length: number; dir: Vec; /** points INTO the room */ inward: Vec }

/** Walls of a room in polygon order. Wall i = vertices[i] -> vertices[i+1]. */
export const roomWalls = (r: Room): Wall[] => {
  const v = r.vertices, s = signedArea(v) > 0 ? 1 : -1
  return v.map((a, i) => {
    const b = v[(i + 1) % v.length], d = norm(sub(b, a))
    return { index: i, start: a, end: b, length: dist(a, b), dir: d, inward: { x: -d.y * s, y: d.x * s } }
  })
}

export const wallByStart = (r: Room, startId: string) => roomWalls(r).find((w) => w.start.id === startId)

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
