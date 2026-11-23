// Make room tool logic (docs/walls-plan.md phase 6): pure, cm. No React here.
//
// A click inside a closed area formed by the traced walls and the room wall centre lines makes one
// room: the polygon is the centre lines of the cycle around the click, each wall takes the thickness
// and the type of the trace (or of the room wall) it lies on, and the traces that the new room walls
// cover are removed, so a wall is never stored twice.
import { findEnclosingCycle, type EnclosingCycle } from '../../model/faces'
import { area, dist } from '../../model/geometry'
import { nextRoomCode } from '../../model/survey'
import { uid } from '../../model/store'
import type { PlanDoc, Room, Vec, WallProps } from '../../model/types'
import { maxWalkOrder } from './ops'
import { DEFAULT_THICKNESS } from './walls'
import { docSegments, propsOfSegment, subtractCovered, type EdgeRef } from './traces'

/** Smallest area a new room can have, cm² (the same rule as the polygon tool). */
export const MIN_ROOM_AREA_CM2 = 100

export type MakeRoomOutcome =
  | { kind: 'ok'; doc: PlanDoc; roomId: string }
  /** The area is already a room of the plan. */
  | { kind: 'exists'; room: Room }
  /** Nothing to make: no closed area here, or an area too small to be a room. */
  | { kind: 'none' }

/**
 * True when both polygons are the same shape within `tolCm`: same number of corners, same points
 * in the same order, from any start corner, in either direction.
 */
export function samePolygon(a: Vec[], b: Vec[], tolCm = 1): boolean {
  if (a.length !== b.length || a.length === 0) return false
  const near = (p: Vec, q: Vec) => dist(p, q) <= tolCm
  const sameFrom = (bs: Vec[]) => a.every((p, i) => near(p, bs[i]))
  for (let j = 0; j < b.length; j++) {
    if (!near(a[0], b[j])) continue
    const forward = [...b.slice(j), ...b.slice(0, j)]
    if (sameFrom(forward)) return true
    const backward = [forward[0], ...forward.slice(1).reverse()]
    if (sameFrom(backward)) return true
  }
  return false
}

/** Wall properties of cycle edge i: the trace it lies on, else the room wall it lies on. */
function edgeProps(doc: PlanDoc, cycle: EnclosingCycle, i: number, tolCm: number): WallProps {
  const id = cycle.segmentIds[i]
  if (id) {
    const p = propsOfSegment(doc, id)
    if (p) return { type: p.type, thicknessCm: p.thicknessCm }
  }
  // No usable id: look for a segment of the plan that runs along this edge.
  const a = cycle.points[i], b = cycle.points[(i + 1) % cycle.points.length]
  for (const s of docSegments(doc)) {
    if (dist(s.a, a) <= tolCm && dist(s.b, b) <= tolCm) {
      const p = propsOfSegment(doc, s.id)
      if (p) return { type: p.type, thicknessCm: p.thicknessCm }
    }
    if (dist(s.a, b) <= tolCm && dist(s.b, a) <= tolCm) {
      const p = propsOfSegment(doc, s.id)
      if (p) return { type: p.type, thicknessCm: p.thicknessCm }
    }
  }
  return { type: 'partition', thicknessCm: DEFAULT_THICKNESS.partition }
}

/**
 * Make one room from a cycle around the click: vertices on the cycle points, wall properties from
 * the traced walls or the room walls it lies on, next free code, name "Room <n>", last walk order.
 * The parts of the traces that the new room walls cover are removed in the same change, so the
 * whole thing is ONE undo step.
 */
export function createRoomFromCycle(doc: PlanDoc, cycle: EnclosingCycle, tolCm = 1): MakeRoomOutcome {
  const points = cycle.points
  if (points.length < 3 || area(points) < MIN_ROOM_AREA_CM2) return { kind: 'none' }
  const existing = doc.rooms.find((r) => samePolygon(r.vertices, points, tolCm))
  if (existing) return { kind: 'exists', room: existing }

  const code = nextRoomCode(doc)
  const n = Number(code.replace(/\D/g, '')) || doc.rooms.length + 1
  const vertices = points.map((p) => ({ id: uid('v'), x: p.x, y: p.y }))
  const walls: Record<string, WallProps> = {}
  vertices.forEach((v, i) => { walls[v.id] = edgeProps(doc, cycle, i, tolCm) })

  const room: Room = {
    id: uid('room'),
    code,
    name: `Room ${n}`,
    vertices,
    holes: [],
    walls,
    walkOrder: maxWalkOrder(doc) + 1,
    diagonal: vertices.length === 4 ? [0, 2] : undefined,
  }

  // The walls of the new room, as segments: the traces they cover can go.
  const roomEdges: EdgeRef[] = vertices.map((v, i) => ({
    id: `room:${room.id}:${v.id}`,
    a: { x: v.x, y: v.y },
    b: vertices[(i + 1) % vertices.length],
  }))
  const traces = doc.traces === undefined ? undefined : subtractCovered(doc.traces, roomEdges, tolCm)

  return {
    kind: 'ok',
    doc: { ...doc, rooms: [...doc.rooms, room], ...(traces === undefined ? {} : { traces }) },
    roomId: room.id,
  }
}

/**
 * Click of the Make room tool: the smallest closed area around `p` becomes one room.
 * `findEnclosingCycle` (src/model/faces.ts) splits the centre lines at their crossings.
 */
export function makeRoomAt(doc: PlanDoc, p: Vec, tolCm = 1): MakeRoomOutcome {
  const cycle = findEnclosingCycle(docSegments(doc), p, tolCm)
  if (!cycle) return { kind: 'none' }
  return createRoomFromCycle(doc, cycle, tolCm)
}
