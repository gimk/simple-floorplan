// Pure door-swing and clearance clash detection (docs/plan.md 7.4). Units: cm.
//
// Every wall element gets a FOOTPRINT in world coordinates:
//   door                      -> the swing sector: a quarter disc from the hinge, radius = leaf
//                                length, on the swing side. A double door gives two sectors.
//   window with variant
//   "french"                  -> two sectors, like a double door. Other windows give nothing.
//   sliding / pocket door     -> nothing (the leaf never sweeps the room).
//   radiator / other          -> a rectangle of depthCm pushed into the room.
// Two footprints that overlap by more than CLASH_TOLERANCE_CM2 make a clash. A door sector that
// reaches through another wall (not its host wall) makes a "door-wall" clash: the leaf cannot
// open against it.
//
// This file has no React and no store access, so it is easy to test.
import polygonClipping from 'polygon-clipping'
import { add, dist, mul, roomWalls } from '../../model/geometry'
import type { Wall } from '../../model/geometry'
import type { PlanDoc, Room, Vec, WallElement } from '../../model/types'
import { KIND_LABEL, wallThickness } from '../elements/geometry'
import { itemSpan } from '../measure/logic'

/** Element / sector overlap that still counts as a clash, in cm² (~5 cm × 5 cm). */
export const CLASH_TOLERANCE_CM2 = 25
/** Depths used when the element has none: the same defaults as the element inspector. */
export const RADIATOR_DEPTH_CM = 10
/** Two walls are the same wall when both endpoints match within this distance. */
const SAME_WALL_CM = 3
/** Points on a quarter arc. 16 keeps the polygon within ~1 mm of the true circle at 80 cm. */
const ARC_STEPS = 16

export type FootprintRole = 'door' | 'fixture'

/** One solid area of one element, closed outline in world cm. */
export type Footprint = {
  elementId: string
  /** door = the sweep of a leaf (also a French window), fixture = the body of a radiator. */
  role: FootprintRole
  points: Vec[]
}

export type ClashKind = 'door-door' | 'door-fixture' | 'door-wall'

/**
 * Two elements that overlap (`a` and `b` are element ids), or a door sector that reaches
 * through another wall (`b` is null and the wall is named by `roomId` + `wallStart`).
 */
export type Clash =
  | { kind: 'door-door' | 'door-fixture'; a: string; b: string; overlapCm2: number }
  | { kind: 'door-wall'; a: string; b: null; roomId: string; wallStart: string; overlapCm2: number }

const neg = (v: Vec): Vec => ({ x: -v.x, y: -v.y })
const asRing = (pts: Vec[]): [number, number][] => pts.map((p) => [p.x, p.y])

/** Shoelace area of a closed ring whose last point repeats the first. */
function closedRingArea(ring: [number, number][]): number {
  let s = 0
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i], b = ring[i + 1]
    s += a[0] * b[1] - b[0] * a[1]
  }
  return Math.abs(s) / 2
}

/** Area shared by two simple polygons, in cm². 0 for shapes that only touch. */
export function overlapArea(a: Vec[], b: Vec[]): number {
  if (a.length < 3 || b.length < 3) return 0
  let pieces: ReturnType<typeof polygonClipping.intersection>
  try {
    pieces = polygonClipping.intersection([asRing(a)], [asRing(b)])
  } catch {
    return 0 // degenerate input: no measurable overlap
  }
  let total = 0
  for (const poly of pieces) {
    if (!poly.length) continue
    total += closedRingArea(poly[0]) - poly.slice(1).reduce((s, hole) => s + closedRingArea(hole), 0)
  }
  return Math.max(0, total)
}

/**
 * Quarter disc at `hinge`: from `along` (the closed leaf, i.e. the wall) round to `open`
 * (the open leaf). Both are unit vectors, so the sweep is always ±90°.
 */
export function swingSector(hinge: Vec, along: Vec, open: Vec, radius: number, steps = ARC_STEPS): Vec[] {
  const start = Math.atan2(along.y, along.x)
  let sweep = Math.atan2(open.y, open.x) - start
  while (sweep > Math.PI) sweep -= 2 * Math.PI
  while (sweep < -Math.PI) sweep += 2 * Math.PI
  const points: Vec[] = [{ x: hinge.x, y: hinge.y }]
  for (let k = 0; k <= steps; k++) {
    const t = start + (sweep * k) / steps
    points.push({ x: hinge.x + Math.cos(t) * radius, y: hinge.y + Math.sin(t) * radius })
  }
  return points
}

/** Body depth of a standing fixture: its own depthCm, else radiator 10 cm. */
export function fixtureDepth(el: Pick<WallElement, 'kind' | 'depthCm'>): number {
  const own = el.depthCm
  if (typeof own === 'number' && Number.isFinite(own) && own > 0) return own
  if (el.kind === 'radiator') return RADIATOR_DEPTH_CM
  return 0 // "other" without a depth has no body to clash with
}

const hasFootprint = (el: WallElement) =>
  el.kind === 'door' || el.kind === 'window' || el.kind === 'radiator' || el.kind === 'other'

/** Footprints of one element, in world cm. Empty when the element cannot be drawn yet. */
export function elementFootprints(
  doc: Pick<PlanDoc, 'measurements'>,
  room: Room,
  el: WallElement,
): Footprint[] {
  if (!hasFootprint(el) || !(el.widthCm > 0)) return []
  const span = itemSpan(doc, room, el)
  if (!span) return []
  const width = dist(span.p0, span.p1)
  if (!(width > 0)) return []
  // Open leaf direction: the inward normal of the host wall, flipped for an "out" swing.
  const side = el.swing === 'out' ? -1 : 1
  const open = mul(span.wall.inward, side)
  const pair = (): Footprint[] => [
    { elementId: el.id, role: 'door', points: swingSector(span.p0, span.wall.dir, open, width / 2) },
    { elementId: el.id, role: 'door', points: swingSector(span.p1, neg(span.wall.dir), open, width / 2) },
  ]

  if (el.kind === 'door') {
    if (el.variant === 'sliding' || el.variant === 'pocket') return []
    if (el.variant === 'double') return pair()
    const atEnd = el.hinge === 'end'
    return [{
      elementId: el.id,
      role: 'door',
      points: swingSector(atEnd ? span.p1 : span.p0, atEnd ? neg(span.wall.dir) : span.wall.dir, open, width),
    }]
  }

  if (el.kind === 'window') {
    return el.variant === 'french' ? pair() : []
  }

  const depth = fixtureDepth(el)
  if (!(depth > 0)) return []
  const back = mul(span.wall.inward, depth)
  return [{ elementId: el.id, role: 'fixture', points: [span.p0, span.p1, add(span.p1, back), add(span.p0, back)] }]
}

/** Footprints of every element of the document, in document order. */
export function clashFootprints(doc: PlanDoc): Footprint[] {
  const out: Footprint[] = []
  for (const el of doc.elements) {
    const room = doc.rooms.find((r) => r.id === el.roomId)
    if (!room) continue
    out.push(...elementFootprints(doc, room, el))
  }
  return out
}

/** Half of a wall, on the far side of its centreline (away from the room it belongs to). */
function outerWallBand(room: Room, wall: Wall): Vec[] {
  const half = Math.max(wallThickness(room, wall.start.id), 1) / 2
  const out = mul(wall.inward, -half)
  return [wall.start, wall.end, add(wall.end, out), add(wall.start, out)]
}

const samePoint = (a: Vec, b: Vec) => dist(a, b) <= SAME_WALL_CM
/** True when `wall` is the host wall of `el` (same two endpoints, in any direction). */
function isHostWall(room: Room, el: WallElement, wall: Wall): boolean {
  const host = roomWalls(room).find((w) => w.start.id === el.wallStart)
  if (!host) return false
  return (
    (samePoint(host.start, wall.start) && samePoint(host.end, wall.end)) ||
    (samePoint(host.start, wall.end) && samePoint(host.end, wall.start))
  )
}

/**
 * Every clash of the document, in document order: element against element first, then
 * door against wall. Pass `footprints` when the caller already built them.
 */
export function findClashes(doc: PlanDoc, footprints: Footprint[] = clashFootprints(doc)): Clash[] {
  const byElement = new Map<string, Footprint[]>()
  for (const f of footprints) {
    const list = byElement.get(f.elementId)
    if (list) list.push(f)
    else byElement.set(f.elementId, [f])
  }

  const clashes: Clash[] = []
  const ids = [...byElement.keys()]
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const first = byElement.get(ids[i])![0]
      const second = byElement.get(ids[j])![0]
      const kind: 'door-door' | 'door-fixture' | null =
        first.role === 'door' && second.role === 'door'
          ? 'door-door'
          : first.role === 'door' || second.role === 'door'
            ? 'door-fixture'
            : null
      if (!kind) continue // two bodies (two radiators side by side) never clash
      let overlap = 0
      for (const fa of byElement.get(ids[i])!) {
        for (const fb of byElement.get(ids[j])!) overlap += overlapArea(fa.points, fb.points)
      }
      if (overlap > CLASH_TOLERANCE_CM2) {
        clashes.push({ kind, a: ids[i], b: ids[j], overlapCm2: Math.round(overlap) })
      }
    }
  }

  for (const el of doc.elements) {
    const room = doc.rooms.find((r) => r.id === el.roomId)
    if (!room) continue
    const sectors = elementFootprints(doc, room, el).filter((f) => f.role === 'door')
    if (!sectors.length) continue
    for (const other of doc.rooms) {
      for (const wall of roomWalls(other)) {
        if (isHostWall(room, el, wall)) continue
        const band = outerWallBand(other, wall)
        let overlap = 0
        for (const s of sectors) overlap += overlapArea(s.points, band)
        if (overlap > CLASH_TOLERANCE_CM2) {
          clashes.push({
            kind: 'door-wall', a: el.id, b: null, roomId: other.id, wallStart: wall.start.id,
            overlapCm2: Math.round(overlap),
          })
        }
      }
    }
  }

  return clashes
}

/** Stable key of a clash, for React lists and de-duplication. */
export const clashKey = (c: Clash): string => (c.kind === 'door-wall' ? `${c.a}>wall:${c.roomId}:${c.wallStart}` : `${c.a}>${c.b}`)

/** Survey-style name of an element: "Door SE-2" (kind + host wall id). */
export function elementClashLabel(doc: Pick<PlanDoc, 'rooms' | 'elements'>, elementId: string): string {
  const el = doc.elements.find((e) => e.id === elementId)
  if (!el) return 'Element'
  const room = doc.rooms.find((r) => r.id === el.roomId)
  const wall = room ? roomWalls(room).find((w) => w.start.id === el.wallStart) : undefined
  const where = room && wall ? ` ${room.code}-${wall.index + 1}` : room ? ` ${room.code}` : ''
  return `${KIND_LABEL[el.kind]}${where}`
}

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1)

/** One line for the sidebar: "Door SE-2 hits radiator SE-3". */
export function clashText(doc: Pick<PlanDoc, 'rooms' | 'elements'>, clash: Clash): string {
  const a = elementClashLabel(doc, clash.a)
  if (clash.kind === 'door-wall') {
    const room = doc.rooms.find((r) => r.id === clash.roomId)
    const wall = room ? roomWalls(room).find((w) => w.start.id === clash.wallStart) : undefined
    return `${a} hits ${room && wall ? `wall ${room.code}-${wall.index + 1}` : 'a wall'}`
  }
  return `${a} hits ${lowerFirst(elementClashLabel(doc, clash.b))}`
}
