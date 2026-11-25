import { describe, expect, it } from 'vitest'
import { emptyDoc } from '../../model/store'
import type { PlanDoc, Room, RoomFace, StoredNode, StoredWall } from '../../model/types'
import { materializeRooms } from '../../model/v2/materialize'
import { addStorage } from './actions'
import {
  DEFAULT_STORAGE_PARAMS, STORAGE_DOOR_OPTIONS, findFirstValidHostWall, hostWallIdForRoomWall, moveStorageToWall,
  readStorageDoor, storageHostWallStart, storageOffsetFromClick,
} from './ui'

function makeV1Doc(w = 400, h = 300): PlanDoc {
  const room: Room = {
    id: 'R1',
    code: 'R1',
    name: 'Bedroom',
    vertices: [
      { id: 'v1', x: 0, y: 0 },
      { id: 'v2', x: w, y: 0 },
      { id: 'v3', x: w, y: h },
      { id: 'v4', x: 0, y: h },
    ],
    holes: [],
    walls: {
      v1: { type: 'exterior', thicknessCm: 20 },
      v2: { type: 'partition', thicknessCm: 10 },
      v3: { type: 'partition', thicknessCm: 10 },
      v4: { type: 'exterior', thicknessCm: 20 },
    },
    walkOrder: 1,
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
    rooms: [{ id: 'R1', code: 'R1', name: 'Bedroom', vertices: [], cycle, holes: [], walls: {}, walkOrder: 1 }],
  }
  return { ...base, rooms: materializeRooms(base) }
}

describe('storage UI helpers', () => {
  it('maps all six door select options', () => {
    expect(STORAGE_DOOR_OPTIONS).toEqual([
      { value: 'single', label: 'Hinged' },
      { value: 'double', label: 'Double hinged' },
      { value: 'sliding', label: 'Sliding' },
      { value: 'pocket', label: 'Pocket' },
      { value: 'bifold', label: 'Bifold' },
      { value: 'none', label: 'No door' },
    ])
  })

  it('computes offset from click centered and clamped to the wall', () => {
    expect(storageOffsetFromClick(200, 100, 400, 5)).toBe(150)
    expect(storageOffsetFromClick(10, 100, 400, 5)).toBe(2.5)
    expect(storageOffsetFromClick(395, 100, 400, 5)).toBe(297.5)
    expect(storageOffsetFromClick(30, 100, 80, 5)).toBe(2.5)
  })

  it('finds the first wall that can hold a storage, or returns an error', () => {
    const narrow = makeV1Doc(80, 300)
    const found = findFirstValidHostWall(narrow, narrow.rooms[0], DEFAULT_STORAGE_PARAMS, 'sliding')
    expect(found).toEqual({ hostWall: 'v2' })

    const tiny = makeV1Doc(50, 50)
    const fail = findFirstValidHostWall(tiny, tiny.rooms[0], DEFAULT_STORAGE_PARAMS, 'sliding')
    expect('error' in fail).toBe(true)
  })

  it('reads host wall start and door type in v1 and v2', () => {
    const v1 = makeV1Doc()
    const r1 = addStorage(v1, 'R1', 'v1', { ...DEFAULT_STORAGE_PARAMS, offsetCm: 50 }, 'bifold')
    expect('error' in r1).toBe(false)
    if ('error' in r1) return
    const st1 = r1.doc.rooms.find((r) => r.id === r1.storageRoomId)!
    expect(storageHostWallStart(r1.doc, st1)).toBe('v1')
    expect(readStorageDoor(r1.doc, st1)).toBe('bifold')

    const v2 = makeV2Doc()
    const hostWall = hostWallIdForRoomWall(v2, v2.rooms[0], 'v2')
    expect(hostWall).toBe('W2')
    const r2 = addStorage(v2, 'R1', hostWall, { ...DEFAULT_STORAGE_PARAMS, offsetCm: 50 }, 'none')
    expect('error' in r2).toBe(false)
    if ('error' in r2) return
    const st2 = r2.doc.rooms.find((r) => r.id === r2.storageRoomId)!
    expect(storageHostWallStart(r2.doc, st2)).toBeTruthy()
    expect(readStorageDoor(r2.doc, st2)).toBe('none')
  })

  it('moves storage to another wall in v2', () => {
    const v2 = makeV2Doc()
    const r = addStorage(v2, 'R1', 'W1', { ...DEFAULT_STORAGE_PARAMS, offsetCm: 50 }, 'sliding')
    expect('error' in r).toBe(false)
    if ('error' in r) return
    const st = r.doc.rooms.find((x) => x.id === r.storageRoomId)!
    const moved = moveStorageToWall(r.doc, st, 'v2', { ...DEFAULT_STORAGE_PARAMS, offsetCm: 50 }, 'pocket')
    expect('error' in moved).toBe(false)
    if ('error' in moved) return
    const stAfter = moved.doc.rooms.find((x) => x.storage?.parentRoomId === 'R1')!
    expect(readStorageDoor(moved.doc, stAfter)).toBe('pocket')
  })
})
