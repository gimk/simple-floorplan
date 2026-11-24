// Wall tool: chain logic, bearing label, snapping targets and the segment it stores
// (docs/walls-plan.md phase 6 and "Walls in the interface").
import { describe, expect, it } from 'vitest'
import type { PlanDoc, Room, Vec } from '../../model/types'
import { convertToV2 } from '../../model/v2/convert'
import { addWallSegment, removeWallSegment } from './traces'
import {
  addChainPoint, bearingDeg, chainSegments, fmtAngle, nextWallProps, previewLabel, removeChainPoint,
  safeType, segmentsWith, snapTargets,
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
