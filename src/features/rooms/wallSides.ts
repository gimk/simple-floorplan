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
import type { PlanDoc, Room, StoredFace, StoredNode, StoredWall, Vec } from '../../model/types'
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
