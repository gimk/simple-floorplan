// Text boxes of the outside dimension chains (round 2 finding R2-2): the wall number badges must
// keep off them. The boxes must be where outside/OutsideDimsLayer.tsx draws its texts: the chain
// row px(28) from the outer face line, the overall row px(52), and the text of a segment that does
// not fit between its ticks past the end of its line, one step further from its row.
import { describe, expect, it } from 'vitest'
import type { PlanDoc, Room, RoomFace, StoredNode, StoredWall } from '../../../model/types'
import { DIM_STYLE } from './dimLine'
import { outsideDims } from '../outside/outsideDims'
import { OUTSIDE_EXTRA_PX, OUTSIDE_ROWS_PX, outsideDimTextBoxes } from './outsideTextBoxes'

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
  const r = room('SE', [
    face('W1', 'L', 0, 600, 'v1'), face('W2', 'L', 0, 400, 'v2'),
    face('W3', 'L', 0, 600, 'v3'), face('W4', 'L', 0, 400, 'v4'),
  ])
  return doc(nodes, walls, [r])
}

/** The rectangle with an inside partition W5 that meets the top wall at a T junction (node T). */
const withPartition = (): PlanDoc => {
  const base = rectangle()
  const nodes: StoredNode[] = [...(base.nodes ?? []), { id: 'T', x: 300, y: 0 }, { id: 'U', x: 300, y: 200 }]
  const walls = [...(base.walls ?? []), wall('W5', 'T', 'U')]
  const partition = room('CO', [face('W5', 'L', 0, 200, 'c1'), face('W5', 'R', 0, 200, 'c2')], 2)
  return { ...base, nodes, walls, rooms: [...base.rooms, partition] }
}

/**
 * The same rectangle, with the partition 15 cm from the left corner: the first segment of the top
 * chain is 20 cm long, too short for its text between the ticks, so that text goes outside.
 */
const shortFirstSegment = (): PlanDoc => {
  const base = withPartition()
  return {
    ...base,
    nodes: (base.nodes ?? []).map((n) => (n.id === 'T' ? { ...n, x: 15 } : n.id === 'U' ? { ...n, x: 15 } : n)),
  }
}

/** The text of every row, short and plain, so that a box is easy to find in a test. */
const input = {
  zoom: 1,
  segmentText: (seg: { lengthCm: number }) => String(Math.round(seg.lengthCm)),
  overallText: (run: { overallCm: number }) => String(Math.round(run.overallCm)),
}

describe('outsideDimTextBoxes', () => {
  it('puts the text of a one-segment run on its overall row, px(52) outside the face line', () => {
    const runs = outsideDims(rectangle())
    expect(runs).toHaveLength(4)
    const boxes = outsideDimTextBoxes(runs, input)
    expect(boxes).toHaveLength(4)
    // The top facade of the rectangle: outer face at y = -5, normal (0,-1), a value '600' 3 chars long.
    const top = boxes[0]
    const centreY = (top.y0 + top.y1) / 2
    expect(centreY).toBeCloseTo(-5 - OUTSIDE_ROWS_PX.overall - DIM_STYLE.textGap, 6)
    expect(top.x1 - top.x0).toBeCloseTo(3 * DIM_STYLE.charWidth, 6)
    expect((top.x0 + top.x1) / 2).toBeCloseTo(300, 6)
  })

  it('adds a chain row px(28) from the face when a run has several segments', () => {
    const runs = outsideDims(withPartition())
    const split = runs.find((r) => r.segments.length === 2)!
    expect(split).toBeDefined()
    const boxes = outsideDimTextBoxes([split], input)
    // Two chain texts and one overall text.
    expect(boxes).toHaveLength(3)
    const chain = boxes.slice(0, 2).map((b) => (b.y0 + b.y1) / 2)
    for (const y of chain) expect(Math.abs(y - (-5 - OUTSIDE_ROWS_PX.chain - DIM_STYLE.textGap))).toBeLessThan(1e-6)
    expect((boxes[2].y0 + boxes[2].y1) / 2).toBeCloseTo(-5 - OUTSIDE_ROWS_PX.overall - DIM_STYLE.textGap, 6)
  })

  it('sends the text of a short segment past the end of its line, one step further from the row', () => {
    // The first chain segment of the top facade is 20 cm long at zoom 1: its text does not fit
    // between the ticks, so it goes past the end of its line, DIM_STYLE.outsideGap + half its width
    // beyond that end, and DIM_STYLE.textGap + OUTSIDE_EXTRA_PX away from the row.
    const runs = outsideDims(shortFirstSegment())
    const split = runs.find((r) => r.segments.length === 2)!
    expect(Math.round(split.segments[0].lengthCm)).toBe(20)
    const boxes = outsideDimTextBoxes([split], { ...input, segmentText: () => '20' })
    const row = -5 - OUTSIDE_ROWS_PX.chain
    // The text is one step further from the row than the standard gap of a dimension text.
    expect((boxes[0].y0 + boxes[0].y1) / 2).toBeCloseTo(row - DIM_STYLE.textGap - OUTSIDE_EXTRA_PX, 6)
    // It went past the START end of the segment, at the outside corner of the run (x = -5).
    const firstX = (boxes[0].x0 + boxes[0].x1) / 2
    expect(firstX).toBeCloseTo(-5 - DIM_STYLE.outsideGap - DIM_STYLE.charWidth, 6)
    const second = split.segments[1]
    expect((boxes[1].x0 + boxes[1].x1) / 2).toBeGreaterThan(second.a.x)
  })

  it('gives no box for a face too short on screen to draw a line', () => {
    // The same partition at zoom 0.01: every row of the plan is under DIM_STYLE.minLine px.
    const runs = outsideDims(withPartition())
    expect(outsideDimTextBoxes(runs, { ...input, zoom: 0.01 })).toEqual([])
  })

  it('gives no box at all when the document has no outside run', () => {
    expect(outsideDimTextBoxes([], input)).toEqual([])
  })
})
