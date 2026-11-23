import { describe, expect, it } from 'vitest'
import { emptyDoc } from '../../model/store'
import { area } from '../../model/geometry'
import type { PlanDoc, Room, WallElement } from '../../model/types'
import { cutDoc, deleteRoom, insertVertex, makeRoom, rectPoints, removeVertex, setRoomCode, sliceDoc } from './ops'

const docWithRoom = () => {
  const d = emptyDoc()
  const room = makeRoom(d, rectPoints({ x: 0, y: 0 }, { x: 400, y: 300 }))
  return { doc: { ...d, rooms: [room] } as PlanDoc, room }
}
/**
 * Area of the CENTRE-LINE polygon minus holes, in m². These geometry-op tests check the
 * outline itself, so they use the centre line, not the inside face (roomAreaM2).
 * Example: 400 x 300 cm -> 12 m².
 */
const cl = (r: Room) => (area(r.vertices) - r.holes.reduce((s, h) => s + area(h), 0)) / 10000
const el = (roomId: string, wallStart: string, offsetCm: number, widthCm = 80): WallElement => ({
  id: 'e' + offsetCm + wallStart, roomId, wallStart, kind: 'door', offsetCm, widthCm, createdAt: '', updatedAt: '',
})

describe('makeRoom', () => {
  it('creates a rectangle with a diagonal and defaults', () => {
    const { room } = docWithRoom()
    expect(room.code).toBe('R1')
    expect(room.diagonal).toEqual([0, 2])
    expect(cl(room)).toBeCloseTo(12)
  })
})

describe('sliceDoc', () => {
  it('splits a rectangle into two rooms with the right areas', () => {
    const { doc, room } = docWithRoom()
    const r = sliceDoc(doc, { x: 200, y: -50 }, { x: 200, y: 350 })!
    expect(r.doc.rooms).toHaveLength(2)
    const areas = r.doc.rooms.map(cl).sort()
    expect(areas[0]).toBeCloseTo(6)
    expect(areas[1]).toBeCloseTo(6)
    expect(new Set(r.doc.rooms.map((x) => x.code)).size).toBe(2)
    expect(r.doc.rooms.some((x) => x.id === room.id)).toBe(true)
  })
  it('keeps wall props on kept edges and makes the new edge a partition', () => {
    const { doc, room } = docWithRoom()
    const top = room.vertices[0].id // wall 0: top edge
    const d2 = { ...doc, rooms: [{ ...room, walls: { [top]: { type: 'exterior' as const, thicknessCm: 30 } } }] }
    const r = sliceDoc(d2, { x: 200, y: -50 }, { x: 200, y: 350 })!
    const exteriors = r.doc.rooms.flatMap((x) => Object.values(x.walls)).filter((w) => w.type === 'exterior')
    expect(exteriors).toHaveLength(2) // top edge now exists in both halves
    for (const rm of r.doc.rooms) expect(Object.keys(rm.walls)).toHaveLength(1)
  })
  it('moves elements to the half that still contains them and drops the cut ones', () => {
    const { doc, room } = docWithRoom()
    const top = room.vertices[0].id
    const d2: PlanDoc = { ...doc, elements: [el(room.id, top, 20), el(room.id, top, 300), el(room.id, top, 170, 80)] }
    const r = sliceDoc(d2, { x: 200, y: -50 }, { x: 200, y: 350 })!
    expect(r.doc.elements).toHaveLength(2) // the one straddling x=200 is dropped
    const second = r.doc.elements.find((e) => e.offsetCm === 100)!
    expect(second.roomId).not.toBe(room.id)
    expect(r.doc.rooms.find((x) => x.id === second.roomId)!.vertices.some((v) => v.id === second.wallStart)).toBe(true)
  })
  it('returns null when the line misses the room', () => {
    const { doc } = docWithRoom()
    expect(sliceDoc(doc, { x: 600, y: -50 }, { x: 600, y: 350 })).toBeNull()
  })
  it('slices diagonally', () => {
    const { doc } = docWithRoom()
    const r = sliceDoc(doc, { x: -10, y: -10 }, { x: 410, y: 310 })!
    expect(r.doc.rooms).toHaveLength(2)
    expect(r.doc.rooms.map(cl).reduce((a, b) => a + b, 0)).toBeCloseTo(12)
  })
})

describe('cutDoc', () => {
  it('adds a hole when the cutout is fully inside', () => {
    const { doc } = docWithRoom()
    const r = cutDoc(doc, rectPoints({ x: 100, y: 100 }, { x: 200, y: 200 }))!
    expect(r.doc.rooms).toHaveLength(1)
    expect(r.doc.rooms[0].holes).toHaveLength(1)
    expect(r.doc.rooms[0].vertices).toHaveLength(4)
    expect(cl(r.doc.rooms[0])).toBeCloseTo(11) // 12 - 1 m² hole
  })
  it('reshapes the outline when the cutout crosses the boundary', () => {
    const { doc, room } = docWithRoom()
    const r = cutDoc(doc, rectPoints({ x: 300, y: -50 }, { x: 450, y: 100 }))!
    expect(r.doc.rooms).toHaveLength(1)
    expect(r.doc.rooms[0].holes).toHaveLength(0)
    expect(r.doc.rooms[0].vertices).toHaveLength(6)
    expect(cl(r.doc.rooms[0])).toBeCloseTo(12 - 1)
    expect(r.doc.rooms[0].id).toBe(room.id)
  })
  it('returns null when the cutout is outside every room', () => {
    const { doc } = docWithRoom()
    expect(cutDoc(doc, rectPoints({ x: 600, y: 600 }, { x: 700, y: 700 }))).toBeNull()
  })
  it('splits the room when the cutout separates it', () => {
    const { doc } = docWithRoom()
    const r = cutDoc(doc, rectPoints({ x: 150, y: -10 }, { x: 250, y: 310 }))!
    expect(r.doc.rooms).toHaveLength(2)
  })
})

describe('vertex ops', () => {
  it('refuses to go under 3 vertices and removes wall data', () => {
    const { doc, room } = docWithRoom()
    const d1 = removeVertex(doc, room.id, room.vertices[3].id)
    expect(d1.rooms[0].vertices).toHaveLength(3)
    expect(d1.rooms[0].diagonal).toEqual([0, 2]) // diagonal vertices survive
    expect(removeVertex(doc, room.id, room.vertices[0].id).rooms[0].diagonal).toBeUndefined()
    const d2 = removeVertex(d1, room.id, room.vertices[2].id)
    expect(d2.rooms[0].vertices).toHaveLength(3)
  })
  it('inserts a vertex on a wall, splits its elements and copies wall props', () => {
    const { doc, room } = docWithRoom()
    const s = room.vertices[0].id
    const d: PlanDoc = {
      ...doc,
      rooms: [{ ...room, walls: { [s]: { type: 'bearing', thicknessCm: 25 } } }],
      elements: [el(room.id, s, 50), el(room.id, s, 300)],
    }
    const r = insertVertex(d, room.id, s, { x: 200, y: 5 })!
    const rm = r.doc.rooms[0]
    expect(rm.vertices).toHaveLength(5)
    expect(rm.vertices[1].y).toBeCloseTo(0)
    expect(rm.walls[r.vertexId].type).toBe('bearing')
    expect(rm.diagonal).toEqual([0, 3])
    const moved = r.doc.elements.find((e) => e.wallStart === r.vertexId)!
    expect(moved.offsetCm).toBeCloseTo(100)
  })
})

describe('room admin', () => {
  it('deletes a room with its elements', () => {
    const { doc, room } = docWithRoom()
    const d = deleteRoom({ ...doc, elements: [el(room.id, room.vertices[0].id, 0)] }, room.id)
    expect(d.rooms).toHaveLength(0)
    expect(d.elements).toHaveLength(0)
  })
  it('renames a code, migrating measurements and notes, and rejects duplicates', () => {
    const { doc, room } = docWithRoom()
    const d: PlanDoc = {
      ...doc,
      measurements: { 'R1-1': { label: 'R1-1', actualCm: 400, updatedAt: '' } },
      roomNotes: { R1: 'hello' },
    }
    const r = setRoomCode(d, room.id, 'SE')
    expect(r.rooms[0].code).toBe('SE')
    expect(r.measurements['SE-1'].label).toBe('SE-1')
    expect(r.measurements['R1-1']).toBeUndefined()
    expect(r.roomNotes.SE).toBe('hello')
    const two = { ...r, rooms: [...r.rooms, { ...r.rooms[0], id: 'x', code: 'ZZ' }] }
    expect(setRoomCode(two, 'x', 'SE')).toBe(two)
  })
})
