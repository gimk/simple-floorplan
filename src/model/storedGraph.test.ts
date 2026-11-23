import { describe, expect, it } from 'vitest'
import { syncStoredGraph } from './storedGraph'
import type { Room, StoredNode, StoredWall } from './types'

type Pt = [number, number]
const room = (id: string, pts: Pt[], walkOrder = 1): Room => ({
  id, code: id, name: id,
  vertices: pts.map(([x, y], i) => ({ id: `${id}v${i}`, x, y })),
  holes: [], walls: {}, walkOrder,
})
const rect = (id: string, x: number, y: number, w: number, h: number, walkOrder = 1) =>
  room(id, [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], walkOrder)

type G = { nodes: StoredNode[]; walls: StoredWall[] }
const ids = (g: G) => g.walls.map((w) => w.id)
/** The wall that has a face of this room starting at this vertex. */
const wallOf = (g: G, roomId: string, wallStart: string) =>
  g.walls.find((w) => w.faces.some((f) => f.roomId === roomId && f.wallStart === wallStart))!

const A = rect('A', 0, 0, 300, 400, 1)
const B = rect('B', 300, 0, 300, 400, 2)

describe('syncStoredGraph', () => {
  it('numbers the first build W1..Wn and N1..Nm in a fixed order', () => {
    const g = syncStoredGraph(undefined, [A, B])
    expect(ids(g)).toEqual(['W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7'])
    expect(g.nodes.map((n) => n.id)).toEqual(['N1', 'N2', 'N3', 'N4', 'N5', 'N6'])
    expect(syncStoredGraph(undefined, [A, B])).toEqual(g)
    expect(syncStoredGraph(undefined, [B, A])).toEqual(g) // array order does not matter
    for (const w of g.walls) {
      expect(g.nodes.some((n) => n.id === w.a)).toBe(true)
      expect(g.nodes.some((n) => n.id === w.b)).toBe(true)
    }
  })

  it('keeps wall and node ids unique', () => {
    const g = syncStoredGraph(undefined, [A, B, rect('C', 600, 0, 200, 400, 3)])
    expect(new Set(ids(g)).size).toBe(g.walls.length)
    expect(new Set(g.nodes.map((n) => n.id)).size).toBe(g.nodes.length)
  })

  it('returns the SAME arrays when nothing changed', () => {
    const g = syncStoredGraph(undefined, [A, B])
    const again = syncStoredGraph(g, [A, B])
    expect(again.walls).toBe(g.walls)
    expect(again.nodes).toBe(g.nodes)
    // Rooms copied, same content: still the same arrays.
    const copy = [structuredClone(A), structuredClone(B)]
    const third = syncStoredGraph(g, copy)
    expect(third.walls).toBe(g.walls)
    expect(third.nodes).toBe(g.nodes)
  })

  it('reads a stored graph that has another key order', () => {
    const g = syncStoredGraph(undefined, [A, B])
    const reordered = JSON.parse(JSON.stringify(g, (_k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).reverse()) : v))) as G
    const again = syncStoredGraph(reordered, [A, B])
    expect(again.walls).toBe(reordered.walls)
    expect(again.nodes).toBe(reordered.nodes)
  })

  it('moving a corner keeps all wall and node ids (the geometry changes)', () => {
    const g = syncStoredGraph(undefined, [A, B])
    const A2: Room = { ...A, vertices: A.vertices.map((v, i) => (i === 3 ? { ...v, x: 30, y: 420 } : v)) }
    const g2 = syncStoredGraph(g, [A2, B])
    expect(ids(g2)).toEqual(ids(g))
    expect(g2.nodes.map((n) => n.id)).toEqual(g.nodes.map((n) => n.id))
    expect(g2.nodes).not.toBe(g.nodes)
    expect(g2.nodes.some((n) => n.x === 30 && n.y === 420)).toBe(true)
  })

  it('adding a room next to a wall keeps that wall id, new walls get new ids', () => {
    const g = syncStoredGraph(undefined, [A, B])
    const sharedId = wallOf(g, 'A', 'Av1').id
    const C = rect('C', 600, 0, 200, 400, 3)
    const g2 = syncStoredGraph(g, [A, B, C])
    for (const w of g.walls) {
      for (const f of w.faces) if (f.roomId) expect(wallOf(g2, f.roomId, f.wallStart!).id).toBe(w.id)
    }
    expect(wallOf(g2, 'A', 'Av1').id).toBe(sharedId)
    // B's right wall is now shared with C: it keeps the id it had.
    expect(wallOf(g2, 'B', 'Bv1').id).toBe(wallOf(g, 'B', 'Bv1').id)
    const fresh = g2.walls.filter((w) => !ids(g).includes(w.id)).map((w) => w.id)
    expect(fresh).toEqual(['W8', 'W9', 'W10'])
  })

  it('deleting a room keeps the ids of the other walls', () => {
    const C = rect('C', 600, 0, 200, 400, 3)
    const g = syncStoredGraph(undefined, [A, B, C])
    const g2 = syncStoredGraph(g, [A, B])
    const keep = (r: string, v: string) => expect(wallOf(g2, r, v).id).toBe(wallOf(g, r, v).id)
    for (const v of ['Av0', 'Av1', 'Av2', 'Av3']) keep('A', v)
    for (const v of ['Bv0', 'Bv1', 'Bv2', 'Bv3']) keep('B', v)
    expect(g2.walls.length).toBeLessThan(g.walls.length)
  })

  describe('a corner added on a diagonal wall (the wall is split)', () => {
    // Triangle with a diagonal wall (400,300) -> (0,0), 500 cm long.
    const tri = room('T', [[0, 0], [400, 0], [400, 300]])
    const split = (at: Pt): Room => ({ ...tri, vertices: [...tri.vertices, { id: 'Tnew', x: at[0], y: at[1] }] })

    it('the larger part keeps the id when it is the first part', () => {
      const g = syncStoredGraph(undefined, [tri])
      const diagId = wallOf(g, 'T', 'Tv2').id
      const g2 = syncStoredGraph(g, [split([100, 75])]) // 375 + 125
      expect(wallOf(g2, 'T', 'Tv2').id).toBe(diagId)
      expect(wallOf(g2, 'T', 'Tnew').id).not.toBe(diagId)
      expect(g2.walls).toHaveLength(g.walls.length + 1)
    })

    it('the larger part keeps the id when it is the second part', () => {
      const g = syncStoredGraph(undefined, [tri])
      const diagId = wallOf(g, 'T', 'Tv2').id
      const g2 = syncStoredGraph(g, [split([300, 225])]) // 125 + 375
      expect(wallOf(g2, 'T', 'Tnew').id).toBe(diagId)
      expect(wallOf(g2, 'T', 'Tv2').id).not.toBe(diagId)
      expect(new Set(ids(g2)).size).toBe(g2.walls.length)
    })

    it('the other walls keep their ids', () => {
      const g = syncStoredGraph(undefined, [tri])
      const g2 = syncStoredGraph(g, [split([300, 225])])
      expect(wallOf(g2, 'T', 'Tv0').id).toBe(wallOf(g, 'T', 'Tv0').id)
      expect(wallOf(g2, 'T', 'Tv1').id).toBe(wallOf(g, 'T', 'Tv1').id)
    })
  })

  it('an old client that dropped nodes and walls gives the numbering of a fresh build', () => {
    const rooms = [A, B]
    const stored = syncStoredGraph(undefined, rooms)
    // The old client keeps the rooms and drops the graph.
    expect(syncStoredGraph(undefined, rooms)).toEqual(stored)
  })

  it('after edits the stored ids can differ from a fresh build (documented limit), but never repeat', () => {
    const g0 = syncStoredGraph(undefined, [A, B])
    const C = rect('C', 600, 0, 200, 400, 3)
    const g1 = syncStoredGraph(g0, [A, B, C])
    const g2 = syncStoredGraph(g1, [A, B]) // C deleted
    const fresh = syncStoredGraph(undefined, [A, B])
    expect(ids(g2).sort()).toEqual(ids(fresh).sort()) // same set here: the ids of A and B were kept
    const g3 = syncStoredGraph(g2, [A, B, rect('D', 0, 400, 300, 200, 4)])
    expect(new Set(ids(g3)).size).toBe(g3.walls.length)
  })

  it('faces carry the side, the room and the start vertex; outside faces have no room', () => {
    const g = syncStoredGraph(undefined, [A, B])
    const shared = wallOf(g, 'A', 'Av1')
    expect(shared.faces.map((f) => `${f.roomId}:${f.wallStart}`).sort()).toEqual(['A:Av1', 'B:Bv3'])
    expect(new Set(shared.faces.map((f) => f.side)).size).toBe(2)
    const outer = wallOf(g, 'A', 'Av0')
    expect(outer.faces.some((f) => f.roomId === undefined && f.wallStart === undefined)).toBe(true)
    expect(outer.faces.some((f) => f.roomId === 'A' && f.wallStart === 'Av0')).toBe(true)
  })

  it('handles no rooms', () => {
    expect(syncStoredGraph(undefined, [])).toEqual({ nodes: [], walls: [] })
  })
})
