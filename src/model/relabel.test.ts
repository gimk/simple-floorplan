import { describe, expect, it } from 'vitest'
import { roomWalls } from './geometry'
import { relabelMeasurements } from './relabel'
import { emptyDoc } from './store'
import type { Measurement, PlanDoc } from './types'
import { cutDoc, insertVertex, makeRoom, rectPoints, removeVertex, sliceDoc } from '../features/rooms/ops'

const P = (x: number, y: number) => ({ x, y })
const meas = (label: string, actualCm: number): Measurement => ({ label, actualCm, updatedAt: '2026-01-01T00:00:00.000Z' })
const NOW = '2026-11-23T12:00:00.000Z'

/** One 400 x 300 room R1 with all 4 walls, its diagonal and its height measured. */
function measuredRect(): PlanDoc {
  const d = emptyDoc()
  const room = { ...makeRoom(d, rectPoints(P(0, 0), P(400, 300))), diagonal: [0, 2] as [number, number] }
  const m: PlanDoc['measurements'] = {}
  for (const [l, v] of [['R1-1', 401], ['R1-2', 302], ['R1-3', 403], ['R1-4', 304], ['R1-D', 505], ['R1-H', 250]] as const) m[l] = meas(l, v)
  return { ...d, rooms: [room], measurements: m }
}

/** Measured value of each wall of a room, by wall start id. */
const byWall = (doc: PlanDoc, code: string) => {
  const room = doc.rooms.find((r) => r.code === code)!
  return roomWalls(room).map((w) => doc.measurements[`${code}-${w.index + 1}`]?.actualCm ?? null)
}

describe('relabelMeasurements', () => {
  it('does nothing when the outline did not change', () => {
    const d = measuredRect()
    expect(relabelMeasurements(d, { ...d, rooms: [...d.rooms] }, NOW)).toBeNull()
  })

  it('a corner added on a wall: that wall loses its value, the next walls keep theirs', () => {
    const d = measuredRect()
    const room = d.rooms[0]
    const r = insertVertex(d, room.id, room.vertices[1].id, P(400, 100))! // splits wall 2
    const res = relabelMeasurements(d, r.doc, NOW)!
    expect(res.dropped).toEqual(['R1-2'])
    const after = { ...r.doc, measurements: res.measurements }
    // walls: 1 (401), 2a (new), 2b (new), 3 (403), 4 (304)
    expect(byWall(after, 'R1')).toEqual([401, null, null, 403, 304])
    expect(after.measurements['R1-D']?.actualCm).toBe(505)
    expect(after.measurements['R1-H']?.actualCm).toBe(250)
    expect(after.measurements['R1-4'].updatedAt).toBe(NOW) // moved from R1-3
  })

  it('a corner removed: its two walls (and a diagonal that used it) lose their values', () => {
    const d = measuredRect()
    const room = d.rooms[0]
    // Remove corner 3 (index 2): walls 2 and 3 meet there.
    const after = removeVertex(d, room.id, room.vertices[2].id)
    const res = relabelMeasurements(d, after, NOW)!
    expect(res.dropped.sort()).toEqual(['R1-2', 'R1-3', 'R1-D'])
    const out = { ...after, measurements: res.measurements }
    expect(byWall(out, 'R1')).toEqual([401, null, 304])
  })

  it('a cutout in a corner keeps the untouched walls and drops the cut ones', () => {
    const d = measuredRect()
    // Cut the bottom-right corner: walls 2 and 3 are shortened.
    const cut = cutDoc(d, rectPoints(P(300, 200), P(450, 350)))!
    const res = relabelMeasurements(d, cut.doc, NOW)!
    expect(res.dropped.sort()).toEqual(['R1-2', 'R1-3', 'R1-D'])
    const after = { ...cut.doc, measurements: res.measurements }
    const vals = byWall(after, 'R1').filter((x) => x !== null).sort()
    expect(vals).toEqual([304, 401]) // walls 1 and 4 keep their values, at their new numbers
    expect(after.measurements['R1-H']?.actualCm).toBe(250)
    expect(after.measurements['R1-D']).toBeUndefined() // the corner of the diagonal was cut away
  })

  it('a slice: each piece keeps the whole walls it got, and gets the height', () => {
    const d = measuredRect()
    const s = sliceDoc(d, P(200, -10), P(200, 310))!
    const res = relabelMeasurements(d, s.doc, NOW)!
    const after = { ...s.doc, measurements: res.measurements }
    expect(res.dropped.sort()).toEqual(['R1-1', 'R1-3', 'R1-D'])
    const all = after.rooms.flatMap((r) => byWall(after, r.code)).filter((x) => x !== null).sort()
    expect(all).toEqual([302, 304])
    for (const r of after.rooms) expect(after.measurements[`${r.code}-H`]?.actualCm).toBe(250)
  })

  it('leaves the values alone when the change itself edited them', () => {
    const d = measuredRect()
    const cut = cutDoc(d, rectPoints(P(300, 200), P(450, 350)))!
    expect(relabelMeasurements(d, { ...cut.doc, measurements: {} }, NOW)).toBeNull()
  })

  it('a deleted room does not report dropped values', () => {
    const d = measuredRect()
    const res = relabelMeasurements(d, { ...d, rooms: [] }, NOW)!
    expect(res.dropped).toEqual([])
    expect(res.measurements).toEqual({})
  })
})
