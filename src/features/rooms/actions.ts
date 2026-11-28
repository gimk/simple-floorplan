// Store actions for rooms. Each call is one undo step (or no step when nothing changes).
import { useDoc } from '../../model/store'
import type { Vec } from '../../model/geometry'
import { area } from '../../model/geometry'
import type { Room, WallKind } from '../../model/types'
import { syncOpeningsForMerge, syncOpeningsForRoomChange } from '../openings/sync'
import { wallThicknessOf } from './walls'
import { cutoutRoom, deleteVertex, deleteWall, mergeRooms, setWallLength } from './ops'

const findArtboard = (artboardId: string) => useDoc.getState().doc.artboards.find((a) => a.id === artboardId)

export function addRoom(artboardId: string, room: Room): void {
  if (!findArtboard(artboardId)) return
  useDoc.getState().update((d) => { d.artboards.find((a) => a.id === artboardId)!.rooms.push(room) })
}

export function deleteRooms(artboardId: string, roomIds: string[]): void {
  const ab = findArtboard(artboardId)
  if (!ab || !ab.rooms.some((r) => roomIds.includes(r.id))) return
  useDoc.getState().update((d) => {
    const a = d.artboards.find((x) => x.id === artboardId)!
    const prev = a.rooms
    a.rooms = a.rooms.filter((r) => !roomIds.includes(r.id))
    a.openings = syncOpeningsForRoomChange(a.openings, prev, a.rooms)
  })
}

export function renameRoom(artboardId: string, roomId: string, name: string): void {
  const room = findArtboard(artboardId)?.rooms.find((r) => r.id === roomId)
  if (!room || room.name === name) return
  useDoc.getState().update((d) => {
    d.artboards.find((a) => a.id === artboardId)!.rooms.find((r) => r.id === roomId)!.name = name
  })
}

/** Returns false (and changes nothing) when the length is invalid or the room is not found. */
export function setRoomWallLength(artboardId: string, roomId: string, edgeIndex: number, lengthCm: number): boolean {
  const room = findArtboard(artboardId)?.rooms.find((r) => r.id === roomId)
  if (!room) return false
  const next = setWallLength(room, edgeIndex, lengthCm)
  if (!next) return false
  useDoc.getState().update((d) => {
    const a = d.artboards.find((x) => x.id === artboardId)!
    const prev = a.rooms
    a.rooms = a.rooms.map((r) => (r.id === roomId ? next : r))
    a.openings = syncOpeningsForRoomChange(a.openings, prev, a.rooms)
  })
  return true
}

/**
 * Subtract the cutter polygon from rooms (targetRoomIds, or all rooms). Rooms the cutter does not
 * touch stay as they are. Returns true when something changed.
 */
export function cutoutArtboardRooms(artboardId: string, cutter: Vec[], targetRoomIds?: string[]): boolean {
  const ab = findArtboard(artboardId)
  if (!ab) return false
  let changed = false
  const rooms: Room[] = []
  for (const r of ab.rooms) {
    if (targetRoomIds && !targetRoomIds.includes(r.id)) { rooms.push(r); continue }
    const parts = cutoutRoom(r, cutter)
    const same = parts.length === 1 && Math.abs(area(parts[0].vertices) - area(r.vertices)) < 1e-6
    if (same) { rooms.push(r); continue }
    changed = true
    rooms.push(...parts)
  }
  if (!changed) return false
  useDoc.getState().update((d) => {
    const a = d.artboards.find((x) => x.id === artboardId)!
    a.openings = syncOpeningsForRoomChange(a.openings, a.rooms, rooms)
    a.rooms = rooms
  })
  return true
}

/** Merge the listed rooms into one (first listed keeps id/name/fill). Returns the merged room or null. */
export function mergeArtboardRooms(artboardId: string, roomIds: string[]): Room | null {
  const ab = findArtboard(artboardId)
  if (!ab) return null
  const picked = roomIds.map((id) => ab.rooms.find((r) => r.id === id)).filter((r): r is Room => !!r)
  const merged = mergeRooms(picked, wallThicknessOf(ab))
  if (!merged) return null
  useDoc.getState().update((d) => {
    const a = d.artboards.find((x) => x.id === artboardId)!
    const prev = a.rooms
    a.rooms = a.rooms.filter((r) => r.id === merged.id || !roomIds.includes(r.id)).map((r) => (r.id === merged.id ? merged : r))
    a.openings = syncOpeningsForMerge(a.openings, roomIds, prev, merged, a.rooms)
  })
  return merged
}

function applyRoomEdit(artboardId: string, roomId: string, edit: (room: Room) => Room | null): boolean {
  const room = findArtboard(artboardId)?.rooms.find((r) => r.id === roomId)
  if (!room) return false
  const next = edit(room)
  if (!next) return false
  useDoc.getState().update((d) => {
    const a = d.artboards.find((x) => x.id === artboardId)!
    const prev = a.rooms
    a.rooms = a.rooms.map((r) => (r.id === roomId ? next : r))
    a.openings = syncOpeningsForRoomChange(a.openings, prev, a.rooms)
  })
  return true
}

/** Remove one vertex (one undo step). Returns false when the room would have fewer than 3 points. */
export function deleteRoomVertex(artboardId: string, roomId: string, vertexIndex: number): boolean {
  return applyRoomEdit(artboardId, roomId, (r) => deleteVertex(r, vertexIndex))
}

/** Remove one wall and reconnect its neighbours (one undo step). Returns false when not possible. */
export function deleteRoomWall(artboardId: string, roomId: string, edgeIndex: number): boolean {
  return applyRoomEdit(artboardId, roomId, (r) => deleteWall(r, edgeIndex))
}

/**
 * Set the kind of one wall of a room ('wall' or 'fence'), in one undo step. 'wall' clears the key,
 * and the `wallKinds` map is removed once it is empty.
 */
export function setRoomWallKind(artboardId: string, roomId: string, edgeIndex: number, kind: WallKind): void {
  if (!findArtboard(artboardId)?.rooms.some((r) => r.id === roomId)) return
  useDoc.getState().update((d) => {
    const r = d.artboards.find((a) => a.id === artboardId)!.rooms.find((x) => x.id === roomId)
    if (!r) return
    const key = String(edgeIndex)
    if (kind === 'wall') {
      const { [key]: _removed, ...rest } = r.wallKinds ?? {}
      if (Object.keys(rest).length === 0) delete r.wallKinds
      else r.wallKinds = rest
    } else {
      r.wallKinds = { ...(r.wallKinds ?? {}), [key]: 'fence' }
    }
  })
}
