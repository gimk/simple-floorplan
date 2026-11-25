// Pure geometry helpers for built-in storage rooms (docs/storage-plan.md). Units: cm, y down.
import { DEFAULT_WALL_CM, add, cross, dist, dot, mul, norm, projectOnSegment, roomWalls, sub } from '../../model/geometry'
import type { PlanDoc, Room, Vec } from '../../model/types'

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
