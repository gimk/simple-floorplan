// Tests of the write path of the v2 model (docs/walls-plan.md, phase 5c step 3): a room polygon
// written into the wall graph, and a room that goes away.
import { describe, expect, it } from 'vitest'
import { demoRooms } from '../../features/measure/demo'
import { dist, signedArea } from '../geometry'
import type { Measurement, PlanDoc, Room, Vec } from '../types'
import { convertToV2 } from './convert'
import { faceEndCm, faceForward, faceStartCm } from './materialize'
import { addStandaloneWall, applyRoomPolygon, removeRoom, removeWall, settleWallsWithoutFaces } from './write'

/** A v1 document with these rooms. */
const plan = (rooms: Room[], measurements: Record<string, Measurement> = {}): PlanDoc => ({
  projectId: 'p1', title: 'test', rooms, elements: [], measurements, roomNotes: {}, tapes: [],
})

/** One room of a test plan: polygon in cm, one corner id per point. */
const mk = (id: string, pts: [number, number][], walkOrder: number, extra: Partial<Room> = {}): Room => ({
  id,
  code: id,
  name: id,
  vertices: pts.map(([x, y], i) => ({ id: `${id}-v${i}`, x, y })),
  holes: [],
  walls: {},
  walkOrder,
  ...extra,
})

const value = (label: string, actualCm: number): Measurement => ({ label, actualCm, updatedAt: '2026-11-23T10:00:00Z', source: 'tape' })

// The A/B/C plan of src/features/rooms/globalSolve.test.ts (centre lines, cm).
const abcRooms = () => [
  mk('A', [[0, 0], [304, 0], [304, 398], [0, 398]], 1, { diagonal: [0, 2] }),
  mk('B', [[304, 0], [601, 0], [601, 203], [304, 203]], 2),
  mk('C', [[304, 203], [601, 203], [601, 398], [304, 398]], 3),
]

/** The converted document of a set of v1 rooms. */
const v2 = (rooms: Room[], measurements: Record<string, Measurement> = {}) => convertToV2(plan(rooms, measurements)).doc

const roomOf = (doc: PlanDoc, id: string) => doc.rooms.find((r) => r.id === id)!

/** The room with one corner at another place (the ids do not change, as a tool keeps them). */
const withVertex = (room: Room, index: number, to: [number, number]): Room => ({
  ...room,
  vertices: room.vertices.map((v, i) => (i === index ? { ...v, x: to[0], y: to[1] } : v)),
})

/** The room with the given corners moved by `d`. */
const withCorners = (room: Room, indexes: number[], d: [number, number]): Room => ({
  ...room,
  vertices: room.vertices.map((v, i) => (indexes.includes(i) ? { ...v, x: v.x + d[0], y: v.y + d[1] } : v)),
})

const corners = (room: Room) => room.vertices.map((v) => [v.x, v.y])

/** Walls that hold a face of both rooms. */
const wallBetween = (doc: PlanDoc, a: string, b: string) =>
  (doc.walls ?? []).filter((w) => w.faces.some((f) => f.roomId === a) && w.faces.some((f) => f.roomId === b))

/** Walls whose centre line is horizontal or vertical at `c` (a duplicate check). */
const wallsOnLine = (doc: PlanDoc, vertical: boolean, c: number) => {
  const nodes = new Map((doc.nodes ?? []).map((n) => [n.id, n]))
  return (doc.walls ?? []).filter((w) => {
    const a = nodes.get(w.a)!
    const b = nodes.get(w.b)!
    if (vertical) return Math.abs(a.x - c) < 0.5 && Math.abs(b.x - c) < 0.5
    return Math.abs(a.y - c) < 0.5 && Math.abs(b.y - c) < 0.5
  })
}

/** Centre line of a stored wall: node a, direction a -> b and length. */
function lineOf(doc: PlanDoc, wallId: string) {
  const wall = (doc.walls ?? []).find((w) => w.id === wallId)
  const nodes = new Map((doc.nodes ?? []).map((n) => [n.id, n]))
  const a = wall ? nodes.get(wall.a) : undefined
  const b = wall ? nodes.get(wall.b) : undefined
  if (!wall || !a || !b) return null
  const length = dist(a, b)
  if (length < 1e-9) return null
  return { a, b, d: { x: (b.x - a.x) / length, y: (b.y - a.y) / length }, length }
}

const pointAt = (line: { a: Vec; d: Vec }, cm: number): Vec => ({ x: line.a.x + line.d.x * cm, y: line.a.y + line.d.y * cm })

/**
 * The invariants of a written document (the style of `conversionProblems`):
 * no face without a wall, no wall without a face, no wall and no node that no room uses, and every
 * room cycle closed (the end of a face is the start of the next one).
 */
function writeProblems(doc: PlanDoc): string[] {
  const problems: string[] = []
  const walls = new Map((doc.walls ?? []).map((w) => [w.id, w]))
  const usedNodes = new Set<string>()
  for (const w of walls.values()) {
    usedNodes.add(w.a)
    usedNodes.add(w.b)
  }
  for (const n of doc.nodes ?? []) if (!usedNodes.has(n.id)) problems.push(`node ${n.id}: used by no wall`)
  const usedWalls = new Set<string>()
  for (const r of doc.rooms) for (const f of r.cycle ?? []) usedWalls.add(f.wallId)
  for (const w of walls.values()) {
    if (!w.faces.length) problems.push(`wall ${w.id}: no face`)
    // A standalone wall STAYS when no room uses it (a wall drawn on its own, a wall of a deleted
    // room): that is the plan of the interface, not a problem.
    if (!usedWalls.has(w.id) && !w.standalone) problems.push(`wall ${w.id}: used by no room`)
    if (w.thicknessCm === undefined || w.type === undefined) problems.push(`wall ${w.id}: no properties`)
  }
  for (const r of doc.rooms) {
    const cycle = r.cycle ?? []
    if (!cycle.length) continue
    if (r.vertices.length !== cycle.length) problems.push(`room ${r.code}: ${r.vertices.length} corners, ${cycle.length} faces`)
    const starts: (Vec | null)[] = []
    const ends: (Vec | null)[] = []
    // The travel direction of the room on this wall: a CCW room walks b -> a on side L.
    const winding = signedArea(r.vertices)
    cycle.forEach((f, k) => {
      const line = lineOf(doc, f.wallId)
      if (!line) {
        problems.push(`room ${r.code}: face ${k} on wall ${f.wallId} that does not exist`)
        starts.push(null)
        ends.push(null)
        return
      }
      if (f.from < -1e-6 || f.to > line.length + 1e-6) problems.push(`room ${r.code}: face ${k} ${f.from}..${f.to} on a wall of ${line.length} cm`)
      const forward = faceForward(f, winding)
      starts.push(pointAt(line, faceStartCm(f, forward)))
      ends.push(pointAt(line, faceEndCm(f, forward)))
    })
    for (let k = 0; k < cycle.length; k++) {
      const end = ends[k]
      const start = starts[(k + 1) % cycle.length]
      if (!end || !start) continue
      if (dist(end, start) > 0.5) problems.push(`room ${r.code}: face ${k} ends ${Math.round(dist(end, start) * 10) / 10} cm from face ${(k + 1) % cycle.length}`)
    }
  }
  return problems
}

describe('applyRoomPolygon: nothing changed', () => {
  it('gives the same document back for the materialized polygon of every room', () => {
    const plans = [
      v2(demoRooms(), { 'SE-2': value('SE-2', 412), 'TE-1': value('TE-1', 320) }),
      v2(abcRooms()),
    ]
    for (const doc of plans) {
      for (const room of doc.rooms) {
        // Identity, not only equality: the store must see no change and make no undo step.
        expect(applyRoomPolygon(doc, room.id, room)).toBe(doc)
      }
      expect(writeProblems(doc)).toEqual([])
    }
  })

  it('keeps the ids, the values and the report of the conversion', () => {
    const before = plan(abcRooms(), { 'A-2': value('A-2', 378) })
    const { doc } = convertToV2(before)
    for (const room of doc.rooms) expect(applyRoomPolygon(doc, room.id, room)).toBe(doc)
    expect(doc.measurements).toBe(before.measurements)
  })
})

describe('applyRoomPolygon: corner and wall edits', () => {
  it('moves one corner of a room that shares no wall', () => {
    const doc = v2([
      mk('A', [[0, 0], [300, 0], [300, 400], [0, 400]], 1),
      mk('B', [[500, 0], [800, 0], [800, 400], [500, 400]], 2),
    ])
    expect(doc.walls).toHaveLength(8)
    const after = applyRoomPolygon(doc, 'A', withVertex(roomOf(doc, 'A'), 1, [350, -50]))

    expect(corners(roomOf(after, 'A'))).toEqual([[0, 0], [350, -50], [300, 400], [0, 400]])
    // The other room does not move.
    expect(corners(roomOf(after, 'B'))).toEqual(corners(roomOf(doc, 'B')))
    // A keeps its two walls that still hold its edges (left and bottom) and makes two new ones.
    expect(after.walls).toHaveLength(8)
    // The old top wall of A (y = 0, x 0..300) is gone: no room uses it any more.
    expect(wallsOnLine(after, false, 0).map((w) => w.faces.filter((f) => f.roomId !== undefined).map((f) => f.roomId))).toEqual([['B']])
    expect(writeProblems(after)).toEqual([])
  })

  it('keeps a shared wall whole when the new edge covers only a part of it', () => {
    const doc = v2([
      mk('A', [[0, 0], [300, 0], [300, 400], [0, 400]], 1),
      mk('B', [[300, 0], [600, 0], [600, 400], [300, 400]], 2),
    ])
    const shared = wallBetween(doc, 'A', 'B')
    expect(shared).toHaveLength(1)
    // B becomes a small room in the middle of the shared wall. The wall is NOT cut to the two ends
    // of the new edge: it keeps its id, its properties and the value of A on its own side, and B
    // gets a face over its span only.
    const after = applyRoomPolygon(doc, 'B', mk('B', [[300, 100], [600, 100], [600, 300], [300, 300]], 2))
    const wall = (after.walls ?? []).find((w) => w.id === shared[0].id)!
    expect(wall).toBeDefined()
    expect(wall.faces.filter((f) => f.roomId === 'A').map((f) => [f.from, f.to])).toEqual([[0, 400]])
    expect(wall.faces.filter((f) => f.roomId === 'B').map((f) => [f.from, f.to])).toEqual([[100, 300]])
    expect(corners(roomOf(after, 'A'))).toEqual(corners(roomOf(doc, 'A')))
    expect(corners(roomOf(after, 'B'))).toEqual([[300, 100], [600, 100], [600, 300], [300, 300]])
    // The old top and bottom walls of B go (no room uses them), the right wall of B is reused.
    expect(after.walls).toHaveLength(7)
    expect(writeProblems(after)).toEqual([])
  })

  it('never moves a wall of another room: a shared edge that leaves the wall makes a new wall', () => {
    const doc = v2([
      mk('A', [[0, 0], [300, 0], [300, 400], [0, 400]], 1),
      mk('B', [[300, 0], [600, 0], [600, 400], [300, 400]], 2),
    ])
    const shared = wallBetween(doc, 'A', 'B')
    const after = applyRoomPolygon(doc, 'A', withCorners(roomOf(doc, 'A'), [1, 2], [-40, 0]))

    // A has its own wall, B keeps the shared one where it is (the v2 rule: the write path never
    // moves a wall of another room).
    expect(corners(roomOf(after, 'A'))).toEqual([[0, 0], [260, 0], [260, 400], [0, 400]])
    expect(corners(roomOf(after, 'B'))).toEqual(corners(roomOf(doc, 'B')))
    expect(wallBetween(after, 'A', 'B')).toEqual([])
    expect(wallsOnLine(after, true, 300)).toHaveLength(1)
    expect(wallsOnLine(after, true, 260)).toHaveLength(1)
    // The neighbour's face on the shared wall is still there: the wall was kept whole.
    const old = (after.walls ?? []).find((w) => w.id === shared[0].id)
    expect(old?.faces.some((f) => f.roomId === 'B')).toBe(true)
    expect(writeProblems(after)).toEqual([])
  })

  it('slices a room in two: the middle wall is shared by the two halves', () => {
    const doc = v2([mk('A', [[0, 0], [600, 0], [600, 400], [0, 400]], 1)])
    const first = roomOf(doc, 'A')
    // The two halves a slice tool builds (same corner ids where the tool kept them).
    const left: Room = {
      ...first,
      vertices: [first.vertices[0], { id: 'mid-top', x: 300, y: 0 }, { id: 'mid-bottom', x: 300, y: 400 }, first.vertices[3]],
    }
    const right: Room = {
      ...mk('A2', [], 2),
      vertices: [{ id: 'mid-top', x: 300, y: 0 }, first.vertices[1], first.vertices[2], { id: 'mid-bottom', x: 300, y: 400 }],
    }
    const one = applyRoomPolygon(doc, 'A', left)
    const both = applyRoomPolygon(one, right.id, right)

    expect(both.rooms).toHaveLength(2)
    expect(corners(roomOf(both, 'A'))).toEqual([[0, 0], [300, 0], [300, 400], [0, 400]])
    expect(corners(roomOf(both, 'A2'))).toEqual([[300, 0], [600, 0], [600, 400], [300, 400]])
    // The middle wall is ONE wall, with a face of each half.
    const middle = wallsOnLine(both, true, 300)
    expect(middle).toHaveLength(1)
    expect(middle[0].faces.map((f) => f.roomId).sort()).toEqual(['A', 'A2'])
    // The two halves also share the long walls of the slice (one wall, a face per half).
    expect(wallBetween(both, 'A', 'A2')).toHaveLength(3)
    expect(writeProblems(both)).toEqual([])
  })

  it('adds a room against an existing wall: reuses it, no duplicate', () => {
    const doc = v2([mk('A', [[0, 0], [300, 0], [300, 400], [0, 400]], 1)])
    expect(doc.walls).toHaveLength(4)
    const added = mk('B', [[300, 0], [600, 0], [600, 400], [300, 400]], 2)
    const after = applyRoomPolygon(doc, 'B', added)

    expect(after.rooms).toHaveLength(2)
    expect(corners(roomOf(after, 'B'))).toEqual([[300, 0], [600, 0], [600, 400], [300, 400]])
    // One wall along x = 300, with a face of each room, and three new walls for B.
    expect(wallsOnLine(after, true, 300)).toHaveLength(1)
    expect(after.walls).toHaveLength(7)
    expect(wallBetween(after, 'A', 'B')).toHaveLength(1)
    expect(writeProblems(after)).toEqual([])
  })

  it('cuts only the faces of the corridor side (the Entree / Couloir rule)', () => {
    const doc = v2([
      mk('EN', [[0, 0], [600, 0], [600, 200], [0, 200]], 1),
      mk('CO', [[0, 200], [600, 200], [600, 300], [0, 300]], 2),
    ])
    const shared = wallBetween(doc, 'EN', 'CO')
    expect(shared).toHaveLength(1)
    const enSide = shared[0].faces.find((f) => f.roomId === 'EN')!.side
    // The corridor gives its right half to a new room. The shared wall stays whole: EN keeps ONE
    // face over its whole length, and only the corridor side gets a second face.
    const co = withVertex(roomOf(doc, 'CO'), 1, [300, 200])
    const co2 = withVertex(co, 2, [300, 300])
    const one = applyRoomPolygon(doc, 'CO', co2)
    const room = {
      ...mk('C2', [[300, 200], [600, 200], [600, 300], [300, 300]], 3),
    }
    const both = applyRoomPolygon(one, 'C2', room)

    const wall = (both.walls ?? []).find((w) => w.id === shared[0].id)!
    // EN is not cut: one face on its side, over the whole wall.
    const enFaces = wall.faces.filter((f) => f.roomId === 'EN')
    expect(enFaces).toHaveLength(1)
    expect(enFaces[0].side).toBe(enSide)
    expect(enFaces[0].from).toBe(0)
    expect(enFaces[0].to).toBe(600)
    // The corridor side holds the corridor and the new room, cut in two.
    const other = wall.faces.filter((f) => f.roomId !== 'EN' && f.roomId !== undefined)
    expect(other.map((f) => f.roomId).sort()).toEqual(['C2', 'CO'])
    expect(other.map((f) => [f.from, f.to])).toEqual([[0, 300], [300, 600]])
    // The middle wall of the corridor is shared by the two rooms.
    expect(wallBetween(both, 'CO', 'C2').length).toBeGreaterThan(0)
    expect(writeProblems(both)).toEqual([])
  })

  it('writes the properties that the tool changed on a shared wall (both rooms see them)', () => {
    const doc = v2([
      mk('A', [[0, 0], [300, 0], [300, 400], [0, 400]], 1),
      mk('B', [[300, 0], [600, 0], [600, 400], [300, 400]], 2),
    ])
    const shared = wallBetween(doc, 'A', 'B')[0]
    const a = roomOf(doc, 'A')
    // The shared wall starts at the corner with id of A: the tool writes a bearing wall of 20 cm.
    const cornerId = a.cycle!.find((f) => f.wallId === shared.id)!.cornerId
    const wanted: Room = { ...a, walls: { ...a.walls, [cornerId]: { type: 'bearing', thicknessCm: 20 } } }
    const after = applyRoomPolygon(doc, 'A', wanted)

    const wall = (after.walls ?? []).find((w) => w.id === shared.id)!
    expect(wall.type).toBe('bearing')
    expect(wall.thicknessCm).toBe(20)
    // By design: one wall, so room B reads the new properties too.
    expect(roomOf(after, 'B').walls[roomOf(after, 'B').cycle!.find((f) => f.wallId === shared.id)!.cornerId]).toEqual({ type: 'bearing', thicknessCm: 20 })
    expect(writeProblems(after)).toEqual([])
  })

  it('keeps slanting walls as they are, and moves a corner on one', () => {
    const doc = v2([
      mk('A', [[0, 0], [304, 0], [375, 398], [0, 398]], 1),
      mk('B', [[304, 0], [601, 0], [601, 398], [375, 398]], 2),
    ])
    const shared = wallBetween(doc, 'A', 'B')
    expect(shared).toHaveLength(1)
    // Nothing changed: identity (a wall at an angle is reused like any other).
    expect(applyRoomPolygon(doc, 'A', roomOf(doc, 'A'))).toBe(doc)
    // B moves its bottom corner: the slanted wall is kept whole for A, B gets a new one.
    const after = applyRoomPolygon(doc, 'B', withVertex(roomOf(doc, 'B'), 3, [420, 398]))
    expect(corners(roomOf(after, 'A'))).toEqual(corners(roomOf(doc, 'A')))
    expect(corners(roomOf(after, 'B'))[3]).toEqual([420, 398])
    const kept = (after.walls ?? []).find((w) => w.id === shared[0].id)!
    expect(kept.faces.some((f) => f.roomId === 'A')).toBe(true)
    expect(writeProblems(after)).toEqual([])
  })

  it('keeps the holes of the room', () => {
    const hole = [{ id: 'h0', x: 100, y: 100 }, { id: 'h1', x: 200, y: 100 }, { id: 'h2', x: 200, y: 200 }, { id: 'h3', x: 100, y: 200 }]
    const doc = v2([mk('A', [[0, 0], [400, 0], [400, 400], [0, 400]], 1, { holes: [hole] })])
    const after = applyRoomPolygon(doc, 'A', withVertex(roomOf(doc, 'A'), 0, [-50, -50]))
    expect(roomOf(after, 'A').holes).toEqual([hole])
  })

  it('gives the properties of the corner to every piece of a split edge', () => {
    // A = x 0..300, y 0..400: its top wall runs from (0,0) to (300,0).
    const doc = v2([mk('A', [[0, 0], [300, 0], [300, 400], [0, 400]], 1)])
    // B is above A, and its bottom edge covers the top wall of A and goes 200 cm further.
    const b: Room = {
      ...mk('B', [[0, 0], [500, 0], [500, -100], [0, -100]], 2),
      walls: { 'B-v0': { type: 'bearing', thicknessCm: 20 } },
    }
    const after = applyRoomPolygon(doc, 'B', b)

    expect(corners(roomOf(after, 'B'))).toEqual([[0, 0], [300, 0], [500, 0], [500, -100], [0, -100]])
    // The edge makes two pieces: the wall of A, reused, then a new wall for the rest of the edge.
    // A wall is never split for a new room, so the extension is a wall of its own; the properties
    // given for the corner of the edge belong to both pieces.
    const atTop = wallsOnLine(after, false, 0)
    expect(atTop).toHaveLength(2)
    expect(atTop.map((w) => [w.type, w.thicknessCm])).toEqual([['bearing', 20], ['bearing', 20]])
    expect(writeProblems(after)).toEqual([])
  })

  it('writes a room polygon wound counter-clockwise without reordering it', () => {
    const doc = v2([mk('A', [[0, 0], [300, 0], [300, 400], [0, 400]], 1)])
    // B shares the wall at x = 300, but its corners are listed counter-clockwise.
    const b = mk('B', [[300, 0], [300, 400], [600, 400], [600, 0]], 2)
    const after = applyRoomPolygon(doc, 'B', b)

    // The polygon comes back as it was typed, with its corners in the same order.
    expect(roomOf(after, 'B').cycle!.map((f) => f.cornerId)).toEqual(['B-v0', 'B-v1', 'B-v2', 'B-v3'])
    expect(corners(roomOf(after, 'B'))).toEqual([[300, 0], [300, 400], [600, 400], [600, 0]])
    // One wall between the two rooms, and the neighbour does not move.
    expect(wallBetween(after, 'A', 'B')).toHaveLength(1)
    expect(corners(roomOf(after, 'A'))).toEqual(corners(roomOf(doc, 'A')))
    expect(writeProblems(after)).toEqual([])
  })

  it('writes a v1 document the v1 way (no wall graph yet)', () => {
    const v1 = plan([mk('A', [[0, 0], [300, 0], [300, 400], [0, 400]], 1)])
    const moved = withVertex(v1.rooms[0], 1, [300, -50])
    const after = applyRoomPolygon(v1, 'A', moved)
    expect(corners(after.rooms[0])[1]).toEqual([300, -50])
    expect(after.walls).toBeUndefined()
    expect(after.rooms[0].cycle).toBeUndefined()
  })
})

describe('removeRoom', () => {
  it('keeps the walls of the room (standalone), and the shared wall keeps its face of A', () => {
    const doc = v2([
      mk('A', [[0, 0], [300, 0], [300, 400], [0, 400]], 1),
      mk('B', [[300, 0], [600, 0], [600, 400], [300, 400]], 2),
      mk('C', [[900, 0], [1200, 0], [1200, 400], [900, 400]], 3),
    ])
    const shared = wallBetween(doc, 'A', 'B')[0]
    const bWalls = roomOf(doc, 'B').cycle!.map((f) => f.wallId)
    const after = removeRoom(doc, 'B')

    expect(after.rooms.map((r) => r.id)).toEqual(['A', 'C'])
    // Deleting a room KEEPS its walls: no wall of B goes away.
    expect(after.walls).toHaveLength((doc.walls ?? []).length)
    for (const id of bWalls) expect((after.walls ?? []).some((w) => w.id === id)).toBe(true)
    // The shared wall stays with the face of A, without the flag (A still uses it).
    const kept = (after.walls ?? []).find((w) => w.id === shared.id)!
    expect(kept.faces.filter((f) => f.roomId === 'B')).toEqual([])
    expect(kept.faces.some((f) => f.roomId === 'A')).toBe(true)
    expect(kept.standalone).toBeUndefined()
    // The three walls that only B used are standalone walls now: a free side on both faces.
    for (const id of bWalls.filter((x) => x !== shared.id)) {
      const wall = (after.walls ?? []).find((w) => w.id === id)!
      expect(wall.standalone).toBe(true)
      expect(wall.faces.filter((f) => f.roomId !== undefined)).toEqual([])
    }
    expect(corners(roomOf(after, 'A'))).toEqual(corners(roomOf(doc, 'A')))
    expect(corners(roomOf(after, 'C'))).toEqual(corners(roomOf(doc, 'C')))
    expect(writeProblems(after)).toEqual([])
  })

  it('keeps the walls of the last room, and gives nothing back when the room is not there', () => {
    const doc = v2([mk('A', [[0, 0], [300, 0], [300, 400], [0, 400]], 1)])
    const wallIds = roomOf(doc, 'A').cycle!.map((f) => f.wallId)
    const empty = removeRoom(doc, 'A')
    expect(empty.rooms).toEqual([])
    expect((empty.walls ?? []).map((w) => w.id).sort()).toEqual([...wallIds].sort())
    expect((empty.walls ?? []).every((w) => w.standalone === true)).toBe(true)
    expect((empty.nodes ?? []).length).toBeGreaterThan(0)
    expect(removeRoom(doc, 'nope')).toBe(doc)
  })
})

describe('a standalone wall', () => {
  it('is added with its two nodes, its properties and the flag', () => {
    const doc = v2([mk('A', [[0, 0], [300, 0], [300, 400], [0, 400]], 1)])
    const out = addStandaloneWall(doc, { x: 900, y: 0 }, { x: 900, y: 500 }, { type: 'bearing', thicknessCm: 25 })
    expect(out.wallId).not.toBeNull()
    const wall = (out.doc.walls ?? []).find((w) => w.id === out.wallId)!
    expect(wall.standalone).toBe(true)
    expect(wall.type).toBe('bearing')
    expect(wall.thicknessCm).toBe(25)
    // A wall alone has no room face: both of its sides are outside.
    expect(wall.faces.every((f) => f.roomId === undefined)).toBe(true)
    expect(writeProblems(out.doc)).toEqual([])
  })

  it('takes an existing node within 1 cm, and a new node on the middle of a wall (a T junction)', () => {
    const doc = v2([mk('A', [[0, 0], [400, 0], [400, 400], [0, 400]], 1)])
    const nodeA = (doc.nodes ?? []).find((n) => Math.abs(n.x - 0) < 0.5 && Math.abs(n.y - 0) < 0.5)!
    // The first end takes the node of the corner, the second one lands on the middle of a wall.
    const out = addStandaloneWall(doc, { x: 0.4, y: 0.3 }, { x: 200, y: 400 }, { type: 'partition', thicknessCm: 10 })
    expect(out.wallId).not.toBeNull()
    const wall = (out.doc.walls ?? []).find((w) => w.id === out.wallId)!
    expect(wall.a === nodeA.id || wall.b === nodeA.id).toBe(true)
    // The host wall is NOT split: its spans still cover it whole.
    const host = (out.doc.walls ?? []).find((w) => w.faces.some((f) => f.roomId === 'A' && f.from === 0 && f.to === 400))
    expect(host).toBeDefined()
    // The new node is on the host line, and no second wall was stored on that line.
    const nodes = new Map((out.doc.nodes ?? []).map((n) => [n.id, n]))
    const end = wall.a === nodeA.id ? nodes.get(wall.b)! : nodes.get(wall.a)!
    expect(Math.abs(end.y - 400)).toBeLessThan(0.5)
    // One wall on that line only: the host, which is not split.
    expect(wallsOnLine(out.doc, false, 400).length).toBe(1)
    expect(writeProblems(out.doc)).toEqual([])
  })

  it('adds nothing for a dot, and nothing for a wall that is already there', () => {
    const doc = v2([mk('A', [[0, 0], [400, 0], [400, 400], [0, 400]], 1)])
    expect(addStandaloneWall(doc, { x: 0, y: 0 }, { x: 0.2, y: 0 }, { type: 'partition', thicknessCm: 10 }).doc).toBe(doc)
    // The wall of the top edge of A is already there (same two nodes): nothing is stored twice.
    const again = addStandaloneWall(doc, { x: 0, y: 0 }, { x: 400, y: 0 }, { type: 'partition', thicknessCm: 10 })
    expect(again.doc).toBe(doc)
    expect(again.wallId).not.toBeNull()
  })

  it('stays when a room shape edit leaves it without a face, and a wall without the flag goes', () => {
    const doc = v2([mk('A', [[0, 0], [400, 0], [400, 300], [0, 300]], 1)])
    const withWall = addStandaloneWall(doc, { x: 100, y: 600 }, { x: 300, y: 600 }, { type: 'partition', thicknessCm: 10 }).doc
    const standaloneId = (withWall.walls ?? []).find((w) => w.standalone)!.id
    // A shape edit that does not touch the standalone wall: it stays.
    const moved = withVertex(roomOf(withWall, 'A'), 0, [-20, -20])
    const after = applyRoomPolygon(withWall, 'A', moved)
    expect((after.walls ?? []).some((w) => w.id === standaloneId)).toBe(true)
    // A wall without the flag that loses its last face GOES: the room moves away from its top wall.
    const topId = roomOf(withWall, 'A').cycle![0].wallId
    const loose = { ...withWall, walls: (withWall.walls ?? []).map((w) => (w.id === topId ? { ...w, standalone: undefined } : w)) }
    const lower = withCorners(roomOf(loose, 'A'), [0, 1], [0, 100])
    const shrunk = applyRoomPolygon(loose, 'A', lower)
    expect((shrunk.walls ?? []).some((w) => w.id === topId)).toBe(false)
    // The standalone wall of the plan is not touched by that edit.
    expect((shrunk.walls ?? []).some((w) => w.id === standaloneId)).toBe(true)
  })
})

describe('removeWall', () => {
  it('removes a standalone wall and the nodes that no wall uses', () => {
    const doc = v2([mk('A', [[0, 0], [400, 0], [400, 400], [0, 400]], 1)])
    const added = addStandaloneWall(doc, { x: 900, y: 0 }, { x: 900, y: 500 }, { type: 'partition', thicknessCm: 10 })
    expect(added.wallId).not.toBeNull()
    const nodeCount = (added.doc.nodes ?? []).length
    const out = removeWall(added.doc, added.wallId!)
    expect(out.refusedBy).toEqual([])
    expect((out.doc.walls ?? []).some((w) => w.id === added.wallId)).toBe(false)
    expect((out.doc.nodes ?? []).length).toBe(nodeCount - 2)
    expect(writeProblems(out.doc)).toEqual([])
  })

  it('is refused while a room face uses the wall, and names those rooms', () => {
    const doc = v2([
      mk('A', [[0, 0], [300, 0], [300, 400], [0, 400]], 1),
      mk('B', [[300, 0], [600, 0], [600, 400], [300, 400]], 2),
    ])
    const shared = wallBetween(doc, 'A', 'B')[0]
    const out = removeWall(doc, shared.id)
    expect(out.doc).toBe(doc)
    expect(out.refusedBy).toEqual(['A', 'B'])
    // A wall that is not in the document changes nothing.
    expect(removeWall(doc, 'nope')).toEqual({ doc, refusedBy: [] })
  })
})

// A wall that a room used before an edit and that no room uses after it (docs/walls-plan.md, "Walls
// in the interface"): the rule takes it away when a room of the result covers it (a MERGE), and
// keeps it as a standalone wall when no room covers it (a room that the user deleted).
describe('settleWallsWithoutFaces', () => {
  /** Two rooms side by side, y 0..400: ONE wall between them, at x = 300. */
  const twoRooms = () => v2([
    mk('A', [[0, 0], [300, 0], [300, 400], [0, 400]], 1),
    mk('C', [[300, 0], [600, 0], [600, 400], [300, 400]], 2),
  ])

  /** The wall that separates the two rooms, as a standalone wall of the graph. */
  const withStandalone = (doc: PlanDoc, wallId: string): PlanDoc => ({
    ...doc,
    walls: (doc.walls ?? []).map((w) => (w.id === wallId ? { ...w, standalone: true } : w)),
  })

  it('removes the wall between two rooms that are one room now', () => {
    const doc = twoRooms()
    const shared = wallBetween(doc, 'A', 'C')[0].id
    // A merge, as the write path of the edit leaves it: C is gone, the wall between the rooms lost
    // its faces (a standalone wall), and A has the polygon of the two rooms.
    const noC = removeRoom(doc, 'C')
    const merged = applyRoomPolygon(withStandalone(noC, shared), 'A', mk('A', [[0, 0], [600, 0], [600, 400], [0, 400]], 1))
    expect((merged.walls ?? []).find((w) => w.id === shared)!.standalone).toBe(true)
    const out = settleWallsWithoutFaces(merged, doc)
    // A room of the result covers its middle: the wall of that one space goes away.
    expect((out.walls ?? []).some((w) => w.id === shared)).toBe(false)
    for (const n of out.nodes ?? []) expect((out.walls ?? []).some((w) => w.a === n.id || w.b === n.id)).toBe(true)
    expect(out.rooms.length).toBe(1)
    expect(writeProblems(out)).toEqual([])
  })

  it('keeps a wall that no room covers, as a standalone wall', () => {
    const doc = twoRooms()
    // A goes away: `removeRoom` gives its own walls the standalone flag, and C covers nothing there.
    const after = removeRoom(doc, 'A')
    const out = settleWallsWithoutFaces(after, doc)
    // Nothing to do: the document comes back as it was.
    expect(out).toBe(after)
    // The wall between the two rooms keeps the face of C, without the flag.
    const between = wallBetween(after, 'A', 'C')
    expect(between).toEqual([])
    expect((out.walls ?? []).filter((w) => w.standalone === true).length).toBeGreaterThan(0)
    for (const w of out.walls ?? []) {
      if (!w.standalone) continue
      // A standalone wall has no room face: no room covers it.
      expect(w.faces.filter((f) => f.roomId !== undefined)).toEqual([])
    }
    expect(out.rooms.length).toBe(1)
  })

  it('never removes a wall that the user drew (standalone before the edit)', () => {
    const doc = twoRooms()
    // A wall drawn on its own in the middle of A, then a merge that covers it.
    const withWall = addStandaloneWall(doc, { x: 100, y: 200 }, { x: 200, y: 200 }, { type: 'partition', thicknessCm: 10 })
    const drawn = withWall.wallId!
    const merged = applyRoomPolygon(withWall.doc, 'A', mk('A', [[0, 0], [600, 0], [600, 400], [0, 400]], 1))
    const out = settleWallsWithoutFaces(merged, withWall.doc)
    expect((out.walls ?? []).some((w) => w.id === drawn)).toBe(true)
    expect((out.walls ?? []).find((w) => w.id === drawn)!.standalone).toBe(true)
  })
})
