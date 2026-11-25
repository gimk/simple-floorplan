import { describe, expect, it } from 'vitest'
import { solverOff, solverOn } from '../features/solver/engine'
import { normalizeOrigin, originOffset } from './origin'
import { emptyDoc } from './store'
import type { Measurement, PlanDoc, Room, RoomFace, StoredNode, StoredWall } from './types'
import { materializeRooms } from './v2/materialize'

const room = (id: string, x0: number, y0: number, x1: number, y1: number): Room => ({
  id, code: id, name: id, walkOrder: 0, walls: {},
  vertices: [{ id: id + 'a', x: x0, y: y0 }, { id: id + 'b', x: x1, y: y0 }, { id: id + 'c', x: x1, y: y1 }, { id: id + 'd', x: x0, y: y1 }],
  holes: [[{ id: id + 'h', x: x0 + 10, y: y0 + 10 }, { id: id + 'i', x: x0 + 20, y: y0 + 10 }, { id: id + 'j', x: x0 + 20, y: y0 + 20 }]],
})

const doc = (): PlanDoc => ({
  ...emptyDoc(),
  rooms: [room('A', 100.5, 50.25, 400, 300), room('B', 400, -20, 600, 300)],
  tapes: [
    { id: 't1', a: { x: 200, y: 100 }, b: { x: 300, y: 100 } },
    { id: 't2', a: { x: 0, y: 0 }, b: { x: 0, y: 0 }, label: 'X', actualCm: 10 },
  ],
  pins: [{ id: 'p', at: { x: 150, y: 60 }, photoKeys: [], createdAt: '', updatedAt: '' }],
})

describe('origin', () => {
  it('finds the offset to the top-left corner of the rooms', () => {
    expect(originOffset(doc())).toEqual({ x: -100.5, y: 20 })
    expect(originOffset(emptyDoc())).toEqual({ x: 0, y: 0 })
  })

  it('moves everything placed, and puts the top-left corner at exactly 0,0', () => {
    const { doc: d, offset } = normalizeOrigin(doc())
    expect(offset).toEqual({ x: -100.5, y: 20 })
    const xs = d.rooms.flatMap((r) => r.vertices.map((v) => v.x)), ys = d.rooms.flatMap((r) => r.vertices.map((v) => v.y))
    expect(Math.min(...xs)).toBe(0)
    expect(Math.min(...ys)).toBe(0)
    expect(d.rooms[0].holes[0][0]).toMatchObject({ x: 10, y: 80.25 })
    expect(d.tapes[0].a).toEqual({ x: 99.5, y: 120 })
    expect(d.tapes[1].a).toEqual({ x: 0, y: 0 }) // unplaced tape stays
    expect(d.pins![0].at).toEqual({ x: 49.5, y: 80 })
  })

  it('does nothing when the plan is already at 0,0', () => {
    const first = normalizeOrigin(doc()).doc
    const again = normalizeOrigin(first)
    expect(again.doc).toBe(first)
    expect(again.offset).toEqual({ x: -0, y: -0 })
  })

  it('shifts doc.solver.baseNodes by the same offset so solverOff restores exact base geometry relative to unmoved nodes', () => {
    const now = '2026-11-25T12:00:00.000Z'
    const meas = (v: Record<string, number>): Record<string, Measurement> =>
      Object.fromEntries(Object.entries(v).map(([label, actualCm]) => [label, { label, actualCm, updatedAt: now }]))
    const nodes: StoredNode[] = [
      { id: 'N1', x: 0, y: 0 },
      { id: 'N2', x: 400, y: 0 },
      { id: 'N3', x: 400, y: 300 },
      { id: 'N4', x: 0, y: 300 },
      { id: 'N_FIXED', x: 900, y: 0 },
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
    const raw: PlanDoc = {
      ...emptyDoc(),
      schemaVersion: 2,
      nodes,
      walls,
      rooms: [{ id: 'R1', code: 'KI', name: 'Kitchen', vertices: [], cycle, holes: [], walls: {}, walkOrder: 1 }],
      measurements: meas({ 'KI-1': 420, 'KI-3': 420 }),
    }
    const base: PlanDoc = { ...raw, rooms: materializeRooms(raw) }
    const { doc: solved } = solverOn(base, { now })
    const { doc: shifted, offset } = normalizeOrigin(solved)
    expect(offset.x).toBeGreaterThan(0)

    // Ghost base coordinates in doc.solver.baseNodes must shift by the same offset.
    for (const [id, pt] of Object.entries(solved.solver!.baseNodes)) {
      expect(shifted.solver!.baseNodes[id].x).toBeCloseTo(pt.x + offset.x, 6)
      expect(shifted.solver!.baseNodes[id].y).toBeCloseTo(pt.y + offset.y, 6)
    }

    // Turning solver Off after the shift restores exact base geometry relative to unmoved nodes.
    const off = solverOff(shifted)
    const nFixed = off.nodes!.find((n) => n.id === 'N_FIXED')!
    const n1 = off.nodes!.find((n) => n.id === 'N1')!
    const n2 = off.nodes!.find((n) => n.id === 'N2')!
    expect(nFixed.x - n1.x).toBeCloseTo(900, 6)
    expect(nFixed.x - n2.x).toBeCloseTo(500, 6)
    expect(n2.x - n1.x).toBeCloseTo(400, 6)
  })
})
