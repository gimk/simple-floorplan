// The two sides of a stored wall, for the wall card and the canvas (docs/walls-plan.md,
// "Walls in the interface"). Pure: no store, no side effect. Units are cm, y points down.
//
// A stored wall is ONE object with two sides:
//   side L = left of node a -> node b, side R = right of it
//   (left of a direction (dx, dy) is (-dy, dx), so L is the side where the cross product of the
//   wall direction and the vector to the point is positive).
// Each side holds faces in order along the wall from node a to node b:
//   - a face of one room, with its survey label ('EN-3') and the value measured on it;
//   - several faces of the same room when T junctions cut that side (the Entree / Couloir case);
//   - an 'outside' span that no room covers (a facade). The two sides are cut independently, so
//     side L can hold one long face while side R holds three short ones.
import { dist } from '../../model/geometry'
import { surveyIds } from '../../model/survey'
import type { PlanDoc, Room, StoredFace, StoredNode, StoredWall, Vec, WallAlign } from '../../model/types'
import { deriveWallFaces, storedWallProps } from '../../model/v2/materialize'
import { outsideFaceSide, wallCentreCm, wallOutsidePlanCm, wallValueLabel } from '../../model/wallValues'

/** A room, as the wall card shows it: code and name for a link. */
export type RoomRef = { roomId: string; code: string; name: string }

/** One face of one side of a stored wall: a room face, or a span that no room covers. */
export type WallSideFace =
  | {
      kind: 'room'
      roomId: string
      code: string
      name: string
      /** Survey label of the face, e.g. 'EN-3'. */
      label: string
      /** Start vertex id of the room wall that makes this face. */
      wallStart: string
      /** Distance along the wall from node a, cm. */
      from: number
      to: number
      lengthCm: number
      /** Length from the drawing (inside face), cm; null when the room wall is gone. */
      plannedCm: number | null
      /** Value measured on site, cm; null when the face has no value. */
      measuredCm: number | null
    }
  | {
      kind: 'outside'
      from: number
      to: number
      lengthCm: number
    }

export type WallSideView = {
  side: 'L' | 'R'
  /** 'A' for side L, 'B' for side R: the names the wall card uses. */
  letter: 'A' | 'B'
  /** Rooms on this side, in order along the wall, without repetition. */
  rooms: RoomRef[]
  /** Faces in order along the wall (room faces and outside spans mixed). */
  faces: WallSideFace[]
  /** True when no room covers this side (a facade, or the free side of a single wall). */
  outside: boolean
  /**
   * Label of the outside face value ('W12-E') when the WHOLE side is outside (the facade side),
   * else null. A single outside span in the middle of a side has no value of its own.
   */
  facadeLabel: string | null
  /** Planned outside length (outside corner to outside corner), cm; null without a facade. */
  facadePlannedCm: number | null
}

export type StoredWallView = {
  wall: StoredWall
  /** Centre line ends, cm. */
  a: Vec
  b: Vec
  /** Centre line length, cm. */
  centreCm: number
  /** Wall properties, with the defaults of a room wall. */
  props: ReturnType<typeof storedWallProps>
  /** Rooms of the two sides, in walk order, without repetition (docs: 'Rooms: EN, CO'). */
  rooms: RoomRef[]
  /** Side A (L) then side B (R). */
  sides: [WallSideView, WallSideView]
}

const SIDES: readonly ('L' | 'R')[] = ['L', 'R']

const sideLetter = (side: 'L' | 'R'): 'A' | 'B' => (side === 'L' ? 'A' : 'B')

const nodeMap = (nodes: StoredNode[] | undefined) => new Map((nodes ?? []).map((n) => [n.id, { x: n.x, y: n.y }]))

/**
 * Side of a stored wall that holds a point. 'L' is the left of node a -> node b (y points down).
 * undefined when the two ends are the same point (no direction).
 */
export function sideOfPoint(a: Vec, b: Vec, p: Vec): 'L' | 'R' | undefined {
  const len = dist(a, b)
  if (len < 1e-6) return undefined
  const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)
  return cross >= 0 ? 'L' : 'R'
}

/**
 * Side of the stored wall where the face of `roomId` that starts at `wallStart` lies. This is the
 * side the user clicks on the canvas: the click comes from the hit area of one room wall.
 * undefined when that room has no face on the wall.
 */
export function sideOfRoomFace(wall: StoredWall, roomId: string, wallStart: string): 'L' | 'R' | undefined {
  const exact = wall.faces.find((f) => f.roomId === roomId && f.wallStart === wallStart)
  if (exact) return exact.side
  return wall.faces.find((f) => f.roomId === roomId)?.side
}

/** Walls with the faces of the room cycles, for a document that is not up to date yet. */
const wallsWithFaces = (doc: Pick<PlanDoc, 'rooms' | 'nodes' | 'walls'>): StoredWall[] => deriveWallFaces(doc)

/** The stored wall of a document, with the faces rebuilt from the room cycles. */
export function storedWallOf(
  doc: Pick<PlanDoc, 'rooms' | 'nodes' | 'walls'>,
  wallId: string,
): StoredWall | undefined {
  return wallsWithFaces(doc).find((w) => w.id === wallId)
}

/**
 * Side of a stored wall to select when the user clicks the wall of one room on the canvas:
 * the side where that room lies (the click comes from the hit area of that room wall).
 */
export function sideOfRoomWall(
  doc: Pick<PlanDoc, 'rooms' | 'nodes' | 'walls'>,
  wallId: string,
  roomId: string,
  wallStart: string,
): 'L' | 'R' | undefined {
  const wall = storedWallOf(doc, wallId)
  return wall ? sideOfRoomFace(wall, roomId, wallStart) : undefined
}

/** A room face of one side of a stored wall, found by a click on that wall. */
export type WallFaceRef = { roomId: string; wallStart: string; label: string }

/** A click this close to an end of a face still counts as on that face (cm). */
const FACE_TOL_CM = 1

/**
 * The room face of the side `side` of a stored wall that holds a point of the plan (cm). The
 * point is put on the centre line of the wall first, so a click anywhere in the band of the wall
 * finds its face. null when that side has no room at this point: outside on that side, or a click
 * past an end.
 *
 * This maps one click on a wall (one hit area, in WallsLayer) to the room of the side that was
 * clicked: Shift + click (group of room walls) and a double click (add a vertex) use it.
 */
export function wallFaceAt(
  doc: Pick<PlanDoc, 'rooms' | 'nodes' | 'walls' | 'measurements'>,
  wallId: string,
  side: 'L' | 'R',
  p: Vec,
): WallFaceRef | null {
  const view = storedWallView(doc, wallId)
  if (!view) return null
  const len = dist(view.a, view.b)
  if (len < 1e-6) return null
  const { a, b } = view
  const t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / len
  const along = Math.min(Math.max(t, 0), view.centreCm)
  const mine = view.sides.find((s) => s.side === side)
  for (const f of mine?.faces ?? []) {
    if (f.kind !== 'room') continue
    if (along >= f.from - FACE_TOL_CM && along <= f.to + FACE_TOL_CM) {
      return { roomId: f.roomId, wallStart: f.wallStart, label: f.label }
    }
  }
  return null
}

/**
 * Key of one face of a stored wall, as `Selection.face` stores it. A room face is
 * `room:<roomId>:<wallStart>`. An outside span is `out:<side>:<index>`, where the index counts the
 * outside spans of that side in order from node a (`indexAmongOutside`, ignored for a room face).
 */
export function faceKeyOf(side: 'L' | 'R', face: WallSideFace, indexAmongOutside: number): string {
  return face.kind === 'room' ? `room:${face.roomId}:${face.wallStart}` : `out:${side}:${indexAmongOutside}`
}

/** Keys of the faces of one side, in the order of `view.faces`. */
export function sideFaceKeys(view: Pick<WallSideView, 'side' | 'faces'>): string[] {
  let outside = 0
  return view.faces.map((f) => faceKeyOf(view.side, f, f.kind === 'outside' ? outside++ : 0))
}

/** One face of a stored wall, with its side and its key. */
export type WallFacePick = { side: 'L' | 'R'; key: string; face: WallSideFace }

/** The face of a wall view with this key, or null when the key names no face of the wall. */
export function faceByKey(view: Pick<StoredWallView, 'sides'>, key: string): WallFacePick | null {
  for (const s of view.sides) {
    const keys = sideFaceKeys(s)
    const at = keys.indexOf(key)
    if (at >= 0) return { side: s.side, key, face: s.faces[at] }
  }
  return null
}

/** Distance along the wall from node a of the point p, put on the centre line and clamped, cm. */
function alongOf(view: StoredWallView, p: Vec): number {
  const len = dist(view.a, view.b)
  if (len < 1e-6) return 0
  const t = ((p.x - view.a.x) * (view.b.x - view.a.x) + (p.y - view.a.y) * (view.b.y - view.a.y)) / len
  return Math.min(Math.max(t, 0), view.centreCm)
}

/** The face of one side at a distance along the wall (1 cm tolerance), or null. */
function faceAtAlong(view: StoredWallView, side: 'L' | 'R', along: number): WallFacePick | null {
  const mine = view.sides.find((s) => s.side === side)
  if (!mine) return null
  const keys = sideFaceKeys(mine)
  const at = mine.faces.findIndex((f) => along >= f.from - FACE_TOL_CM && along <= f.to + FACE_TOL_CM)
  return at >= 0 ? { side, key: keys[at], face: mine.faces[at] } : null
}

/**
 * The face of a stored wall under a point of the plan (cm): the side of the point, and the face
 * of that side (a room face or an outside span) at the position of the point along the wall. The
 * point is put on the centre line first and clamped to the wall. null when that side has no face
 * there (a single wall has none).
 */
export function wallFaceAtPoint(
  doc: Pick<PlanDoc, 'rooms' | 'nodes' | 'walls' | 'measurements'>,
  wallId: string,
  p: Vec,
): WallFacePick | null {
  const view = storedWallView(doc, wallId)
  const side = view ? sideOfPoint(view.a, view.b, p) : undefined
  return view && side ? faceAtAlong(view, side, alongOf(view, p)) : null
}

/**
 * The face directly across the wall from the point p: the OTHER side, at the same position along
 * the wall. The second click on a face selects it. null when the other side has no face there.
 */
export function wallFaceAcross(
  doc: Pick<PlanDoc, 'rooms' | 'nodes' | 'walls' | 'measurements'>,
  wallId: string,
  p: Vec,
): WallFacePick | null {
  const view = storedWallView(doc, wallId)
  const side = view ? sideOfPoint(view.a, view.b, p) : undefined
  return view && side ? faceAtAlong(view, otherSide(side), alongOf(view, p)) : null
}

/**
 * Key of the room face of `roomId` on one side of a wall. With a span [from, to] the face that
 * overlaps it most wins, else the first face of that room on that side. undefined when none.
 */
export function roomFaceKeyOnSide(
  doc: Pick<PlanDoc, 'rooms' | 'nodes' | 'walls' | 'measurements'>,
  wallId: string,
  side: 'L' | 'R',
  roomId: string,
  span?: { from: number; to: number },
): string | undefined {
  const view = storedWallView(doc, wallId)
  const mine = view?.sides.find((s) => s.side === side)
  if (!mine) return undefined
  const keys = sideFaceKeys(mine)
  let best: { key: string; overlap: number } | undefined
  mine.faces.forEach((f, i) => {
    if (f.kind !== 'room' || f.roomId !== roomId) return
    const overlap = span ? Math.min(f.to, Math.max(span.from, span.to)) - Math.max(f.from, Math.min(span.from, span.to)) : 0
    if (!best || overlap > best.overlap) best = { key: keys[i], overlap }
  })
  return best?.key
}

/** The other side of a wall: 'L' -> 'R', 'R' -> 'L'. */
export const otherSide = (side: 'L' | 'R'): 'L' | 'R' => (side === 'L' ? 'R' : 'L')

/**
 * Side of a stored wall that the alignment line ("In line on") is drawn on, as the wall card names
 * it: side A ('room'), the centre line ('center'), side B ('other'). Side A is side L, side B is
 * side R, so the card and the plan use the same letters (decisions of the UI review).
 */
export type WallAlignSide = 'A' | 'center' | 'B'

/** `align` of a stored wall in the names of the wall card: 'Side A' | 'Centre' | 'Side B'. */
export const wallAlignSide = (align: WallAlign | undefined): WallAlignSide =>
  align === 'center' ? 'center' : align === 'other' ? 'B' : 'A'

/**
 * Offset of the alignment line from the centre line of the wall, cm, along side L (side A). The
 * line of side A is half a thickness on the L side of the centre line, the line of side B the
 * other way, and the centre line is the centre.
 */
export function wallAlignOffsetCm(align: WallAlign | undefined, thicknessCm: number): number {
  const side = wallAlignSide(align)
  return side === 'A' ? thicknessCm / 2 : side === 'B' ? -thicknessCm / 2 : 0
}

/**
 * The outside face value of a stored wall ('W12-E') when a point of the plan is on the OUTSIDE
 * half of its facade side; null when the point is on the room side, or when no side of the wall
 * is a facade. Measuring Mode uses it: a click on the outside half of a facade wall opens its
 * outside face value, a click on the room half opens the field of the room face.
 */
export function outsideFaceLabelAtPoint(
  doc: Pick<PlanDoc, 'rooms' | 'nodes' | 'walls' | 'measurements'>,
  wallId: string,
  p: Vec,
): string | null {
  const view = storedWallView(doc, wallId)
  if (!view) return null
  const outside = outsideFaceSide(view.wall, view.centreCm)
  if (!outside) return null
  return sideOfPoint(view.a, view.b, p) === outside ? wallValueLabel(wallId, 'outside') : null
}

/** Rooms of the document, sorted the way the walk-through shows them. */
const walkOrdered = (rooms: Room[]) => [...rooms].sort((a, b) => a.walkOrder - b.walkOrder || a.code.localeCompare(b.code))

/** Survey label of one face of a room ('EN-3'), and its planned length, or nulls. */
function faceOfRoom(room: Room, face: StoredFace): { label: string; plannedCm: number | null } {
  const cycle = room.cycle ?? []
  const at = cycle.findIndex((f) => f.cornerId === face.wallStart)
  const index = at >= 0 ? at : room.vertices.findIndex((v) => v.id === face.wallStart)
  if (index < 0) return { label: '', plannedCm: null }
  const survey = surveyIds(room).filter((s) => s.kind === 'wall')
  return { label: `${room.code}-${index + 1}`, plannedCm: survey[index]?.plannedCm ?? null }
}

/** The two sides of one stored wall, or null when the wall (or one of its nodes) is not there. */
export function storedWallView(
  doc: Pick<PlanDoc, 'rooms' | 'nodes' | 'walls' | 'measurements'>,
  wallId: string,
): StoredWallView | null {
  const wall = storedWallOf(doc, wallId)
  const nodes = nodeMap(doc.nodes)
  const a = wall ? nodes.get(wall.a) : undefined
  const b = wall ? nodes.get(wall.b) : undefined
  if (!wall || !a || !b) return null
  const centreCm = wallCentreCm(doc.nodes ?? [], wall) ?? dist(a, b)
  const facadeSide = outsideFaceSide(wall, centreCm)
  const roomsById = new Map(doc.rooms.map((r) => [r.id, r]))

  const sides = SIDES.map((side): WallSideView => {
    const mine = wall.faces
      .filter((f) => f.side === side)
      .sort((x, y) => x.from - y.from || x.to - y.to)
    const rooms: RoomRef[] = []
    const faces: WallSideFace[] = mine.map((f): WallSideFace => {
      const from = Math.min(f.from, f.to)
      const to = Math.max(f.from, f.to)
      const room = f.roomId === undefined ? undefined : roomsById.get(f.roomId)
      if (f.roomId === undefined || !room) return { kind: 'outside', from, to, lengthCm: to - from }
      if (!rooms.some((r) => r.roomId === room.id)) rooms.push({ roomId: room.id, code: room.code, name: room.name })
      const { label, plannedCm } = faceOfRoom(room, f)
      return {
        kind: 'room',
        roomId: room.id,
        code: room.code,
        name: room.name,
        label,
        wallStart: f.wallStart ?? '',
        from,
        to,
        lengthCm: to - from,
        plannedCm,
        measuredCm: label ? doc.measurements[label]?.actualCm ?? null : null,
      }
    })
    const outside = !faces.some((f) => f.kind === 'room')
    const isFacade = facadeSide === side
    return {
      side,
      letter: sideLetter(side),
      rooms,
      faces,
      outside,
      facadeLabel: isFacade ? wallValueLabel(wall.id, 'outside') : null,
      facadePlannedCm: isFacade ? wallOutsidePlanCm(doc.rooms, doc.nodes ?? [], wall) : null,
    }
  }) as [WallSideView, WallSideView]

  // The rooms of the wall, in walk order: the card shows 'Rooms: EN, CO'.
  const present = new Set(sides.flatMap((s) => s.rooms.map((r) => r.roomId)))
  const rooms = walkOrdered(doc.rooms.filter((r) => present.has(r.id))).map((r) => ({ roomId: r.id, code: r.code, name: r.name }))

  return { wall, a, b, centreCm, props: storedWallProps(wall), rooms, sides }
}

/** One line of the room card wall list: 'EN-3 · W12 · shared with Couloir'. */
export type RoomWallLink = {
  /** Start vertex id of the room wall (the key of `room.walls`). */
  wallStart: string
  /** Stable id of the stored wall, e.g. 'W12'. */
  wallId: string
  /** Side of the stored wall that this room lies on: the side to select on a click. */
  side: 'L' | 'R'
  /** What is on the other side of the wall. */
  kind: 'shared' | 'facade' | 'own'
  /** Rooms on the other side, in walk order. */
  others: RoomRef[]
  /** Text after the wall id: 'shared with Couloir', 'facade', 'own wall'. */
  text: string
}

/**
 * Link of each wall of a room to its stored wall, keyed by the start vertex id of the room wall.
 * A wall with a room on the other side is 'shared with <rooms>'; a wall that stands alone (drawn
 * with the Wall tool, or left by a deleted room) is an 'own wall'; any other wall has the outside
 * on its other side and is a 'facade'.
 */
export function roomWallLinks(
  doc: Pick<PlanDoc, 'rooms' | 'nodes' | 'walls'>,
  room: Room,
): Map<string, RoomWallLink> {
  const out = new Map<string, RoomWallLink>()
  const walls = wallsWithFaces(doc)
  const roomsById = new Map(doc.rooms.map((r) => [r.id, r]))
  for (const face of room.cycle ?? []) {
    const wall = walls.find((w) => w.id === face.wallId)
    if (!wall) continue
    const other = face.side === 'L' ? 'R' : 'L'
    const otherFaces = wall.faces.filter((f) => f.side === other)
    const others: RoomRef[] = []
    for (const f of otherFaces) {
      const r = f.roomId === undefined ? undefined : roomsById.get(f.roomId)
      if (r && r.id !== room.id && !others.some((o) => o.roomId === r.id)) {
        others.push({ roomId: r.id, code: r.code, name: r.name })
      }
    }
    const kind: RoomWallLink['kind'] = others.length
      ? 'shared'
      : wall.standalone ? 'own' : 'facade'
    const text = kind === 'shared'
      ? `shared with ${others.map((o) => o.name).join(', ')}`
      : kind === 'facade' ? 'facade' : 'own wall'
    out.set(face.cornerId, { wallStart: face.cornerId, wallId: wall.id, side: face.side, kind, others, text })
  }
  return out
}
