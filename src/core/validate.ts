// Pure validation of a project document: Zod schema issues first, then semantic checks.
// No React, no store, no DOM. Units: cm.
import { dist, projectOnSegment } from '../model/geometry'
import type { Vec } from '../model/geometry'
import { projectDocSchema } from '../model/schema'
import type { Artboard, Opening, ProjectDoc, Room } from '../model/types'

export type ValidationIssue = {
  code: string
  severity: 'error' | 'warning'
  path: string
  message: string
}

export type ValidationResult = { ok: boolean; doc?: ProjectDoc; issues: ValidationIssue[] }

/** Wall edges shorter than this are reported as zero-length. */
export const ZERO_WALL_CM = 0.1
/** An opening farther than this from every room edge of its artboard floats off the walls. */
export const OPENING_NEAR_WALL_CM = 25
const EPS = 1e-9

/** Zod path -> "artboards[0].rooms[1].name". */
export function formatPath(path: ReadonlyArray<PropertyKey>): string {
  let out = ''
  for (const seg of path) {
    if (typeof seg === 'number') out += `[${seg}]`
    else out += out ? `.${String(seg)}` : String(seg)
  }
  return out || '$'
}

// ---------- segment helpers ----------

const orient = (a: Vec, b: Vec, c: Vec): number => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)

const onSegment = (a: Vec, b: Vec, p: Vec): boolean =>
  Math.min(a.x, b.x) - EPS <= p.x && p.x <= Math.max(a.x, b.x) + EPS && Math.min(a.y, b.y) - EPS <= p.y && p.y <= Math.max(a.y, b.y) + EPS

/** True when segments ab and cd share at least one point (crossing, touching or overlapping). */
export function segmentsIntersect(a: Vec, b: Vec, c: Vec, d: Vec): boolean {
  const o1 = orient(a, b, c), o2 = orient(a, b, d), o3 = orient(c, d, a), o4 = orient(c, d, b)
  if (((o1 > EPS && o2 < -EPS) || (o1 < -EPS && o2 > EPS)) && ((o3 > EPS && o4 < -EPS) || (o3 < -EPS && o4 > EPS))) return true
  if (Math.abs(o1) <= EPS && onSegment(a, b, c)) return true
  if (Math.abs(o2) <= EPS && onSegment(a, b, d)) return true
  if (Math.abs(o3) <= EPS && onSegment(c, d, a)) return true
  if (Math.abs(o4) <= EPS && onSegment(c, d, b)) return true
  return false
}

/** True when two non-adjacent edges of the polygon meet. Zero-length edges are ignored. */
export function isSelfIntersecting(vertices: Vec[]): boolean {
  const n = vertices.length
  if (n < 4) return false
  for (let i = 0; i < n; i++) {
    const a = vertices[i], b = vertices[(i + 1) % n]
    if (dist(a, b) < ZERO_WALL_CM) continue
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue // neighbours share a vertex
      const c = vertices[j], d = vertices[(j + 1) % n]
      if (dist(c, d) < ZERO_WALL_CM) continue
      if (segmentsIntersect(a, b, c, d)) return true
    }
  }
  return false
}

type NearestEdge = { room: Room; edgeIndex: number; distance: number; lengthCm: number }

/** Nearest non-degenerate room edge to pt among `rooms`, or null. */
function nearestEdge(rooms: Room[], pt: Vec): NearestEdge | null {
  let best: NearestEdge | null = null
  for (const room of rooms) {
    const v = room.vertices
    if (v.length < 2) continue
    for (let i = 0; i < v.length; i++) {
      const a = v[i], b = v[(i + 1) % v.length]
      const lengthCm = dist(a, b)
      if (lengthCm < 1e-6) continue
      const p = projectOnSegment(pt, a, b)
      if (!best || p.distance < best.distance) best = { room, edgeIndex: i, distance: p.distance, lengthCm }
    }
  }
  return best
}

// ---------- semantic checks ----------

function checkRoom(room: Room, base: string, issues: ValidationIssue[]): void {
  const v = room.vertices
  if (v.length < 3) {
    issues.push({ code: 'room.too_few_vertices', severity: 'error', path: `${base}.vertices`, message: `Room "${room.name}" has ${v.length} vertices; a room needs at least 3.` })
    return
  }
  v.forEach((a, i) => {
    const length = dist(a, v[(i + 1) % v.length])
    if (length < ZERO_WALL_CM) {
      issues.push({ code: 'room.zero_length_wall', severity: 'warning', path: `${base}.vertices[${i}]`, message: `Wall ${i} of room "${room.name}" has length ${length.toFixed(3)} cm (less than ${ZERO_WALL_CM} cm).` })
    }
  })
  if (isSelfIntersecting(v)) {
    issues.push({ code: 'room.self_intersecting', severity: 'error', path: `${base}.vertices`, message: `Room "${room.name}" has a self-intersecting outline.` })
  }
}

function checkOpening(o: Opening, ab: Artboard, base: string, issues: ValidationIssue[]): void {
  const own = o.roomId ? ab.rooms.find((r) => r.id === o.roomId) : undefined
  if (o.roomId && !own) {
    issues.push({ code: 'opening.orphan_room', severity: 'warning', path: `${base}.roomId`, message: `Opening "${o.id}" points to room "${o.roomId}", which does not exist in this artboard.` })
  }
  const pt = { x: o.xCm, y: o.yCm }
  const nearest = nearestEdge(ab.rooms, pt)
  if (!nearest || nearest.distance > OPENING_NEAR_WALL_CM) {
    issues.push({ code: 'opening.not_on_wall', severity: 'warning', path: base, message: `Opening "${o.id}" is not near any wall (more than ${OPENING_NEAR_WALL_CM} cm from every room edge).` })
    return
  }
  const host = (own ? nearestEdge([own], pt) : null) ?? nearest
  if (o.widthCm > host.lengthCm + 1e-6) {
    issues.push({ code: 'opening.wider_than_wall', severity: 'warning', path: `${base}.widthCm`, message: `Opening "${o.id}" is ${o.widthCm} cm wide, wider than its wall (${host.lengthCm.toFixed(1)} cm, room "${host.room.name}", wall ${host.edgeIndex}).` })
  }
}

/** Semantic checks of a schema-valid document. */
export function semanticIssues(doc: ProjectDoc): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  doc.artboards.forEach((ab, ai) => {
    ab.rooms.forEach((room, ri) => checkRoom(room, `artboards[${ai}].rooms[${ri}]`, issues))
    ab.openings.forEach((o, oi) => checkOpening(o, ab, `artboards[${ai}].openings[${oi}]`, issues))
  })
  return issues
}

/**
 * Validate unknown data as a project. Returns every Zod issue (not only the first). When the schema
 * passes, the semantic checks run too. `ok` is true when no issue has severity 'error'.
 * `doc` is set whenever the schema passes (even with semantic errors). Never throws.
 */
export function validateProject(input: unknown): ValidationResult {
  const parsed = projectDocSchema.safeParse(input)
  if (!parsed.success) {
    const issues: ValidationIssue[] = parsed.error.issues.map((i) => ({
      code: `schema.${i.code}`,
      severity: 'error',
      path: formatPath(i.path),
      message: i.message,
    }))
    return { ok: false, issues }
  }
  const doc = parsed.data as ProjectDoc
  const issues = semanticIssues(doc)
  return { ok: !issues.some((i) => i.severity === 'error'), doc, issues }
}
