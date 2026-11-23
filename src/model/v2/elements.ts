// Elements on walls of a v2 document (docs/walls-plan.md, phase 7). Pure, cm, y points down.
//
// In a v2 document an element belongs to a WALL, not to one room wall:
//   - `wallId` + `alongCm` (distance from node a of the wall to the near edge of the element) are
//     the stored data, so a door between two rooms is ONE element on ONE wall;
//   - `roomId` + `wallStart` + `offsetCm` stay the calculated view: the room the element opens into,
//     the face of that room which holds it, and the distance from that face's start corner along the
//     face direction (the room travel direction: a -> b on side L, b -> a on side R).
// A v1 document keeps only the view, so these functions give it back unchanged.
//
// `attachElements(doc)`: an element without `wallId` (a converted v1 document, a tool or a command
// that placed an element with the view only) gets `wallId` and `alongCm` from its view. The view is
// NOT touched: nothing moves.
//
// `materializeElements(doc)`: every element with `wallId` gets its view calculated again:
//   1. a face of `element.roomId` on that wall holds the element: it gives `wallStart` and
//      `offsetCm`, so a corner added on the wall before the element changes the numbers of the
//      view, never the element (same `wallId`, same `alongCm`);
//   2. the wall is gone (a deleted room took it): the element keeps its last view and loses
//      `wallId`. An element is never deleted;
//   3. no face of its own room holds it any more (the room was deleted, or the wall is no longer
//      one of its walls): the element opens into the room on the other side of the wall, and gets
//      `elementMoved` as a hint for the user. When its room is gone and no face of another room
//      covers it, the nearest face of that wall keeps it visible.
// `alongCm` is kept from node a, and clamped into the wall: a node drag that makes the wall shorter
// moves the view of the element, not the element.
//
// `syncElements(prev, next)` is the whole rule for the store and the server commands: place, follow
// a view that the user moved, then calculate the views.

import { dist } from '../geometry'
import type { PlanDoc, Room, StoredWall, Vec, WallElement } from '../types'
import { roundStored } from './materialize'

/** One face of one room on one wall, with the wall it belongs to. */
type Face = { wallId: string; roomId: string; wallStart: string; side: 'L' | 'R'; from: number; to: number }

/** Two numbers of the view this close are the same number (1 mm: the wall graph precision). */
const VIEW_TOL_CM = 0.001
/** A face holds an element when its span covers the element within this distance (cm). */
const FACE_TOL_CM = 0.5

const near = (a: number, b: number) => Math.abs(a - b) <= VIEW_TOL_CM

/** The document as the functions of this file read it. */
type Graph = { rooms: Room[]; roomById: Map<string, Room>; wallById: Map<string, StoredWall>; nodes: Map<string, Vec> }

function graphOf(doc: Pick<PlanDoc, 'rooms' | 'nodes' | 'walls'>): Graph {
  return {
    rooms: doc.rooms,
    roomById: new Map(doc.rooms.map((r) => [r.id, r])),
    wallById: new Map((doc.walls ?? []).map((w) => [w.id, w])),
    nodes: new Map((doc.nodes ?? []).map((n) => [n.id, { x: n.x, y: n.y }])),
  }
}

/** Length of a wall, or null when the wall or one of its nodes is missing (or the two nodes touch). */
function wallLength(g: Graph, wallId: string): number | null {
  const w = g.wallById.get(wallId)
  if (!w) return null
  const a = g.nodes.get(w.a)
  const b = g.nodes.get(w.b)
  if (!a || !b) return null
  const length = dist(a, b)
  return length > 1e-6 ? length : null
}

/** A face of a room cycle, in room order (from < to). */
const cycleFace = (f: { wallId: string; side: 'L' | 'R'; from: number; to: number; cornerId: string }, roomId: string): Face => ({
  wallId: f.wallId,
  roomId,
  wallStart: f.cornerId,
  side: f.side,
  from: Math.min(f.from, f.to),
  to: Math.max(f.from, f.to),
})

/**
 * The faces of one room, in room order. The room cycle is the source; a room without a cycle (a
 * fallback room of a v2 document) uses the faces that the walls keep for it.
 */
function roomFaces(g: Graph, roomId: string): Face[] {
  const room = g.roomById.get(roomId)
  const cycle = room?.cycle ?? []
  if (cycle.length) return cycle.map((f) => cycleFace(f, roomId))
  const out: Face[] = []
  for (const w of g.wallById.values()) {
    for (const f of w.faces) {
      if (f.roomId !== roomId || !f.wallStart) continue
      out.push({
        wallId: w.id, roomId, wallStart: f.wallStart, side: f.side,
        from: Math.min(f.from, f.to), to: Math.max(f.from, f.to),
      })
    }
  }
  return out
}

/** Every face of one wall, whatever the room (the element can show on the other side too). */
function facesOfWall(g: Graph, wallId: string): Face[] {
  const out: Face[] = []
  for (const r of g.rooms) out.push(...roomFaces(g, r.id).filter((f) => f.wallId === wallId))
  return out
}

/**
 * Distance from node a of the near edge of an element, from its view: `offsetCm` runs from the face
 * start corner in the travel direction of the room (a -> b on side L, b -> a on side R).
 */
function alongFromView(f: Face, offsetCm: number, widthCm: number): number {
  const start = f.side === 'L' ? f.from : f.to
  const step = f.side === 'L' ? 1 : -1
  const e0 = start + step * offsetCm
  const e1 = e0 + step * widthCm
  return roundStored(Math.min(e0, e1))
}

/** The face of a room that holds the span `[lo, hi]` of a wall, or null. */
function holdingFace(faces: Face[], lo: number, hi: number): Face | null {
  const holding = faces.filter((f) => f.from <= lo + FACE_TOL_CM && f.to >= hi - FACE_TOL_CM)
  return holding.length ? holding.reduce((best, f) => (f.to - f.from > best.to - best.from ? f : best)) : null
}

/** The face of a room that the span `[lo, hi]` overlaps the most, or null when nothing overlaps. */
function overlappingFace(faces: Face[], lo: number, hi: number): Face | null {
  let best: Face | null = null
  let bestOverlap = 0
  for (const f of faces) {
    const overlap = Math.min(hi, f.to) - Math.max(lo, f.from)
    if (overlap <= 0) continue
    if (overlap > bestOverlap) {
      bestOverlap = overlap
      best = f
    }
  }
  return best
}

/** Distance between a face and the span `[lo, hi]` along the wall (0 when the face holds it). */
function faceGap(f: Face, lo: number, hi: number): number {
  if (f.to < lo) return lo - f.to
  if (f.from > hi) return f.from - hi
  return 0
}

/** The element with the view of one face: the room it opens into, the face, and the offset. */
function withView(el: WallElement, f: Face, lo: number, hi: number, alongCm: number): WallElement {
  const roomMoved = el.roomId !== f.roomId
  // The near edge in the travel direction of the room: the start end on side L, the end one on side R.
  const offsetCm = roundStored(Math.max(0, f.side === 'L' ? lo - f.from : f.to - hi))
  const same =
    !roomMoved && el.wallStart === f.wallStart && near(offsetCm, el.offsetCm) &&
    el.alongCm !== undefined && near(alongCm, el.alongCm)
  if (same) return el
  const out: WallElement = { ...el, roomId: f.roomId, wallStart: f.wallStart, offsetCm, alongCm }
  if (roomMoved) out.elementMoved = true
  return out
}

/**
 * The element with its view calculated from its wall, or the SAME element when the view is already
 * right. An element without `wallId` is given back as it is (call `attachElements` first).
 */
function materializeOne(g: Graph, el: WallElement): WallElement {
  const wallId = el.wallId
  if (!wallId || el.alongCm === undefined) return el
  const length = wallLength(g, wallId)
  // The wall is gone: the last view stays, and the element has no wall any more. Never delete it.
  if (length === null) {
    const { wallId: _gone, alongCm: _along, ...rest } = el
    return rest
  }
  const widthCm = el.widthCm > 0 ? el.widthCm : 0
  // The distance from node a stays; a wall that a drag made shorter pulls the element inside.
  const alongCm = roundStored(Math.min(Math.max(el.alongCm, 0), Math.max(0, length - widthCm)))
  const lo = alongCm
  const hi = alongCm + widthCm

  // 1. The face of its own room that holds it (the usual case, and a corner added on the wall).
  const own = roomFaces(g, el.roomId).filter((f) => f.wallId === wallId)
  const home = holdingFace(own, lo, hi) ?? overlappingFace(own, lo, hi)
  if (home) return withView(el, home, lo, hi, alongCm)

  // 2. The same wall, seen from the room on the other side: the element opens into that room now.
  const others = facesOfWall(g, wallId).filter((f) => f.roomId !== el.roomId)
  const away = holdingFace(others, lo, hi) ?? overlappingFace(others, lo, hi)
  if (away) return withView(el, away, lo, hi, alongCm)

  // 3. Its room is gone, and no face of another room holds the element: the nearest face of that
  //    wall keeps it visible (the room of the element does not exist any more).
  if (!own.length && others.length) {
    const nearest = others.reduce((best, f) => (faceGap(f, lo, hi) < faceGap(best, lo, hi) ? f : best))
    return withView(el, nearest, lo, hi, alongCm)
  }

  // 4. No room holds this part of the wall: keep the last view, and the wall (the next edit fixes it).
  return el.alongCm === alongCm ? el : { ...el, alongCm }
}

/** Attach one element to the wall of its view, or give it back when the view points nowhere. */
function attachOne(g: Graph, el: WallElement): WallElement {
  const face = roomFaces(g, el.roomId).find((f) => f.wallStart === el.wallStart)
  if (!face) return el
  // A wall without geometry cannot hold an element (a document in the middle of a repair).
  if (wallLength(g, face.wallId) === null) return el
  return { ...el, wallId: face.wallId, alongCm: alongFromView(face, el.offsetCm, el.widthCm) }
}

/**
 * Every element without `wallId` gets its wall and its distance from node a, taken from its view.
 * A v1 document, and an element whose view points nowhere, stay as they are.
 */
export function attachElements(doc: PlanDoc): PlanDoc {
  if (doc.schemaVersion !== 2 || !doc.elements.length) return doc
  if (doc.elements.every((e) => e.wallId)) return doc
  const g = graphOf(doc)
  let changed = false
  const elements = doc.elements.map((el) => {
    if (el.wallId) return el
    const next = attachOne(g, el)
    if (next === el) return el
    changed = true
    return next
  })
  return changed ? { ...doc, elements } : doc
}

/**
 * The view of every element with a `wallId` calculated again from its wall. Gives the same document
 * back when every view is already right, so a drag does not make a new document on every move.
 */
export function materializeElements(doc: PlanDoc): PlanDoc {
  if (!doc.elements.some((e) => e.wallId)) return doc
  const g = graphOf(doc)
  let changed = false
  const elements = doc.elements.map((el) => {
    const next = materializeOne(g, el)
    if (next === el) return el
    changed = true
    return next
  })
  return changed ? { ...doc, elements } : doc
}

/**
 * The elements whose VIEW changed since `prev` (a drag along the wall, a command, the door-host
 * rule): the distance from node a follows the view. This is how a write on `offsetCm` becomes a
 * write on `alongCm`.
 */
function followViews(prev: PlanDoc, next: PlanDoc): PlanDoc {
  const before = new Map(prev.elements.map((e) => [e.id, e]))
  const g = graphOf(next)
  let changed = false
  const elements = next.elements.map((el) => {
    const was = before.get(el.id)
    if (!was || !el.wallId || el.alongCm === undefined) return el
    if (was.roomId === el.roomId && was.wallStart === el.wallStart && was.offsetCm === el.offsetCm) return el
    // The view moved: the wall keeps the element where the view says, on the face of the view.
    const face = roomFaces(g, el.roomId).find((f) => f.wallStart === el.wallStart && f.wallId === el.wallId)
    if (!face) return el
    const alongCm = alongFromView(face, el.offsetCm, el.widthCm)
    if (near(alongCm, el.alongCm)) return el
    changed = true
    return { ...el, alongCm }
  })
  return changed ? { ...next, elements } : next
}

/**
 * Keep the elements on their walls: attach the ones that have no wall yet, follow a view that the
 * user (or the door-host rule) moved, then calculate every view. `prev` is the document before the
 * edit, so only the elements that really changed get a new `alongCm`.
 */
export function syncElements(prev: PlanDoc, next: PlanDoc): PlanDoc {
  const placed = attachElements(next)
  // Same element array as before the edit: no view moved, so only the views are calculated again.
  const followed = placed.elements === prev.elements ? placed : followViews(prev, placed)
  return materializeElements(followed)
}
