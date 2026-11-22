// The canonical door-host rule: a door belongs to the room it opens into.
// An element lives on one wall of one room (roomId + wallStart + offsetCm).
// A door with swing 'out' draws its arc into the NEIGHBOUR room, so it must be stored on that
// neighbour room instead: same world position, same hinge point, swing 'in'.
// Pure module (no React, no store): usable by the command layer, Edit Mode and Measuring Mode.
import { cross, dot, lerp, roomWalls, sub } from '../model/geometry'
import type { Wall } from '../model/geometry'
import type { PlanDoc, Room, Vec, WallElement } from '../model/types'
import { findSharedWalls } from './queries'
import type { SharedWall } from './queries'

/** Two walls closer than this are treated as the same wall (same value as ADJ_TOLERANCE_CM in features/measure/logic.ts). */
export const DOOR_HOST_TOLERANCE_CM = 3

export type DoorHostMove = { elementId: string; fromRoomId: string; toRoomId: string }

const nowIso = (): string => new Date().toISOString()

/** Host wall of an element: the wall of `room` that starts at `wallStart`. */
function hostWallOf(room: Room, el: Pick<WallElement, 'wallStart'>): Wall | undefined {
  return roomWalls(room).find((w) => w.start.id === el.wallStart)
}

/** World span of an element on its host wall (planned geometry, offset along the wall start -> end). */
function spanPoints(wall: Wall, el: Pick<WallElement, 'offsetCm' | 'widthCm'>): [Vec, Vec] {
  const t0 = el.offsetCm / wall.length
  const t1 = (el.offsetCm + el.widthCm) / wall.length
  return [lerp(wall.start, wall.end, t0), lerp(wall.start, wall.end, t1)]
}

/** Distance along the wall (from its start) of point p. */
const along = (wall: Wall, p: Vec) => dot(sub(p, wall.start), wall.dir)

/** Perpendicular distance of point p to the wall line. */
const offLine = (wall: Wall, p: Vec) => Math.abs(cross(sub(p, wall.start), wall.dir))

/**
 * The element, re-hosted on the room it opens into when it is a door with swing 'out' on a wall
 * shared with another room that contains the whole door span. Otherwise the SAME element object.
 * `shared` (findSharedWalls output) can be passed in when normalizing many elements at once.
 */
export function openingRoomHost(doc: PlanDoc, el: WallElement, shared?: SharedWall[]): WallElement {
  if (el.kind !== 'door' || el.swing !== 'out') return el
  if (!(el.widthCm > 0)) return el
  const host = doc.rooms.find((r) => r.id === el.roomId)
  if (!host) return el
  const hostWall = hostWallOf(host, el)
  if (!hostWall || !(hostWall.length > 0)) return el

  const [a, b] = spanPoints(hostWall, el)

  // Candidate neighbours: walls collinear with the host wall. findSharedWalls already applies the
  // parallelism, gap and overlap tests; its gap is our collinearity tolerance here.
  const pairs = shared ?? findSharedWalls(doc, { maxGapCm: DOOR_HOST_TOLERANCE_CM, minOverlapCm: 1 })
  for (const s of pairs) {
    const iAmA = s.roomAId === host.id && s.wallStartA === el.wallStart
    const iAmB = s.roomBId === host.id && s.wallStartB === el.wallStart
    if (!iAmA && !iAmB) continue
    const otherId = iAmA ? s.roomBId : s.roomAId
    const otherWallStart = iAmA ? s.wallStartB : s.wallStartA
    const other = doc.rooms.find((r) => r.id === otherId)
    if (!other) continue
    const wall = roomWalls(other).find((w) => w.start.id === otherWallStart)
    if (!wall || !(wall.length > 0)) continue

    // The neighbour wall must carry the whole door span: both ends on its line and inside it.
    if (offLine(wall, a) > DOOR_HOST_TOLERANCE_CM || offLine(wall, b) > DOOR_HOST_TOLERANCE_CM) continue
    const sa = along(wall, a)
    const sb = along(wall, b)
    const lo = Math.min(sa, sb)
    const hi = Math.max(sa, sb)
    if (lo < -DOOR_HOST_TOLERANCE_CM || hi > wall.length + DOOR_HOST_TOLERANCE_CM) continue

    // The walls of the two rooms usually run in opposite directions: take the near edge from the
    // neighbour wall start, and keep the hinge on the same world end of the opening.
    const hingeAtStart = el.hinge !== 'end'
    const hingeNearLo = hingeAtStart === (sa <= sb)
    return {
      ...el,
      roomId: other.id,
      wallStart: wall.start.id,
      offsetCm: Math.max(0, lo),
      hinge: hingeNearLo ? 'start' : 'end',
      swing: 'in',
      updatedAt: nowIso(),
    }
  }
  return el
}

/**
 * Apply the door-host rule to every element of the document.
 * Returns the SAME doc object (and no moves) when no door changes room.
 */
export function normalizeDoorHosts<T extends PlanDoc>(doc: T): { doc: T; moved: DoorHostMove[] } {
  const moved: DoorHostMove[] = []
  // Fast path: nothing to do (and no shared-wall scan) when no door opens out.
  if (!doc.elements.some((e) => e.kind === 'door' && e.swing === 'out')) return { doc, moved }
  const shared = findSharedWalls(doc, { maxGapCm: DOOR_HOST_TOLERANCE_CM, minOverlapCm: 1 })
  const elements = doc.elements.map((el) => {
    const next = openingRoomHost(doc, el, shared)
    if (next === el) return el
    moved.push({ elementId: el.id, fromRoomId: el.roomId, toRoomId: next.roomId })
    return next
  })
  if (!moved.length) return { doc, moved }
  return { doc: { ...doc, elements } as T, moved }
}
