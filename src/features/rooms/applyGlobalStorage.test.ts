// Review finding 2: "Solve whole plan" keeps a built-in storage at its size and on its host wall.
import { describe, expect, it } from 'vitest'
import { centroid, dist, norm, pointInPolygon, roomInnerRing, sub } from '../../model/geometry'
import { emptyDoc } from '../../model/store'
import type { Measurement, PlanDoc, Room, RoomFace, StoredNode, StoredWall } from '../../model/types'
import { materializeRooms } from '../../model/v2/materialize'
import { addStorage } from '../storage/actions'
import { readStorageParams, type StorageParams } from '../storage/geometry'
import { applyGlobal } from './applyGlobal'

function makeV1Doc(): PlanDoc {
  const room: Room = {
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
    rooms: [{ id: 'R1', code: 'R1', name: 'Bedroom', vertices: [], cycle, holes: [], walls: {}, walkOrder: 1, diagonal: [0, 2] }],
  }
  return { ...base, rooms: materializeRooms(base) }
}

const PARAMS: StorageParams = { offsetCm: 100, widthCm: 100, depthCm: 60, sideCm: 5, backCm: 5 }

const meas = (v: Record<string, number>): Record<string, Measurement> =>
  Object.fromEntries(Object.entries(v).map(([label, actualCm]) => [label, { label, actualCm, updatedAt: '' }]))

/**
 * The inside lengths of the room, each straight run of walls larger by `by` cm: the first wall of a
 * run takes the whole change, the other walls of the run keep their drawn length (a value must be
 * consistent, or the fit cannot reach it).
 */
function measuredLarger(room: Room, by: number): Record<string, number> {
  const ring = roomInnerRing(room)
  const n = room.vertices.length
  const dirs = ring.map((p, i) => norm(sub(ring[(i + 1) % n], p)))
  const out: Record<string, number> = {}
  for (let i = 0; i < n; i++) {
    const prev = dirs[(i + n - 1) % n]
    const startsRun = Math.abs(prev.x * dirs[i].x + prev.y * dirs[i].y) < 0.99
    out[`${room.code}-${i + 1}`] = dist(ring[i], ring[(i + 1) % n]) + (startsRun ? by : 0)
  }
  return out
}

/** Inside width and depth of a storage room, from its inside ring. */
function storageSize(room: Room): { widthCm: number; depthCm: number } {
  const ring = roomInnerRing(room)
  return { widthCm: dist(ring[0], ring[1]), depthCm: dist(ring[1], ring[2]) }
}

for (const [version, make] of [['v1', makeV1Doc], ['v2', makeV2Doc]] as const) {
  describe(`applyGlobal with a built-in storage (${version})`, () => {
    const build = (by: number) => {
      const base = make()
      const added = addStorage(base, 'R1', version === 'v1' ? 'v1' : 'W1', PARAMS, 'single')
      if ('error' in added) throw new Error(added.error)
      const doc = added.doc
      const parent = doc.rooms.find((r) => r.id === 'R1')!
      const storage = doc.rooms.find((r) => r.id === added.storageRoomId)!
      const values = measuredLarger(parent, by)
      const solved = applyGlobal({ ...doc, measurements: meas(values) })
      return { doc, parent, storage, values, solved }
    }

    it('keeps the size of the storage and its place on the outer side of the top wall', () => {
      const { doc, parent, storage, values, solved } = build(20)
      const before = storageSize(storage)
      expect(before.widthCm).toBeCloseTo(100, 1)
      expect(before.depthCm).toBeCloseTo(60, 1)

      const next = solved.doc
      const storage2 = next.rooms.find((r) => r.id === storage.id)!
      const parent2 = next.rooms.find((r) => r.id === 'R1')!
      expect(storage2).toBeDefined()

      // The parent room took the measured values: its inside width grew by about 20 cm.
      const parentBefore = roomInnerRing(parent)
      const parentAfter = roomInnerRing(parent2)
      const widthBefore = Math.max(...parentBefore.map((p) => p.x)) - Math.min(...parentBefore.map((p) => p.x))
      const widthAfter = Math.max(...parentAfter.map((p) => p.x)) - Math.min(...parentAfter.map((p) => p.x))
      expect(widthAfter - widthBefore).toBeCloseTo(20, 0)

      // The storage kept its inside dimensions (no crush, no invert).
      const after = storageSize(storage2)
      expect(after.widthCm).toBeCloseTo(before.widthCm, 1)
      expect(after.depthCm).toBeCloseTo(before.depthCm, 1)
      expect(after.depthCm).toBeGreaterThan(0)

      // Still a storage of R1, on the outer side of the top wall.
      expect(storage2.storage).toEqual({ parentRoomId: 'R1' })
      expect(pointInPolygon(centroid(storage2.vertices), parent2.vertices)).toBe(false)
      const ring2 = roomInnerRing(storage2)
      expect(Math.max(...ring2.map((p) => p.y))).toBeLessThan(Math.min(...parentAfter.map((p) => p.y)))

      // The stored parameters are the same as before the solve.
      const paramsBefore = readStorageParams(doc, storage)!
      const paramsAfter = readStorageParams(next, storage2)!
      expect(paramsAfter.widthCm).toBeCloseTo(paramsBefore.widthCm, 1)
      expect(paramsAfter.depthCm).toBeCloseTo(paramsBefore.depthCm, 1)
      expect(paramsAfter.sideCm).toBeCloseTo(paramsBefore.sideCm, 1)
      expect(paramsAfter.backCm).toBeCloseTo(paramsBefore.backCm, 1)
      expect(paramsAfter.offsetCm).toBeCloseTo(paramsBefore.offsetCm, 0)

      // No warning: the storage went back on the solved wall.
      expect(solved.report.storageWarnings).toBeUndefined()
      expect(solved.report.rooms).toBe(doc.rooms.length)
      // The fit found the values of the parent room.
      expect(solved.report.rmsCm).toBeLessThan(0.5)
      expect(Object.keys(values).length).toBeGreaterThan(0)
    })

    it('keeps the size of the storage when the room gets 100 cm smaller', () => {
      const { storage, solved } = build(-100)
      const storage2 = solved.doc.rooms.find((r) => r.id === storage.id)!
      const after = storageSize(storage2)
      expect(after.widthCm).toBeCloseTo(100, 1)
      expect(after.depthCm).toBeCloseTo(60, 1)
      expect(solved.report.storageWarnings).toBeUndefined()
    })

    it('does not let the storage walls hold the parent room back', () => {
      // The same room without a storage, with the same change of its inside lengths: the fit must
      // give the same polygon, so the storage walls do not move the parent room.
      const plain = make()
      const plainParent = plain.rooms.find((r) => r.id === 'R1')!
      const plainSolved = applyGlobal({ ...plain, measurements: meas(measuredLarger(plainParent, 20)) })
      const plainAfter = roomInnerRing(plainSolved.doc.rooms.find((r) => r.id === 'R1')!)
      const { solved } = build(20)
      const after = roomInnerRing(solved.doc.rooms.find((r) => r.id === 'R1')!)
      const size = (ring: { x: number; y: number }[]) => ({
        w: Math.max(...ring.map((p) => p.x)) - Math.min(...ring.map((p) => p.x)),
        h: Math.max(...ring.map((p) => p.y)) - Math.min(...ring.map((p) => p.y)),
      })
      expect(size(after).w).toBeCloseTo(size(plainAfter).w, 0)
      expect(size(after).h).toBeCloseTo(size(plainAfter).h, 0)
    })
  })
}
