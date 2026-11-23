// Values of a stored wall (docs/walls-plan.md phase 5b). Pure, cm, y points down.
//
// A stored wall (`doc.walls`, stable id W1, W2...) has its own length values. They stay keyed by
// label in `doc.measurements`:
//   'W12-C' = CENTRE line length, node a to node b. Usually read on an architect plan.
//   'W12-E' = OUTSIDE face length. Only for a facade wall: a side with no room that covers the
//             whole length. It goes from outside corner to outside corner, that is between the
//             outside faces of the walls at its two ends.
//
// This file holds the labels, the facade test, the walls at the two ends of a wall, and the move
// of the values of a wall that is gone. No store import: the doc rule lives in measureRules.ts.
import { DEFAULT_WALL_CM, dist, projectOnSegment, roomWalls } from './geometry'
import type { Measurement, PlanDoc, Room, StoredNode, StoredWall, Vec } from './types'

/** The two kinds of value that belong to a stored wall. */
export type WallValueKind = 'centre' | 'outside'

export type WallValueLabel = { wallId: string; kind: WallValueKind }

/** A room wall end this close to a stored wall line is on it (cm). */
const ON_WALL_TOL_CM = 2
/** |cos| under this between two directions: the walls are perpendicular. */
const PERP_TOL = 0.05
/** Face ends closer than this leave no gap (cm). */
const GAP_TOL_CM = 1

/** Label of one value of a stored wall: 'W12-C' or 'W12-E'. */
export const wallValueLabel = (wallId: string, kind: WallValueKind) => `${wallId}-${kind === 'centre' ? 'C' : 'E'}`

/** 'W12-C' -> { wallId: 'W12', kind: 'centre' }. null for any other label. */
export function parseWallValueLabel(label: string): WallValueLabel | null {
  const m = /^(W\d+)-([CE])$/.exec(label)
  return m ? { wallId: m[1], kind: m[2] === 'C' ? 'centre' : 'outside' } : null
}

/** Centre line length of a stored wall (cm), or null when a node is missing. */
export function wallCentreCm(nodes: StoredNode[], wall: StoredWall): number | null {
  const a = nodes.find((n) => n.id === wall.a)
  const b = nodes.find((n) => n.id === wall.b)
  return a && b ? dist(a, b) : null
}

/**
 * Side of the wall that no room covers on its whole length (a facade), or null.
 * A side is a facade when every face of that side has no room, the faces leave no gap and they
 * cover the wall from 0 to its length.
 */
export function outsideFaceSide(wall: StoredWall, centreCm: number): 'L' | 'R' | null {
  for (const side of ['L', 'R'] as const) {
    const faces = wall.faces.filter((f) => f.side === side).sort((a, b) => a.from - b.from)
    if (!faces.length) continue
    if (faces.some((f) => f.roomId !== undefined)) continue
    let end = 0
    let ok = true
    for (const f of faces) {
      if (Math.abs(f.from - end) > GAP_TOL_CM) { ok = false; break }
      end = Math.max(end, f.to)
    }
    if (ok && Math.abs(end - centreCm) <= GAP_TOL_CM) return side
  }
  return null
}

/** One room wall that continues an end of a stored wall, with its thickness. */
export type RoomWallRef = {
  roomId: string
  /** Index of the room in the array given to `wallEnds` (same order as the solver edges). */
  roomIndex: number
  wallStart: string
  /** Index of the room wall in its polygon. */
  index: number
  thicknessCm: number
}

/** The room walls that continue the a end and the b end of a stored wall. */
export type WallEnds = { a: RoomWallRef | null; b: RoomWallRef | null }

/**
 * The perpendicular room walls at the two ends of a stored wall: the walls that give the outside
 * corner at each end. A wall end with no such room wall (a free end) gives null.
 *
 * The room walls that lie ON the stored wall are read first (a stored wall can hold two room walls
 * in line, one per room), so the walls at the two ends are their neighbours in the room polygon.
 */
export function wallEnds(rooms: Room[], nodes: StoredNode[], wall: StoredWall): WallEnds {
  const out: WallEnds = { a: null, b: null }
  const na = nodes.find((n) => n.id === wall.a)
  const nb = nodes.find((n) => n.id === wall.b)
  if (!na || !nb) return out
  const length = dist(na, nb)
  if (length < 1) return out
  const d = { x: (nb.x - na.x) / length, y: (nb.y - na.y) / length }
  const left = { x: -d.y, y: d.x }
  const u = (p: Vec) => (p.x - na.x) * d.x + (p.y - na.y) * d.y
  const v = (p: Vec) => (p.x - na.x) * left.x + (p.y - na.y) * left.y

  for (const face of wall.faces) {
    if (face.roomId === undefined) continue
    const roomIndex = rooms.findIndex((r) => r.id === face.roomId)
    if (roomIndex < 0) continue
    const room = rooms[roomIndex]
    const walls = roomWalls(room)
    const n = walls.length
    // Room walls on this stored wall: both ends close to the line and inside its span.
    const on = walls
      .filter((w) => w.length >= 1 && Math.abs(v(w.start)) <= ON_WALL_TOL_CM && Math.abs(v(w.end)) <= ON_WALL_TOL_CM)
      .filter((w) => Math.max(u(w.start), u(w.end)) >= -ON_WALL_TOL_CM && Math.min(u(w.start), u(w.end)) <= length + ON_WALL_TOL_CM)
    if (!on.length) continue
    const first = on.reduce((a, b) => (Math.min(u(a.start), u(a.end)) <= Math.min(u(b.start), u(b.end)) ? a : b))
    const last = on.reduce((a, b) => (Math.max(u(a.start), u(a.end)) >= Math.max(u(b.start), u(b.end)) ? a : b))
    // Room walls follow the polygon: they can run from the a end to the b end, or the other way.
    const reversed = u(first.start) > u(first.end)
    // The wall at an end must pass through that end node: at a corner (its own end is there) or
    // as a T junction (the node lies on it).
    const refOf = (index: number, end: Vec): RoomWallRef | null => {
      const w = walls[index]
      if (!w) return null
      // A wall in line with the stored wall gives no outside corner.
      if (Math.abs(w.dir.x * d.x + w.dir.y * d.y) > PERP_TOL) return null
      if (projectOnSegment(end, w.start, w.end).distance > ON_WALL_TOL_CM) return null
      return {
        roomId: room.id, roomIndex, wallStart: w.start.id, index,
        thicknessCm: room.walls[w.start.id]?.thicknessCm ?? DEFAULT_WALL_CM,
      }
    }
    // The wall before the first one in the polygon is the wall at the a end (or after, if reversed).
    if (!out.a) out.a = refOf(reversed ? (first.index + 1) % n : (first.index - 1 + n) % n, na)
    if (!out.b) out.b = refOf(reversed ? (last.index - 1 + n) % n : (last.index + 1) % n, nb)
    if (out.a && out.b) break
  }
  return out
}

/**
 * Planned OUTSIDE face length from the drawing (cm): the centre line plus half of the thickness of
 * the wall at each end (the two outside corners). An end with no perpendicular wall adds nothing,
 * and the solver skips a value on such a wall (see `wallEnds`).
 */
export function wallOutsidePlanCm(rooms: Room[], nodes: StoredNode[], wall: StoredWall): number | null {
  const centre = wallCentreCm(nodes, wall)
  if (centre === null) return null
  const ends = wallEnds(rooms, nodes, wall)
  return centre + ((ends.a?.thicknessCm ?? 0) + (ends.b?.thicknessCm ?? 0)) / 2
}

/** Stored wall that holds a room wall (roomId + start vertex id), or null. */
export function storedWallOfRoomWall(
  doc: { rooms: Room[]; walls?: StoredWall[]; nodes?: StoredNode[] },
  roomId: string,
  wallStart: string,
): StoredWall | null {
  const walls = doc.walls ?? []
  const direct = walls.find((w) => w.faces.some((f) => f.roomId === roomId && f.wallStart === wallStart))
  if (direct) return direct
  // A stored wall that holds two room walls in line carries the start vertex of one of them only:
  // find it by geometry.
  const room = doc.rooms.find((r) => r.id === roomId)
  const nodes = doc.nodes ?? []
  const w = room ? roomWalls(room).find((x) => x.start.id === wallStart) : undefined
  if (!w) return null
  for (const sw of walls) {
    const na = nodes.find((n) => n.id === sw.a)
    const nb = nodes.find((n) => n.id === sw.b)
    if (!na || !nb) continue
    const onWall = (p: Vec) => {
      const dx = nb.x - na.x, dy = nb.y - na.y
      const len = Math.hypot(dx, dy)
      if (len < 1) return false
      const ux = dx / len, uy = dy / len
      const along = (p.x - na.x) * ux + (p.y - na.y) * uy
      const off = Math.abs(-(p.x - na.x) * uy + (p.y - na.y) * ux)
      return off <= ON_WALL_TOL_CM && along >= -ON_WALL_TOL_CM && along <= len + ON_WALL_TOL_CM
    }
    if (onWall(w.start) && onWall(w.end)) return sw
  }
  return null
}

/** First face of a stored wall that a room sees: the room wall to select or to type a value in. */
export function firstRoomFace(wall: StoredWall): { roomId: string; wallStart: string } | null {
  const face = wall.faces.find((f) => f.roomId !== undefined && f.wallStart !== undefined)
  return face && face.roomId !== undefined && face.wallStart !== undefined
    ? { roomId: face.roomId, wallStart: face.wallStart }
    : null
}

/**
 * Ids of the walls that are in `before` and not in `after`. A wall that keeps its id keeps its
 * values; a wall that is split gives its id to one part, so only a removed wall comes here.
 */
export const removedWallIds = (
  before: { walls?: StoredWall[] },
  after: { walls?: StoredWall[] },
): string[] => {
  const still = new Set((after.walls ?? []).map((w) => w.id))
  return (before.walls ?? []).map((w) => w.id).filter((id) => !still.has(id))
}

/** A value that leaves `measurements` (same shape as DroppedValue in relabel.ts). */
export type RemovedWallValue = {
  roomCode: string
  reason: 'wall-removed'
  measurement: Measurement
}

/**
 * Values of the stored walls that are gone leave `doc.measurements` and go to the old values
 * (reason 'wall-removed', roomCode ''). A wall whose id stays keeps its values.
 * Null when no value has to move, so the doc does not change.
 */
export function removedWallValues(
  before: { walls?: StoredWall[] },
  after: { measurements: PlanDoc['measurements']; walls?: StoredWall[] },
): { measurements: PlanDoc['measurements']; dropped: RemovedWallValue[] } | null {
  const gone = new Set(removedWallIds(before, after))
  if (!gone.size) return null
  const measurements: PlanDoc['measurements'] = { ...after.measurements }
  const dropped: RemovedWallValue[] = []
  for (const [label, m] of Object.entries(after.measurements)) {
    const parsed = parseWallValueLabel(label)
    if (!parsed || !gone.has(parsed.wallId)) continue
    delete measurements[label]
    dropped.push({ roomCode: '', reason: 'wall-removed', measurement: m })
  }
  return dropped.length ? { measurements, dropped } : null
}
