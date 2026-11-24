// Wall tool: chain logic, bearing label, snapping targets and the segment it stores
// (docs/walls-plan.md phase 6 and "Walls in the interface").
import { describe, expect, it } from 'vitest'
import type { PlanDoc, Room, Vec } from '../../model/types'
import { convertToV2 } from '../../model/v2/convert'
import { addWallSegment, removeWallSegment } from './traces'
import {
  addChainPoint, alignBadge, angleFieldText, bearingDeg, centreLineOffsetCm, chainSegments, fmtAngle,
  leftNormal, moveSegmentEnd, nextAlign, nextWallProps, offsetChain, offsetSegment, placePoint,
  pointFromLengthAngle, previewLabel, removeChainPoint, safeType, segmentsWith, snapTargets, typedEnd,
} from './wallToolLogic'

const p = (x: number, y: number) => ({ x, y })

const rectRoom = (over: Partial<Room> = {}): Room => ({
  id: 'r1', code: 'SE', name: 'Séjour', holes: [], walls: {}, walkOrder: 1,
  vertices: [p(0, 0), p(400, 0), p(400, 300), p(0, 300)].map((v, i) => ({ id: `v${i}`, ...v })),
  ...over,
})

/** Point coordinates of a list of points/vertices (a vertex carries an id too). */
const hasPoint = (pts: { x: number; y: number }[], x: number, y: number) =>
  pts.some((v) => v.x === x && v.y === y)

const hasEdge = (edges: [Vec, Vec][], a: Vec, b: Vec) =>
  edges.some(([s, e]) => (s.x === a.x && s.y === a.y && e.x === b.x && e.y === b.y)
    || (s.x === b.x && s.y === b.y && e.x === a.x && e.y === a.y))

const doc = (over: Partial<PlanDoc> = {}): PlanDoc => ({
  projectId: 'local', title: 'T', rooms: [rectRoom()], elements: [], measurements: {}, roomNotes: {}, tapes: [],
  ...over,
})

describe('chain of the Wall tool', () => {
  it('adds points and ignores a click on the last point (double-click ends the chain)', () => {
    let chain = addChainPoint([], p(0, 0))
    expect(chain).toHaveLength(1)
    chain = addChainPoint(chain, p(400, 0))
    expect(chain).toHaveLength(2)
    // The second click of a double-click is the same point: no zero-length wall.
    expect(addChainPoint(chain, p(400, 0))).toBe(chain)
    expect(addChainPoint(chain, p(400.4, 0))).toBe(chain)
    expect(addChainPoint(chain, p(400, 10))).toHaveLength(3)
  })

  it('removes the last point (Backspace) and gives the chain segments', () => {
    const chain = [p(0, 0), p(400, 0), p(400, 300)]
    expect(removeChainPoint(chain)).toEqual([p(0, 0), p(400, 0)])
    expect(removeChainPoint([])).toEqual([])
    expect(chainSegments(chain)).toEqual([[p(0, 0), p(400, 0)], [p(400, 0), p(400, 300)]])
    expect(chainSegments([p(0, 0)])).toEqual([])
  })

  it('draws the rubber band from the last point to the pointer only', () => {
    const chain = [p(0, 0), p(400, 0)]
    expect(segmentsWith(chain, p(400, 300))).toEqual([[p(0, 0), p(400, 0)], [p(400, 0), p(400, 300)]])
    expect(segmentsWith(chain, null)).toEqual([[p(0, 0), p(400, 0)]])
    // A pointer on the last point adds nothing.
    expect(segmentsWith(chain, p(400, 0))).toHaveLength(1)
    expect(segmentsWith([p(0, 0)], p(100, 0))).toEqual([[p(0, 0), p(100, 0)]])
  })
})

describe('bearing and labels of the Wall tool', () => {
  it('reads a bearing in degrees: 0 up, 90 right, 180 down, 270 left (y points down)', () => {
    const o = p(0, 0)
    expect(bearingDeg(o, p(0, -100))).toBe(0)
    expect(bearingDeg(o, p(100, 0))).toBe(90)
    expect(bearingDeg(o, p(0, 100))).toBe(180)
    expect(bearingDeg(o, p(-100, 0))).toBe(270)
    expect(bearingDeg(o, p(100, -100))).toBeCloseTo(45, 6)
    expect(bearingDeg(o, p(-100, 100))).toBeCloseTo(225, 6)
  })

  it('formats the angle and the preview label with a comma decimal', () => {
    expect(fmtAngle(45)).toBe('45°')
    expect(fmtAngle(45.46)).toBe('45,5°')
    expect(fmtAngle(360)).toBe('0°')
    expect(previewLabel(p(0, 0), p(400, -400))).toBe('565,7 · 45°')
    expect(previewLabel(p(0, 0), p(0, 412))).toBe('412 · 180°')
  })
})

describe('snapping targets of the Wall tool', () => {
  it('gives room corners and room walls, and the end points and lines of the traces', () => {
    const d = doc({ traces: [{ id: 't1', a: p(1000, 0), b: p(1000, 200), thicknessCm: 10, type: 'partition' }] })
    const t = snapTargets(d)
    expect(t.vertices).toHaveLength(4 + 2)
    expect(t.edges).toHaveLength(4 + 1)
    expect(hasPoint(t.vertices, 1000, 0)).toBe(true)
    expect(hasEdge(t.edges, p(1000, 0), p(1000, 200))).toBe(true)
    // Room wall centre lines are edges too (a T junction on an existing wall).
    expect(hasEdge(t.edges, p(0, 0), p(400, 0))).toBe(true)
  })

  it('adds the points of the chain, so a chain can close on its own start point', () => {
    const t = snapTargets(doc(), [p(500, 500), p(600, 500)])
    expect(hasPoint(t.vertices, 500, 500)).toBe(true)
    expect(hasPoint(t.vertices, 600, 500)).toBe(true)
  })

  it('includes hole corners (a shaft corner is a corner of the plan)', () => {
    const d = doc({ rooms: [rectRoom({ holes: [[p(10, 10), p(20, 10), p(20, 20)].map((v, i) => ({ id: `h${i}`, ...v }))] })] })
    expect(hasPoint(snapTargets(d).vertices, 20, 20)).toBe(true)
  })
})

describe('snapping targets on a v2 document', () => {
  it('gives the nodes and the centre lines of the stored walls', () => {
    const v1 = doc()
    const v2 = convertToV2(v1).doc
    const t = snapTargets(v2)
    // A node of the graph is a point to snap onto, and a wall is a line to land on (a T junction).
    expect(hasPoint(t.vertices, 0, 0)).toBe(true)
    expect(hasPoint(t.vertices, 400, 0)).toBe(true)
    expect(hasEdge(t.edges, p(0, 0), p(400, 0))).toBe(true)
    expect(hasEdge(t.edges, p(400, 0), p(400, 300))).toBe(true)
  })
})

describe('the segment that the Wall tool stores', () => {
  it('is a standalone stored wall in a v2 document, with the properties of the tool', () => {
    const v2 = convertToV2(doc()).doc
    const out = addWallSegment(v2, p(1000, 0), p(1000, 400), { type: 'bearing', thicknessCm: 25 })
    expect(out.wallId).not.toBeNull()
    const wall = (out.doc.walls ?? []).find((w) => w.id === out.wallId)!
    expect(wall.standalone).toBe(true)
    expect(wall.type).toBe('bearing')
    expect(wall.thicknessCm).toBe(25)
    // No trace: a v2 document keeps its walls in the graph.
    expect(out.doc.traces ?? []).toEqual([])
  })

  it('is a trace in a v1 document, as before', () => {
    const v1 = doc()
    const out = addWallSegment(v1, p(1000, 0), p(1000, 400), { type: 'partition', thicknessCm: 12 }, 'tr9')
    expect(out.wallId).toBe('tr9')
    expect((out.doc.traces ?? []).map((t) => t.id)).toEqual(['tr9'])
    expect(out.doc.walls).toBeUndefined()
  })

  it('takes the node of a wall end within 1 cm, and makes a node on the middle of a wall', () => {
    const v2 = convertToV2(doc()).doc
    const out = addWallSegment(v2, p(0.2, 0.2), p(400, 150), { type: 'partition', thicknessCm: 10 })
    expect(out.wallId).not.toBeNull()
    const wall = (out.doc.walls ?? []).find((w) => w.id === out.wallId)!
    const nodes = new Map((out.doc.nodes ?? []).map((n) => [n.id, n]))
    const ends = [nodes.get(wall.a)!, nodes.get(wall.b)!]
    // One end is the corner of the room, the other one is on the middle of its right wall.
    expect(ends.some((e) => Math.abs(e.x) < 0.5 && Math.abs(e.y) < 0.5)).toBe(true)
    expect(ends.some((e) => Math.abs(e.x - 400) < 0.5 && Math.abs(e.y - 150) < 0.5)).toBe(true)
  })

  it('goes back with Backspace, and stays away while a room uses it', () => {
    const v2 = convertToV2(doc()).doc
    const out = addWallSegment(v2, p(1000, 0), p(1000, 400), { type: 'partition', thicknessCm: 10 })
    const back = removeWallSegment(out.doc, out.wallId!)
    expect((back.walls ?? []).some((w) => w.id === out.wallId)).toBe(false)
    // A wall of the room (a face of room SE) cannot be removed: the room would open.
    const roomWall = v2.rooms[0].cycle![0].wallId
    const kept = removeWallSegment(v2, roomWall)
    expect(kept).toBe(v2)
  })
})

describe('wall properties of the next segment', () => {
  it('keeps a good thickness and falls back to the typical thickness of the type', () => {
    expect(nextWallProps(10, 'partition')).toEqual({ type: 'partition', thicknessCm: 10 })
    expect(nextWallProps(30, 'exterior')).toEqual({ type: 'exterior', thicknessCm: 30 })
    expect(nextWallProps(0, 'bearing')).toEqual({ type: 'bearing', thicknessCm: 25 })
    expect(nextWallProps(Number.NaN, 'exterior')).toEqual({ type: 'exterior', thicknessCm: 30 })
  })

  it('falls back to partition for an unknown type', () => {
    expect(safeType('wood')).toBe('partition')
    expect(safeType('bearing')).toBe('bearing')
    expect(safeType('exterior')).toBe('exterior')
  })
})

describe('typed length and angle of the Wall tool (measurements plan, section 7)', () => {
  it('places the end point of the segment from a length and a bearing', () => {
    const o = p(0, 0)
    // 0° = up on the screen, so -y.
    const up = pointFromLengthAngle(o, 412, 0)
    expect(up.x).toBeCloseTo(0, 9)
    expect(up.y).toBeCloseTo(-412, 9)
    // 90° = right.
    const right = pointFromLengthAngle(o, 412, 90)
    expect(right.x).toBeCloseTo(412, 9)
    expect(right.y).toBeCloseTo(0, 9)
    const d37 = pointFromLengthAngle(o, 412, 37)
    expect(d37.x).toBeCloseTo(247.95, 1)
    expect(d37.y).toBeCloseTo(-329.04, 1)
    // The bearing of the segment comes back as the angle that was typed.
    expect(bearingDeg(o, d37)).toBeCloseTo(37, 6)
    expect(bearingDeg(o, pointFromLengthAngle(o, 300, 225))).toBeCloseTo(225, 6)
  })

  it('takes the typed angle, else the direction of the pointer preview', () => {
    const from = p(100, 100)
    // No angle: the pointer direction, with the typed length.
    const a = typedEnd(from, p(200, 100), 50, null)!
    expect(a.x).toBeCloseTo(150, 6)
    expect(a.y).toBeCloseTo(100, 6)
    // A typed angle wins over the pointer.
    expect(typedEnd(from, p(200, 100), 50, 180)).toEqual(p(100, 150))
    // Nothing to place: no length, a length of 0, or no angle and no pointer.
    expect(typedEnd(from, p(200, 100), null, 45)).toBeNull()
    expect(typedEnd(from, p(200, 100), 0, 45)).toBeNull()
    expect(typedEnd(from, null, 300, null)).toBeNull()
    expect(typedEnd(from, from, 300, null)).toBeNull()
    expect(typedEnd(from, null, 300, 0)).toEqual(p(100, -200))
  })

  it('gives the angle field text of the preview, with a comma decimal', () => {
    expect(angleFieldText(p(0, 0), p(100, 0))).toBe('90')
    expect(angleFieldText(p(0, 0), p(100, -100))).toBe('45')
    expect(angleFieldText(p(0, 0), null)).toBe('')
    expect(angleFieldText(p(0, 0), p(10, 100))).toBe('174,3')
    expect(angleFieldText(undefined, p(10, 100))).toBe('')
  })
})

describe('drawing reference of the Wall tool: centre, side A, side B', () => {
  it('cycles centre -> A -> B -> centre', () => {
    expect(nextAlign('centre')).toBe('A')
    expect(nextAlign('A')).toBe('B')
    expect(nextAlign('B')).toBe('centre')
    expect(alignBadge('centre')).toBe('C')
    expect(alignBadge('A')).toBe('A')
    expect(alignBadge('B')).toBe('B')
  })

  it('puts the centre line half a thickness away from a face, on the other side', () => {
    // Side A is the left face: walking right (1, 0), the centre line is below the clicked points.
    expect(centreLineOffsetCm('centre', 20)).toBe(0)
    expect(centreLineOffsetCm('A', 20)).toBe(-10)
    expect(centreLineOffsetCm('B', 20)).toBe(10)
    expect(centreLineOffsetCm('A', Number.NaN)).toBe(-0)
    // The left normal of a direction on the screen: right -> up, down -> right.
    const nRight = leftNormal({ x: 1, y: 0 })
    expect(nRight.x).toBeCloseTo(0, 9)
    expect(nRight.y).toBeCloseTo(-1, 9)
    const nDown = leftNormal({ x: 0, y: 1 })
    expect(nDown.x).toBeCloseTo(1, 9)
    expect(nDown.y).toBeCloseTo(0, 9)
  })

  it('moves the two ends of one segment across the drawing direction', () => {
    // A chain traced on side A of a wall going right: the centre line is 5 cm below it.
    const [a, b] = offsetSegment(p(0, 0), p(400, 0), -5)
    expect(a).toEqual(p(0, 5))
    expect(b).toEqual(p(400, 5))
    expect(offsetSegment(p(0, 0), p(0, 300), 5)).toEqual([p(5, 0), p(5, 300)])
  })

  it('keeps the clicked points on the face and offsets the stored centre line', () => {
    const chain = [p(0, 0), p(400, 0)]
    const centre = offsetChain(chain, -5)
    expect(centre).toEqual([p(0, 5), p(400, 5)])
    // The centre reference does not move anything.
    expect(offsetChain(chain, 0)).toEqual(chain)
    expect(offsetChain([], 5)).toEqual([])
    expect(offsetChain([p(10, 10)], 5)).toEqual([p(10, 10)])
  })

  it('joins consecutive segments at a mitre of the offset lines', () => {
    // A chain traced on side A: two segments at a right angle (right, then down).
    const chain = [p(0, 0), p(400, 0), p(400, 300)]
    const centre = offsetChain(chain, -5)
    // Side A of the first segment is its top side, so the centre line is below it (y = +5); side A
    // of the second segment is its left side, so its centre line is at x = 395. The corner of the
    // centre line is the crossing of the two lines: (395, 5), not the two simple offsets.
    expect(centre[0]).toEqual(p(0, 5))
    expect(centre[1]).toEqual(p(395, 5))
    expect(centre[2]).toEqual(p(395, 300))
    // The segments share the corner point, so the wall has no gap.
    const segs = chainSegments(centre)
    expect(segs[0][1]).toEqual(segs[1][0])
    // Side B is the mirror image of it.
    const other = offsetChain(chain, 5)
    expect(other).toEqual([p(0, -5), p(405, -5), p(405, 300)])
    expect(chainSegments(other)[0][1]).toEqual(chainSegments(other)[1][0])
  })

  it('has no mitre problem when the segments are in line, and turns to the left too', () => {
    // In line: the offset is the plain one, with no crossing to find.
    expect(offsetChain([p(0, 0), p(400, 0), p(800, 0)], 5)).toEqual([p(0, -5), p(400, -5), p(800, -5)])
    // A chain that turns left: the mitre is inside the corner.
    const left = offsetChain([p(0, 0), p(400, 0), p(400, -300)], 5)
    expect(left[1]).toEqual(p(395, -5))
    expect(chainSegments(left)[0][1]).toEqual(chainSegments(left)[1][0])
  })
})

describe('the end of the last segment moves to the mitre of the next corner', () => {
  it('moves the node of a standalone stored wall', () => {
    const v2 = convertToV2(doc()).doc
    const seg = addWallSegment(v2, p(1000, 0), p(1000, 400), { type: 'partition', thicknessCm: 10 })
    const moved = moveSegmentEnd(seg.doc, seg.wallId!, p(1005, 405), p(1000, 400))
    const wall = (moved.walls ?? []).find((w) => w.id === seg.wallId)!
    const nodes = new Map((moved.nodes ?? []).map((n) => [n.id, n]))
    expect({ x: nodes.get(wall.b)!.x, y: nodes.get(wall.b)!.y }).toEqual({ x: 1005, y: 405 })
    // The other end stays where it was.
    expect({ x: nodes.get(wall.a)!.x, y: nodes.get(wall.a)!.y }).toEqual({ x: 1000, y: 0 })
  })

  it('never moves a node that a room or another wall uses', () => {
    const v2 = convertToV2(doc()).doc
    // The segment starts on the corner of room SE: that corner is not this wall's own.
    const seg = addWallSegment(v2, p(0.1, 0.1), p(400, 150), { type: 'partition', thicknessCm: 10 })
    const moved = moveSegmentEnd(seg.doc, seg.wallId!, p(-3, -3), p(0, 0))
    expect(moved).toBe(seg.doc)
  })

  it('moves the end of a v1 trace', () => {
    const v1 = doc()
    const seg = addWallSegment(v1, p(1000, 0), p(1000, 400), { type: 'partition', thicknessCm: 10 }, 'tr1')
    const moved = moveSegmentEnd(seg.doc, 'tr1', p(1005, 405), p(1000, 400))
    expect((moved.traces ?? [])[0].b).toEqual(p(1005, 405))
    expect((moved.traces ?? [])[0].a).toEqual(p(1000, 0))
    // An id that is not in the doc changes nothing.
    expect(moveSegmentEnd(v1, 'nope', p(1, 1), p(0, 0))).toBe(v1)
  })
})

describe('one click of the Wall tool on a face (alignment A)', () => {
  it('stores the centre line half a thickness inside, and joins two segments at a node', () => {
    const props = { type: 'partition' as const, thicknessCm: 10 }
    const k = centreLineOffsetCm('A', props.thicknessCm) // -5 cm: the clicked points are on the top face
    let d = convertToV2(doc()).doc
    // The chain traced on the face: (1000, 0) -> (1400, 0) -> (1400, 400).
    let chain: Vec[] = [p(1000, 0)]
    let ids: string[] = []
    for (const point of [p(1400, 0), p(1400, 400)]) {
      const res = placePoint(d, chain, ids[ids.length - 1] ?? null, point, props, k)
      expect(res.chain.length).toBe(chain.length + 1)
      expect(res.doc).not.toBe(d)
      d = res.doc
      chain = res.chain
      ids = [...ids, res.wallId!]
    }
    // Two stored walls, and the first one moved its end to the mitre of the corner.
    expect(ids.every((id) => (d.walls ?? []).some((w) => w.id === id))).toBe(true)
    const nodes = new Map((d.nodes ?? []).map((n) => [n.id, n]))
    const w1 = (d.walls ?? []).find((w) => w.id === ids[0])!
    const w2 = (d.walls ?? []).find((w) => w.id === ids[1])!
    // The two segments share the corner node: the offset segments join, no gap.
    expect(w1.b).toBe(w2.a)
    const corner = nodes.get(w1.b)!
    expect(corner.x).toBeCloseTo(1395, 6)
    expect(corner.y).toBeCloseTo(5, 6)
    // The clicked points stay on the face: the centre line is 5 cm away from them.
    const a1 = nodes.get(w1.a)!
    expect(a1.x).toBeCloseTo(1000, 6)
    expect(a1.y).toBeCloseTo(5, 6)
  })

  it('does nothing for a click on the last point (a double-click adds no wall)', () => {
    const props = { type: 'partition' as const, thicknessCm: 10 }
    const d = convertToV2(doc()).doc
    const res = placePoint(d, [p(1000, 0)], null, p(1000, 0), props, -5)
    expect(res.doc).toBe(d)
    expect(res.wallId).toBeNull()
    expect(res.chain).toHaveLength(1)
  })
})

describe('the previous segment keeps its start when both corners are close', () => {
  it('moves the end that the last click created, not the start of a short segment', () => {
    const props = { type: 'partition' as const, thicknessCm: 20 }
    const k = centreLineOffsetCm('B', props.thicknessCm) // +10: the clicked points are on the right face
    // A very short first segment: both of its nodes are close to the new corner.
    let d = convertToV2(doc()).doc
    let chain: Vec[] = [p(1000, 0)]
    let ids: string[] = []
    for (const point of [p(1003, 0), p(1003, 400)]) {
      const res = placePoint(d, chain, ids[ids.length - 1] ?? null, point, props, k)
      d = res.doc
      chain = res.chain
      ids = [...ids, res.wallId ?? '']
    }
    const nodes = new Map((d.nodes ?? []).map((n) => [n.id, n]))
    const w1 = (d.walls ?? []).find((w) => w.id === ids[0])!
    const w2 = (d.walls ?? []).find((w) => w.id === ids[1])!
    expect(w1.b).toBe(w2.a)
    // The start of the short segment stays on its own face line (y = -10 for side B).
    const a1 = nodes.get(w1.a)!
    expect(a1.x).toBeCloseTo(1000, 6)
    expect(a1.y).toBeCloseTo(-10, 6)
  })
})
