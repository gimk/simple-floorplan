// Pure geometry helpers for built-in storage rooms (docs/storage-plan.md). Units: cm, y down.
import { DEFAULT_WALL_CM, add, cross, dist, dot, mul, norm, projectOnSegment, roomWalls, sub, type Wall } from '../../model/geometry'
import type { PlanDoc, Room, Vec, WallElement } from '../../model/types'

export const DEFAULT_STORAGE_SIDE_CM = 5
export const DEFAULT_STORAGE_BACK_CM = 5

export type StorageParams = {
  offsetCm: number
  widthCm: number
  depthCm: number
  sideCm: number
  backCm: number
}

export type StorageDoor = 'single' | 'double' | 'sliding' | 'pocket' | 'bifold' | 'none'

const round3 = (v: number) => Math.round(v * 1000) / 1000

/**
 * Compute the 4 centre-line corners A, B, C, D of a built-in storage room attached to the OUTER
 * side of a parent room's host wall.
 *   A, B lie on the host wall centre line; C, D lie on the back wall centre line.
 */
export function storageCorners(
  hostStartCentre: Vec,
  hostEndCentre: Vec,
  inward: Vec,
  hostThicknessCm: number,
  p: StorageParams,
): { A: Vec; B: Vec; C: Vec; D: Vec } {
  const dir = norm(sub(hostEndCentre, hostStartCentre))
  const out = mul(inward, -1)
  const depthOut = hostThicknessCm / 2 + p.depthCm + p.backCm / 2
  const A = add(hostStartCentre, mul(dir, p.offsetCm - p.sideCm / 2))
  const B = add(hostStartCentre, mul(dir, p.offsetCm + p.widthCm + p.sideCm / 2))
  const C = add(B, mul(out, depthOut))
  const D = add(A, mul(out, depthOut))
  return { A, B, C, D }
}

/**
 * Reconstruct StorageParams from a stored storage room and its parent room.
 * Returns null if the room is not a valid storage room or its parent cannot be found.
 */
export function readStorageParams(
  doc: Pick<PlanDoc, 'rooms' | 'nodes' | 'walls' | 'schemaVersion'>,
  storageRoom: Room,
): StorageParams | null {
  if (!storageRoom.storage || storageRoom.vertices.length < 4) return null
  const parent = doc.rooms.find((r) => r.id === storageRoom.storage!.parentRoomId)
  if (!parent || parent.vertices.length < 3) return null

  const [A, B, C, D] = storageRoom.vertices
  const h = storageRoom.walls[A.id]?.thicknessCm ?? DEFAULT_WALL_CM
  const sideRight = storageRoom.walls[B.id]?.thicknessCm ?? DEFAULT_STORAGE_SIDE_CM
  const sideLeft = storageRoom.walls[D.id]?.thicknessCm ?? DEFAULT_STORAGE_SIDE_CM
  const sideCm = round3((sideRight + sideLeft) / 2)
  const backCm = round3(storageRoom.walls[C.id]?.thicknessCm ?? DEFAULT_STORAGE_BACK_CM)
  const widthCm = round3(dist(A, B) - sideCm)
  const depthCm = round3(dist(B, C) - h / 2 - backCm / 2)
  const dir = norm(sub(B, A))

  let offsetCm = 0
  if (storageRoom.cycle?.length && parent.cycle?.length && parent.vertices.length === parent.cycle.length) {
    const frontWallId = storageRoom.cycle[0].wallId
    const frontIdx = parent.cycle.findIndex((f) => f.wallId === frontWallId)
    if (frontIdx >= 0) {
      const n = parent.cycle.length
      let startIdx = frontIdx
      for (let step = 0; step < n - 1; step++) {
        const prevIdx = (startIdx - 1 + n) % n
        const p0 = parent.vertices[prevIdx]
        const p1 = parent.vertices[startIdx]
        if (dist(p0, p1) < 1e-6) break
        const prevDir = norm(sub(p1, p0))
        if (Math.abs(cross(prevDir, dir)) < 1e-3 && dot(prevDir, dir) > 0.99) {
          startIdx = prevIdx
        } else {
          break
        }
      }
      const s = parent.vertices[startIdx]
      offsetCm = round3(dot(sub(A, s), dir) + sideCm / 2)
      return { offsetCm, widthCm, depthCm, sideCm, backCm }
    }
  }

  // v1 (or fallback): find the parent wall that A..B lies on.
  for (const w of roomWalls(parent)) {
    if (dot(w.dir, dir) < 0.99) continue
    const dA = projectOnSegment(A, w.start, w.end).distance
    const dB = projectOnSegment(B, w.start, w.end).distance
    if (dA < 1 && dB < 1) {
      offsetCm = round3(dot(sub(A, w.start), w.dir) + sideCm / 2)
      break
    }
  }

  return { offsetCm, widthCm, depthCm, sideCm, backCm }
}

/** The front door of a built-in storage: a door or an opening of the parent room, on the host wall. */
export function storageFrontDoor(
  doc: Pick<PlanDoc, 'rooms' | 'nodes' | 'walls' | 'schemaVersion' | 'elements'>,
  storageRoom: Room,
): WallElement | undefined {
  const parentId = storageRoom.storage?.parentRoomId
  if (!parentId) return undefined
  const frontWallId = storageRoom.cycle?.[0]?.wallId
  const doors = (doc.elements ?? []).filter(
    (e) => e.roomId === parentId && (e.kind === 'door' || e.kind === 'opening'),
  )
  if (frontWallId !== undefined) return doors.find((e) => e.wallId === frontWallId)
  const params = readStorageParams(doc, storageRoom)
  const host = storageHostWall(doc, storageRoom)
  if (!params || !host) return undefined
  return doors.find(
    (e) =>
      e.wallStart === host.start.id &&
      Math.abs(e.offsetCm - params.offsetCm) < 1 &&
      Math.abs(e.widthCm - params.widthCm) < 1,
  )
}

/** The wall of the parent room that carries the front of a built-in storage, or null. */
export function storageHostWall(
  doc: Pick<PlanDoc, 'rooms' | 'nodes' | 'walls' | 'schemaVersion'>,
  storageRoom: Room,
): Wall | null {
  const parentId = storageRoom.storage?.parentRoomId
  if (!parentId || storageRoom.vertices.length < 2) return null
  const parent = doc.rooms.find((r) => r.id === parentId)
  if (!parent || parent.vertices.length < 3) return null
  // v2: the first face of the storage cycle is the front wall, which belongs to the parent room too.
  const frontWallId = storageRoom.cycle?.[0]?.wallId
  if (frontWallId !== undefined && parent.cycle?.length) {
    const idx = parent.cycle.findIndex((f) => f.wallId === frontWallId)
    if (idx >= 0) {
      const w = roomWalls(parent)[idx]
      if (w) return w
    }
  }
  // v1 (or fallback): the parent wall that A..B lies on.
  const [A, B] = storageRoom.vertices
  const dir = norm(sub(B, A))
  for (const w of roomWalls(parent)) {
    if (dot(w.dir, dir) < 0.99) continue
    if (projectOnSegment(A, w.start, w.end).distance < 1 && projectOnSegment(B, w.start, w.end).distance < 1) return w
  }
  return null
}

/** Door type of a built-in storage, for the DSL and the agent tools. */
export function storageDoorType(
  doc: Pick<PlanDoc, 'rooms' | 'nodes' | 'walls' | 'schemaVersion' | 'elements'>,
  storageRoom: Room,
): StorageDoor {
  const el = storageFrontDoor(doc, storageRoom)
  if (!el || el.kind === 'opening') return 'none'
  const v = el.variant
  return v === 'double' || v === 'sliding' || v === 'pocket' || v === 'bifold' ? v : 'single'
}

/** Everything the text form and the agent tools need about a built-in storage room. */
export type StoragePlacement = StorageParams & {
  /** 1-based index of the host wall in the parent room polygon order. */
  wallIndex: number
  door: StorageDoor
}

/**
 * Index of the first face of the run of collinear faces of the parent room that holds face `idx`.
 * A v2 room is split where another room meets it, so the host wall of a storage is one piece of a
 * longer wall: the text form and `readStorageParams` measure the offset from the START of that wall.
 */
function collinearRunStart(parent: Room, idx: number, dir: Vec): number {
  const n = parent.vertices.length
  let start = idx
  for (let step = 0; step < n - 1; step++) {
    const prevIdx = (start - 1 + n) % n
    const p0 = parent.vertices[prevIdx]
    const p1 = parent.vertices[start]
    if (dist(p0, p1) < 1e-6) break
    const prevDir = norm(sub(p1, p0))
    if (Math.abs(cross(prevDir, dir)) < 1e-3 && dot(prevDir, dir) > 0.99) start = prevIdx
    else break
  }
  return start
}

/**
 * Reading of a built-in storage for a text form: its parameters (readStorageParams), the 1-based
 * index of its host wall in the parent room, and its door type. Null when the storage cannot be
 * described (no parent, no host wall).
 */
export function readStoragePlacement(
  doc: Pick<PlanDoc, 'rooms' | 'nodes' | 'walls' | 'schemaVersion' | 'elements'>,
  storageRoom: Room,
): StoragePlacement | null {
  const params = readStorageParams(doc, storageRoom)
  const host = storageHostWall(doc, storageRoom)
  if (!params || !host || !storageRoom.storage) return null
  const parent = doc.rooms.find((r) => r.id === storageRoom.storage!.parentRoomId)
  if (!parent) return null
  // The front face of the storage is a piece of the host wall: describe the whole wall (run start).
  let idx = host.index
  if (parent.cycle?.length && parent.vertices.length === parent.cycle.length && storageRoom.vertices.length >= 2) {
    const dir = norm(sub(storageRoom.vertices[1], storageRoom.vertices[0]))
    idx = collinearRunStart(parent, idx, dir)
  }
  return { ...params, wallIndex: idx + 1, door: storageDoorType(doc, storageRoom) }
}
