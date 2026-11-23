// Tests of the drags on the wall graph (docs/walls-plan.md, phase 5c step 3): a node, a wall and a
// whole room. Each drag gives the rooms calculated again from the walls.
import { describe, expect, it } from 'vitest'
import { demoRooms } from '../../features/measure/demo'
import { dist } from '../geometry'
import type { PlanDoc, Room } from '../types'
import { convertToV2 } from './convert'
import { moveNode, moveRoom, moveWall } from './drag'

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

/** Two rooms side by side, one shared wall (x = 300). */
const twoRooms = () => [
  mk('A', [[0, 0], [300, 0], [300, 400], [0, 400]], 1),
  mk('B', [[300, 0], [600, 0], [600, 400], [300, 400]], 2),
]

const v2 = (rooms: Room[]) => convertToV2(plan(rooms)).doc
const roomOf = (doc: PlanDoc, id: string) => doc.rooms.find((r) => r.id === id)!
/** The corners of a room, rounded to 0,001 cm (the crossing of two lines can carry float noise). */
const corners = (room: Room) => room.vertices.map((v) => [Math.round(v.x * 1000) / 1000, Math.round(v.y * 1000) / 1000])
const wallBetween = (doc: PlanDoc, a: string, b: string) =>
  (doc.walls ?? []).filter((w) => w.faces.some((f) => f.roomId === a) && w.faces.some((f) => f.roomId === b))

/** The faces of one wall of one room, as spans. */
const spans = (doc: PlanDoc, wallId: string, roomId: string) =>
  (doc.walls ?? []).find((w) => w.id === wallId)!.faces.filter((f) => f.roomId === roomId).map((f) => [f.from, f.to])

/** Node at a place (cm). */
const nodeAt = (doc: PlanDoc, x: number, y: number) => {
  const node = (doc.nodes ?? []).find((n) => dist(n, { x, y }) < 0.5)
  if (!node) throw new Error(`no node at ${x},${y}`)
  return node.id
}

/** Every face of every wall stays inside its wall (cm). */
function spansInsideWalls(doc: PlanDoc): string[] {
  const nodes = new Map((doc.nodes ?? []).map((n) => [n.id, n]))
  const problems: string[] = []
  for (const w of doc.walls ?? []) {
    const a = nodes.get(w.a)
    const b = nodes.get(w.b)
    if (!a || !b) continue
    const length = dist(a, b)
    for (const f of w.faces) {
      if (f.from < -1e-6 || f.to > length + 0.05) problems.push(`${w.id}: face ${f.from}..${f.to} on ${length} cm`)
    }
  }
  return problems
}

describe('moveNode', () => {
  it('moves the corner of both rooms that share the wall', () => {
    const doc = v2(twoRooms())
    const id = nodeAt(doc, 300, 0)
    const after = moveNode(doc, id, { x: 300, y: -50 })

    // One node, so both rooms follow: the v2 behaviour of a shared wall.
    expect(corners(roomOf(after, 'A'))).toEqual([[0, 0], [300, -50], [300, 400], [0, 400]])
    expect(corners(roomOf(after, 'B'))).toEqual([[300, -50], [600, 0], [600, 400], [300, 400]])
    // No wall and no corner was added: the same graph, on other nodes.
    expect(after.walls).toHaveLength(doc.walls!.length)
    expect(after.nodes).toHaveLength(doc.nodes!.length)
    expect(spansInsideWalls(after)).toEqual([])
  })

  it('gives the same document back when the node does not move, and for an unknown node', () => {
    const doc = v2(twoRooms())
    const node = (doc.nodes ?? [])[0]
    expect(moveNode(doc, node.id, { x: node.x, y: node.y })).toBe(doc)
    expect(moveNode(doc, 'N-nope', { x: 0, y: 0 })).toBe(doc)
  })

  it('keeps the face of a wall on the whole wall when the wall gets longer', () => {
    const doc = v2(twoRooms())
    const id = nodeAt(doc, 300, 400)
    const shared = wallBetween(doc, 'A', 'B')[0]
    // The shared wall is 400 cm long; its faces end at 400. The node goes 100 cm down.
    expect(spans(doc, shared.id, 'A')).toEqual([[0, 400]])
    const after = moveNode(doc, id, { x: 300, y: 500 })
    expect(spans(after, shared.id, 'A')).toEqual([[0, 500]])
    expect(spans(after, shared.id, 'B')).toEqual([[0, 500]])
    expect(corners(roomOf(after, 'A'))).toEqual([[0, 0], [300, 0], [300, 500], [0, 400]])
    expect(spansInsideWalls(after)).toEqual([])
  })

  it('moves a corner of a real plan (the demo apartment)', () => {
    const doc = v2(demoRooms())
    const node = (doc.nodes ?? [])[0]
    const after = moveNode(doc, node.id, { x: node.x - 20, y: node.y - 20 })
    // Every room keeps its corners and its faces, and the graph stays inside its walls.
    expect(after.rooms.map((r) => r.vertices.length)).toEqual(doc.rooms.map((r) => r.vertices.length))
    expect(after.walls).toHaveLength(doc.walls!.length)
    expect(spansInsideWalls(after)).toEqual([])
  })
})

describe('moveWall', () => {
  it('moves a shared wall: both rooms follow', () => {
    const doc = v2(twoRooms())
    const shared = wallBetween(doc, 'A', 'B')[0]
    const after = moveWall(doc, shared.id, { x: 50, y: 0 })

    expect(corners(roomOf(after, 'A'))).toEqual([[0, 0], [350, 0], [350, 400], [0, 400]])
    expect(corners(roomOf(after, 'B'))).toEqual([[350, 0], [600, 0], [600, 400], [350, 400]])
    // The same wall, the same two faces: the rooms are still on its two sides.
    expect(wallBetween(after, 'A', 'B').map((w) => w.id)).toEqual([shared.id])
    expect(spans(after, shared.id, 'A')).toEqual([[0, 400]])
    expect(spans(after, shared.id, 'B')).toEqual([[0, 400]])
    expect(spansInsideWalls(after)).toEqual([])
  })

  it('stretches the walls connected at the two nodes of the wall', () => {
    const doc = v2([mk('A', [[0, 0], [300, 0], [300, 400], [0, 400]], 1)])
    // The wall of the room that lies on x = 300.
    const nodes = new Map((doc.nodes ?? []).map((n) => [n.id, n]))
    const right = (doc.walls ?? []).find((w) => nodes.get(w.a)!.x === 300 && nodes.get(w.b)!.x === 300)!
    expect(right).toBeDefined()
    const after = moveWall(doc, right.id, { x: 40, y: 0 })
    expect(corners(roomOf(after, 'A'))).toEqual([[0, 0], [340, 0], [340, 400], [0, 400]])
    expect(after.walls).toHaveLength(4)
    expect(spansInsideWalls(after)).toEqual([])
    expect(moveWall(doc, right.id, { x: 0, y: 0 })).toBe(doc)
    expect(moveWall(doc, 'W-nope', { x: 10, y: 0 })).toBe(doc)
  })
})

describe('moveRoom', () => {
  it('moves the room and lets the neighbour stretch on the shared wall', () => {
    const doc = v2(twoRooms())
    const after = moveRoom(doc, 'A', { x: 0, y: 100 })

    expect(corners(roomOf(after, 'A'))).toEqual([[0, 100], [300, 100], [300, 500], [0, 500]])
    // The shared wall moved with A, so the two corners of B on it follow; the other two do not.
    expect(corners(roomOf(after, 'B'))).toEqual([[300, 100], [600, 0], [600, 400], [300, 500]])
    expect(after.walls).toHaveLength(doc.walls!.length)
    expect(spansInsideWalls(after)).toEqual([])
  })

  it('leaves the neighbour in place with thisRoomOnly (the room gets copies of shared walls)', () => {
    const doc = v2(twoRooms())
    const shared = wallBetween(doc, 'A', 'B')[0]
    const after = moveRoom(doc, 'A', { x: 0, y: 100 }, { thisRoomOnly: true })

    expect(corners(roomOf(after, 'A'))).toEqual([[0, 100], [300, 100], [300, 500], [0, 500]])
    // The neighbour does not move at all: the shared wall stayed, and A has its own copy of it.
    expect(corners(roomOf(after, 'B'))).toEqual(corners(roomOf(doc, 'B')))
    expect(after.walls).toHaveLength(doc.walls!.length + 1)
    const original = (after.walls ?? []).find((w) => w.id === shared.id)!
    expect(original.faces.some((f) => f.roomId === 'B')).toBe(true)
    expect(original.faces.some((f) => f.roomId === 'A')).toBe(false)
    // The two rooms no longer share a wall: the A side is a copy, 100 cm lower.
    expect(wallBetween(after, 'A', 'B')).toEqual([])
    expect(spansInsideWalls(after)).toEqual([])
  })

  it('does nothing for a room with no cycle, no move, or a room that is not there', () => {
    const doc = v2(twoRooms())
    expect(moveRoom(doc, 'A', { x: 0, y: 0 })).toBe(doc)
    expect(moveRoom(doc, 'nope', { x: 10, y: 0 })).toBe(doc)
    const v1 = plan([mk('A', [[0, 0], [300, 0], [300, 400], [0, 400]], 1)])
    expect(moveRoom(v1, 'A', { x: 10, y: 0 })).toBe(v1)
    // A room with no shared wall: thisRoomOnly is the same move.
    const alone = v2([mk('A', [[0, 0], [300, 0], [300, 400], [0, 400]], 1)])
    expect(corners(roomOf(moveRoom(alone, 'A', { x: 20, y: 0 }, { thisRoomOnly: true }), 'A')))
      .toEqual([[20, 0], [320, 0], [320, 400], [20, 400]])
  })
})
