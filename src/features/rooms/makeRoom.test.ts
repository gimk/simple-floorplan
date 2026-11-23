// Make room tool: one room from a closed area of traces and room walls
// (docs/walls-plan.md phase 6). `findEnclosingCycle` is not implemented yet: it is mocked here,
// and the pure parts are tested without it.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EnclosingCycle } from '../../model/faces'
import type { PlanDoc, Room, TraceWall, Vec } from '../../model/types'
import { createRoomFromCycle, makeRoomAt, samePolygon } from './makeRoom'

const cycleMock = vi.fn<(segments: unknown, p: Vec, tol?: number) => EnclosingCycle | null>()

vi.mock('../../model/faces', () => ({
  findEnclosingCycle: (segments: unknown, p: Vec, tol?: number) => cycleMock(segments, p, tol),
}))

const p = (x: number, y: number) => ({ x, y })

const rectRoom = (over: Partial<Room> = {}): Room => ({
  id: 'r1', code: 'SE', name: 'Séjour', holes: [], walls: {}, walkOrder: 3,
  vertices: [p(0, 0), p(400, 0), p(400, 300), p(0, 300)].map((v, i) => ({ id: `v${i}`, ...v })),
  ...over,
})

const doc = (over: Partial<PlanDoc> = {}): PlanDoc => ({
  projectId: 'local', title: 'T', rooms: [], elements: [], measurements: {}, roomNotes: {}, tapes: [],
  ...over,
})

/** A square of traces: 1000,0 - 1400,0 - 1400,400 - 1000,400. */
const squareTraces = (): TraceWall[] => [
  { id: 'tr1', a: p(1000, 0), b: p(1400, 0), thicknessCm: 10, type: 'partition' },
  { id: 'tr2', a: p(1400, 0), b: p(1400, 400), thicknessCm: 30, type: 'exterior' },
  { id: 'tr3', a: p(1400, 400), b: p(1000, 400), thicknessCm: 10, type: 'partition' },
  { id: 'tr4', a: p(1000, 400), b: p(1000, 0), thicknessCm: 10, type: 'partition' },
]

const squareCycle: EnclosingCycle = {
  points: [p(1000, 0), p(1400, 0), p(1400, 400), p(1000, 400)],
  segmentIds: ['trace:tr1', 'trace:tr2', 'trace:tr3', 'trace:tr4'],
}

beforeEach(() => cycleMock.mockReset())

describe('samePolygon', () => {
  const a = [p(0, 0), p(400, 0), p(400, 300), p(0, 300)]
  it('accepts the same shape from another start corner, in either direction', () => {
    expect(samePolygon(a, [p(400, 0), p(400, 300), p(0, 300), p(0, 0)])).toBe(true)
    expect(samePolygon(a, [p(0, 300), p(400, 300), p(400, 0), p(0, 0)])).toBe(true)
    expect(samePolygon(a, [p(0, 0.4), p(400, 0.4), p(400, 300), p(0, 300)])).toBe(true)
  })
  it('refuses a different shape, a different count, or a corner too far', () => {
    expect(samePolygon(a, [p(0, 0), p(400, 0), p(400, 300)])).toBe(false)
    expect(samePolygon(a, [p(0, 0), p(400, 0), p(400, 500), p(0, 300)])).toBe(false)
    expect(samePolygon(a, [p(0, 2), p(400, 0), p(400, 300), p(0, 300)])).toBe(false)
    expect(samePolygon([], [])).toBe(false)
  })
})

describe('createRoomFromCycle', () => {
  it('makes one room: cycle points, wall properties from the traces, next code, last walk order', () => {
    const d = doc({ rooms: [rectRoom()], traces: squareTraces() })
    const out = createRoomFromCycle(d, squareCycle)
    expect(out.kind).toBe('ok')
    if (out.kind !== 'ok') return
    expect(out.doc.rooms).toHaveLength(2)
    const room = out.doc.rooms[1]
    expect(room.code).toBe('R1')
    expect(room.name).toBe('Room 1')
    expect(room.walkOrder).toBe(4)
    expect(room.vertices.map((v) => [v.x, v.y])).toEqual([[1000, 0], [1400, 0], [1400, 400], [1000, 400]])
    // New vertex ids, and each wall takes the type and thickness of the trace it lies on.
    expect(new Set(room.vertices.map((v) => v.id)).size).toBe(4)
    expect(room.walls[room.vertices[0].id]).toEqual({ type: 'partition', thicknessCm: 10 })
    expect(room.walls[room.vertices[1].id]).toEqual({ type: 'exterior', thicknessCm: 30 })
    expect(room.walls[room.vertices[2].id]).toEqual({ type: 'partition', thicknessCm: 10 })
    expect(room.diagonal).toEqual([0, 2])
  })

  it('removes the traces that the new room walls now cover (same change, one undo step)', () => {
    const out = createRoomFromCycle(doc({ traces: squareTraces() }), squareCycle)
    expect(out.kind).toBe('ok')
    if (out.kind !== 'ok') return
    expect(out.doc.traces).toEqual([])
  })

  it('cuts the part of a trace that the new room does not cover', () => {
    // A trace that goes 200 cm past the corner of the area.
    const traces = squareTraces().map((t) => (t.id === 'tr1' ? { ...t, b: p(1600, 0) } : t))
    const out = createRoomFromCycle(doc({ traces }), squareCycle)
    expect(out.kind).toBe('ok')
    if (out.kind !== 'ok') return
    expect(out.doc.traces).toHaveLength(1)
    expect(out.doc.traces![0].id).toBe('tr1')
    expect(out.doc.traces![0].a).toEqual(p(1400, 0))
    expect(out.doc.traces![0].b).toEqual(p(1600, 0))
  })

  it('takes the wall properties of a room wall that the area lies on', () => {
    const d = doc({ rooms: [rectRoom({ walls: { v0: { type: 'exterior', thicknessCm: 30 } } })] })
    const cycle: EnclosingCycle = {
      points: [p(0, 0), p(400, 0), p(400, 300)],
      segmentIds: ['room:r1:v0', 'room:r1:v1', 'room:r1:v2'],
    }
    const out = createRoomFromCycle(d, cycle)
    expect(out.kind).toBe('ok')
    if (out.kind !== 'ok') return
    const room = out.doc.rooms[1]
    expect(room.walls[room.vertices[0].id]).toEqual({ type: 'exterior', thicknessCm: 30 })
    expect(room.walls[room.vertices[2].id]).toEqual({ type: 'partition', thicknessCm: 10 })
  })

  it('takes the properties of a segment that the cycle does not name (matched by geometry)', () => {
    const d = doc({ traces: squareTraces() })
    const cycle: EnclosingCycle = { points: squareCycle.points, segmentIds: [] }
    const out = createRoomFromCycle(d, cycle)
    expect(out.kind).toBe('ok')
    if (out.kind !== 'ok') return
    const room = out.doc.rooms[0]
    expect(room.walls[room.vertices[1].id]).toEqual({ type: 'exterior', thicknessCm: 30 })
  })

  it('says the area is already a room when the cycle is that room', () => {
    const d = doc({ rooms: [rectRoom()] })
    const cycle: EnclosingCycle = {
      points: [p(400, 0), p(400, 300), p(0, 300), p(0, 0)],
      segmentIds: ['room:r1:v1', 'room:r1:v2', 'room:r1:v3', 'room:r1:v0'],
    }
    const out = createRoomFromCycle(d, cycle)
    expect(out.kind).toBe('exists')
    if (out.kind !== 'exists') return
    expect(out.room.code).toBe('SE')
  })

  it('refuses a cycle that is not an area (two points, or almost no surface)', () => {
    expect(createRoomFromCycle(doc(), { points: [p(0, 0), p(400, 0)], segmentIds: ['a', 'b'] })).toEqual({ kind: 'none' })
    expect(createRoomFromCycle(doc(), { points: [p(0, 0), p(5, 0), p(5, 5)], segmentIds: ['a', 'b', 'c'] })).toEqual({ kind: 'none' })
  })

  it('keeps the doc as it is when it has no traces field (no empty array added)', () => {
    const out = createRoomFromCycle(doc(), squareCycle)
    expect(out.kind).toBe('ok')
    if (out.kind !== 'ok') return
    expect('traces' in out.doc).toBe(false)
  })
})

describe('makeRoomAt', () => {
  it('gives the closed area of the click to createRoomFromCycle', () => {
    cycleMock.mockReturnValue(squareCycle)
    const out = makeRoomAt(doc({ traces: squareTraces() }), p(1200, 200))
    expect(out.kind).toBe('ok')
    if (out.kind !== 'ok') return
    expect(out.doc.rooms[0].vertices).toHaveLength(4)
    // The cycle search gets the traces AND the room wall centre lines of the plan.
    const segments = cycleMock.mock.calls[0][0] as { id: string }[]
    expect(segments.map((s) => s.id)).toContain('trace:tr1')
  })

  it('says none when the click is not inside a closed area', () => {
    cycleMock.mockReturnValue(null)
    expect(makeRoomAt(doc({ traces: squareTraces() }), p(5000, 5000))).toEqual({ kind: 'none' })
  })
})
