// Shared actions and field options of the Inspect cards (RoomCard, WallCard, VertexCard,
// GroupCard). Kept out of RoomsPanel.tsx so the cards do not import their parent.
// All lengths are cm. One undo step per edit, comma decimals (docs/sidebar-plan-3.md step 4).
import { fmtCm, innerWallLengths, roomWalls } from '../../model/geometry'
import type { SelItem } from '../../model/selection'
import { useDoc, useUi } from '../../model/store'
import type { PlanDoc, Room, StoredWall, WallAlign, WallProps, WallType } from '../../model/types'
import { removeWall } from '../../model/v2/write'
import { undoToast } from '../toast'
import { moveHoleVertex, moveVertices, movableLinked } from './ops'
import { setWallAlign } from './thickness'
import { wallProps } from './walls'

/** Selected hole (own store, see ./holes.ts). Passed down so the views stay pure. */
export type ActiveHole = { roomId: string; holeIndex: number } | null

export const update = (fn: (d: PlanDoc) => PlanDoc) => useDoc.getState().update(fn)

export const patchRoom = (id: string, patch: Partial<Room>) =>
  update((d) => ({ ...d, rooms: d.rooms.map((r) => (r.id === id ? { ...r, ...patch } : r)) }))

export const WALL_TYPES = [
  { value: 'bearing', label: 'Bearing' },
  { value: 'partition', label: 'Partition' },
  { value: 'exterior', label: 'Exterior' },
] as const

/** Renovation state of the selected wall (7.4). */
export const WALL_STATUSES = [
  { value: 'existing', label: 'Existing' },
  { value: 'demolish', label: 'Demolish' },
  { value: 'new', label: 'New' },
] as const

/** Structural warning message: same text as the set_wall_props command warning. */
export const structuralWarning = (type: WallType) => `STRUCTURAL: ${type} wall marked for demolition`

/** Line of a wall that lines up with the walls that continue it (7.5). */
export const WALL_ALIGNS = [
  { value: 'room', label: 'This face' },
  { value: 'center', label: 'Centre' },
  { value: 'other', label: 'Other face' },
] as const

/** A wall, addressed by its room and start vertex. */
export type WallRef = { roomId: string; wallStart: string }

/** Patch the props of one or more walls in one undo step. `patch` may depend on the current props. */
export function patchWalls(refs: WallRef[], patch: (cur: WallProps) => Partial<WallProps>) {
  update((d) => ({
    ...d,
    rooms: d.rooms.map((r) => {
      const mine = refs.filter((w) => w.roomId === r.id)
      if (!mine.length) return r
      const walls = { ...r.walls }
      for (const w of mine) { const cur = wallProps(r, w.wallStart); walls[w.wallStart] = { ...cur, ...patch(cur) } }
      return { ...r, walls }
    }),
  }))
}

/** Set the alignment of walls in one undo step; the other side of each wall gets the mirrored value. */
export function setWallAligns(refs: WallRef[], align: WallAlign) {
  update((d) => refs.reduce((cur, w) => {
    const r = cur.rooms.find((x) => x.id === w.roomId)
    const i = r ? r.vertices.findIndex((v) => v.id === w.wallStart) : -1
    return r && i >= 0 ? setWallAlign(cur, r.id, i, align) : cur
  }, d))
}

/** Change the type; each wall keeps its current thickness. */
export function setWallTypes(refs: WallRef[], type: WallType) {
  patchWalls(refs, () => ({ type }))
}

// ---------- a stored wall: one object with two sides (docs/walls-plan.md, Walls in the interface) ----------

/** Write the properties of one stored wall (one undo step). The sync rule rebuilds both rooms. */
export function patchStoredWall(wallId: string, patch: Partial<StoredWall>) {
  update((d) => ({ ...d, walls: (d.walls ?? []).map((w) => (w.id === wallId ? { ...w, ...patch } : w)) }))
}

/** Toast text of a refused removal: 'Wall W12 is part of rooms EN, CO.' */
export const refusedDeleteText = (wallId: string, refusedBy: string[]) =>
  `Wall ${wallId} is part of rooms ${refusedBy.join(', ')}.`

/**
 * Remove a stored wall (docs/walls-plan.md phase 5c, `removeWall`). A wall that a room uses is
 * REFUSED: nothing is written and the room codes come back, so the caller can name them in a toast.
 */
export function deleteStoredWall(wallId: string): { removed: boolean; refusedBy: string[] } {
  const doc = useDoc.getState().doc
  const res = removeWall(doc, wallId)
  if (res.refusedBy.length) return { removed: false, refusedBy: res.refusedBy }
  if (res.doc === doc) return { removed: false, refusedBy: [] }
  update(() => res.doc)
  useUi.getState().select(null)
  undoToast('Wall deleted', () => useDoc.temporal.getState().undo())
  return { removed: true, refusedBy: [] }
}

/** Signed cm difference, French decimal comma: "+2,1" / "−0,6". */
export const fmtDiffCm = (d: number) => `${d >= 0 ? '+' : '−'}${fmtCm(Math.abs(Math.round(d * 10) / 10))}`

/** Selected walls when two or more are selected, else null. */
export function wallGroup(items: SelItem[]): WallRef[] | null {
  const walls = items.flatMap((s) => (s.kind === 'wall' ? [{ roomId: s.roomId, wallStart: s.wallStart }] : []))
  return walls.length > 1 ? walls : null
}

/** Set the inside face length of a wall: its end vertex moves along the wall. */
export function setWallLength(roomId: string, startId: string, length: number) {
  update((d) => ({
    ...d,
    rooms: d.rooms.map((r) => {
      if (r.id !== roomId) return r
      const w = roomWalls(r).find((x) => x.start.id === startId)
      if (!w) return r
      // Centre line = inside face + the part at the corners (kept as it is now).
      const centre = length + (w.length - innerWallLengths(r)[w.index])
      const end = { x: w.start.x + w.dir.x * centre, y: w.start.y + w.dir.y * centre }
      return { ...r, vertices: r.vertices.map((v) => (v.id === w.end.id ? { ...v, ...end } : v)) }
    }),
  }))
}

/** Move a point to typed coordinates. Corners of other rooms at the same place follow, like a drag. */
export function setVertexPos(roomId: string, vertexId: string, hole: boolean, to: { x: number; y: number }) {
  update((d) => hole
    ? moveHoleVertex(d, roomId, vertexId, to)
    : moveVertices(d, [{ roomId, vertexId, ...to }, ...movableLinked(d, roomId, vertexId).map((ref) => ({ ...ref, ...to }))]))
}

/**
 * Start vertex of the wall `step` places before or after `wallStart` in the polygon order of
 * the room, wrapping around. null when the wall is gone or the room has no wall.
 */
export function adjacentWallStart(room: Room, wallStart: string, step: 1 | -1): string | null {
  const walls = roomWalls(room)
  const i = walls.findIndex((w) => w.start.id === wallStart)
  if (i < 0) return null
  return walls[(i + step + walls.length) % walls.length].start.id
}
