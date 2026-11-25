// Shared UI helpers for built-in storage in Measuring Mode and Edit Mode.
import { projectOnSegment, roomWalls, type Wall } from '../../model/geometry'
import type { PlanDoc, Room } from '../../model/types'
import { addStorage, deleteStorage, type StorageDoor, type StorageParams } from './actions'
import {
  collinearRunStart, DEFAULT_STORAGE_BACK_CM, DEFAULT_STORAGE_SIDE_CM, isV2Doc,
  storageDoorType, storageFrontDoor, storageHostWall,
} from './geometry'

export const DEFAULT_STORAGE_PARAMS: StorageParams = {
  offsetCm: 0,
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

/** Return the `hostWall` argument expected by `addStorage` for a room wall starting at `wallStart`. */
export function hostWallIdForRoomWall(
  doc: Pick<PlanDoc, 'rooms' | 'schemaVersion'>,
  room: Room,
  wallStart: string,
): string {
  if (isV2Doc(doc)) {
    const face = room.cycle?.find((f) => f.cornerId === wallStart)
    if (face) return face.wallId
  }
  return wallStart
}

/** Find the `wallStart` (cornerId) of the collinear wall run on the parent room where `storageRoom` is hosted. */
export function storageHostWallStart(doc: PlanDoc, storageRoom: Room): string | null {
  const parent = doc.rooms.find((r) => r.id === storageRoom.storage?.parentRoomId)
  const host = storageHostWall(doc, storageRoom)
  if (!parent || !host) return null
  const runStartIdx = collinearRunStart(parent, host.index, host.dir)
  return parent.vertices[runStartIdx]?.id ?? host.start.id
}

/** One entry per collinear wall run of `parent` for the UI Wall select. */
export function parentWallRuns(parent: Room): { wallStart: string; label: string; wall: Wall }[] {
  const runs: { wallStart: string; label: string; wall: Wall }[] = []
  for (const w of roomWalls(parent)) {
    if (collinearRunStart(parent, w.index, w.dir) === w.index) {
      runs.push({ wallStart: w.start.id, label: `on ${parent.code}-${w.index + 1}`, wall: w })
    }
  }
  return runs
}

/** Read the current `StorageDoor` of a storage room from its front door element. */
export function readStorageDoor(doc: PlanDoc, storageRoom: Room): StorageDoor {
  if (!storageFrontDoor(doc, storageRoom)) return DEFAULT_STORAGE_DOOR
  return storageDoorType(doc, storageRoom)
}

/**
 * Compute storage `offsetCm` (from the inside corner) from a click distance `alongFromInsideCm`
 * along an inside wall length `innerLengthCm`. Centers the storage and clamps to `[0, max]`.
 */
export function storageOffsetFromClick(
  alongFromInsideCm: number,
  widthCm: number,
  innerLengthCm: number,
): number {
  const maxOff = Math.max(0, innerLengthCm - widthCm)
  const raw = alongFromInsideCm - widthCm / 2
  return Math.round(Math.max(0, Math.min(maxOff, raw)) * 10) / 10
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
 * Keeps `id`, `code`, `name`, and `walkOrder`.
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
  const res = addStorage(without, nextParent.id, hostWall, params, door, {
    id: storageRoom.id,
    code: storageRoom.code,
    name: storageRoom.name,
    walkOrder: storageRoom.walkOrder,
  })
  if ('error' in res) return res
  return { doc: res.doc }
}
