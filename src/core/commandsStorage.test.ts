// Review finding 3: `delete_room` deletes the built-in storages of the room, and a storage room is
// deleted as a storage (its front door, its own walls and the split of the host wall).
import { describe, expect, it } from 'vitest'
import { roomInnerRing, dist } from '../model/geometry'
import { emptyDoc } from '../model/store'
import type { PlanDoc, RoomFace, StoredNode, StoredWall } from '../model/types'
import { materializeRooms } from '../model/v2/materialize'
import { addStorage } from '../features/storage/actions'
import { apply } from './commands'

function makeV2Doc(): PlanDoc {
  const nodes: StoredNode[] = [
    { id: 'N1', x: 0, y: 0 },
    { id: 'N2', x: 400, y: 0 },
    { id: 'N3', x: 400, y: 300 },
    { id: 'N4', x: 0, y: 300 },
  ]
  const walls: StoredWall[] = [
    { id: 'W1', a: 'N1', b: 'N2', faces: [], type: 'exterior', thicknessCm: 20 },
    { id: 'W2', a: 'N2', b: 'N3', faces: [], type: 'partition', thicknessCm: 10 },
    { id: 'W3', a: 'N3', b: 'N4', faces: [], type: 'partition', thicknessCm: 10 },
    { id: 'W4', a: 'N4', b: 'N1', faces: [], type: 'exterior', thicknessCm: 20 },
  ]
  const cycle: RoomFace[] = [
    { wallId: 'W1', side: 'L', from: 0, to: 400, cornerId: 'v1' },
    { wallId: 'W2', side: 'L', from: 0, to: 300, cornerId: 'v2' },
    { wallId: 'W3', side: 'L', from: 0, to: 400, cornerId: 'v3' },
    { wallId: 'W4', side: 'L', from: 0, to: 300, cornerId: 'v4' },
  ]
  const base: PlanDoc = {
    ...emptyDoc(),
    schemaVersion: 2,
    nodes,
    walls,
    rooms: [{ id: 'R1', code: 'R1', name: 'Bedroom', vertices: [], cycle, holes: [], walls: {}, walkOrder: 1, diagonal: [0, 2] }],
  }
  return { ...base, rooms: materializeRooms(base) }
}

function makeV1Doc(): PlanDoc {
  return {
    ...emptyDoc(),
    rooms: [{
      id: 'R1', code: 'R1', name: 'Bedroom',
      vertices: [
        { id: 'v1', x: 0, y: 0 },
        { id: 'v2', x: 400, y: 0 },
        { id: 'v3', x: 400, y: 300 },
        { id: 'v4', x: 0, y: 300 },
      ],
      holes: [],
      walls: {
        v1: { type: 'exterior', thicknessCm: 20 },
        v2: { type: 'partition', thicknessCm: 10 },
        v3: { type: 'partition', thicknessCm: 10 },
        v4: { type: 'exterior', thicknessCm: 20 },
      },
      walkOrder: 1,
      diagonal: [0, 2],
    }],
  }
}

function withStorage(): { doc: PlanDoc; storageId: string; doorId: string } {
  const added = addStorage(
    makeV2Doc(), 'R1', 'W1',
    { offsetCm: 100, widthCm: 100, depthCm: 60, sideCm: 5, backCm: 5 },
    'single',
  )
  if ('error' in added) throw new Error(added.error)
  const door = added.doc.elements[0]
  return { doc: added.doc, storageId: added.storageRoomId, doorId: door.id }
}

describe('delete_room and built-in storage (v1)', () => {
  it('deletes the storage of the room, with its front door', () => {
    const added = addStorage(
      makeV1Doc(), 'R1', 'v1',
      { offsetCm: 100, widthCm: 100, depthCm: 60, sideCm: 5, backCm: 5 },
      'single',
    )
    if ('error' in added) throw new Error(added.error)
    const doc = added.doc
    expect(doc.rooms).toHaveLength(2)

    const res = apply(doc, { type: 'delete_room', roomId: 'R1' })

    expect(res.doc.rooms).toEqual([])
    expect(res.doc.elements).toEqual([])
  })
})

describe('delete_room and built-in storage (v2)', () => {
  it('deletes the storages of the room, with their doors and their own walls', () => {
    const { doc, storageId, doorId } = withStorage()
    expect(doc.rooms.map((r) => r.id)).toContain(storageId)
    expect(doc.elements.map((e) => e.id)).toContain(doorId)

    const res = apply(doc, { type: 'delete_room', roomId: 'R1' })

    // No room is left: neither the room nor its storage (no orphan).
    expect(res.doc.rooms).toEqual([])
    // No door is left either.
    expect(res.doc.elements.map((e) => e.id)).not.toContain(doorId)
    // The walls of the storage are gone: only the 4 walls of the room stay (as for a plain room).
    // Before the command the host wall was split and the 3 walls of the storage were there.
    expect(res.doc.walls ?? []).toHaveLength(4)
    expect(res.doc.nodes ?? []).toHaveLength(4)
    // The result names the removed element.
    expect((res.result as { removedElements: string[] }).removedElements).toContain(doorId)
  })

  it('deletes a storage room as a storage: the parent room and its wall stay whole', () => {
    const { doc, storageId, doorId } = withStorage()

    const res = apply(doc, { type: 'delete_room', roomId: storageId })

    expect(res.doc.rooms.map((r) => r.id)).toEqual(['R1'])
    expect(res.doc.elements.map((e) => e.id)).not.toContain(doorId)
    // The host wall is merged back into one wall: the parent room has its 4 walls again.
    const parent = res.doc.rooms[0]
    expect(parent.vertices).toHaveLength(4)
    expect(res.doc.walls ?? []).toHaveLength(4)
    const ring = roomInnerRing(parent)
    // Inside width of the room is whole again (400 - 10 - 5).
    expect(dist(ring[0], ring[1])).toBeCloseTo(385, 1)
    expect((res.result as { deletedRoomId: string }).deletedRoomId).toBe(storageId)
  })
})
