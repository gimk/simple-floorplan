// Tests of the read layer of the v2 model (docs/walls-plan.md, phase 5c step 1):
// the room polygon of a cycle of faces, and the faces of a wall rebuilt from those cycles.
import { describe, expect, it } from 'vitest'
import { demoRooms } from '../../features/measure/demo'
import type { PlanDoc, Room, RoomFace, StoredNode, StoredWall } from '../types'
import { convertToV2 } from './convert'
import { deriveWallFaces, faceStartCm, materializeRooms } from './materialize'

/** A v2 document written by hand: nodes, walls with properties, and one room cycle. */
const v2 = (nodes: StoredNode[], walls: StoredWall[], rooms: Room[]): PlanDoc => ({
  projectId: 'p1', title: 'test', schemaVersion: 2, nodes, walls, rooms,
  elements: [], measurements: {}, roomNotes: {}, tapes: [],
})

const wall = (id: string, a: string, b: string, thicknessCm = 10): StoredWall => ({
  id, a, b, faces: [], type: 'partition', thicknessCm,
})

const face = (wallId: string, side: 'L' | 'R', from: number, to: number, cornerId: string): RoomFace =>
  ({ wallId, side, from, to, cornerId })

const roomWithCycle = (cycle: RoomFace[], extra: Partial<Room> = {}): Room => ({
  id: 'R', code: 'R', name: 'R', vertices: [], holes: [], walls: {}, walkOrder: 1, cycle, ...extra,
})

/** A 400 × 300 rectangle: N1 (0,0), N2 (400,0), N3 (400,300), N4 (0,300). */
const rectNodes = (): StoredNode[] => [
  { id: 'N1', x: 0, y: 0 }, { id: 'N2', x: 400, y: 0 }, { id: 'N3', x: 400, y: 300 }, { id: 'N4', x: 0, y: 300 },
]

const rectWalls = (): StoredWall[] => [wall('W1', 'N1', 'N2'), wall('W2', 'N2', 'N3'), wall('W3', 'N3', 'N4'), wall('W4', 'N4', 'N1')]

const rectCycle = (): RoomFace[] => [
  face('W1', 'L', 0, 400, 'r0'), face('W2', 'L', 0, 300, 'r1'), face('W3', 'L', 0, 400, 'r2'), face('W4', 'L', 0, 300, 'r3'),
]

const corners = (r: Room) => r.vertices.map((v) => [v.x, v.y])

describe('materializeRooms', () => {
  it('puts each corner where the two centre lines cross', () => {
    const doc = v2(rectNodes(), rectWalls(), [roomWithCycle(rectCycle())])
    const [room] = materializeRooms(doc)
    expect(room.vertices.map((v) => v.id)).toEqual(['r0', 'r1', 'r2', 'r3'])
    expect(corners(room)).toEqual([[0, 0], [400, 0], [400, 300], [0, 300]])
    // The wall properties come from the WALL, keyed by the corner id of the face.
    expect(room.walls['r0']).toEqual({ type: 'partition', thicknessCm: 10 })
  })

  it('takes the thickness of the wall, not of the old room copy', () => {
    const walls = rectWalls().map((w) => (w.id === 'W1' ? { ...w, thicknessCm: 20, type: 'exterior' as const } : w))
    const doc = v2(rectNodes(), walls, [roomWithCycle(rectCycle())])
    const [room] = materializeRooms(doc)
    expect(room.walls['r0']).toEqual({ type: 'exterior', thicknessCm: 20 })
    expect(room.walls['r1']).toEqual({ type: 'partition', thicknessCm: 10 })
  })

  it('gives the same corner as the node where two walls meet at an angle', () => {
    const nodes: StoredNode[] = [
      { id: 'N1', x: 0, y: 0 }, { id: 'N2', x: 400, y: 0 }, { id: 'N3', x: 350, y: 300 }, { id: 'N4', x: 0, y: 300 },
    ]
    const walls = [wall('W1', 'N1', 'N2'), wall('W2', 'N2', 'N3'), wall('W3', 'N3', 'N4'), wall('W4', 'N4', 'N1')]
    const [room] = materializeRooms(v2(nodes, walls, [roomWithCycle(rectCycle())]))
    expect(corners(room)[1]).toEqual([400, 0])
    expect(corners(room)[2][0]).toBeCloseTo(350, 9)
    expect(corners(room)[2][1]).toBeCloseTo(300, 9)
  })

  it('puts an in-line corner on the wall, where the two faces meet', () => {
    // Two faces of one room on one wall (a corridor with a corner on its long wall).
    const nodes = rectNodes()
    const walls = rectWalls()
    const cycle = [face('W1', 'L', 0, 150, 'r0'), face('W1', 'L', 150, 400, 'r5'), ...rectCycle().slice(1)]
    const [room] = materializeRooms(v2(nodes, walls, [roomWithCycle(cycle)]))
    expect(room.vertices.map((v) => v.id)).toEqual(['r0', 'r5', 'r1', 'r2', 'r3'])
    expect(corners(room)[1]).toEqual([150, 0])
    expect(corners(room)[0]).toEqual([0, 0])
    expect(corners(room)[2]).toEqual([400, 0])
  })

  it('puts an in-line corner right for a room wound the other way (CCW)', () => {
    // The same rectangle, walked counter-clockwise: the room is on side L of every wall but runs
    // b -> a, so its two faces on W1 come in the other order (the span that stops at 150 first).
    const nodes = rectNodes()
    const walls = rectWalls()
    const cycle = [
      face('W1', 'L', 250, 400, 'c0'),
      face('W1', 'L', 0, 250, 'c5'),
      face('W4', 'L', 0, 300, 'c1'),
      face('W3', 'L', 0, 400, 'c2'),
      face('W2', 'L', 0, 300, 'c3'),
    ]
    const [room] = materializeRooms(v2(nodes, walls, [roomWithCycle(cycle)]))
    // The corner ids keep the polygon order, and the in-line corner is where the two spans meet.
    expect(room.vertices.map((v) => v.id)).toEqual(['c0', 'c5', 'c1', 'c2', 'c3'])
    expect(corners(room)).toEqual([[400, 0], [250, 0], [0, 0], [0, 300], [400, 300]])
  })

  it('gives a room without a cycle back unchanged', () => {
    const room: Room = { id: 'old', code: 'O', name: 'O', vertices: [{ id: 'a', x: 0, y: 0 }], holes: [], walls: {}, walkOrder: 1 }
    const doc = v2([], [], [room])
    expect(materializeRooms(doc)[0]).toBe(room)
  })

  it('is deterministic', () => {
    const doc = v2(rectNodes(), rectWalls(), [roomWithCycle(rectCycle())])
    expect(materializeRooms(doc)).toEqual(materializeRooms(doc))
  })

  it('reads the start of a face in room order from its side', () => {
    // Side L: the room runs along a -> b, so the face starts at `from`. Side R: it runs b -> a.
    expect(faceStartCm({ side: 'L', from: 20, to: 80 })).toBe(20)
    expect(faceStartCm({ side: 'R', from: 20, to: 80 })).toBe(80)
  })
})

describe('deriveWallFaces', () => {
  it('rebuilds the two sides from the cycles, with an outside face where no room is', () => {
    // The room is on side L of W1 over the whole length, nothing on side R: a facade.
    const doc = v2(rectNodes(), rectWalls(), [roomWithCycle(rectCycle())])
    const walls = deriveWallFaces(doc)
    const w1 = walls.find((w) => w.id === 'W1')!
    expect(w1.faces).toEqual([
      { side: 'L', roomId: 'R', wallStart: 'r0', from: 0, to: 400 },
      { side: 'R', from: 0, to: 400 },
    ])
  })

  it('cuts outside spans around a face that covers the middle of a wall', () => {
    const walls = rectWalls()
    const cycle = [face('W1', 'L', 100, 300, 'r0'), ...rectCycle().slice(1)]
    const doc = v2(rectNodes(), walls, [roomWithCycle(cycle)])
    const w1 = deriveWallFaces(doc).find((w) => w.id === 'W1')!
    expect(w1.faces).toEqual([
      { side: 'L', from: 0, to: 100 },
      { side: 'L', roomId: 'R', wallStart: 'r0', from: 100, to: 300 },
      { side: 'L', from: 300, to: 400 },
      { side: 'R', from: 0, to: 400 },
    ])
  })

  it('cuts the two sides independently (the Entree / Couloir case)', () => {
    // One wall, one face of room A on side L, two faces of room B on side R.
    const nodes: StoredNode[] = [{ id: 'N1', x: 0, y: 0 }, { id: 'N2', x: 400, y: 0 }]
    const walls = [wall('W1', 'N1', 'N2')]
    const rooms = [
      roomWithCycle([face('W1', 'L', 0, 400, 'a0')], { id: 'A', code: 'A', walkOrder: 1 }),
      roomWithCycle([face('W1', 'R', 0, 150, 'b0'), face('W1', 'R', 150, 400, 'b1')], { id: 'B', code: 'B', walkOrder: 2 }),
    ]
    const w1 = deriveWallFaces(v2(nodes, walls, rooms))[0]
    expect(w1.faces.filter((f) => f.side === 'R')).toHaveLength(2)
    expect(w1.faces.filter((f) => f.side === 'L')).toEqual([{ side: 'L', roomId: 'A', wallStart: 'a0', from: 0, to: 400 }])
  })

  it('gives the same array back when nothing changed', () => {
    const converted = convertToV2({
      projectId: 'p1', title: 'test', rooms: demoRooms(), elements: [], measurements: {}, roomNotes: {}, tapes: [],
    }).doc
    expect(deriveWallFaces(converted)).toBe(converted.walls)
    // And the faces it rebuilds are the faces of the wall graph.
    expect(deriveWallFaces(converted).map((w) => w.faces)).toEqual(converted.walls!.map((w) => w.faces))
  })

  it('fills the faces of a wall that has none yet', () => {
    const doc = v2(rectNodes(), rectWalls(), [roomWithCycle(rectCycle())])
    const w1 = deriveWallFaces(doc).find((w) => w.id === 'W1')!
    expect(w1.faces).toEqual([
      { side: 'L', roomId: 'R', wallStart: 'r0', from: 0, to: 400 },
      { side: 'R', from: 0, to: 400 },
    ])
  })
})
