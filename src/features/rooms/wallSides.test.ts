// Tests of the two sides of a stored wall (docs/walls-plan.md, "Walls in the interface"):
// faces per side in order, outside spans, and the wall list of the room card.
import { describe, expect, it } from 'vitest'
import { demoRooms } from '../measure/demo'
import type { PlanDoc, Room, RoomFace, StoredNode, StoredWall } from '../../model/types'
import { convertToV2 } from '../../model/v2/convert'
import { materializeRooms } from '../../model/v2/materialize'
import {
  otherSide, outsideFaceLabelAtPoint, roomWallLinks, sideOfPoint, sideOfRoomWall, storedWallView, wallAlignOffsetCm,
  wallAlignSide, wallFaceAt,
} from './wallSides'

const face = (wallId: string, side: 'L' | 'R', from: number, to: number, cornerId: string): RoomFace =>
  ({ wallId, side, from, to, cornerId })

const roomWithCycle = (id: string, cycle: RoomFace[], walkOrder = 1): Room =>
  ({ id, code: id, name: id, vertices: [], holes: [], walls: {}, walkOrder, cycle })

const wall = (id: string, a: string, b: string, thicknessCm = 10): StoredWall =>
  ({ id, a, b, faces: [], type: 'partition', thicknessCm })

/** A v2 document of one wall, with the polygons of its rooms calculated (the read layer). */
const v2 = (nodes: StoredNode[], walls: StoredWall[], rooms: Room[]): PlanDoc => {
  const doc: PlanDoc = {
    projectId: 'p1', title: 'test', schemaVersion: 2, nodes, walls, rooms,
    elements: [], measurements: {}, roomNotes: {}, tapes: [],
  }
  return { ...doc, rooms: materializeRooms(doc) }
}

/** The wall N1 (0,0) -> N2 (400,0). */
const nodes = (): StoredNode[] => [{ id: 'N1', x: 0, y: 0 }, { id: 'N2', x: 400, y: 0 }]

describe('sideOfPoint', () => {
  it('puts a point below the wall (y down) on side L, above it on side R', () => {
    const a = { x: 0, y: 0 }, b = { x: 400, y: 0 }
    expect(sideOfPoint(a, b, { x: 200, y: 50 })).toBe('L')
    expect(sideOfPoint(a, b, { x: 200, y: -50 })).toBe('R')
  })

  it('follows the direction of the wall, not the screen', () => {
    // The same wall drawn the other way: the two sides are swapped.
    expect(sideOfPoint({ x: 400, y: 0 }, { x: 0, y: 0 }, { x: 200, y: 50 })).toBe('R')
  })

  it('has no side for a wall of zero length', () => {
    expect(sideOfPoint({ x: 5, y: 5 }, { x: 5, y: 5 }, { x: 1, y: 1 })).toBeUndefined()
  })
})

describe('storedWallView', () => {
  it('cuts the two sides independently (one face on side A, three on side B)', () => {
    // Room A sees the wall once; room B is cut by two T junctions: three faces on the other side.
    const doc = v2(nodes(), [wall('W1', 'N1', 'N2')], [
      roomWithCycle('A', [face('W1', 'L', 0, 400, 'a0')], 1),
      roomWithCycle('B', [face('W1', 'R', 0, 150, 'b0'), face('W1', 'R', 150, 300, 'b1'), face('W1', 'R', 300, 400, 'b2')], 2),
    ])
    const view = storedWallView(doc, 'W1')!
    expect(view.centreCm).toBe(400)
    const [a, b] = view.sides
    expect(a.side).toBe('L')
    expect(a.letter).toBe('A')
    expect(a.faces).toHaveLength(1)
    expect(a.faces[0]).toMatchObject({ kind: 'room', code: 'A', label: 'A-1', from: 0, to: 400 })
    expect(b.side).toBe('R')
    expect(b.letter).toBe('B')
    expect(b.faces.map((f) => (f.kind === 'room' ? f.label : 'outside'))).toEqual(['B-1', 'B-2', 'B-3'])
    expect(b.faces.map((f) => (f.kind === 'room' ? [f.from, f.to] : []))).toEqual([[0, 150], [150, 300], [300, 400]])
    // No outside span: both sides are covered by a room.
    expect(a.outside).toBe(false)
    expect(b.outside).toBe(false)
    expect(a.facadeLabel).toBeNull()
    // The rooms of the wall, in walk order.
    expect(view.rooms.map((r) => r.code)).toEqual(['A', 'B'])
  })

  it('gives a free side an outside span, and the facade value when the whole side is outside', () => {
    const doc = v2(nodes(), [wall('W1', 'N1', 'N2', 20)], [roomWithCycle('A', [face('W1', 'L', 0, 400, 'a0')])])
    const view = storedWallView(doc, 'W1')!
    const [, b] = view.sides
    expect(b.outside).toBe(true)
    expect(b.faces).toEqual([{ kind: 'outside', from: 0, to: 400, lengthCm: 400 }])
    expect(b.facadeLabel).toBe('W1-E')
    // The plan value is never shorter than the centre line (the outside corners are further out).
    expect(b.facadePlannedCm).toBeGreaterThanOrEqual(400)
    // The side with the room is not a facade.
    expect(view.sides[0].facadeLabel).toBeNull()
  })

  it('reads the outside value of the facade of the demo apartment, corner to corner', () => {
    const doc = convertToV2({ projectId: 'p', title: 't', rooms: demoRooms(), elements: [], measurements: {}, roomNotes: {}, tapes: [] }).doc
    const view = storedWallView(doc, 'W5')!
    const facade = view.sides.find((s) => s.facadeLabel)!
    expect(facade.facadeLabel).toBe('W5-E')
    expect(facade.outside).toBe(true)
    // The outside face is longer than the centre line: half of each end wall sticks out.
    expect(facade.facadePlannedCm!).toBeGreaterThan(view.centreCm)
  })

  it('keeps an outside span in the middle of a side, without the facade value', () => {
    // Room B covers the end of the side only: the start of the side is outside.
    const doc = v2(nodes(), [wall('W1', 'N1', 'N2')], [
      roomWithCycle('A', [face('W1', 'L', 0, 400, 'a0')], 1),
      roomWithCycle('B', [face('W1', 'R', 200, 400, 'b0')], 2),
    ])
    const [, b] = storedWallView(doc, 'W1')!.sides
    expect(b.faces.map((f) => (f.kind === 'room' ? f.label : 'outside'))).toEqual(['outside', 'B-1'])
    expect(b.faces[0]).toMatchObject({ kind: 'outside', from: 0, to: 200 })
    expect(b.outside).toBe(false)
    expect(b.facadeLabel).toBeNull()
  })

  it('reads the measured value of a face, and the label it is stored under', () => {
    const doc = v2(nodes(), [wall('W1', 'N1', 'N2')], [
      roomWithCycle('A', [face('W1', 'L', 0, 400, 'a0')], 1),
      roomWithCycle('B', [face('W1', 'R', 0, 400, 'b0')], 2),
    ])
    doc.measurements['A-1'] = { label: 'A-1', actualCm: 398, updatedAt: '' }
    const [a] = storedWallView(doc, 'W1')!.sides
    expect(a.faces[0]).toMatchObject({ kind: 'room', label: 'A-1', measuredCm: 398 })
  })

  it('has no view for a wall that is not on the plan', () => {
    expect(storedWallView(v2(nodes(), [], []), 'W9')).toBeNull()
  })

  it('lists the faces of the Entrée / Couloir wall of the demo apartment, in order', () => {
    const doc = convertToV2({ projectId: 'p', title: 't', rooms: demoRooms(), elements: [], measurements: {}, roomNotes: {}, tapes: [] }).doc
    // W6 is the wall between the Entrée (one face) and the Couloir (cut by the other walls).
    const view = storedWallView(doc, 'W6')!
    const enSide = view.sides.find((s) => s.rooms.some((r) => r.code === 'EN'))!
    const coSide = view.sides.find((s) => s.rooms.some((r) => r.code === 'CO'))!
    expect(enSide.faces.filter((f) => f.kind === 'room').map((f) => (f.kind === 'room' ? f.label : ''))).toEqual(['EN-6'])
    expect(coSide.faces.filter((f) => f.kind === 'room').map((f) => (f.kind === 'room' ? f.code : ''))).toEqual(['WC', 'CO'])
    // In order along the wall: the faces never go back.
    for (const side of view.sides) {
      const from = side.faces.map((f) => f.from)
      expect(from).toEqual([...from].sort((x, y) => x - y))
    }
    expect(view.rooms.map((r) => r.code).sort()).toEqual(['CO', 'EN', 'WC'])
  })
})

describe('sideOfRoomFace', () => {
  it('gives the side of the wall where the room of the clicked wall lies', () => {
    const doc = v2(nodes(), [wall('W1', 'N1', 'N2')], [
      roomWithCycle('A', [face('W1', 'L', 0, 400, 'a0')], 1),
      roomWithCycle('B', [face('W1', 'R', 0, 400, 'b0')], 2),
    ])
    // The faces come from the room cycles, like every reader of a v2 document.
    expect(sideOfRoomWall(doc, 'W1', 'A', 'a0')).toBe('L')
    expect(sideOfRoomWall(doc, 'W1', 'B', 'b0')).toBe('R')
    expect(sideOfRoomWall(doc, 'W1', 'ZZ', 'zz')).toBeUndefined()
    expect(sideOfRoomWall(doc, 'W9', 'A', 'a0')).toBeUndefined()
  })
})

describe('wallFaceAt', () => {
  /** One wall N1 (0,0) -> N2 (400,0), room A on side L and room B on side R, over the whole wall. */
  const twoRooms = () => v2(nodes(), [wall('W1', 'N1', 'N2')], [
    roomWithCycle('A', [face('W1', 'L', 0, 400, 'a0')], 1),
    roomWithCycle('B', [face('W1', 'R', 0, 400, 'b0')], 2),
  ])

  it('gives the room of the side that holds the point of the click', () => {
    const doc = twoRooms()
    // A point below the wall is on side L (y points down), one above is on side R.
    expect(wallFaceAt(doc, 'W1', 'L', { x: 200, y: 20 })).toEqual({ roomId: 'A', wallStart: 'a0', label: 'A-1' })
    expect(wallFaceAt(doc, 'W1', 'R', { x: 200, y: -20 })).toEqual({ roomId: 'B', wallStart: 'b0', label: 'B-1' })
    // A click past an end still lands on the face: it is put back on the wall.
    expect(wallFaceAt(doc, 'W1', 'L', { x: 460, y: 10 })?.roomId).toBe('A')
  })

  it('gives the face that covers the point when a side is cut in two', () => {
    const doc = v2(nodes(), [wall('W1', 'N1', 'N2')], [
      roomWithCycle('A', [face('W1', 'L', 0, 400, 'a0')], 1),
      roomWithCycle('B', [face('W1', 'R', 0, 150, 'b0'), face('W1', 'R', 150, 400, 'b1')], 2),
    ])
    expect(wallFaceAt(doc, 'W1', 'R', { x: 80, y: -10 })?.wallStart).toBe('b0')
    expect(wallFaceAt(doc, 'W1', 'R', { x: 300, y: -10 })?.wallStart).toBe('b1')
  })

  it('gives null on a side with no room (a single wall, or a facade)', () => {
    const doc = v2(nodes(), [{ ...wall('W1', 'N1', 'N2'), standalone: true }], [])
    expect(wallFaceAt(doc, 'W1', 'L', { x: 200, y: 20 })).toBeNull()
    expect(wallFaceAt(doc, 'W1', 'R', { x: 200, y: -20 })).toBeNull()
    // A wall that is not on the plan has no face either.
    expect(wallFaceAt(doc, 'W9', 'L', { x: 200, y: 20 })).toBeNull()
  })
})

describe('otherSide', () => {
  it('swaps the two sides of a wall', () => {
    expect(otherSide('L')).toBe('R')
    expect(otherSide('R')).toBe('L')
  })
})

describe('roomWallLinks', () => {
  it('says what is on the other side of each wall of a room', () => {
    const doc = v2(nodes(), [wall('W1', 'N1', 'N2'), { ...wall('W2', 'N2', 'N1'), standalone: true }], [
      roomWithCycle('A', [face('W1', 'L', 0, 400, 'a0'), face('W2', 'L', 0, 400, 'a1')], 1),
      roomWithCycle('B', [face('W1', 'R', 0, 400, 'b0')], 2),
    ])
    const links = roomWallLinks(doc, doc.rooms[0])
    expect(links.get('a0')).toMatchObject({ wallId: 'W1', side: 'L', kind: 'shared', text: 'shared with B' })
    // W2 stands alone (a wall of the Wall tool): an own wall of the room.
    expect(links.get('a1')).toMatchObject({ wallId: 'W2', side: 'L', kind: 'own', text: 'own wall' })
  })

  it('names the rooms of the other side on the demo apartment', () => {
    const doc = convertToV2({ projectId: 'p', title: 't', rooms: demoRooms(), elements: [], measurements: {}, roomNotes: {}, tapes: [] }).doc
    const co = doc.rooms.find((r) => r.code === 'CO')!
    const links = roomWallLinks(doc, co)
    expect(links.size).toBe(co.cycle!.length)
    // One line per face, with the wall id and what is on the other side.
    expect([...links.values()].map((l) => l.wallId)).toContain('W21')
    expect([...links.values()].find((l) => l.wallId === 'W21')!.text).toBe('facade')
    expect([...links.values()].find((l) => l.text === 'shared with Entrée')!.wallId).toBe('W6')
  })
})

describe('"In line on" of a stored wall', () => {
  it('names the three choices of the wall card: Side A, Centre, Side B', () => {
    expect(wallAlignSide(undefined)).toBe('A')
    expect(wallAlignSide('room')).toBe('A')
    expect(wallAlignSide('center')).toBe('center')
    expect(wallAlignSide('other')).toBe('B')
  })

  it('puts the guide half a thickness on the L side for side A, on the centre for Centre', () => {
    expect(wallAlignOffsetCm(undefined, 12)).toBe(6)
    expect(wallAlignOffsetCm('room', 12)).toBe(6)
    expect(wallAlignOffsetCm('center', 12)).toBe(0)
    expect(wallAlignOffsetCm('other', 12)).toBe(-6)
  })
})

describe('outsideFaceLabelAtPoint', () => {
  /** Wall W1 (0,0) -> N2 (400,0); room A on side L, the outside on side R (a facade). */
  const facadeDoc = () =>
    v2(nodes(), [{ ...wall('W1', 'N1', 'N2'), faces: [
      { side: 'L', roomId: 'A', wallStart: 'a0', from: 0, to: 400 },
      { side: 'R', from: 0, to: 400 },
    ] }], [roomWithCycle('A', [face('W1', 'L', 0, 400, 'a0')])])

  it('gives the outside value on the outside half of a facade wall', () => {
    // y < 0 is side R: the outside of this wall.
    expect(outsideFaceLabelAtPoint(facadeDoc(), 'W1', { x: 200, y: -5 })).toBe('W1-E')
  })

  it('gives nothing on the room half of the same wall', () => {
    expect(outsideFaceLabelAtPoint(facadeDoc(), 'W1', { x: 200, y: 5 })).toBeNull()
  })

  it('gives nothing when both sides have a room', () => {
    const doc = v2(nodes(), [{ ...wall('W1', 'N1', 'N2'), faces: [
      { side: 'L', roomId: 'A', wallStart: 'a0', from: 0, to: 400 },
      { side: 'R', roomId: 'B', wallStart: 'b0', from: 0, to: 400 },
    ] }], [
      roomWithCycle('A', [face('W1', 'L', 0, 400, 'a0')], 1),
      roomWithCycle('B', [face('W1', 'R', 0, 400, 'b0')], 2),
    ])
    expect(outsideFaceLabelAtPoint(doc, 'W1', { x: 200, y: -5 })).toBeNull()
  })
})
