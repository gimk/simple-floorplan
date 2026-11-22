// Pure whole-room transforms (cm): translate a room as a whole, scale it around an anchor corner.
// No React, no store: called by interaction.ts inside a drag.
import { dist } from '../../model/geometry'
import type { PlanDoc, Pin, Room, Vec, Vertex } from '../../model/types'
import { moveVertices, type VMove, type VRef } from './ops'

/** Smallest allowed room dimension when scaling from a corner (cm). */
export const MIN_ROOM_CM = 10

const EPS = 1e-6

/** Outline vertices, then hole vertices. */
export const allVertices = (room: Room): Vertex[] => [...room.vertices, ...room.holes.flat()]

/** Vertex of `room` (outline first) closest to `p`. */
export function nearestVertex(room: Room, p: Vec): Vertex | null {
  let best: Vertex | null = null
  let bd = Infinity
  for (const v of allVertices(room)) {
    const d = dist(v, p)
    if (d < bd) { bd = d; best = v }
  }
  return best
}

/** Outline vertex farthest from `vertexId`: the anchor of a corner resize (opposite corner). */
export function oppositeVertex(room: Room, vertexId: string): Vertex | null {
  const v = room.vertices.find((x) => x.id === vertexId)
  if (!v) return null
  let best: Vertex | null = null
  let bd = -1
  for (const o of room.vertices) {
    if (o.id === v.id) continue
    const d = dist(o, v)
    if (d > bd) { bd = d; best = o }
  }
  return best
}

/** Is at least one wall of the room locked? A locked wall forbids scaling (lengths would change). */
export const roomHasLockedWall = (room: Room) => Object.values(room.walls).some((w) => !!w && w.locked === true)

/** Outline vertex at `ref` in `doc`, if it still exists. */
export const vertexAt = (doc: Pick<PlanDoc, 'rooms'>, ref: VRef): Vertex | null =>
  doc.rooms.find((r) => r.id === ref.roomId)?.vertices.find((v) => v.id === ref.vertexId) ?? null

/** Pins of one room, moved through `f`; pins of other rooms are returned untouched. */
const mapRoomPins = (pins: PlanDoc['pins'], roomId: string, f: (p: Vec) => Vec): PlanDoc['pins'] =>
  pins?.map((p: Pin) => (p.roomId === roomId ? { ...p, at: f(p.at) } : p))

/**
 * Move one room as a whole: outline vertices, hole vertices and the pins that belong to it.
 * Walls, elements and survey data are relative, so they follow without a change.
 * Translating never changes a wall length, so a locked wall does not block it.
 */
export function translateRoom(doc: PlanDoc, roomId: string, d: Vec): PlanDoc {
  const shift = (p: Vec): Vec => ({ x: p.x + d.x, y: p.y + d.y })
  return {
    ...doc,
    rooms: doc.rooms.map((r) => (r.id !== roomId ? r : {
      ...r,
      vertices: r.vertices.map((v) => ({ ...v, ...shift(v) })),
      holes: r.holes.map((h) => h.map((v) => ({ ...v, ...shift(v) }))),
    })),
    pins: mapRoomPins(doc.pins, roomId, shift),
  }
}

/** Move a room and drag the linked vertices of other rooms (shared corners) with it. */
export function moveRoom(doc: PlanDoc, roomId: string, d: Vec, linked: VRef[] = []): PlanDoc {
  const next = translateRoom(doc, roomId, d)
  const moves: VMove[] = linked.flatMap((ref) => {
    const v = vertexAt(doc, ref)
    return v ? [{ ...ref, x: v.x + d.x, y: v.y + d.y }] : []
  })
  return moveVertices(next, moves)
}

export type ScaleFactors = { sx: number; sy: number }

/**
 * Factor on one axis of a corner resize. Never zero, never negative (no flip over the anchor),
 * and never smaller than `minCm` for that axis.
 */
export function axisFactor(fromCm: number, toCm: number, minCm = MIN_ROOM_CM): number {
  const span = Math.abs(fromCm)
  if (span < EPS) return 1 // degenerate axis: a corner on the anchor line cannot be scaled
  const min = minCm / span
  const r = toCm / fromCm
  return r > min ? r : min
}

/**
 * Scale factors of a corner resize: independent in x and y (a rectangle resize), or one factor
 * for both axes when `uniform` (Ctrl/Cmd + Shift).
 */
export function scaleFactors(anchor: Vec, corner: Vec, target: Vec, uniform = false, minCm = MIN_ROOM_CM): ScaleFactors {
  const sx = axisFactor(corner.x - anchor.x, target.x - anchor.x, minCm)
  const sy = axisFactor(corner.y - anchor.y, target.y - anchor.y, minCm)
  if (!uniform) return { sx, sy }
  const f = Math.max(sx, sy)
  return { sx: f, sy: f }
}

const scaleAbout = (p: Vec, anchor: Vec, f: ScaleFactors): Vec =>
  ({ x: anchor.x + (p.x - anchor.x) * f.sx, y: anchor.y + (p.y - anchor.y) * f.sy })

/** Scale a room around `anchor`: outline, holes and its pins. Ids, walls and elements are kept. */
export function scaleRoom(doc: PlanDoc, roomId: string, anchor: Vec, f: ScaleFactors): PlanDoc {
  const sc = (p: Vec) => scaleAbout(p, anchor, f)
  return {
    ...doc,
    rooms: doc.rooms.map((r) => (r.id !== roomId ? r : {
      ...r,
      vertices: r.vertices.map((v) => ({ ...v, ...sc(v) })),
      holes: r.holes.map((h) => h.map((v) => ({ ...v, ...sc(v) }))),
    })),
    pins: mapRoomPins(doc.pins, roomId, sc),
  }
}

/** A shared corner of another room and the vertex of the scaled room it must follow. */
export type Link = { ref: VRef; source: VRef }

/** Moves that put every linked vertex on the new place of the vertex it is linked to. */
export function linkMoves(after: PlanDoc, links: Link[]): VMove[] {
  return links.flatMap(({ ref, source }) => {
    const v = vertexAt(after, source)
    return v ? [{ ...ref, x: v.x, y: v.y }] : []
  })
}

/** Scale a room and move the linked vertices of its neighbours onto their new corners. */
export function scaleRoomWithLinks(doc: PlanDoc, roomId: string, anchor: Vec, f: ScaleFactors, links: Link[] = []): PlanDoc {
  const next = scaleRoom(doc, roomId, anchor, f)
  return links.length ? moveVertices(next, linkMoves(next, links)) : next
}
