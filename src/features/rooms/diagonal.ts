// The survey diagonal of a room (`room.diagonal`, label CODE-D): add it, step it to the next pair of
// opposite corners, or remove it, from the room card. Pure functions; the card writes the result
// as one undo step. Before this, the only way to get a diagonal was the "Measure next" list.
import { nowIso } from '../../model/store'
import type { PlanDoc, Room } from '../../model/types'
import { targetOfLabel } from '../../model/v2/targets'

/** Every pair of corners that are not neighbours, in order: [0,2], [0,3], ..., [1,3], ... */
export function diagonalPairs(n: number): [number, number][] {
  const out: [number, number][] = []
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue // the closing wall: neighbours
      out.push([i, j])
    }
  }
  return out
}

/** The pair a new diagonal takes: corner 1 to the corner across (n / 2 further). null under 4 corners. */
export function defaultDiagonal(n: number): [number, number] | null {
  if (n < 4) return null
  return [0, Math.floor(n / 2)]
}

/** The pair after `current` in diagonalPairs (wraps). The default pair when `current` is not valid. */
export function nextDiagonal(n: number, current: [number, number] | undefined): [number, number] | null {
  const pairs = diagonalPairs(n)
  if (!pairs.length) return null
  const at = current ? pairs.findIndex(([a, b]) => (a === current[0] && b === current[1]) || (a === current[1] && b === current[0])) : -1
  if (at < 0) return defaultDiagonal(n)
  return pairs[(at + 1) % pairs.length]
}

/**
 * Set (or remove, with `pair` null) the diagonal of a room. A measured value of CODE-D stays: when
 * the pair changes, its target is read again on the new corners (a v2 document names the wall of
 * the first corner face, like the "Measure next" save).
 */
export function setRoomDiagonal(doc: PlanDoc, roomId: string, pair: [number, number] | null): PlanDoc {
  const room = doc.rooms.find((r) => r.id === roomId)
  if (!room) return doc
  const rooms = doc.rooms.map((r): Room => {
    if (r.id !== roomId) return r
    const next = { ...r }
    if (pair) next.diagonal = pair
    else delete next.diagonal
    return next
  })
  const next = { ...doc, rooms }
  const label = `${room.code}-D`
  const m = doc.measurements[label]
  if (!pair || !m) return next
  const target = targetOfLabel(next, label)
  const { target: _old, ...rest } = m
  return { ...next, measurements: { ...doc.measurements, [label]: { ...rest, updatedAt: nowIso(), ...(target ? { target } : {}) } } }
}
