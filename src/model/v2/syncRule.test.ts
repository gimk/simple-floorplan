// Tests of the two-way sync rule of the v2 model (docs/walls-plan.md, phase 5c step 4): the rooms
// of a v2 document are a calculated view, so a polygon that a tool wrote goes into the wall graph,
// and a change of the walls calculates the polygons again.
import { describe, expect, it } from 'vitest'
import { dist } from '../geometry'
import type { PlanDoc, Room } from '../types'
import { convertToV2 } from './convert'
import { materializeRooms } from './materialize'
import { v2SyncRule } from './syncRule'

/** A v1 document with these rooms. */
const plan = (rooms: Room[]): PlanDoc => ({
  projectId: 'p1', title: 'test', rooms, elements: [], measurements: {}, roomNotes: {}, tapes: [],
})

/** One room of a test plan: polygon in cm, one corner id per point. */
const mk = (id: string, pts: [number, number][], walkOrder: number): Room => ({
  id,
  code: id,
  name: id,
  vertices: pts.map(([x, y], i) => ({ id: `${id}-v${i}`, x, y })),
  holes: [],
  walls: {},
  walkOrder,
})

/** A = x 0..300, C = x 300..600, y 0..400: one wall between them. */
const acRooms = () => [
  mk('A', [[0, 0], [300, 0], [300, 400], [0, 400]], 1),
  mk('C', [[300, 0], [600, 0], [600, 400], [300, 400]], 2),
]

/** The v2 document of a set of v1 rooms. */
const v2 = (rooms: Room[]) => convertToV2(plan(rooms)).doc

const roomOf = (doc: PlanDoc, id: string) => doc.rooms.find((r) => r.id === id)!

/** Walls that hold a face of both rooms: the ONE wall between them. */
const wallsBetween = (doc: PlanDoc, a: string, b: string) =>
  (doc.walls ?? []).filter((w) => w.faces.some((f) => f.roomId === a) && w.faces.some((f) => f.roomId === b))

/** Walls whose centre line lies on the vertical line x = c. */
const verticalWallsAt = (doc: PlanDoc, c: number) => {
  const nodes = new Map((doc.nodes ?? []).map((n) => [n.id, n]))
  return (doc.walls ?? []).filter((w) => {
    const a = nodes.get(w.a), b = nodes.get(w.b)
    return !!a && !!b && Math.abs(a.x - c) < 0.5 && Math.abs(b.x - c) < 0.5
  })
}

/** Structural problems of a v2 document (empty = the walls and the rooms agree). */
const problems = (doc: PlanDoc): string[] => {
  const out: string[] = []
  const nodes = new Map((doc.nodes ?? []).map((n) => [n.id, n]))
  const walls = new Map((doc.walls ?? []).map((w) => [w.id, w]))
  for (const w of doc.walls ?? []) {
    if (!nodes.has(w.a) || !nodes.has(w.b)) out.push(`wall ${w.id}: node missing`)
    if (!w.faces.length) out.push(`wall ${w.id}: no face`)
  }
  for (const r of doc.rooms) {
    const cycle = r.cycle ?? []
    if (!cycle.length) {
      out.push(`room ${r.code}: no cycle`)
      continue
    }
    if (cycle.length !== r.vertices.length) out.push(`room ${r.code}: ${cycle.length} faces, ${r.vertices.length} corners`)
    for (const f of cycle) {
      const w = walls.get(f.wallId)
      if (!w) { out.push(`room ${r.code}: wall ${f.wallId} is gone`); continue }
      if (!w.faces.some((x) => x.roomId === r.id && x.side === f.side)) out.push(`room ${r.code}: ${w.id} has no face for it`)
      if (Math.abs(f.to - f.from) < 0.5) out.push(`room ${r.code}: empty face on ${w.id}`)
    }
  }
  return out
}

const corners = (r: Room) => r.vertices.map((v) => [Math.round(v.x * 10) / 10, Math.round(v.y * 10) / 10])

describe('v2SyncRule: a v1 document is not a v2 document', () => {
  it('is given back unchanged, whatever changed', () => {
    const prev = plan(acRooms())
    const extra = mk('B', [[600, 0], [900, 0], [900, 400], [600, 400]], 3)
    const next: PlanDoc = { ...prev, rooms: [...prev.rooms, extra] }
    expect(v2SyncRule(prev, next)).toBe(next)
  })
})

describe('v2SyncRule: nothing to do', () => {
  it('gives the same document back (same object)', () => {
    const doc = v2(acRooms())
    expect(v2SyncRule(doc, doc)).toBe(doc)
    // A change that does not touch the rooms nor the graph is not its business.
    const note: PlanDoc = { ...doc, title: 'other' }
    expect(v2SyncRule(doc, note)).toBe(note)
  })

  it('keeps the rooms and the walls of a document that is already right', () => {
    const doc = v2(acRooms())
    const again = v2SyncRule({ ...doc, measurements: {} }, doc)
    expect(again.rooms).toBe(doc.rooms)
    expect(again.walls).toBe(doc.walls)
  })
})

describe('v2SyncRule: rooms changed, walls not', () => {
  it('writes a new room into the graph and keeps one wall with the room it touches', () => {
    const doc = v2(acRooms())
    // B is added against the right wall of C (x = 600): that wall must become ONE wall with two
    // faces, not a second wall drawn over it.
    const b = mk('B', [[600, 0], [900, 0], [900, 400], [600, 400]], 3)
    const next: PlanDoc = { ...doc, rooms: [...doc.rooms, b] }
    const out = v2SyncRule(doc, next)
    expect(out).not.toBe(next)
    expect(out.schemaVersion).toBe(2)
    expect(out.rooms.length).toBe(3)
    expect(problems(out)).toEqual([])
    // One wall between C and B, and no second wall on the same line.
    expect(wallsBetween(out, 'C', 'B').length).toBe(1)
    expect(verticalWallsAt(out, 600).length).toBe(1)
    // The new room keeps the corners of the polygon that the tool wrote.
    expect(corners(roomOf(out, 'B'))).toEqual([[600, 0], [900, 0], [900, 400], [600, 400]])
    // The wall values of the old rooms are untouched.
    expect(out.measurements).toBe(doc.measurements)
  })

  it('writes the wall properties of a room onto the stored wall (one wall, both rooms)', () => {
    const doc = v2(acRooms())
    const shared = wallsBetween(doc, 'A', 'C')[0]
    const wallStart = roomOf(doc, 'A').cycle!.find((f) => f.wallId === shared.id)!.cornerId
    const room = roomOf(doc, 'A')
    const next: PlanDoc = {
      ...doc,
      rooms: doc.rooms.map((r) => (r.id === 'A'
        ? { ...r, walls: { ...r.walls, [wallStart]: { type: 'bearing', thicknessCm: 20 } } }
        : r)),
    }
    const out = v2SyncRule(doc, next)
    const wall = (out.walls ?? []).find((w) => w.id === shared.id)!
    expect(wall.thicknessCm).toBe(20)
    expect(wall.type).toBe('bearing')
    // Both rooms see the same wall, so both see the new thickness.
    expect(roomOf(out, 'A').walls[wallStart].thicknessCm).toBe(20)
    expect(roomOf(out, 'C').walls[(roomOf(out, 'C').cycle ?? []).find((f) => f.wallId === shared.id)!.cornerId].thicknessCm).toBe(20)
    expect(problems(out)).toEqual([])
    expect(room.vertices.length).toBe(4)
  })

  it('removes a room with the walls that no other room uses', () => {
    const doc = v2(acRooms())
    const shared = wallsBetween(doc, 'A', 'C')[0]
    const next: PlanDoc = { ...doc, rooms: doc.rooms.filter((r) => r.id !== 'A') }
    const out = v2SyncRule(doc, next)
    expect(out.rooms.length).toBe(1)
    expect(problems(out)).toEqual([])
    // C keeps the shared wall (it is a facade of C now), and the left wall of A is gone.
    expect((out.walls ?? []).some((w) => w.id === shared.id)).toBe(true)
    expect(verticalWallsAt(out, 0).length).toBe(0)
    expect(out.rooms[0].vertices.length).toBe(4)
  })
})

describe('v2SyncRule: walls changed', () => {
  it('calculates the polygons again from the walls (the rooms win nothing)', () => {
    const doc = v2(acRooms())
    // Move one node of the plan: the polygons of the rooms on its walls must follow.
    const target = (doc.nodes ?? [])[0]
    const nodes = (doc.nodes ?? []).map((n) => (n.id === target.id ? { ...n, y: n.y + 50 } : n))
    const next: PlanDoc = { ...doc, nodes }
    const out = v2SyncRule(doc, next)
    expect(out.rooms).not.toBe(doc.rooms)
    expect(problems(out)).toEqual([])
    // The corner of A that the node carries moved with it.
    const before = roomOf(doc, 'A').vertices[0]
    const after = roomOf(out, 'A').vertices.find((v) => v.id === before.id)!
    expect(after.y).not.toBe(before.y)
    expect(after.y).toBe(before.y + 50)
  })

  it('wins over the polygon of a room of the graph', () => {
    const doc = v2(acRooms())
    const target = (doc.nodes ?? [])[0]
    const nodes = (doc.nodes ?? []).map((n) => (n.id === target.id ? { ...n, y: n.y + 50 } : n))
    // A polygon that no wall holds (a spike), kept with the cycle of the room: the walls win.
    const spike: Room = {
      ...roomOf(doc, 'A'),
      vertices: [[0, 0], [200, 0], [200, 700], [0, 400]].map(([x, y], i) => ({ id: `A-v${i}`, x, y })),
    }
    const next: PlanDoc = { ...doc, nodes, rooms: [spike, roomOf(doc, 'C')] }
    const out = v2SyncRule(doc, next)
    expect(out.rooms).toEqual(materializeRooms(out))
    // The spike corner (200, 700) of the polygon that the tool wrote is not on the plan.
    expect(corners(roomOf(out, 'A')).some(([x, y]) => x === 200 && y === 700)).toBe(false)
  })

  it('keeps the saved polygon of a room that is not in the graph yet (fallback)', () => {
    const doc = v2(acRooms())
    const nodes = (doc.nodes ?? []).map((n) => ({ ...n, y: n.y + 50 }))
    const loose = mk('L', [[1000, 0], [1200, 0], [1200, 200], [1000, 200]], 9)
    const out = v2SyncRule(doc, { ...doc, nodes, rooms: [...doc.rooms, loose] })
    // A room without a cycle keeps the polygon that was saved for it.
    expect(corners(out.rooms.find((r) => r.id === 'L')!)).toEqual([[1000, 0], [1200, 0], [1200, 200], [1000, 200]])
  })
})

describe('v2SyncRule: repeated use', () => {
  it('gives the same document when it runs on its own result', () => {
    const doc = v2(acRooms())
    const b = mk('B', [[600, 0], [900, 0], [900, 400], [600, 400]], 3)
    const once = v2SyncRule(doc, { ...doc, rooms: [...doc.rooms, b] })
    expect(v2SyncRule(once, once)).toBe(once)
    // And once more from the rule that made it (the store runs every rule in one step).
    const twice = v2SyncRule(doc, once)
    expect(twice).toBe(once)
  })

  it('keeps one wall per shared side after a chain of room edits', () => {
    const doc = v2(acRooms())
    let cur = doc
    // A row of rooms added against the right wall of the last one, one after the other.
    for (let k = 0; k < 3; k++) {
      const x0 = 600 + k * 300
      const room = mk(`R${k}`, [[x0, 0], [x0 + 300, 0], [x0 + 300, 400], [x0, 400]], 10 + k)
      cur = v2SyncRule(cur, { ...cur, rooms: [...cur.rooms, room] })
      expect(problems(cur)).toEqual([])
      expect(verticalWallsAt(cur, x0).length).toBe(1)
      // A shared wall is ONE wall: no two walls on the same line.
      const nodes = new Map((cur.nodes ?? []).map((n) => [n.id, n]))
      const onLine = verticalWallsAt(cur, x0)
      expect(onLine.every((w) => dist(nodes.get(w.a)!, nodes.get(w.b)!) > 1)).toBe(true)
    }
    expect(cur.rooms.length).toBe(5)
  })
})

describe('v2SyncRule: the wall graph of a document without walls', () => {
  it('is not touched (a v2 doc that lost its graph keeps its rooms)', () => {
    const v1 = plan(acRooms())
    const doc: PlanDoc = { ...v1, schemaVersion: 2, walls: undefined, nodes: undefined }
    const next: PlanDoc = { ...doc, rooms: [...doc.rooms, mk('B', [[600, 0], [900, 0], [900, 400], [600, 400]], 3)] }
    expect(v2SyncRule(doc, next)).toBe(next)
  })
})
