// Tests of the outside dimension chains (docs/measurements-plan.md section 3): the outside faces
// of the stored walls, grouped into straight runs, with the chain segments and the overall length.
import { describe, expect, it } from 'vitest'
import { emptyDoc } from '../../../model/store'
import type { PlanDoc, Room, RoomFace, StoredNode, StoredWall } from '../../../model/types'
import { convertToV2 } from '../../../model/v2/convert'
import { ensureV2 } from '../../../model/v2/ensure'
import { wallSurveyIds } from '../../../model/survey'
import { wallOutsidePlanCm } from '../../../model/wallValues'
import { demoRooms } from '../../measure/demo'
import { dimTextBox } from '../dims/dimBoxes'
import { DIM_STYLE } from '../dims/dimLine'
import { OUTSIDE_ROWS_PX, facadePlannedLengths, groupRuns, outsideDims, outsideRowLine, outsideSpans, type OutsideDimRun } from './outsideDims'

/** Length of the whole chain row of a run, cm. */
const sumOf = (run: OutsideDimRun) => run.segments.reduce((s, seg) => s + seg.lengthCm, 0)

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

/**
 * The four walls and the room of a rectangle of 600 x 400 at (x0, 0), all faces of the room on
 * side L (interior), so side R of each wall is outside. The room also has its polygon (vertices),
 * because the gaps between rooms are found from the room polygons.
 */
const box = (id: string, x0: number, order: number): { nodes: StoredNode[]; walls: StoredWall[]; room: Room } => {
  const n = [`${id}1`, `${id}2`, `${id}3`, `${id}4`]
  const nodes: StoredNode[] = [
    { id: n[0], x: x0, y: 0 }, { id: n[1], x: x0 + 600, y: 0 },
    { id: n[2], x: x0 + 600, y: 400 }, { id: n[3], x: x0, y: 400 },
  ]
  const walls = nodes.map((v, i) => wall(`${id}W${i + 1}`, v.id, nodes[(i + 1) % 4].id))
  const cycle = [
    face(walls[0].id, 'L', 0, 600, `${id}c1`), face(walls[1].id, 'L', 0, 400, `${id}c2`),
    face(walls[2].id, 'L', 0, 600, `${id}c3`), face(walls[3].id, 'L', 0, 400, `${id}c4`),
  ]
  const vertices = nodes.map((v) => ({ id: `v${v.id}`, x: v.x, y: v.y }))
  return { nodes, walls, room: { ...room(id, cycle, order), vertices } }
}

/**
 * Two rooms side by side with a 20 cm gap between them (a shaft, a duct): each room has its own
 * walls, so the two faces that look into the gap are outside faces of walls.
 */
const twoRoomsWithGap = (): PlanDoc => {
  const a = box('A', 0, 1)
  // Room B starts 20 cm to the right of room A.
  const b = box('B', 620, 2)
  return doc([...a.nodes, ...b.nodes], [...a.walls, ...b.walls], [a.room, b.room])
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

  it('gives no span on the faces that look into a gap between two rooms (a shaft, a duct)', () => {
    // 8 outside faces, minus the 2 that look into the 20 cm gap between the two rooms.
    const spans = outsideSpans(twoRoomsWithGap())
    expect(spans).toHaveLength(6)
    expect(spans.some((s) => s.wallId === 'AW2' || s.wallId === 'BW4')).toBe(false)
    // The facades of the building stay: the 2 outer end walls, at the outer face line of each room.
    const ends = spans.filter((s) => Math.abs(s.normal.x) > 0.5)
    expect(ends.map((s) => Math.round(s.a.x)).sort((x, y) => x - y)).toEqual([-5, 1225])
    // Same for the rows: 6 runs, and no run in the gap.
    const runs = outsideDims(twoRoomsWithGap())
    expect(runs).toHaveLength(6)
    expect(runs.filter((r) => Math.abs(r.normal.x) > 0.5)).toHaveLength(2)
    for (const run of runs) expect(sumOf(run)).toBeCloseTo(run.overallCm, 6)
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

  it('adds the chain up to the overall when the two end walls have different thicknesses', () => {
    // The right wall of the rectangle is 30 cm thick: the top run goes to its outside corner, 15 cm
    // past the node, and the chain must use that same point.
    const base = rectangle()
    const runs = outsideDims({ ...base, walls: (base.walls ?? []).map((w) => (w.id === 'W2' ? { ...w, thicknessCm: 30 } : w)) })
    const top = runs.find((r) => r.key === 'W1:R')!
    expect(top.segments).toHaveLength(1)
    expect(top.a).toEqual({ x: -5, y: -5 })
    expect(top.b).toEqual({ x: 615, y: -5 })
    expect(sumOf(top)).toBeCloseTo(top.overallCm, 6)
    // Every run of the plan, with its own thickness and its own corners.
    for (const run of runs) expect(sumOf(run)).toBeCloseTo(run.overallCm, 6)
  })

  it('merges a sliver of the corner into its neighbour, so the chain still adds up (R1-6)', () => {
    // The demo apartment: on the run W14:L a T junction sits 7 cm from the end of the wall. Before
    // the fix the chain row showed 7 + 214 while the overall row showed 221, and the 7 cm text was
    // too short to be drawn at 50 % zoom, so the two rows disagreed on screen.
    const demo = ensureV2({ ...emptyDoc(), rooms: demoRooms() })
    const runs = outsideDims({ rooms: demo.rooms, nodes: demo.nodes, walls: demo.walls, measurements: demo.measurements })
    for (const run of runs) expect(sumOf(run)).toBeCloseTo(run.overallCm, 6)
    const w14 = runs.find((r) => r.key === 'W14:L')!
    expect(w14.segments).toHaveLength(1)
    // 209, not 221 (round 2): the row now starts on the outer face of W5 (y 1290), the inside corner
    // 7 cm below the start of W14, instead of at the start of the wall (y 1278, inside W5).
    expect(Math.round(w14.overallCm)).toBe(209)
    expect(Math.round(w14.segments[0].lengthCm)).toBe(209)
    // The whole outside side of the wall: it carries the facade value, which the two shortened
    // segments could not show.
    expect(w14.segments[0].label).toBe('W14-E')
  })

  it('gives one segment for a run of one whole side of a wall', () => {
    const top = outsideDims(rectangle()).find((r) => r.key === 'W1:R')!
    expect(top.segments).toHaveLength(1)
    expect(top.points).toHaveLength(2)
    expect(sumOf(top)).toBeCloseTo(top.overallCm, 6)
  })
})

describe('outsideDims at an inside corner', () => {
  it('ends the two rows that meet at the inside corner of an L on the outer faces (walls 10 cm)', () => {
    const runs = outsideDims(lShape())
    // Inside corner P4 (300, 400): W3 comes from the right, W4 goes down. Both rows stop where the
    // two outer faces meet: (305, 405). Convex end of W3 at P3: outer faces of W2 and W3 meet at (605, 405).
    const w3 = runs.find((r) => r.key === 'W3:R')!
    expect(w3.a).toEqual({ x: 605, y: 405 })
    expect(w3.b).toEqual({ x: 305, y: 405 })
    const w4 = runs.find((r) => r.key === 'W4:R')!
    expect(w4.a).toEqual({ x: 305, y: 405 })
    expect(w4.b).toEqual({ x: 305, y: 705 })
    // Convex corners unchanged: W1 goes from (-5, -5) to (605, -5).
    const w1 = runs.find((r) => r.key === 'W1:R')!
    expect(w1.a).toEqual({ x: -5, y: -5 })
    expect(w1.b).toEqual({ x: 605, y: -5 })
    for (const run of runs) expect(sumOf(run)).toBeCloseTo(run.overallCm, 6)
  })

  it('does the same when the wall that is met passes through the node (T junction)', () => {
    // H (0,0)-(600,0) has room R1 below it. V rises from the node T (300, 0) to U (300, -300) and
    // has room R2 on its side L (x > 300), which also covers H from 300 to 600. The top of H left of V
    // and the left of V are outside faces that meet at an inside corner on the centre line of H.
    const nodes: StoredNode[] = [
      { id: 'A', x: 0, y: 0 }, { id: 'B', x: 600, y: 0 }, { id: 'T', x: 300, y: 0 }, { id: 'U', x: 300, y: -300 },
    ]
    const walls = [wall('H', 'A', 'B'), wall('V', 'T', 'U')]
    const rooms = [
      room('R1', [face('H', 'L', 0, 600, 'c1')]),
      room('R2', [face('V', 'L', 0, 300, 'c2'), face('H', 'R', 300, 600, 'c3')], 2),
    ]
    const runs = outsideDims(doc(nodes, walls, rooms))
    // Row of the top of H: it stops on the outer face of V (x = 295), not on its centre (x = 300).
    const h = runs.find((r) => r.key === 'H:R')!
    expect(h.a).toEqual({ x: 0, y: -5 })
    expect(h.b).toEqual({ x: 295, y: -5 })
    // Row of the left of V: it starts on the outer face of H (y = -5), not on its centre (y = 0).
    const v = runs.find((r) => r.key === 'V:R')!
    expect(v.a).toEqual({ x: 295, y: -5 })
    expect(v.b).toEqual({ x: 295, y: -300 })
    for (const run of runs) expect(sumOf(run)).toBeCloseTo(run.overallCm, 6)
  })

  it('gives a facade value W12-E that equals the chain segment, also at an inside corner', () => {
    const doc2 = convertToV2({
      ...emptyDoc(),
      rooms: [{
        id: 'A', code: 'A', name: 'A',
        vertices: [
          { id: 'v0', x: 0, y: 0 }, { id: 'v1', x: 600, y: 0 }, { id: 'v2', x: 600, y: 400 },
          { id: 'v3', x: 300, y: 400 }, { id: 'v4', x: 300, y: 700 }, { id: 'v5', x: 0, y: 700 },
        ],
        holes: [], walls: {}, walkOrder: 1,
      }],
    }).doc
    const runs = outsideDims(doc2)
    expect(runs).toHaveLength(6)
    const lengths: number[] = []
    for (const run of runs) {
      const w = (doc2.walls ?? []).find((x) => run.key.startsWith(`${x.id}:`))!
      expect(run.segments).toHaveLength(1)
      const plan = wallOutsidePlanCm(doc2.rooms, doc2.nodes ?? [], w)!
      expect(run.segments[0].label).toBe(`${w.id}-E`)
      expect(run.segments[0].lengthCm).toBeCloseTo(plan, 6)
      lengths.push(Math.round(plan))
    }
    // Two walls meet at the inside corner: 300 centre, 10 cm walls: 300 + 5 (convex) - 5 (inside).
    expect(lengths.sort((a, b) => a - b)).toEqual([300, 300, 310, 410, 610, 710])
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
    // A room under each wall (side L, y down), so the walls are facades and not single walls.
    const rooms = [room('R1', [face('W1', 'L', 0, 300, 'A1')]), room('R2', [face('W2', 'L', 0, 300, 'B1')], 2)]
    const runs = outsideDims(doc(nodes, walls, rooms))
    const top = runs.filter((r) => Math.abs(r.normal.y + 1) < 1e-9)
    expect(top).toHaveLength(2)
    expect(top.map((r) => Math.round(r.overallCm)).sort((a, b) => a - b)).toEqual([300, 300])
  })

  it('skips a wall that no room uses (a single wall is not a facade)', () => {
    const nodes: StoredNode[] = [{ id: 'A1', x: 0, y: 0 }, { id: 'A2', x: 300, y: 0 }]
    expect(outsideDims(doc(nodes, [wall('W1', 'A1', 'A2')]))).toEqual([])
  })
})

describe('demo apartment: inside corner at a T junction, and the facade planned length', () => {
  const demo = () => {
    const d = ensureV2({ ...emptyDoc(), rooms: demoRooms() })
    return { d, runs: outsideDims({ rooms: d.rooms, nodes: d.nodes, walls: d.walls, measurements: d.measurements }) }
  }

  it('ends the rows of the inside corner W14 / W5 on the outer face of the other wall', () => {
    const { runs } = demo()
    // W14 (vertical, x 717..727) passes through the node of W5 (y 1280..1290) and W4 also ends
    // there. W14's outside face (x = 717) runs THROUGH the node, so it is the face of the corner:
    // the W5 row stops on x = 717 (not at 727 on W4's face) and the W14 row starts on y = 1290.
    const w5 = runs.find((r) => r.key === 'W5:L')!
    expect(w5.a.x).toBe(531)
    expect(w5.b.x).toBeCloseTo(717, 6)
    expect(w5.b.y).toBeCloseTo(1290, 6)
    expect(w5.overallCm).toBeCloseTo(186, 6)
    // The row W14:L starts on the outer face of W5 (y 1290): 1499 - 1290 = 209. The wall W14 itself
    // starts at y 1278 (a T junction on W4), but the outside there is the corner with W5.
    const w14 = runs.find((r) => r.key === 'W14:L')!
    expect(w14.a.y).toBeCloseTo(1290, 6)
    expect(w14.a.x).toBeCloseTo(717, 6)
    expect(w14.overallCm).toBeCloseTo(209, 6)
  })

  it('gives the same planned length in Measuring Mode as the outside row, for every W*-E segment', () => {
    const { d, runs } = demo()
    const planned = new Map(wallSurveyIds(d).filter((s) => s.kind === 'outside').map((s) => [s.label, s.plannedCm!]))
    const fromHelper = facadePlannedLengths(d)
    let count = 0
    for (const run of runs) {
      for (const seg of run.segments) {
        if (!seg.label || !/^W\d+-E$/.test(seg.label)) continue
        count++
        expect(planned.get(seg.label), seg.label).toBeCloseTo(seg.lengthCm, 1)
        expect(fromHelper.get(seg.label), seg.label).toBeCloseTo(seg.lengthCm, 1)
      }
    }
    expect(count).toBeGreaterThanOrEqual(12)
  })
})

describe('outsideRowLine: the text of a row stays on its own row line (UI test report, "Look")', () => {
  /** The row of a face of `lengthCm`, its normal up (the outside of a top wall), at 1 px/cm. */
  const row = (offsetPx: number, text: string, lengthCm = 95, outsideEnd: 'start' | 'end' = 'end') =>
    outsideRowLine({
      start: { x: 0, y: 0 }, end: { x: lengthCm, y: 0 }, normal: { x: 0, y: -1 },
      offsetCm: offsetPx, zoom: 1, text, outsideEnd,
    })!

  it('keeps the text that does not fit at the standard gap from its own row line', () => {
    // A measured value between two storages: too wide for its segment, so it goes past the end of
    // its line. It keeps the text gap of every other label (7 px), not one step further out.
    const text = 'W7-E ✓ 95 · 95,4'
    const line = row(OUTSIDE_ROWS_PX.chain, text)
    expect(line.outside).toBe(true)
    expect(-OUTSIDE_ROWS_PX.chain - line.text.y).toBeCloseTo(DIM_STYLE.textGap, 6)
  })

  it('stays clear of the dimension line of the next run, 65 cm behind the wall', () => {
    // The UI test: the '95' of the wall piece between two storages was on the overall row of its
    // run (52 px off the host face), and the storage behind it is 65 cm deep, so the line of that
    // storage is 65 px away. A text one step further out (the removed 6 px) crossed it; the text
    // box of a label that keeps the standard gap does not.
    const text = 'W7-E ✓ 95 · 95,4'
    const line = row(OUTSIDE_ROWS_PX.overall, text)
    const box = dimTextBox(line, text, 1)
    expect(-box.y0).toBeLessThan(65)
    // ... and it is still clear of its own row line: it sits above the line, never on it.
    expect(box.y1).toBeLessThan(-OUTSIDE_ROWS_PX.overall)
  })

  it('still sends the text past the end of its own line, never on a tick', () => {
    const text = 'W7-E ✓ 95 · 95,4'
    const line = row(OUTSIDE_ROWS_PX.chain, text)
    const half = (text.length * DIM_STYLE.charWidth) / 2
    expect(line.text.x).toBeCloseTo(95 + DIM_STYLE.outsideGap + half, 6)
    // The other end moves the text past the start of the line.
    const atStart = row(OUTSIDE_ROWS_PX.chain, text, 95, 'start')
    expect(atStart.text.x).toBeCloseTo(-DIM_STYLE.outsideGap - half, 6)
  })

  it('centres a text that fits on the middle of its own segment, at the standard gap', () => {
    const line = row(OUTSIDE_ROWS_PX.chain, '95')
    expect(line.outside).toBe(false)
    expect(line.text.x).toBeCloseTo(47.5, 6)
    expect(-OUTSIDE_ROWS_PX.chain - line.text.y).toBeCloseTo(DIM_STYLE.textGap, 6)
  })

  it('draws nothing for a face too short on screen to hold a line', () => {
    expect(outsideRowLine({
      start: { x: 0, y: 0 }, end: { x: 5, y: 0 }, normal: { x: 0, y: -1 },
      offsetCm: OUTSIDE_ROWS_PX.chain, zoom: 0.1, text: '5', outsideEnd: 'end',
    })).toBeNull()
  })
})
