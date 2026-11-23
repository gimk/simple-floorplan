// Tests of the write path of the v2 model (docs/walls-plan.md, phase 5c step 3): a room polygon
// written into the wall graph, and a room that goes away.
import { describe, expect, it } from 'vitest'
import { demoRooms } from '../../features/measure/demo'
import { dist } from '../geometry'
import type { Measurement, PlanDoc, Room, Vec } from '../types'
import { convertToV2 } from './convert'
import { faceEndCm, faceStartCm } from './materialize'
import { applyRoomPolygon, removeRoom } from './write'

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
    if (!usedWalls.has(w.id)) problems.push(`wall ${w.id}: used by no room`)
    if (w.thicknessCm === undefined || w.type === undefined) problems.push(`wall ${w.id}: no properties`)
  }
  for (const r of doc.rooms) {
    const cycle = r.cycle ?? []
    if (!cycle.length) continue
    if (r.vertices.length !== cycle.length) problems.push(`room ${r.code}: ${r.vertices.length} corners, ${cycle.length} faces`)
    const starts: (Vec | null)[] = []
    const ends: (Vec | null)[] = []
    cycle.forEach((f, k) => {
      const line = lineOf(doc, f.wallId)
      if (!line) {
        problems.push(`room ${r.code}: face ${k} on wall ${f.wallId} that does not exist`)
        starts.push(null)
        ends.push(null)
        return
      }
      if (f.from < -1e-6 || f.to > line.length + 1e-6) problems.push(`room ${r.code}: face ${k} ${f.from}..${f.to} on a wall of ${line.length} cm`)
      starts.push(pointAt(line, faceStartCm(f)))
      ends.push(pointAt(line, faceEndCm(f)))
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
  it('removes the faces and the walls of the room, and keeps the shared walls', () => {
    const doc = v2([
      mk('A', [[0, 0], [300, 0], [300, 400], [0, 400]], 1),
      mk('B', [[300, 0], [600, 0], [600, 400], [300, 400]], 2),
      mk('C', [[900, 0], [1200, 0], [1200, 400], [900, 400]], 3),
    ])
    const shared = wallBetween(doc, 'A', 'B')[0]
    const after = removeRoom(doc, 'B')

    expect(after.rooms.map((r) => r.id)).toEqual(['A', 'C'])
    // Three walls of B go, the shared wall stays with the face of A, and C does not move.
    const kept = (after.walls ?? []).find((w) => w.id === shared.id)
    expect(kept).toBeDefined()
    expect(kept!.faces.filter((f) => f.roomId === 'B')).toEqual([])
    expect(kept!.faces.some((f) => f.roomId === 'A')).toBe(true)
    expect(corners(roomOf(after, 'A'))).toEqual(corners(roomOf(doc, 'A')))
    expect(corners(roomOf(after, 'C'))).toEqual(corners(roomOf(doc, 'C')))
    expect(after.walls).toHaveLength(8)
    expect(writeProblems(after)).toEqual([])
  })

  it('leaves an empty graph when the last room goes, and nothing when the room is not there', () => {
    const doc = v2([mk('A', [[0, 0], [300, 0], [300, 400], [0, 400]], 1)])
    const empty = removeRoom(doc, 'A')
    expect(empty.rooms).toEqual([])
    expect(empty.walls).toEqual([])
    expect(empty.nodes).toEqual([])
    expect(removeRoom(doc, 'nope')).toBe(doc)
  })
})
