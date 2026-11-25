// Pure geometry helpers for built-in storage rooms (docs/storage-plan.md). Units: cm, y down.
import {
  DEFAULT_WALL_CM, add, cross, dist, dot, mul, norm, projectOnSegment, roomInnerRing, roomWalls, sub, type Wall,
} from '../../model/geometry'
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

/** True when the document uses the v2 node/wall graph. */
export const isV2Doc = (doc: Pick<PlanDoc, 'rooms' | 'schemaVersion'>): boolean =>
  doc.schemaVersion === 2 || doc.rooms.some((r) => (r.cycle?.length ?? 0) > 0)

/** Two consecutive faces belong to one straight wall if within 0.5° or middle node within 1 cm of chord. */
const COLLINEAR_SIN = Math.sin((0.5 * Math.PI) / 180)
const COLLINEAR_DIST_CM = 1

function isCollinearStep(a: Vec, b: Vec, c: Vec, refDir: Vec): boolean {
  const ab = dist(a, b)
  const bc = dist(b, c)
  if (ab < 1e-6 || bc < 1e-6) return false
  const d1 = { x: (b.x - a.x) / ab, y: (b.y - a.y) / ab }
  const d2 = { x: (c.x - b.x) / bc, y: (c.y - b.y) / bc }
  if (dot(d1, d2) <= 0.99 || dot(d1, refDir) <= 0.99 || dot(d2, refDir) <= 0.99) return false
  if (Math.abs(cross(d1, refDir)) <= COLLINEAR_SIN && Math.abs(cross(d2, refDir)) <= COLLINEAR_SIN) return true
  const ac = dist(a, c)
  if (ac < 1e-6) return false
  return Math.abs(cross(sub(b, a), sub(c, a))) / ac <= COLLINEAR_DIST_CM
}

/**
 * Index of the first face of the run of collinear faces of the parent room that holds face `idx`.
 * A v2 room is split where another room meets it, so the host wall of a storage is one piece of a
 * longer wall: the text form and `readStorageParams` measure the offset from the START of that wall.
 */
export function collinearRunStart(parent: Room, idx: number, dir: Vec): number {
  const n = parent.vertices.length
  if (n < 2) return idx
  let start = idx
  for (let step = 0; step < n - 1; step++) {
    const prevIdx = (start - 1 + n) % n
    const p0 = parent.vertices[prevIdx]
    const p1 = parent.vertices[start]
    const p2 = parent.vertices[(start + 1) % n]
    if (isCollinearStep(p0, p1, p2, dir)) start = prevIdx
    else break
  }
  return start
}

/** Index of the last face of the run of collinear faces of `parent` that holds face `idx`. */
export function collinearRunEnd(parent: Room, idx: number, dir: Vec): number {
  const n = parent.vertices.length
  if (n < 2) return idx
  let end = idx
  for (let step = 0; step < n - 1; step++) {
    const nextIdx = (end + 1) % n
    const p0 = parent.vertices[end]
    const p1 = parent.vertices[nextIdx]
    const p2 = parent.vertices[(nextIdx + 1) % n]
    if (isCollinearStep(p0, p1, p2, dir)) end = nextIdx
    else break
  }
  return end
}

export type WallRunMetrics = {
  startIdx: number
  endIdx: number
  startCentre: Vec
  endCentre: Vec
  dir: Vec
  cornerInset: number
  innerLength: number
  centreLength: number
  faceIndices: number[]
}

/** Geometry of the full collinear wall run of `parent` containing wall `wallIdx`. */
export function wallRunMetrics(parent: Room, wallIdx: number): WallRunMetrics | null {
  const n = parent.vertices.length
  if (n < 3 || wallIdx < 0 || wallIdx >= n) return null
  const a = parent.vertices[wallIdx]
  const b = parent.vertices[(wallIdx + 1) % n]
  if (dist(a, b) < 1e-6) return null
  const dir = norm(sub(b, a))
  const startIdx = collinearRunStart(parent, wallIdx, dir)
  const endIdx = collinearRunEnd(parent, wallIdx, dir)
  const startCentre = parent.vertices[startIdx]
  const endCentre = parent.vertices[(endIdx + 1) % n]
  const inner = roomInnerRing(parent)
  const innerStart = inner[startIdx]
  const innerEnd = inner[(endIdx + 1) % n]
  if (!innerStart || !innerEnd) return null
  const cornerInset = dot(sub(innerStart, startCentre), dir)
  const innerLength = dot(sub(innerEnd, innerStart), dir)
  const centreLength = dot(sub(endCentre, startCentre), dir)
  const faceIndices: number[] = []
  let cur = startIdx
  for (let step = 0; step < n; step++) {
    faceIndices.push(cur)
    if (cur === endIdx) break
    cur = (cur + 1) % n
  }
  return { startIdx, endIdx, startCentre, endCentre, dir, cornerInset, innerLength, centreLength, faceIndices }
}

/**
 * Compute the 4 centre-line corners A, B, C, D of a built-in storage room attached to the OUTER
 * side of a parent room's host wall.
 *   A, B lie on the host wall centre line; C, D lie on the back wall centre line.
 *   `p.offsetCm` is measured from the parent room's inside corner (`cornerInsetCm` from `hostStartCentre`).
 */
export function storageCorners(
  hostStartCentre: Vec,
  hostEndCentre: Vec,
  inward: Vec,
  hostThicknessCm: number,
  p: StorageParams,
  cornerInsetCm = 0,
): { A: Vec; B: Vec; C: Vec; D: Vec } {
  const dir = norm(sub(hostEndCentre, hostStartCentre))
  const out = mul(inward, -1)
  const depthOut = hostThicknessCm / 2 + p.depthCm + p.backCm / 2
  const centreOffset = cornerInsetCm + p.offsetCm
  const A = add(hostStartCentre, mul(dir, centreOffset - p.sideCm / 2))
  const B = add(hostStartCentre, mul(dir, centreOffset + p.widthCm + p.sideCm / 2))
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
  const h = storageRoom.walls?.[A.id]?.thicknessCm ?? DEFAULT_WALL_CM
  const sideRight = storageRoom.walls?.[B.id]?.thicknessCm ?? DEFAULT_STORAGE_SIDE_CM
  const sideLeft = storageRoom.walls?.[D.id]?.thicknessCm ?? DEFAULT_STORAGE_SIDE_CM
  const sideCm = round3((sideRight + sideLeft) / 2)
  const backCm = round3(storageRoom.walls?.[C.id]?.thicknessCm ?? DEFAULT_STORAGE_BACK_CM)
  const widthCm = round3(dist(A, B) - sideCm)
  const depthCm = round3(dist(B, C) - h / 2 - backCm / 2)

  const host = storageHostWall(doc, storageRoom)
  if (!host) return { offsetCm: 0, widthCm, depthCm, sideCm, backCm }
  const metrics = wallRunMetrics(parent, host.index)
  if (!metrics) return { offsetCm: 0, widthCm, depthCm, sideCm, backCm }

  const offsetCm = round3(dot(sub(A, metrics.startCentre), metrics.dir) + sideCm / 2 - metrics.cornerInset)
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
  const parent = doc.rooms.find((r) => r.id === parentId)
  const params = readStorageParams(doc, storageRoom)
  const host = storageHostWall(doc, storageRoom)
  if (!parent || !params || !host) return undefined
  const metrics = wallRunMetrics(parent, host.index)
  const centreOffset = (metrics?.cornerInset ?? 0) + params.offsetCm
  return doors.find(
    (e) =>
      e.wallStart === host.start.id &&
      Math.abs(e.offsetCm - centreOffset) < 1 &&
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
