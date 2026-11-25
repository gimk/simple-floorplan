// A wall that the app adds never duplicates or overlaps a wall that is already there
// (causes 1-4 of the duplicate-wall investigation). Synthetic documents only.
import { describe, expect, it } from 'vitest'
import { graphEdges, graphVertices } from '../../features/rooms/interaction'
import type { PlanDoc, Room } from '../types'
import { convertToV2 } from './convert'
import { endpointsOf } from './repair'
import { overlaps } from './overlapHelper'
import { idMaker, layWall } from './spans'
import { addStandaloneWall, applyRoomPolygon } from './write'

const room = (id: string, pts: [number, number][]): Room => ({
  id, code: id, name: id, holes: [], walls: {}, walkOrder: 1,
  vertices: pts.map(([x, y], i) => ({ id: `${id}-v${i}`, x, y })),
})
const empty = (): PlanDoc => convertToV2({ projectId: 'p', title: 't', rooms: [], elements: [], measurements: {}, roomNotes: {}, tapes: [] }).doc
const P = { type: 'partition' as const, thicknessCm: 10 }
const add = (d: PlanDoc, x1: number, y1: number, x2: number, y2: number) => addStandaloneWall(d, { x: x1, y: y1 }, { x: x2, y: y2 }, P).doc

describe('cause 1: a new wall splits the host and reuses the covered spans', () => {
  it('a wall inside a longer wall cuts it into 3 walls, none overlaps', () => {
    const d = add(add(empty(), 0, 0, 400, 0), 100, 0, 300, 0)
    expect(d.walls).toHaveLength(3)
    expect(overlaps(d)).toEqual([])
  })

  it('a long wall over two halves reuses both: 2 walls', () => {
    const d = add(add(add(empty(), 0, 0, 200, 0), 200, 0, 400, 0), 0, 0, 400, 0)
    expect(d.walls).toHaveLength(2)
    expect(overlaps(d)).toEqual([])
  })

  it('a longer wall that extends a wall adds only the missing span', () => {
    const d = add(add(empty(), 0, 0, 200, 0), 100, 0, 400, 0)
    expect(overlaps(d)).toEqual([])
    expect(d.walls).toHaveLength(3)
  })

  it('the same wall again adds nothing', () => {
    const one = add(empty(), 0, 0, 400, 0)
    expect(add(one, 0, 0, 400, 0).walls).toHaveLength(1)
    expect(add(one, 400, 0, 0, 0).walls).toHaveLength(1)
  })
})

describe('cause 2: one tolerance of 1 cm', () => {
  it('a point 0.8 cm from a node takes the node (no second node)', () => {
    const d = add(add(empty(), 0, 0, 300, 0), 300.8, 0, 300, 200)
    expect(d.nodes).toHaveLength(3)
  })

  it('a short wall (30 cm) is the edge of a room that is 0.9 cm off its line: 4 walls', () => {
    const d0 = add(empty(), 0, 0, 30, 0)
    const poly = room('A', [[0, 0.9], [30, 0], [30, 100], [0, 100]])
    const d = applyRoomPolygon({ ...d0, rooms: [poly] }, 'A', poly)
    expect(d.walls).toHaveLength(4)
    expect(overlaps(d)).toEqual([])
  })
})

describe('cause 3: the room tools snap to the wall graph', () => {
  it('gives the nodes and the wall segments of a standalone wall', () => {
    const d = add(empty(), 10, 20, 310, 20)
    expect(graphVertices(d)).toEqual(expect.arrayContaining([{ x: 10, y: 20 }, { x: 310, y: 20 }]))
    expect(graphEdges(d)).toEqual([[{ x: 10, y: 20 }, { x: 310, y: 20 }]])
  })
})

describe('cause 4: the back wall of a storage goes through the same helper', () => {
  it('a back wall over a wall that is there is reused, not added', () => {
    const d = add(empty(), 0, 0, 400, 0)
    const [a, b] = d.nodes!
    const laid = layWall(
      { nodes: d.nodes!, walls: d.walls!, rooms: d.rooms, elements: d.elements },
      a.id, b.id, P, false, idMaker(d),
    )
    expect(laid.changed).toBe(false)
    expect(laid.g.walls).toHaveLength(1)
    expect(laid.pieces).toHaveLength(1)
  })
})

describe('the wall list is the geometry list', () => {
  it('endpointsOf gives one segment per wall', () => {
    expect(endpointsOf(add(empty(), 0, 0, 100, 0))).toEqual([[0, 0, 100, 0]])
  })
})
