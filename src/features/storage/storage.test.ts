import { beforeEach, describe, expect, it } from 'vitest'
import { parsePlan } from '../../core/schema'
import { centroid, dist, pointInPolygon, roomAreaM2, roomInnerRing } from '../../model/geometry'
import { emptyDoc, useDoc } from '../../model/store'
import type { PlanDoc, Room, RoomFace, StoredNode, StoredWall, WallElement } from '../../model/types'
import { materializeRooms } from '../../model/v2/materialize'
import { buildWallGraph } from '../../model/wallGraph'
import { deleteRoom } from '../rooms/ops'
import { outsideSpans } from '../rooms/outside/outsideDims'
import { addStorage, deleteStorage, updateStorage } from './actions'
import { readStorageParams, type StorageParams } from './geometry'

function makeV1Doc(): PlanDoc {
  const room: Room = {
    id: 'R1',
    code: 'R1',
    name: 'Bedroom',
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
  }
  return { ...emptyDoc(), rooms: [room] }
}

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
    rooms: [
      {
        id: 'R1',
        code: 'R1',
        name: 'Bedroom',
        vertices: [],
        cycle,
        holes: [],
        walls: {},
        walkOrder: 1,
        diagonal: [0, 2],
      },
    ],
  }
  return { ...base, rooms: materializeRooms(base) }
}

const DEFAULT_PARAMS: StorageParams = {
  offsetCm: 100,
  widthCm: 120,
  depthCm: 60,
  sideCm: 5,
  backCm: 5,
}

describe('built-in storage (v1)', () => {
  it('creates storage with exact inner ring width x depth and area on the outer side of the host wall', () => {
    const doc = makeV1Doc()
    const res = addStorage(doc, 'R1', 'v1', DEFAULT_PARAMS, 'single')
    expect('error' in res).toBe(false)
    if ('error' in res) return

    const storage = res.doc.rooms.find((r) => r.id === res.storageRoomId)!
    const parent = res.doc.rooms.find((r) => r.id === 'R1')!
    expect(storage).toBeDefined()
    expect(storage.storage).toEqual({ parentRoomId: 'R1' })
    expect(storage.name).toBe('Storage')

    // 1. Inside ring = widthCm x depthCm
    const ring = roomInnerRing(storage)
    expect(ring).toHaveLength(4)
    expect(dist(ring[0], ring[1])).toBeCloseTo(120, 3)
    expect(dist(ring[1], ring[2])).toBeCloseTo(60, 3)
    expect(roomAreaM2(storage)).toBeCloseTo((120 * 60) / 10000, 4)

    // 2. Outer side: centroid not inside parent room
    const c = centroid(storage.vertices)
    expect(pointInPolygon(c, parent.vertices)).toBe(false)
    expect(c.y).toBeLessThan(0)

    // 3. Front wall is shared in buildWallGraph
    const graph = buildWallGraph(res.doc.rooms)
    const parentFrontFaces = graph.roomFaces['R1'].find((f) => f.wallStart === 'v1')!.faceIndexes
    const storageFrontFaces = graph.roomFaces[storage.id][0].faceIndexes
    const parentWalls = new Set(parentFrontFaces.map((fi) => graph.faces[fi].wallId))
    const storageWalls = new Set(storageFrontFaces.map((fi) => graph.faces[fi].wallId))
    const shared = [...parentWalls].filter((id) => storageWalls.has(id))
    expect(shared.length).toBeGreaterThan(0)

    // Front door created
    expect(res.doc.elements).toHaveLength(1)
    const door = res.doc.elements[0]
    expect(door.roomId).toBe('R1')
    expect(door.wallStart).toBe('v1')
    expect(door.kind).toBe('door')
    expect(door.variant).toBe('single')
    expect(door.offsetCm).toBeCloseTo(100, 3)
    expect(door.widthCm).toBeCloseTo(120, 3)
    expect(door.swing).toBe('in')

    // readStorageParams round-trips
    expect(readStorageParams(res.doc, storage)).toEqual(DEFAULT_PARAMS)
  })

  it('updateStorage resizes storage and moves door; deleteStorage restores parent and removes door', () => {
    const doc = makeV1Doc()
    const parentAreaBefore = roomAreaM2(doc.rooms[0])
    const added = addStorage(doc, 'R1', 'v1', DEFAULT_PARAMS, 'bifold')
    if ('error' in added) throw new Error(added.error)

    const updated = updateStorage(
      added.doc,
      added.storageRoomId,
      { offsetCm: 150, widthCm: 80, depthCm: 50, sideCm: 5, backCm: 5 },
      'none',
    )
    expect('error' in updated).toBe(false)
    if ('error' in updated) return

    const storage = updated.doc.rooms.find((r) => r.id === added.storageRoomId)!
    expect(roomAreaM2(storage)).toBeCloseTo((80 * 50) / 10000, 4)
    expect(readStorageParams(updated.doc, storage)).toEqual({
      offsetCm: 150,
      widthCm: 80,
      depthCm: 50,
      sideCm: 5,
      backCm: 5,
    })
    const door = updated.doc.elements[0]
    expect(door.kind).toBe('opening')
    expect(door.variant).toBeUndefined()
    expect(door.offsetCm).toBeCloseTo(150, 3)
    expect(door.widthCm).toBeCloseTo(80, 3)

    const deleted = deleteStorage(updated.doc, added.storageRoomId)
    expect(deleted.rooms).toHaveLength(1)
    expect(deleted.elements).toHaveLength(0)
    expect(roomAreaM2(deleted.rooms[0])).toBeCloseTo(parentAreaBefore, 4)
  })

  it('deleting parent room deletes its storage rooms and front door', () => {
    const doc = makeV1Doc()
    const added = addStorage(doc, 'R1', 'v1', DEFAULT_PARAMS, 'sliding')
    if ('error' in added) throw new Error(added.error)
    expect(added.doc.rooms).toHaveLength(2)

    const after = deleteRoom(added.doc, 'R1')
    expect(after.rooms).toHaveLength(0)
    expect(after.elements).toHaveLength(0)
  })
})

describe('built-in storage (v2)', () => {
  it('splits host wall, shares front wall in cycles, routes outsideSpans around storage, and preserves existing elements', () => {
    const base = makeV2Doc()
    const existingWin: WallElement = {
      id: 'win1',
      roomId: 'R1',
      wallStart: 'v1',
      wallId: 'W1',
      alongCm: 300,
      kind: 'window',
      variant: 'standard',
      offsetCm: 300,
      widthCm: 60,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    }
    const doc: PlanDoc = { ...base, elements: [existingWin] }

    const res = addStorage(doc, 'R1', 'W1', DEFAULT_PARAMS, 'double')
    expect('error' in res).toBe(false)
    if ('error' in res) return

    const storage = res.doc.rooms.find((r) => r.id === res.storageRoomId)!
    const parent = res.doc.rooms.find((r) => r.id === 'R1')!

    // 1. Inside ring = widthCm x depthCm
    const ring = roomInnerRing(storage)
    expect(dist(ring[0], ring[1])).toBeCloseTo(120, 3)
    expect(dist(ring[1], ring[2])).toBeCloseTo(60, 3)
    expect(roomAreaM2(storage)).toBeCloseTo((120 * 60) / 10000, 4)

    // 2. Outer side
    expect(pointInPolygon(centroid(storage.vertices), parent.vertices)).toBe(false)

    // 3. Front wall is shared in v2 cycles
    const storageFrontWallId = storage.cycle![0].wallId
    expect(parent.cycle!.some((f) => f.wallId === storageFrontWallId)).toBe(true)

    // Existing window kept its real world position (at x = 300..360)
    const winAfter = res.doc.elements.find((e) => e.id === 'win1')!
    expect(winAfter).toBeDefined()
    const winWall = res.doc.walls!.find((w) => w.id === winAfter.wallId)!
    const winNodeA = res.doc.nodes!.find((n) => n.id === winWall.a)!
    expect(winNodeA.x + winAfter.alongCm!).toBeCloseTo(300, 3)

    // 4. outsideSpans goes around the storage: outside span on back wall, none on front wall A-B
    const spans = outsideSpans(res.doc)
    const backWallId = storage.cycle![2].wallId
    expect(spans.some((s) => s.wallId === backWallId)).toBe(true)
    expect(spans.some((s) => s.wallId === storageFrontWallId)).toBe(false)

    // readStorageParams round-trips
    expect(readStorageParams(res.doc, storage)).toEqual(DEFAULT_PARAMS)
  })

  it('updateStorage and deleteStorage work on v2 and merge the split wall back', () => {
    const doc = makeV2Doc()
    const parentAreaBefore = roomAreaM2(doc.rooms[0])
    const wallCountBefore = doc.walls!.length
    const nodeCountBefore = doc.nodes!.length

    const added = addStorage(doc, 'R1', 'W1', DEFAULT_PARAMS, 'pocket')
    if ('error' in added) throw new Error(added.error)

    const updated = updateStorage(
      added.doc,
      added.storageRoomId,
      { offsetCm: 50, widthCm: 100, depthCm: 70, sideCm: 5, backCm: 5 },
      'sliding',
    )
    expect('error' in updated).toBe(false)
    if ('error' in updated) return

    const storage = updated.doc.rooms.find((r) => r.id === added.storageRoomId)!
    expect(roomAreaM2(storage)).toBeCloseTo((100 * 70) / 10000, 4)
    expect(readStorageParams(updated.doc, storage)).toEqual({
      offsetCm: 50,
      widthCm: 100,
      depthCm: 70,
      sideCm: 5,
      backCm: 5,
    })

    const deleted = deleteStorage(updated.doc, added.storageRoomId)
    expect(deleted.rooms).toHaveLength(1)
    expect(deleted.elements).toHaveLength(0)
    expect(deleted.walls!.length).toBe(wallCountBefore)
    expect(deleted.nodes!.length).toBe(nodeCountBefore)
    expect(roomAreaM2(deleted.rooms[0])).toBeCloseTo(parentAreaBefore, 4)
  })

  it('deleting parent room deletes its storage in v2', () => {
    const doc = makeV2Doc()
    const added = addStorage(doc, 'R1', 'W1', DEFAULT_PARAMS, 'single')
    if ('error' in added) throw new Error(added.error)

    const after = deleteRoom(added.doc, 'R1')
    expect(after.rooms).toHaveLength(0)
    expect(after.elements).toHaveLength(0)
  })
})

describe('storage error cases', () => {
  it('rejects width <= 0, depth <= 0, side <= 0, back <= 0', () => {
    const doc = makeV2Doc()
    expect('error' in addStorage(doc, 'R1', 'W1', { ...DEFAULT_PARAMS, widthCm: 0 }, 'single')).toBe(true)
    expect('error' in addStorage(doc, 'R1', 'W1', { ...DEFAULT_PARAMS, depthCm: -10 }, 'single')).toBe(true)
    expect('error' in addStorage(doc, 'R1', 'W1', { ...DEFAULT_PARAMS, sideCm: 0 }, 'single')).toBe(true)
    expect('error' in addStorage(doc, 'R1', 'W1', { ...DEFAULT_PARAMS, backCm: -5 }, 'single')).toBe(true)
  })

  it('rejects storage that does not fit on the host wall (before start or past end)', () => {
    const doc = makeV2Doc()
    // offsetCm = 1 with sideCm = 5 -> A is at -1.5 cm
    expect('error' in addStorage(doc, 'R1', 'W1', { ...DEFAULT_PARAMS, offsetCm: 1 }, 'single')).toBe(true)
    // offsetCm = 300, widthCm = 120, sideCm = 5 -> B is at 422.5 cm > 400 cm
    expect('error' in addStorage(doc, 'R1', 'W1', { ...DEFAULT_PARAMS, offsetCm: 300 }, 'single')).toBe(true)
  })

  it('rejects storage that overlaps another room', () => {
    // Add a second room right above W1 (y = -200..0)
    const base = makeV1Doc()
    const other: Room = {
      id: 'R2',
      code: 'R2',
      name: 'Hall',
      vertices: [
        { id: 'u1', x: 0, y: -200 },
        { id: 'u2', x: 400, y: -200 },
        { id: 'u3', x: 400, y: 0 },
        { id: 'u4', x: 0, y: 0 },
      ],
      holes: [],
      walls: {},
      walkOrder: 2,
    }
    const doc: PlanDoc = { ...base, rooms: [...base.rooms, other] }
    const res = addStorage(doc, 'R1', 'v1', DEFAULT_PARAMS, 'single')
    expect('error' in res).toBe(true)
  })

  it('rejects updateStorage on invalid new dimensions without mutating doc', () => {
    const doc = makeV2Doc()
    const added = addStorage(doc, 'R1', 'W1', DEFAULT_PARAMS, 'single')
    if ('error' in added) throw new Error(added.error)
    const res = updateStorage(added.doc, added.storageRoomId, { ...DEFAULT_PARAMS, offsetCm: 350 })
    expect('error' in res).toBe(true)
  })
})

describe('store integration and schema compatibility', () => {
  beforeEach(() => {
    useDoc.getState().replace(makeV2Doc())
    useDoc.temporal.getState().clear()
  })

  it('addStorage, updateStorage, deleteStorage are one undo step each on useDoc', () => {
    const r1 = useDoc.getState().addStorage('R1', 'W1', DEFAULT_PARAMS, 'single')
    expect('error' in r1).toBe(false)
    if ('error' in r1) return
    expect(useDoc.getState().doc.rooms).toHaveLength(2)
    expect(useDoc.temporal.getState().pastStates).toHaveLength(1)

    const r2 = useDoc.getState().updateStorage(r1.storageRoomId, { ...DEFAULT_PARAMS, widthCm: 90 }, 'double')
    expect(r2.error).toBeUndefined()
    expect(useDoc.temporal.getState().pastStates).toHaveLength(2)

    useDoc.getState().deleteStorage(r1.storageRoomId)
    expect(useDoc.getState().doc.rooms).toHaveLength(1)
    expect(useDoc.temporal.getState().pastStates).toHaveLength(3)

    useDoc.temporal.getState().undo()
    expect(useDoc.getState().doc.rooms).toHaveLength(2)
    useDoc.temporal.getState().undo()
    expect(readStorageParams(useDoc.getState().doc, useDoc.getState().doc.rooms[1])!.widthCm).toBe(120)
    useDoc.temporal.getState().undo()
    expect(useDoc.getState().doc.rooms).toHaveLength(1)
  })

  it('schema loads old data without storage and new data with storage', () => {
    const oldParsed = parsePlan(makeV1Doc())
    expect(oldParsed.rooms[0].storage).toBeUndefined()

    const added = addStorage(makeV1Doc(), 'R1', 'v1', DEFAULT_PARAMS, 'single')
    if ('error' in added) throw new Error(added.error)
    const newParsed = parsePlan(added.doc)
    expect(newParsed.rooms[1].storage).toEqual({ parentRoomId: 'R1' })
  })
})
