// Traced walls: figure subtraction of covered parts, segments and selection
// (docs/walls-plan.md phase 6).
import { describe, expect, it } from 'vitest'
import type { PlanDoc, Room, Selection, TraceWall } from '../../model/types'
import { addTrace, deleteTrace, docSegments, propsOfSegment, subtractCovered, traceLength } from './traces'

const p = (x: number, y: number) => ({ x, y })

const trace = (over: Partial<TraceWall> = {}): TraceWall => ({
  id: 't1', a: p(0, 0), b: p(400, 0), thicknessCm: 10, type: 'partition', ...over,
})

const rectRoom = (over: Partial<Room> = {}): Room => ({
  id: 'r1', code: 'SE', name: 'Séjour', holes: [], walls: {}, walkOrder: 1,
  vertices: [p(0, 0), p(400, 0), p(400, 300), p(0, 300)].map((v, i) => ({ id: `v${i}`, ...v })),
  ...over,
})

const doc = (over: Partial<PlanDoc> = {}): PlanDoc => ({
  projectId: 'local', title: 'T', rooms: [], elements: [], measurements: {}, roomNotes: {}, tapes: [],
  ...over,
})

describe('subtractCovered', () => {
  it('keeps a trace that no room wall covers, with the same array (no undo step)', () => {
    const traces = [trace()]
    expect(subtractCovered(traces, [{ a: p(0, 500), b: p(400, 500) }])).toBe(traces)
  })

  it('removes a trace that lies fully under a room wall', () => {
    const out = subtractCovered([trace()], [{ a: p(0, 0), b: p(400, 0) }])
    expect(out).toEqual([])
  })

  it('cuts a partly covered trace into the part that stays, keeping the id', () => {
    // The room wall covers the right half of the trace.
    const out = subtractCovered([trace()], [{ a: p(200, 0), b: p(400, 0) }])
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe('t1')
    expect(out[0].a).toEqual(p(0, 0))
    expect(out[0].b).toEqual(p(200, 0))
    expect(out[0].thicknessCm).toBe(10)
  })

  it('cuts a covered middle into two pieces with different ids', () => {
    const out = subtractCovered([trace()], [{ a: p(100, 0), b: p(300, 0) }])
    expect(out.map((t) => t.id)).toEqual(['t1', 't1-2'])
    expect(out.map((t) => [t.a.x, t.b.x])).toEqual([[0, 100], [300, 400]])
  })

  it('works in any direction and with the room wall drawn the other way', () => {
    // A vertical trace, covered by a room wall drawn upwards.
    const t = trace({ a: p(100, 0), b: p(100, 300) })
    const out = subtractCovered([t], [{ a: p(100, 300), b: p(100, 150) }])
    expect(out).toHaveLength(1)
    expect(out[0].b).toEqual(p(100, 150))
    // A wall at 45 degrees, covered from its middle to its end.
    const d = trace({ a: p(0, 0), b: p(100, 100) })
    const cut = subtractCovered([d], [{ a: p(50, 50), b: p(100, 100) }])
    expect(cut).toHaveLength(1)
    expect(cut[0].b.x).toBeCloseTo(50, 1)
    expect(cut[0].b.y).toBeCloseTo(50, 1)
  })

  it('ignores an edge that is not on the trace (within 1 cm), or one that only touches it', () => {
    // 2 cm away: parallel but not the same line.
    expect(subtractCovered([trace()], [{ a: p(0, 2), b: p(400, 2) }])).toHaveLength(1)
    // Crossing the middle: covers nothing (not collinear).
    expect(subtractCovered([trace()], [{ a: p(200, -50), b: p(200, 50) }])).toHaveLength(1)
    // 0,5 cm away: within the tolerance, so it counts as the same line.
    expect(subtractCovered([trace()], [{ a: p(0, 0.5), b: p(400, 0.5) }])).toEqual([])
  })

  it('merges overlapping covers and shortens a trace from both ends', () => {
    const out = subtractCovered([trace()], [
      { a: p(-50, 0), b: p(100, 0) },
      { a: p(50, 0), b: p(150, 0) },
      { a: p(300, 0), b: p(500, 0) },
    ])
    expect(out).toHaveLength(1)
    expect([out[0].a.x, out[0].b.x]).toEqual([150, 300])
  })
})

describe('trace helpers', () => {
  it('adds a trace with the given wall properties and its own id', () => {
    const d = addTrace(doc(), p(0, 0), p(400, 0), { type: 'bearing', thicknessCm: 20 })
    expect(d.traces).toHaveLength(1)
    expect(d.traces![0].type).toBe('bearing')
    expect(d.traces![0].thicknessCm).toBe(20)
    expect(traceLength(d.traces![0])).toBe(400)
  })

  it('deletes a trace, and leaves the doc alone when the id is unknown', () => {
    const d = doc({ traces: [trace()] })
    expect(deleteTrace(d, 't1').traces).toEqual([])
    expect(deleteTrace(d, 'nope')).toBe(d)
  })

  it('gives the segments of the plan with the ids of the cycle contract', () => {
    const d = doc({ rooms: [rectRoom()], traces: [trace({ a: p(0, 600), b: p(400, 600) })] })
    const segs = docSegments(d)
    expect(segs[0]).toEqual({ id: 'trace:t1', a: p(0, 600), b: p(400, 600) })
    expect(segs.map((s) => s.id)).toContain('room:r1:v1')
    expect(segs).toHaveLength(1 + 4)
  })

  it('finds the wall properties of a segment (trace, room wall, or nothing)', () => {
    const d = doc({
      rooms: [rectRoom({ walls: { v0: { type: 'exterior', thicknessCm: 30, locked: true } } })],
      traces: [trace({ type: 'bearing', thicknessCm: 20 })],
    })
    expect(propsOfSegment(d, 'trace:t1')).toEqual({ type: 'bearing', thicknessCm: 20 })
    expect(propsOfSegment(d, 'room:r1:v0')).toEqual({ type: 'exterior', thicknessCm: 30 })
    // A wall with no props is a partition of 10 cm, like everywhere else.
    expect(propsOfSegment(d, 'room:r1:v1')).toEqual({ type: 'partition', thicknessCm: 10 })
    expect(propsOfSegment(d, 'trace:gone')).toBeNull()
    expect(propsOfSegment(d, 'room:gone:v0')).toBeNull()
    expect(propsOfSegment(d, 'other')).toBeNull()
  })
})

describe('selection of a trace', () => {
  it('accepts the trace kind of the Selection union, without a room', () => {
    const sel: Selection = { kind: 'trace', id: 't1' }
    expect(sel?.kind).toBe('trace')
    // A trace is not inside a room: Esc goes to nothing, and no room card can open.
    expect(sel && 'roomId' in sel ? sel.roomId : undefined).toBeUndefined()
  })
})
