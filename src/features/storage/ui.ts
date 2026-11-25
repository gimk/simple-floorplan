// Shared UI helpers for built-in storage in Measuring Mode and Edit Mode.
import { dot, norm, projectOnSegment, roomWalls, sub } from '../../model/geometry'
import type { PlanDoc, Room } from '../../model/types'
import { addStorage, deleteStorage, type StorageDoor, type StorageParams } from './actions'
import { DEFAULT_STORAGE_BACK_CM, DEFAULT_STORAGE_SIDE_CM, readStorageParams } from './geometry'

export const DEFAULT_STORAGE_PARAMS: StorageParams = {
  offsetCm: DEFAULT_STORAGE_SIDE_CM / 2,
  widthCm: 100,
  depthCm: 60,
  sideCm: DEFAULT_STORAGE_SIDE_CM,
  backCm: DEFAULT_STORAGE_BACK_CM,
}

export const DEFAULT_STORAGE_DOOR: StorageDoor = 'sliding'

export const STORAGE_DOOR_OPTIONS: { value: StorageDoor; label: string }[] = [
  { value: 'single', label: 'Hinged' },
  { value: 'double', label: 'Double hinged' },
  { value: 'sliding', label: 'Sliding' },
  { value: 'pocket', label: 'Pocket' },
  { value: 'bifold', label: 'Bifold' },
  { value: 'none', label: 'No door' },
]

export const isV2DocOrRooms = (doc: Pick<PlanDoc, 'rooms' | 'schemaVersion'>): boolean =>
  doc.schemaVersion === 2 || doc.rooms.some((r) => (r.cycle?.length ?? 0) > 0)

/** Return the `hostWall` argument expected by `addStorage` for a room wall starting at `wallStart`. */
export function hostWallIdForRoomWall(
  doc: Pick<PlanDoc, 'rooms' | 'schemaVersion'>,
  room: Room,
  wallStart: string,
): string {
  if (isV2DocOrRooms(doc)) {
    const face = room.cycle?.find((f) => f.cornerId === wallStart)
    if (face) return face.wallId
  }
  return wallStart
}

/** Find the `wallStart` (cornerId) on the parent room where `storageRoom` is hosted. */
export function storageHostWallStart(doc: PlanDoc, storageRoom: Room): string | null {
  const parent = doc.rooms.find((r) => r.id === storageRoom.storage?.parentRoomId)
  if (!parent || storageRoom.vertices.length < 2) return null

  if (isV2DocOrRooms(doc) && storageRoom.cycle?.length && parent.cycle?.length) {
    const frontWallId = storageRoom.cycle[0].wallId
    const face = parent.cycle.find((f) => f.wallId === frontWallId)
    if (face) return face.cornerId
  }

  const [A, B] = storageRoom.vertices
  const dir = norm(sub(B, A))
  for (const w of roomWalls(parent)) {
    if (dot(w.dir, dir) < 0.99) continue
    if (projectOnSegment(A, w.start, w.end).distance < 1 && projectOnSegment(B, w.start, w.end).distance < 1) {
      return w.start.id
    }
  }
  return null
}

/** Read the current `StorageDoor` of a storage room from its front door element. */
export function readStorageDoor(doc: PlanDoc, storageRoom: Room): StorageDoor {
  const parentId = storageRoom.storage?.parentRoomId
  if (!parentId) return DEFAULT_STORAGE_DOOR

  if (isV2DocOrRooms(doc) && storageRoom.cycle?.length) {
    const frontWallId = storageRoom.cycle[0].wallId
    const el = doc.elements.find(
      (e) => e.roomId === parentId && e.wallId === frontWallId && (e.kind === 'door' || e.kind === 'opening'),
    )
    if (el) return el.kind === 'opening' ? 'none' : ((el.variant as StorageDoor) ?? 'single')
  }

  const wallStart = storageHostWallStart(doc, storageRoom)
  const params = readStorageParams(doc, storageRoom)
  if (!wallStart || !params) return DEFAULT_STORAGE_DOOR
  const el = doc.elements.find(
    (e) =>
      e.roomId === parentId &&
      e.wallStart === wallStart &&
      (e.kind === 'door' || e.kind === 'opening') &&
      Math.abs(e.offsetCm - params.offsetCm) < 1 &&
      Math.abs(e.widthCm - params.widthCm) < 1,
  )
  if (!el) return DEFAULT_STORAGE_DOOR
  return el.kind === 'opening' ? 'none' : ((el.variant as StorageDoor) ?? 'single')
}

/**
 * Compute storage `offsetCm` from a click distance `alongCm` along a wall of length `wallLengthCm`.
 * Centers the storage at `alongCm` and clamps so `A..B` stays within `[0, wallLengthCm]`.
 */
export function storageOffsetFromClick(
  alongCm: number,
  widthCm: number,
  wallLengthCm: number,
  sideCm: number = DEFAULT_STORAGE_SIDE_CM,
): number {
  const minOff = sideCm / 2
  const maxOff = Math.max(minOff, wallLengthCm - widthCm - sideCm / 2)
  const raw = alongCm - widthCm / 2
  return Math.round(Math.max(minOff, Math.min(maxOff, raw)) * 10) / 10
}

/** Find the first wall of `room` that can hold a storage with `params` and `door`. */
export function findFirstValidHostWall(
  doc: PlanDoc,
  room: Room,
  params: StorageParams = DEFAULT_STORAGE_PARAMS,
  door: StorageDoor = DEFAULT_STORAGE_DOOR,
): { hostWall: string } | { error: string } {
  const walls = roomWalls(room)
  if (!walls.length) return { error: 'Room has no walls' }
  let firstError = 'Storage does not fit on any wall'
  for (const w of walls) {
    const hostWall = hostWallIdForRoomWall(doc, room, w.start.id)
    const res = addStorage(doc, room.id, hostWall, params, door)
    if (!('error' in res)) return { hostWall }
    firstError = res.error
  }
  return { error: firstError }
}

/**
 * Move an existing storage room to a different wall (`targetWallStart` on the parent room).
 * Returns `{ doc }` on success or `{ error }` without modifying the original document.
 */
export function moveStorageToWall(
  doc: PlanDoc,
  storageRoom: Room,
  targetWallStart: string,
  params: StorageParams,
  door: StorageDoor,
): { doc: PlanDoc } | { error: string } {
  const parent = doc.rooms.find((r) => r.id === storageRoom.storage?.parentRoomId)
  if (!parent) return { error: 'Parent room not found' }
  const targetWall = roomWalls(parent).find((w) => w.start.id === targetWallStart)
  if (!targetWall) return { error: 'Host wall not found' }

  const mid = {
    x: (targetWall.start.x + targetWall.end.x) / 2,
    y: (targetWall.start.y + targetWall.end.y) / 2,
  }
  const without = deleteStorage(doc, storageRoom.id)
  const nextParent = without.rooms.find((r) => r.id === parent.id)
  if (!nextParent) return { error: 'Parent room not found' }

  let bestWall = roomWalls(nextParent).find((w) => w.start.id === targetWallStart)
  if (!bestWall) {
    let bestDist = Infinity
    for (const w of roomWalls(nextParent)) {
      const d = projectOnSegment(mid, w.start, w.end).distance
      if (d < bestDist) {
        bestDist = d
        bestWall = w
      }
    }
  }
  if (!bestWall) return { error: 'Host wall not found' }

  const hostWall = hostWallIdForRoomWall(without, nextParent, bestWall.start.id)
  const res = addStorage(without, nextParent.id, hostWall, params, door)
  if ('error' in res) return res
  return { doc: res.doc }
}
