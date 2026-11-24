// What is under a point of the plan, top first: this is the list that Tab flicks through
// (Rayon "TAB: flick through overlapping entities"). Pure: no store, no DOM, no side effect, so the
// order is tested alone. Units are cm, y points down.
//
// The order of the stack is fixed:
//   1. element on a wall (a door, a window, a cupboard...);
//   2. wall face: the face of the side under the point of a STORED wall (v2), or the ROOM WALL of a
//      v1 document (a v1 document has no stored wall: the wall is the face);
//   3. stored wall (v2 only): the wall of the face, with the side of the point;
//   4. vertex (an outline or a hole corner of a room);
//   5. room floor.
//
// The hit tests are the ones the click uses today, taken from their own modules, never copied:
//   - the stored wall band and its faces: ./wallSides.ts (storedWallView, wallFaceAtPoint,
//     sideOfPoint), and ./hoverTarget.ts (storedWallLine) for the two ends of a wall;
//   - a room wall of a v1 document: roomWalls + the thickness of the wall, which is the width of
//     the hit line of RoomsLayer.tsx (max(thickness, 18 px));
//   - the room floor: roomInnerRing (the inside faces) and pointInPolygon.
// An element is the one hit test that has no pure form today: ElementsLayer.tsx hit-tests the SVG
// symbols with the DOM. `elementPicks` gives the same span (the element box on its wall), so a Tab
// press on a door finds the door.
import { area, pointInPolygon, projectOnSegment, roomInnerRing, roomWalls } from '../../model/geometry'
import { selKey } from '../../model/selection'
import type { PlanDoc, Selection, Vec, Vertex } from '../../model/types'
import { storedWallProps } from '../../model/v2/materialize'
import { isV2Doc } from '../../model/v2/targets'
import { storedWallLine } from './hoverTarget'
import { sideOfPoint, wallFaceAtPoint } from './wallSides'
import { wallProps } from './walls'

/** One item of the stack: a selection, so Tab can give it to `useUi.select` as it is. */
export type PickItem = NonNullable<Selection>

/** The document fields the stack reads. */
export type PickDoc = Pick<PlanDoc, 'rooms' | 'elements' | 'schemaVersion' | 'nodes' | 'walls' | 'measurements'>

/** Distance of one hit, cm: the nearest thing under the point comes first in its group. */
type Hit<T> = { item: T; distance: number }

const byDistance = <T>(a: Hit<T>, b: Hit<T>) => a.distance - b.distance

/** Half of the wall band under a point: the thickness, plus the slack of the pointer (cm). */
const bandOf = (thicknessCm: number, tolCm: number) => Math.max(thicknessCm / 2, tolCm)

/**
 * Key of one stack item, side and face included. `selKey` (model/selection.ts) ignores both, so a
 * face and its wall would look equal and Tab would stop on them.
 */
export const pickKey = (s: PickItem): string =>
  selKey(s) + (s.kind === 'storedWall' ? `:${s.side ?? ''}:${s.face ?? ''}` : '')

/**
 * Elements whose box on their wall holds the point: the span of the element along the wall, within
 * half of the wall thickness plus the slack. Nearest first (two elements cannot overlap much, but the
 * rule stays the same).
 */
function elementPicks(doc: PickDoc, point: Vec, tolCm: number): PickItem[] {
  const hits: Hit<PickItem>[] = []
  for (const el of doc.elements) {
    // An element without a width is not drawn and not hit-tested by ElementsLayer.tsx.
    if (!(typeof el.widthCm === 'number') || !(el.widthCm > 0)) continue
    const room = doc.rooms.find((r) => r.id === el.roomId)
    if (!room) continue
    const wall = roomWalls(room).find((w) => w.start.id === el.wallStart)
    if (!wall) continue
    // The two ends of the element on the line of its wall (the frame of elementFrame, elements/geometry).
    const a = { x: wall.start.x + wall.dir.x * el.offsetCm, y: wall.start.y + wall.dir.y * el.offsetCm }
    const b = { x: a.x + wall.dir.x * el.widthCm, y: a.y + wall.dir.y * el.widthCm }
    const pr = projectOnSegment(point, a, b)
    if (pr.distance <= bandOf(wallProps(room, el.wallStart).thicknessCm, tolCm)) {
      hits.push({ item: { kind: 'element', elementId: el.id }, distance: pr.distance })
    }
  }
  return hits.sort(byDistance).map((h) => h.item)
}

/** Stored walls whose band holds the point, nearest first (v2 documents). */
function storedWallPicks(doc: PickDoc, point: Vec, tolCm: number): PickItem[] {
  const hits: Hit<PickItem>[] = []
  for (const wall of doc.walls ?? []) {
    const line = storedWallLine(doc, wall.id)
    if (!line) continue
    const pr = projectOnSegment(point, line.a, line.b)
    if (pr.distance > bandOf(storedWallProps(wall).thicknessCm, tolCm)) continue
    const side = sideOfPoint(line.a, line.b, point) ?? 'L'
    hits.push({ item: { kind: 'storedWall', wallId: wall.id, side }, distance: pr.distance })
  }
  return hits.sort(byDistance).map((h) => h.item)
}

/** Room walls whose band holds the point, nearest first (v1 documents). */
function roomWallPicks(doc: PickDoc, point: Vec, tolCm: number): PickItem[] {
  const hits: Hit<PickItem>[] = []
  for (const room of doc.rooms) {
    for (const wall of roomWalls(room)) {
      const pr = projectOnSegment(point, wall.start, wall.end)
      if (pr.distance > bandOf(wallProps(room, wall.start.id).thicknessCm, tolCm)) continue
      hits.push({ item: { kind: 'wall', roomId: room.id, wallStart: wall.start.id }, distance: pr.distance })
    }
  }
  return hits.sort(byDistance).map((h) => h.item)
}

/** Outline and hole corners of the rooms, within `tolCm` of the point, nearest first. */
function vertexPicks(doc: PickDoc, point: Vec, tolCm: number): PickItem[] {
  const hits: Hit<PickItem>[] = []
  const add = (roomId: string, v: Vertex) => {
    const d = Math.hypot(point.x - v.x, point.y - v.y)
    if (d <= tolCm) hits.push({ item: { kind: 'vertex', roomId, vertexId: v.id }, distance: d })
  }
  for (const room of doc.rooms) {
    for (const v of room.vertices) add(room.id, v)
    for (const hole of room.holes) for (const v of hole) add(room.id, v)
  }
  return hits.sort(byDistance).map((h) => h.item)
}

/** Floors that hold the point: the inside ring, minus the holes. Smallest room first (innermost). */
function roomPicks(doc: PickDoc, point: Vec): PickItem[] {
  const hits: Hit<PickItem>[] = []
  for (const room of doc.rooms) {
    const ring = roomInnerRing(room)
    if (!pointInPolygon(point, ring)) continue
    if (room.holes.some((h) => pointInPolygon(point, h))) continue
    hits.push({ item: { kind: 'room', roomId: room.id }, distance: area(ring) })
  }
  return hits.sort(byDistance).map((h) => h.item)
}

/**
 * Everything under `point` of the plan, top first. `tolCm` is the slack of the pointer, in cm
 * (screen px divided by the zoom): it widens the wall band and the radius of a corner.
 */
export function pickStack(doc: PickDoc, point: Vec, tolCm: number): PickItem[] {
  const tol = Math.max(tolCm, 0)
  const out: PickItem[] = [...elementPicks(doc, point, tol)]

  if (isV2Doc(doc)) {
    // The face of the side under the point, then the wall itself: one wall between two rooms gives
    // two faces, but only the face of the side of the pointer is under the pointer.
    const walls = storedWallPicks(doc, point, tol)
    for (const wall of walls) {
      if (wall.kind !== 'storedWall') continue
      const face = wallFaceAtPoint(doc, wall.wallId, point)
      if (face) out.push({ kind: 'storedWall', wallId: wall.wallId, side: face.side, face: face.key })
    }
    out.push(...walls)
  } else {
    // A v1 document: the room wall is the face (there is no stored wall to show as well).
    out.push(...roomWallPicks(doc, point, tol))
  }

  out.push(...vertexPicks(doc, point, tol))
  out.push(...roomPicks(doc, point))

  // One entry per thing, in the order above.
  const seen = new Set<string>()
  return out.filter((item) => {
    const k = pickKey(item)
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/**
 * The item after `current` in the stack, wrapping around. `back` (Shift + Tab) gives the item
 * before it. When the current selection is not in the stack, Tab starts at the top (or the bottom,
 * going back). null when the stack has one item or none: Tab must then keep its browser meaning.
 */
export function nextInStack(stack: PickItem[], current: Selection, back = false): PickItem | null {
  if (stack.length < 2) return null
  const keys = stack.map(pickKey)
  const at = current ? keys.indexOf(pickKey(current)) : -1
  if (at < 0) return back ? stack[stack.length - 1] : stack[0]
  const step = back ? -1 : 1
  return stack[(at + step + stack.length) % stack.length]
}
