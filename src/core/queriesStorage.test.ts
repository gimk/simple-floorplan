// Review finding 8: the area totals of the summary include the built-in storages, the room count
// does not, and `unmeasured` leaves the storage rooms out when no room is asked for.
import { describe, expect, it } from 'vitest'
import { parsePlan } from './schema'
import { applyBatch } from './commands'
import { querySummary, queryUnmeasured, roomStorages } from './queries'
import { emptyDoc } from '../model/store'
import type { PlanDoc } from '../model/types'

function docWithStorage(): { doc: PlanDoc; storageId: string; storageCode: string } {
  const base = parsePlan({
    projectId: 'p1', title: 'Apt', rooms: [], elements: [], measurements: {},
    roomNotes: {}, tapes: [], pins: [],
  })
  // A 400 x 300 room (walls 10 cm): 390 x 290 inside = 11.31 m².
  const withRoom = applyBatch(base, [
    { type: 'add_room', code: 'SE', name: 'Living', rect: { x: 0, y: 0, w: 400, h: 300 }, ceilingCm: 250, walkOrder: 1 },
  ]).doc
  // A 100 x 60 built-in storage: 0.60 m².
  const res = applyBatch(withRoom, [
    { type: 'add_storage', room: 'SE', wall: 'SE-1', offsetCm: 100, widthCm: 100, depthCm: 60, door: 'single' },
  ])
  const parent = res.doc.rooms.find((r) => r.code === 'SE')!
  const storage = roomStorages(res.doc, parent.id)[0]
  if (!storage) throw new Error('no storage')
  return { doc: res.doc, storageId: storage.id, storageCode: storage.code }
}

describe('querySummary and built-in storage', () => {
  it('counts the storage area in the totals but not the storage as a room', () => {
    const { doc } = docWithStorage()
    const s = querySummary(doc)
    const parent = s.rooms.find((r) => r.code === 'SE')!
    expect(parent.storages).toHaveLength(1)
    expect(parent.storages[0].areaM2).toBeCloseTo(0.6, 2)

    // The room area plus the area of its storage.
    expect(s.totalIndoorAreaM2).toBeCloseTo(parent.areaM2 + 0.6, 2)
    // The takeoff of the plan counts the storage too, so the two agree.
    expect(s.totalIndoorAreaM2).toBeCloseTo(s.takeoff.totals.floorM2, 2)
    // One room, and no room line for the storage.
    expect(s.roomCount).toBe(1)
    expect(s.rooms.map((r) => r.code)).toEqual(['SE'])
  })

  it('adds an outdoor storage to the outdoor total only', () => {
    const { doc } = docWithStorage()
    const outdoor: PlanDoc = {
      ...doc,
      rooms: doc.rooms.map((r) => (r.storage ? { ...r, outdoor: true } : r)),
    }
    const s = querySummary(outdoor)
    const parent = s.rooms.find((r) => r.code === 'SE')!
    expect(s.totalOutdoorAreaM2).toBeCloseTo(0.6, 2)
    expect(s.totalIndoorAreaM2).toBeCloseTo(parent.areaM2, 2)
    expect(s.takeoff.totals.floorM2).toBeCloseTo(parent.areaM2, 2)
  })
})

describe('queryUnmeasured and built-in storage', () => {
  it('leaves the storage rooms out when no room is asked for', () => {
    const { doc, storageId } = docWithStorage()
    const res = queryUnmeasured(doc)
    expect(res.remaining.length).toBeGreaterThan(0)
    expect(res.remaining.some((s) => s.roomId === storageId)).toBe(false)
    // The count is the count of the room values only.
    const parentValues = res.remaining.filter((s) => s.roomCode === 'SE')
    expect(parentValues.length).toBeGreaterThan(0)
    expect(res.total).toBe(res.remaining.length)
  })

  it('answers the values of a storage room that the caller names', () => {
    const { doc, storageId } = docWithStorage()
    const res = queryUnmeasured(doc, { roomId: storageId })
    expect(res.remaining.length).toBeGreaterThan(0)
    expect(res.remaining.every((s) => s.roomId === storageId)).toBe(true)
  })
})

describe('empty document', () => {
  it('has no storage and no total', () => {
    const s = querySummary(emptyDoc())
    expect(s.totalIndoorAreaM2).toBe(0)
    expect(s.roomCount).toBe(0)
  })
})
