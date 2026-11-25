import { describe, expect, it } from 'vitest'
import { emptyDoc } from '../../model/store'
import type { PlanDoc, Room, RoomFace, StoredNode, StoredWall } from '../../model/types'
import { materializeRooms } from '../../model/v2/materialize'
import { addStorage } from './actions'
import { readStorageParams } from './geometry'
import {
  DEFAULT_STORAGE_PARAMS, STORAGE_DOOR_OPTIONS, findFirstValidHostWall, hostWallIdForRoomWall, moveStorageToWall,
  parentWallRuns, readStorageDoor, storageHostWallStart, storageOffsetFromClick,
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

  it('computes offset from click centered and clamped to the inside wall length', () => {
    expect(storageOffsetFromClick(200, 100, 400)).toBe(150)
    expect(storageOffsetFromClick(10, 100, 400)).toBe(0)
    expect(storageOffsetFromClick(395, 100, 400)).toBe(300)
    expect(storageOffsetFromClick(30, 100, 80)).toBe(0)
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

  it('moves storage to another wall in v2 and keeps id, code, name, and walkOrder', () => {
    const v2 = makeV2Doc()
    const r = addStorage(v2, 'R1', 'W1', { ...DEFAULT_PARAMS_OFFSET50 }, 'sliding')
    expect('error' in r).toBe(false)
    if ('error' in r) return
    const st = {
      ...r.doc.rooms.find((x) => x.id === r.storageRoomId)!,
      name: 'Coat Closet',
    }
    const docWithName = {
      ...r.doc,
      rooms: r.doc.rooms.map((rm) => (rm.id === st.id ? st : rm)),
    }
    const moved = moveStorageToWall(docWithName, st, 'v2', { ...DEFAULT_PARAMS_OFFSET50 }, 'pocket')
    expect('error' in moved).toBe(false)
    if ('error' in moved) return
    const stAfter = moved.doc.rooms.find((x) => x.id === st.id)!
    expect(stAfter).toBeDefined()
    expect(stAfter.code).toBe(st.code)
    expect(stAfter.name).toBe('Coat Closet')
    expect(stAfter.walkOrder).toBe(st.walkOrder)
    expect(readStorageDoor(moved.doc, stAfter)).toBe('pocket')
  })

  it('finding 12: parentWallRuns groups split collinear faces into one entry per wall run', () => {
    const v2 = makeV2Doc()
    const r = addStorage(v2, 'R1', 'W1', { ...DEFAULT_STORAGE_PARAMS, offsetCm: 50 }, 'sliding')
    if ('error' in r) throw new Error(r.error)
    const parent = r.doc.rooms.find((x) => x.id === 'R1')!
    const st = r.doc.rooms.find((x) => x.id === r.storageRoomId)!
    // W1 was split into 3 collinear pieces, so parent.vertices has 6 vertices, but only 4 wall runs
    expect(parent.vertices).toHaveLength(6)
    const runs = parentWallRuns(parent)
    expect(runs).toHaveLength(4)
    expect(storageHostWallStart(r.doc, st)).toBe(runs[0].wallStart)
  })

  it('lists each wall run once when a storage starts at offset 0 of the top wall', () => {
    const v2 = makeV2Doc()
    const r = addStorage(v2, 'R1', 'W1', { ...DEFAULT_STORAGE_PARAMS, offsetCm: 0 }, 'sliding')
    if ('error' in r) throw new Error(r.error)
    const parent = r.doc.rooms.find((x) => x.id === 'R1')!
    const runs = parentWallRuns(parent)
    // The top wall is now 3 collinear pieces: still ONE entry for it, and no entry for the pieces.
    expect(parent.vertices.length).toBeGreaterThan(4)
    expect(runs).toHaveLength(4)
    // The label is the label of the FIRST wall of the run.
    expect(runs.map((x) => x.label)).toEqual(['on R1-1', 'on R1-4', 'on R1-5', 'on R1-6'])
    expect(new Set(runs.map((x) => x.wallStart)).size).toBe(4)
  })

  it('lists each wall run once with two storages on the top wall', () => {
    const v2 = makeV2Doc()
    const r1 = addStorage(v2, 'R1', 'W1', { ...DEFAULT_STORAGE_PARAMS, offsetCm: 0 }, 'sliding')
    if ('error' in r1) throw new Error(r1.error)
    const r2 = addStorage(r1.doc, 'R1', 'W1', { ...DEFAULT_STORAGE_PARAMS, offsetCm: 200 }, 'single')
    if ('error' in r2) throw new Error(r2.error)
    const parent = r2.doc.rooms.find((x) => x.id === 'R1')!
    const runs = parentWallRuns(parent)
    expect(runs).toHaveLength(4)
    expect(runs[0].label).toBe('on R1-1')
    expect(new Set(runs.map((x) => x.wallStart)).size).toBe(4)
    // Both storages report the top run: the select therefore shows the top wall for each of them.
    for (const st of r2.doc.rooms.filter((x) => x.storage)) {
      expect(storageHostWallStart(r2.doc, st)).toBe(runs[0].wallStart)
    }
  })

  it('selects the storage own run, and a change of run moves the storage to the run start', () => {
    const v2 = makeV2Doc()
    const r = addStorage(v2, 'R1', 'W1', { ...DEFAULT_STORAGE_PARAMS, offsetCm: 0 }, 'sliding')
    if ('error' in r) throw new Error(r.error)
    const parent = r.doc.rooms.find((x) => x.id === 'R1')!
    const st = r.doc.rooms.find((x) => x.id === r.storageRoomId)!
    const runs = parentWallRuns(parent)
    // The value of the select is one of the options, and it is the run of the storage.
    const selected = storageHostWallStart(r.doc, st)
    expect(runs.map((x) => x.wallStart)).toContain(selected)
    expect(selected).toBe(runs[0].wallStart)

    // Selecting the right wall run moves the storage there, with the offset from its inside corner.
    const params = { ...DEFAULT_STORAGE_PARAMS, offsetCm: 0 }
    const moved = moveStorageToWall(r.doc, st, runs[1].wallStart, params, 'sliding')
    if ('error' in moved) throw new Error(moved.error)
    const stAfter = moved.doc.rooms.find((x) => x.id === st.id)!
    expect(storageHostWallStart(moved.doc, stAfter)).toBe(runs[1].wallStart)
    const runsAfter = parentWallRuns(moved.doc.rooms.find((x) => x.id === 'R1')!)
    expect(runsAfter.map((x) => x.wallStart)).toContain(runs[1].wallStart)
    expect(readStorageParams(moved.doc, stAfter)?.offsetCm).toBe(0)
  })
})

const DEFAULT_PARAMS_OFFSET50 = { ...DEFAULT_STORAGE_PARAMS, offsetCm: 50 }
