import { describe, expect, it } from 'vitest'
import { roomWalls } from '../../model/geometry'
import { emptyDoc } from '../../model/store'
import type { Measurement, PlanDoc } from '../../model/types'
import { applyMeasuredAll, applyMeasuredNear } from './apply'
import { makeRoom, rectPoints } from './ops'
import { measuredNeighbours, twinValues } from './solve'

const P = (x: number, y: number) => ({ x, y })
const meas = (label: string, actualCm: number): Measurement => ({ label, actualCm, updatedAt: '' })

/** A (0..400) and B (400..700) share the wall x = 400. */
function twoRooms(): PlanDoc {
  let d = emptyDoc()
  const a = makeRoom(d, rectPoints(P(0, 0), P(400, 300)))
  d = { ...d, rooms: [a] }
  const b = makeRoom(d, rectPoints(P(400, 0), P(700, 300)))
  return { ...d, rooms: [a, b] }
}

/** Length of the wall of room `code` lying on x = 400. */
const sharedLen = (doc: PlanDoc, code: string) => {
  const r = doc.rooms.find((x) => x.code === code)!
  return roomWalls(r).find((w) => Math.abs(w.start.x - 400) < 5 && Math.abs(w.end.x - 400) < 5)!.length
}
const label = (doc: PlanDoc, code: string) => {
  const r = doc.rooms.find((x) => x.code === code)!
  return `${code}-${roomWalls(r).findIndex((w) => Math.abs(w.start.x - 400) < 5 && Math.abs(w.end.x - 400) < 5) + 1}`
}

describe('shared walls', () => {
  it('gives an unmeasured wall the value of its twin', () => {
    const d = twoRooms()
    const [a, b] = d.rooms
    const doc = { ...d, measurements: { [label(d, a.code)]: meas(label(d, a.code), 302) } }
    expect(twinValues(doc, b)).toEqual([expect.objectContaining({ cm: 302, label: label(d, a.code) })])
    expect(twinValues(doc, a)).toEqual([])
  })

  it('solves a measured neighbour so both sides of the wall match', () => {
    const d = twoRooms()
    const [a, b] = d.rooms
    const la = label(d, a.code)
    // B has a value of its own (its top wall), so its corners do not follow A.
    const bTop = `${b.code}-1`
    const doc = { ...d, measurements: { [la]: meas(la, 302), [bTop]: meas(bTop, 300) } }
    expect(measuredNeighbours(doc, a).map((r) => r.id)).toEqual([b.id])
    const out = applyMeasuredNear(doc, a.id)
    expect(sharedLen(out.doc, a.code)).toBeCloseTo(302, 1)
    expect(sharedLen(out.doc, b.code)).toBeCloseTo(302, 1)
    expect(out.reports).toHaveLength(2)
  })

  it('apply to all rooms gives the same length on both sides', () => {
    const d = twoRooms()
    const [a, b] = d.rooms
    const la = label(d, a.code), bTop = `${b.code}-1`
    const doc = { ...d, measurements: { [la]: meas(la, 302), [bTop]: meas(bTop, 300) } }
    const out = applyMeasuredAll(doc)
    expect(sharedLen(out.doc, b.code)).toBeCloseTo(sharedLen(out.doc, a.code), 1)
  })
})
