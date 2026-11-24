// Tests of the outside dimension chains (docs/measurements-plan.md section 3): the outside faces
// of the stored walls, grouped into straight runs, with the chain segments and the overall length.
import { describe, expect, it } from 'vitest'
import { emptyDoc } from '../../../model/store'
import type { PlanDoc, Room, RoomFace, StoredNode, StoredWall } from '../../../model/types'
import { convertToV2 } from '../../../model/v2/convert'
import { wallOutsidePlanCm } from '../../../model/wallValues'
import { groupRuns, outsideDims, outsideSpans } from './outsideDims'

const wall = (id: string, a: string, b: string, thicknessCm = 10): StoredWall =>
  ({ id, a, b, faces: [], type: 'partition', thicknessCm })

const face = (wallId: string, side: 'L' | 'R', from: number, to: number, cornerId: string): RoomFace =>
  ({ wallId, side, from, to, cornerId })

const room = (id: string, cycle: RoomFace[], walkOrder = 1): Room =>
  ({ id, code: id, name: id, vertices: [], holes: [], walls: {}, walkOrder, cycle })

const doc = (nodes: StoredNode[], walls: StoredWall[], rooms: Room[] = []): PlanDoc => ({
  projectId: 'p1', title: 'test', schemaVersion: 2, nodes, walls, rooms,
  elements: [], measurements: {}, roomNotes: {}, tapes: [],
})

/** A rectangle room 600 x 400: the outside is the side R of its four walls. */
const rectangle = (): PlanDoc => {
  const nodes: StoredNode[] = [
    { id: 'N1', x: 0, y: 0 }, { id: 'N2', x: 600, y: 0 }, { id: 'N3', x: 600, y: 400 }, { id: 'N4', x: 0, y: 400 },
  ]
  const walls = [wall('W1', 'N1', 'N2'), wall('W2', 'N2', 'N3'), wall('W3', 'N3', 'N4'), wall('W4', 'N4', 'N1')]
  // Interior on side L of every wall (a -> b with y down): side R is outside.
  const r = room('SE', [
    face('W1', 'L', 0, 600, 'v1'), face('W2', 'L', 0, 400, 'v2'),
    face('W3', 'L', 0, 600, 'v3'), face('W4', 'L', 0, 400, 'v4'),
  ])
  return doc(nodes, walls, [r])
}

/** An L outline: 6 walls, all faces of the one room on side L. */
const lShape = (): PlanDoc => {
  const nodes: StoredNode[] = [
    { id: 'P1', x: 0, y: 0 }, { id: 'P2', x: 600, y: 0 }, { id: 'P3', x: 600, y: 400 },
    { id: 'P4', x: 300, y: 400 }, { id: 'P5', x: 300, y: 700 }, { id: 'P6', x: 0, y: 700 },
  ]
  const walls = [
    wall('W1', 'P1', 'P2'), wall('W2', 'P2', 'P3'), wall('W3', 'P3', 'P4'),
    wall('W4', 'P4', 'P5'), wall('W5', 'P5', 'P6'), wall('W6', 'P6', 'P1'),
  ]
  const r = room('SE', [
    face('W1', 'L', 0, 600, 'q1'), face('W2', 'L', 0, 400, 'q2'), face('W3', 'L', 0, 300, 'q3'),
    face('W4', 'L', 0, 300, 'q4'), face('W5', 'L', 0, 300, 'q5'), face('W6', 'L', 0, 700, 'q6'),
  ])
  return doc(nodes, walls, [r])
}

/**
 * The rectangle with an inside partition W5 that meets the top wall W1 at a T junction (node T on
 * the centre line of W1). W5 has a room on both sides, so it is not an outside face.
 */
const withPartition = (): PlanDoc => {
  const base = rectangle()
  const nodes: StoredNode[] = [...(base.nodes ?? []), { id: 'T', x: 300, y: 0 }, { id: 'U', x: 300, y: 200 }]
  const walls = [...(base.walls ?? []), wall('W5', 'T', 'U')]
  const partition = room('CO', [face('W5', 'L', 0, 200, 'c1'), face('W5', 'R', 0, 200, 'c2')], 2)
  return { ...base, nodes, walls, rooms: [...base.rooms, partition] }
}

describe('outsideSpans', () => {
  it('finds the outside side of each wall of a rectangle room, on the outer face line', () => {
    const spans = outsideSpans(rectangle())
    expect(spans).toHaveLength(4)
    const top = spans.find((s) => s.wallId === 'W1')!
    // Half a thickness (5 cm) outside the centre line, above the top wall (y points down).
    expect(top.normal).toEqual({ x: 0, y: -1 })
    expect(top.a).toEqual({ x: 0, y: -5 })
    expect(top.b).toEqual({ x: 600, y: -5 })
    expect(top.lengthCm).toBe(600)
  })

  it('gives no span for a wall that a room covers on both sides', () => {
    const spans = outsideSpans(withPartition())
    expect(spans.some((s) => s.wallId === 'W5')).toBe(false)
  })

  it('cuts a span at the point where another wall meets the wall (T junction)', () => {
    const top = outsideSpans(withPartition()).find((s) => s.wallId === 'W1')!
    expect(top.cuts).toEqual([{ x: 300, y: -5 }])
  })
})

describe('outsideDims', () => {
  it('gives 4 runs with one segment each for a rectangle of 4 walls', () => {
    const runs = outsideDims(rectangle())
    expect(runs).toHaveLength(4)
    for (const run of runs) expect(run.segments).toHaveLength(1)
    // Outside corner to outside corner: each wall gains half a thickness at both ends.
    expect(runs.map((r) => r.overallCm).sort((a, b) => a - b)).toEqual([410, 410, 610, 610])
    const top = runs.find((r) => r.key === 'W1:R')!
    expect(top.a).toEqual({ x: -5, y: -5 })
    expect(top.b).toEqual({ x: 605, y: -5 })
    // The segment is the whole outside side of W1, so it carries the facade label (no value typed yet).
    expect(top.segments[0]).toMatchObject({ lengthCm: 610, label: 'W1-E', measuredCm: null })
  })

  it('gives the same length as the facade value of the wall (outside corner to outside corner)', () => {
    // A real v2 document (a converted room, with its corners), where the facade value of a wall is
    // known: the chain segment must agree with it, so the measured value is not shown as a shift.
    const doc2 = convertToV2({
      ...emptyDoc(),
      rooms: [{
        id: 'A', code: 'A', name: 'A',
        vertices: [{ id: 'v0', x: 0, y: 0 }, { id: 'v1', x: 400, y: 0 }, { id: 'v2', x: 400, y: 300 }, { id: 'v3', x: 0, y: 300 }],
        holes: [], walls: {}, walkOrder: 1,
      }],
    }).doc
    const runs = outsideDims(doc2)
    expect(runs).toHaveLength(4)
    for (const run of runs) {
      const wall = (doc2.walls ?? []).find((w) => run.key.startsWith(`${w.id}:`))!
      expect(run.segments).toHaveLength(1)
      expect(run.segments[0].lengthCm).toBeCloseTo(wallOutsidePlanCm(doc2.rooms, doc2.nodes ?? [], wall)!, 6)
    }
  })

  it('measures the whole side of a facade wall and shows its facade label', () => {
    const base = rectangle()
    const runs = outsideDims({ ...base, measurements: { 'W1-E': { label: 'W1-E', actualCm: 608, updatedAt: '2026-01-01' } } })
    const top = runs.find((r) => r.key === 'W1:R')!
    expect(top.segments[0].label).toBe('W1-E')
    expect(top.segments[0].measuredCm).toBe(608)
    // Only the facade side of a wall carries the value, not the other walls.
    expect(runs.filter((r) => r.segments[0].label === 'W1-E')).toHaveLength(1)
  })

  it('gives 6 runs for an L shaped outline, each round the outside corners', () => {
    const runs = outsideDims(lShape())
    expect(runs).toHaveLength(6)
    for (const run of runs) expect(run.segments).toHaveLength(1)
    // The outside corners of the L: top 610, right 410, notch 300 + 300, bottom 310, left 710.
    expect(runs.map((r) => Math.round(r.overallCm)).sort((a, b) => a - b)).toEqual([300, 300, 310, 410, 610, 710])
    // The notch wall W4 faces east (+x), the run is half a thickness outside it.
    const notch = runs.find((r) => r.key === 'W4:R')!
    expect(notch.normal.x).toBe(1)
    expect(notch.normal.y).toBeCloseTo(0)
    expect(notch.a).toEqual({ x: 305, y: 405 })
    expect(notch.b).toEqual({ x: 305, y: 705 })
  })

  it('cuts a facade at a T junction into 2 segments, and keeps the overall length', () => {
    const runs = outsideDims(withPartition())
    expect(runs).toHaveLength(4)
    const top = runs.find((r) => r.key === 'W1:R')!
    expect(top.points).toHaveLength(3)
    expect(top.segments.map((s) => Math.round(s.lengthCm))).toEqual([305, 305])
    expect(top.overallCm).toBe(610)
    // A value on the whole side cannot be put on a shorter span.
    expect(top.segments.map((s) => s.label)).toEqual([null, null])
  })

  it('gives no run for a document with no walls', () => {
    expect(outsideDims(doc([], []))).toEqual([])
  })
})

describe('groupRuns', () => {
  it('puts two collinear spans that touch end to end in one run', () => {
    const spans = outsideSpans(rectangle())
    const groups = groupRuns(spans)
    expect(groups).toHaveLength(4)
    for (const g of groups) expect(g).toHaveLength(1)
  })

  it('keeps parallel spans that do not touch in separate runs', () => {
    // Two walls in line but with a gap of 50 cm between them: two rows, not one.
    const nodes: StoredNode[] = [
      { id: 'A1', x: 0, y: 0 }, { id: 'A2', x: 300, y: 0 },
      { id: 'B1', x: 350, y: 0 }, { id: 'B2', x: 650, y: 0 },
    ]
    const walls = [wall('W1', 'A1', 'A2'), wall('W2', 'B1', 'B2')]
    const runs = outsideDims(doc(nodes, walls))
    const top = runs.filter((r) => Math.abs(r.normal.y + 1) < 1e-9)
    expect(top).toHaveLength(2)
    expect(top.map((r) => Math.round(r.overallCm)).sort((a, b) => a - b)).toEqual([300, 300])
  })
})
