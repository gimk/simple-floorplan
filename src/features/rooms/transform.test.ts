import { describe, expect, it } from 'vitest'
import { roomAreaM2 } from '../../model/geometry'
import { emptyDoc } from '../../model/store'
import type { Pin, PlanDoc, Room, Vec, WallProps } from '../../model/types'
import { makeRoom, rectPoints } from './ops'
import {
  MIN_ROOM_CM, axisFactor, linkMoves, moveRoom, nearestVertex, oppositeVertex, roomHasLockedWall,
  scaleFactors, scaleRoom, scaleRoomWithLinks, translateRoom,
} from './transform'

const pin = (id: string, x: number, y: number, roomId?: string): Pin =>
  ({ id, roomId, at: { x, y }, photoKeys: [], createdAt: '', updatedAt: '' })

/** Two 4 x 3 m rooms side by side, sharing the corner (400, 0)-(400, 300) edge. */
const twoRooms = () => {
  const d = emptyDoc()
  const a = makeRoom(d, rectPoints({ x: 0, y: 0 }, { x: 400, y: 300 }))
  const b = makeRoom({ ...d, rooms: [a] }, rectPoints({ x: 400, y: 0 }, { x: 700, y: 300 }))
  const doc: PlanDoc = { ...d, rooms: [a, b] }
  return { doc, a, b }
}

const at = (doc: PlanDoc, room: Room, index: number): Vec => {
  const v = doc.rooms.find((r) => r.id === room.id)!.vertices[index]
  return { x: v.x, y: v.y }
}

describe('nearestVertex / oppositeVertex', () => {
  it('finds the closest outline vertex to the pointer', () => {
    const { a } = twoRooms()
    expect(nearestVertex(a, { x: 390, y: 290 })!.id).toBe(a.vertices[2].id)
    expect(nearestVertex(a, { x: 5, y: 5 })!.id).toBe(a.vertices[0].id)
  })
  it('considers hole vertices', () => {
    const d = emptyDoc()
    const hole = [
      { id: 'h1', x: 100, y: 100 }, { id: 'h2', x: 200, y: 100 }, { id: 'h3', x: 200, y: 200 }, { id: 'h4', x: 100, y: 200 },
    ]
    const room: Room = { ...makeRoom(d, rectPoints({ x: 0, y: 0 }, { x: 400, y: 300 })), holes: [hole] }
    expect(nearestVertex(room, { x: 198, y: 96 })!.id).toBe('h2')
  })
  it('picks the opposite corner as the scale anchor', () => {
    const { a } = twoRooms()
    expect(oppositeVertex(a, a.vertices[0].id)!.id).toBe(a.vertices[2].id)
    expect(oppositeVertex(a, a.vertices[1].id)!.id).toBe(a.vertices[3].id)
    expect(oppositeVertex(a, 'nope')).toBeNull()
  })
})

describe('translateRoom', () => {
  it('moves outline, holes and the pins of that room only', () => {
    const { doc, a, b } = twoRooms()
    const hole = [{ id: 'h1', x: 100, y: 100 }, { id: 'h2', x: 200, y: 100 }, { id: 'h3', x: 200, y: 200 }]
    const d: PlanDoc = {
      ...doc,
      rooms: [{ ...a, holes: [hole] }, b],
      pins: [pin('p1', 10, 20, a.id), pin('p2', 500, 20, b.id), pin('p3', 40, 40)],
    }
    const r = translateRoom(d, a.id, { x: 50, y: -20 })
    expect(at(r, a, 0)).toEqual({ x: 50, y: -20 })
    expect(at(r, a, 2)).toEqual({ x: 450, y: 280 })
    expect(r.rooms[0].holes[0][0]).toMatchObject({ id: 'h1', x: 150, y: 80 })
    expect(r.rooms[0].vertices[0].id).toBe(a.vertices[0].id) // ids survive
    expect(at(r, b, 0)).toEqual({ x: 400, y: 0 }) // neighbour untouched
    expect(r.pins![0].at).toEqual({ x: 60, y: 0 })
    expect(r.pins![1].at).toEqual({ x: 500, y: 20 }) // other room's pin
    expect(r.pins![2].at).toEqual({ x: 40, y: 40 }) // unattached pin
  })
  it('keeps wall props and does not touch wall elements', () => {
    const { doc, a } = twoRooms()
    const walls: Record<string, WallProps> = { [a.vertices[0].id]: { type: 'exterior', thicknessCm: 30, locked: true } }
    const el = { id: 'e1', roomId: a.id, wallStart: a.vertices[0].id, kind: 'door' as const, offsetCm: 10, widthCm: 80, createdAt: '', updatedAt: '' }
    const r = translateRoom({ ...doc, rooms: [{ ...a, walls }], elements: [el] }, a.id, { x: 25, y: 25 })
    expect(r.rooms[0].walls).toEqual(walls)
    expect(r.elements).toEqual([el]) // wall + offset are relative
  })
})

describe('moveRoom', () => {
  it('drags linked vertices of other rooms by the same translation', () => {
    const { doc, a, b } = twoRooms()
    const shared = [{ roomId: b.id, vertexId: b.vertices[0].id }] // b at (400, 0), linked to a at (400, 0)
    const r = moveRoom(doc, a.id, { x: 100, y: 50 }, shared)
    expect(at(r, a, 1)).toEqual({ x: 500, y: 50 })
    expect(r.rooms[1].vertices[0]).toMatchObject({ id: b.vertices[0].id, x: 500, y: 50 })
    expect(at(r, b, 2)).toEqual({ x: 700, y: 300 }) // the rest of the neighbour stays
  })
  it('ignores a linked reference that no longer exists', () => {
    const { doc, a } = twoRooms()
    expect(moveRoom(doc, a.id, { x: 10, y: 10 }, [{ roomId: 'gone', vertexId: 'x' }])).toBeTruthy()
  })
})

describe('axisFactor', () => {
  it('scales freely above the minimum', () => {
    expect(axisFactor(400, 800)).toBeCloseTo(2)
    expect(axisFactor(400, 200)).toBeCloseTo(0.5)
  })
  it('never goes below the minimum size', () => {
    expect(axisFactor(400, 0)).toBeCloseTo(MIN_ROOM_CM / 400)
    expect(axisFactor(400, 1)).toBeCloseTo(MIN_ROOM_CM / 400)
  })
  it('refuses a flip over the anchor', () => {
    expect(axisFactor(400, -800)).toBeCloseTo(MIN_ROOM_CM / 400)
  })
  it('leaves a degenerate axis alone', () => {
    expect(axisFactor(0, 300)).toBe(1)
  })
})

describe('scaleFactors', () => {
  const anchor = { x: 0, y: 0 }, corner = { x: 400, y: 300 }
  it('scales x and y independently', () => {
    expect(scaleFactors(anchor, corner, { x: 800, y: 150 })).toEqual({ sx: 2, sy: 0.5 })
  })
  it('uses one factor when uniform', () => {
    expect(scaleFactors(anchor, corner, { x: 200, y: 600 }, true)).toEqual({ sx: 2, sy: 2 })
  })
})

describe('scaleRoom', () => {
  it('resizes the rectangle around the anchor corner', () => {
    const { doc, a, b } = twoRooms()
    const anchor = a.vertices[0] // (0, 0)
    const r = scaleRoom({ ...doc, pins: [pin('p1', 100, 100, a.id)] }, a.id, anchor, { sx: 2, sy: 1 })
    expect(at(r, a, 2)).toEqual({ x: 800, y: 300 })
    expect(at(r, a, 3)).toEqual({ x: 0, y: 300 })
    expect(roomAreaM2(r.rooms[0])).toBeCloseTo(24)
    expect(r.pins![0].at).toEqual({ x: 200, y: 100 })
    expect(at(r, b, 0)).toEqual({ x: 400, y: 0 }) // other rooms untouched
  })
})

describe('scaleRoomWithLinks', () => {
  it('puts a linked neighbour corner on the new place of its vertex', () => {
    const { doc, a, b } = twoRooms()
    const anchor = a.vertices[0] // (0, 0)
    const corner = a.vertices[1] // (400, 0): shared with b
    const links = [{ ref: { roomId: b.id, vertexId: b.vertices[0].id }, source: { roomId: a.id, vertexId: corner.id } }]
    const f = scaleFactors(anchor, corner, { x: 800, y: 0 })
    const r = scaleRoomWithLinks(doc, a.id, anchor, f, links)
    expect(at(r, a, 1)).toEqual({ x: 800, y: 0 })
    expect(r.rooms[1].vertices[0]).toMatchObject({ x: 800, y: 0 })
    expect(at(r, b, 2)).toEqual({ x: 700, y: 300 })
  })
  it('skips a link whose source vertex is missing', () => {
    const { doc, a } = twoRooms()
    const after = scaleRoom(doc, a.id, a.vertices[0], { sx: 1, sy: 1 })
    expect(linkMoves(after, [{ ref: { roomId: a.id, vertexId: 'nope' }, source: { roomId: a.id, vertexId: 'nope' } }])).toEqual([])
  })
})

describe('roomHasLockedWall', () => {
  it('detects a locked wall', () => {
    const { a } = twoRooms()
    expect(roomHasLockedWall(a)).toBe(false)
    const locked: Room = { ...a, walls: { [a.vertices[0].id]: { type: 'bearing', thicknessCm: 20, locked: true } } }
    expect(roomHasLockedWall(locked)).toBe(true)
  })
})
