// Which element of the plan a survey label points at, so a hover can highlight it.
//
// The Solve tab shows survey IDs ('CU-6' wall, 'CU-D' diagonal, 'SE-1-T' thickness). The label is
// resolved with src/model/survey.ts: the room code is the part before the first '-'. Pure: no
// store, no side effect, so it is easy to test.
import { roomInnerRing, roomWalls } from '../../model/geometry'
import { labelRoomCode, parseThicknessLabel } from '../../model/survey'
import type { PlanDoc, Room, Vec } from '../../model/types'

export type HoverTarget =
  /** A wall of a room, given by the start vertex id (the key of `room.walls`). */
  | { kind: 'wall'; roomId: string; wallStart: string; label: string }
  /**
   * The survey diagonal of a room, between two INSIDE corners (see roomInnerRing): the same two
   * points that the measured value of the diagonal uses.
   */
  | { kind: 'diagonal'; roomId: string; a: Vec; b: Vec; label: string }
  /** Nothing hovered, or the label does not name an element of this plan. */
  | null

/** Room with this survey code, if any. Room codes contain no '-'. */
export const roomByCode = (doc: Pick<PlanDoc, 'rooms'>, code: string): Room | undefined =>
  doc.rooms.find((r) => r.code === code)

/** Wall object of `index` (0-based) of a room, if the room has it. */
const wallAt = (r: Room, index: number) => roomWalls(r).find((w) => w.index === index)

/**
 * Diagonal target between the two inside corners `i` and `j` of a room. `pair` wins over
 * `room.diagonal`: a Measure next suggestion knows its pair, also when the room has none yet.
 */
export const diagonalTarget = (
  r: Room, pair: [number, number] | undefined, label: string,
): HoverTarget => {
  const p = pair ?? r.diagonal
  if (!p) return null
  const q = roomInnerRing(r)
  const a = q[p[0]], b = q[p[1]]
  if (!a || !b || p[0] === p[1]) return null
  return { kind: 'diagonal', roomId: r.id, a, b, label }
}

/**
 * Element of the plan that `label` names, or null when the label is unknown (another project,
 * a room code that is not in this document, the ceiling height 'CU-H', a wall number out of
 * range...).
 *
 * `pair` is optional: it gives the two inside corners of a diagonal (Measure next suggestions),
 * for a room that has no `room.diagonal` yet. Without it, the pair comes from the room.
 */
export function hoverTarget(
  doc: Pick<PlanDoc, 'rooms'>,
  label: string | null,
  pair?: [number, number],
): HoverTarget {
  if (!label) return null
  const code = labelRoomCode(label)
  if (!code) return null
  const room = roomByCode(doc, code)
  if (!room) return null

  // Thickness: 'SE-1-T' -> wall 1 of the room (the wall, not its inside face).
  const thickness = parseThicknessLabel(label)
  if (thickness) {
    const w = wallAt(room, thickness.index)
    return w ? { kind: 'wall', roomId: room.id, wallStart: w.start.id, label } : null
  }

  // Diagonal: 'SE-D'.
  if (label === `${code}-D`) return diagonalTarget(room, pair, label)

  // Wall: 'SE-3' -> third wall (1-based number in the survey).
  const m = /^(\d+)$/.exec(label.slice(code.length + 1))
  if (!m) return null
  const w = wallAt(room, Number(m[1]) - 1)
  return w ? { kind: 'wall', roomId: room.id, wallStart: w.start.id, label } : null
}
