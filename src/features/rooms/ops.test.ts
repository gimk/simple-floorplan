import { beforeEach, describe, expect, it } from 'vitest'
import { area } from '../../model/geometry'
import { createDefaultProject } from '../../model/schema'
import { useDoc } from '../../model/store'
import type { Room } from '../../model/types'
import {
  createRectRoom, cutoutRoom, deleteVertex, insertVertexOnEdge, isAxisAlignedRect, mergeRooms,
  moveEdge, moveRoom, moveVertex, nextRoomName, roomWalls, setWallLength,
} from './ops'
import {
  addRoom, cutoutArtboardRooms, deleteRooms, mergeArtboardRooms, renameRoom, setRoomWallLength,
} from './actions'

const rect = (id: string, x0: number, y0: number, x1: number, y1: number): Room => ({
  id, name: id, fill: '#abc',
  vertices: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }],
})
const tri: Room = { id: 't', name: 't', vertices: [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 0, y: 400 }] }

describe('roomWalls', () => {
  it('lists walls with length, mid and angle', () => {
    const w = roomWalls(rect('a', 0, 0, 400, 300))
    expect(w).toHaveLength(4)
    expect(w[0]).toMatchObject({ index: 0, lengthCm: 400, mid: { x: 200, y: 0 }, angleDeg: 0 })
    expect(w[1].angleDeg).toBeCloseTo(90)
    expect(w[3].lengthCm).toBe(300)
    expect(w[3].b).toEqual({ x: 0, y: 0 })
  })
})

describe('isAxisAlignedRect', () => {
  it('detects rects', () => {
    expect(isAxisAlignedRect(rect('a', 0, 0, 10, 20).vertices)).toBe(true)
    expect(isAxisAlignedRect(tri.vertices)).toBe(false)
    expect(isAxisAlignedRect([{ x: 0, y: 0 }, { x: 10, y: 5 }, { x: 10, y: 20 }, { x: 0, y: 20 }])).toBe(false)
  })
})

describe('setWallLength', () => {
  it('keeps a rect rectangular (horizontal wall)', () => {
    const r = setWallLength(rect('a', 0, 0, 400, 300), 0, 500)!
    expect(isAxisAlignedRect(r.vertices)).toBe(true)
    expect(r.vertices[1]).toEqual({ x: 500, y: 0 })
    expect(r.vertices[2]).toEqual({ x: 500, y: 300 })
    expect(r.vertices[0]).toEqual({ x: 0, y: 0 })
  })
  it('keeps a rect rectangular (vertical wall, shrink)', () => {
    const r = setWallLength(rect('a', 0, 0, 400, 300), 1, 200)!
    expect(isAxisAlignedRect(r.vertices)).toBe(true)
    expect(r.vertices[2]).toEqual({ x: 400, y: 200 })
    expect(r.vertices[3]).toEqual({ x: 0, y: 200 })
  })
  it('works on the closing wall', () => {
    const r = setWallLength(rect('a', 0, 0, 400, 300), 3, 100)!
    expect(isAxisAlignedRect(r.vertices)).toBe(true)
    expect(roomWalls(r)[3].lengthCm).toBeCloseTo(100)
  })
  it('moves only the end vertex of a polygon', () => {
    const r = setWallLength(tri, 0, 200)!
    expect(r.vertices[0]).toEqual({ x: 0, y: 0 })
    expect(r.vertices[1]).toEqual({ x: 200, y: 0 })
    expect(r.vertices[2]).toEqual({ x: 0, y: 400 })
  })
  it('returns null when invalid', () => {
    expect(setWallLength(tri, 0, 0)).toBeNull()
    expect(setWallLength(tri, 0, -5)).toBeNull()
    expect(setWallLength(tri, 0, NaN)).toBeNull()
    expect(setWallLength(tri, 9, 5)).toBeNull()
  })
  it('does not change its input', () => {
    const src = rect('a', 0, 0, 400, 300)
    setWallLength(src, 0, 500)
    expect(src.vertices[1]).toEqual({ x: 400, y: 0 })
  })
})

describe('move and edit', () => {
  it('moveRoom', () => {
    expect(moveRoom(rect('a', 0, 0, 10, 10), 5, -5).vertices[0]).toEqual({ x: 5, y: -5 })
  })
  it('moveVertex', () => {
    const r = moveVertex(tri, 1, { x: 350, y: 20 })
    expect(r.vertices[1]).toEqual({ x: 350, y: 20 })
    expect(r.vertices[0]).toEqual({ x: 0, y: 0 })
  })
  it('moveEdge moves both ends', () => {
    const r = moveEdge(rect('a', 0, 0, 400, 300), 1, { x: 50, y: 0 })
    expect(r.vertices[1].x).toBe(450)
    expect(r.vertices[2].x).toBe(450)
    expect(r.vertices[0].x).toBe(0)
  })
  it('moveEdge on the closing wall wraps', () => {
    const r = moveEdge(rect('a', 0, 0, 400, 300), 3, { x: 0, y: 10 })
    expect(r.vertices[3].y).toBe(310)
    expect(r.vertices[0].y).toBe(10)
  })
  it('insertVertexOnEdge', () => {
    const r = insertVertexOnEdge(rect('a', 0, 0, 400, 300), 0, { x: 200, y: 0 })
    expect(r.vertices).toHaveLength(5)
    expect(r.vertices[1]).toEqual({ x: 200, y: 0 })
    expect(r.vertices[2]).toEqual({ x: 400, y: 0 })
    const last = insertVertexOnEdge(rect('a', 0, 0, 400, 300), 3, { x: 0, y: 100 })
    expect(last.vertices[4]).toEqual({ x: 0, y: 100 })
  })
  it('deleteVertex keeps min 3', () => {
    expect(deleteVertex(rect('a', 0, 0, 10, 10), 0)!.vertices).toHaveLength(3)
    expect(deleteVertex(tri, 0)).toBeNull()
    expect(deleteVertex(rect('a', 0, 0, 10, 10), 7)).toBeNull()
  })
})

describe('createRectRoom and names', () => {
  it('makes 4 clockwise vertices from any corner order', () => {
    const r = createRectRoom({ x: 400, y: 300 }, { x: 0, y: 0 }, 'R')
    expect(r.vertices).toEqual([{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }, { x: 0, y: 300 }])
    expect(r.id).toBeTruthy()
    expect(area(r.vertices)).toBe(120000)
  })
  it('enforces min 10 cm per side', () => {
    const r = createRectRoom({ x: 0, y: 0 }, { x: 3, y: -2 }, 'S')
    expect(r.vertices[1].x - r.vertices[0].x).toBe(10)
    expect(r.vertices[2].y - r.vertices[1].y).toBe(10)
  })
  it('nextRoomName', () => {
    expect(nextRoomName([])).toBe('Room 1')
    expect(nextRoomName([rect('Room 1', 0, 0, 1, 1), rect('Room 2', 0, 0, 1, 1)])).toBe('Room 3')
    expect(nextRoomName([rect('Room 2', 0, 0, 1, 1)])).toBe('Room 1')
  })
})

describe('cutoutRoom', () => {
  const big = rect('big', 0, 0, 400, 300)
  it('notches a corner and keeps id/name', () => {
    const res = cutoutRoom(big, rect('c', 300, 200, 500, 400).vertices)
    expect(res).toHaveLength(1)
    expect(res[0].id).toBe('big')
    expect(res[0].name).toBe('big')
    expect(res[0].vertices).toHaveLength(6)
    expect(area(res[0].vertices)).toBeCloseTo(120000 - 100 * 100)
  })
  it('splits into two rooms; largest keeps the id', () => {
    const res = cutoutRoom(big, rect('c', 100, -10, 150, 310).vertices)
    expect(res).toHaveLength(2)
    expect(res[0].id).toBe('big')
    expect(res[1].id).not.toBe('big')
    expect(area(res[0].vertices)).toBeGreaterThan(area(res[1].vertices))
  })
  it('returns [] when fully covered', () => {
    expect(cutoutRoom(big, rect('c', -10, -10, 500, 500).vertices)).toEqual([])
  })
  it('returns the same shape when disjoint', () => {
    const res = cutoutRoom(big, rect('c', 1000, 1000, 1100, 1100).vertices)
    expect(res).toHaveLength(1)
    expect(area(res[0].vertices)).toBeCloseTo(120000)
  })
})

describe('mergeRooms', () => {
  it('merges touching rooms, keeps first id/name/fill', () => {
    const m = mergeRooms([rect('a', 0, 0, 200, 200), rect('b', 200, 0, 400, 200)])!
    expect(m.id).toBe('a')
    expect(m.fill).toBe('#abc')
    expect(m.vertices).toHaveLength(4)
    expect(area(m.vertices)).toBeCloseTo(80000)
  })
  it('merges overlapping rooms into an L', () => {
    const m = mergeRooms([rect('a', 0, 0, 200, 200), rect('b', 100, 100, 300, 300)])!
    expect(m.vertices).toHaveLength(8)
    expect(area(m.vertices)).toBeCloseTo(40000 + 40000 - 10000)
  })
  it('returns null for disjoint rooms or fewer than 2', () => {
    expect(mergeRooms([rect('a', 0, 0, 100, 100), rect('b', 500, 500, 600, 600)])).toBeNull()
    expect(mergeRooms([rect('a', 0, 0, 100, 100)])).toBeNull()
  })
  it('returns null when the union has a hole', () => {
    const ring = [rect('a', 0, 0, 300, 100), rect('b', 200, 0, 300, 300), rect('c', 0, 200, 300, 300), rect('d', 0, 0, 100, 300)]
    expect(mergeRooms(ring)).toBeNull()
  })
})

describe('store actions', () => {
  let ab: string
  beforeEach(() => {
    useDoc.getState().hydrate(createDefaultProject())
    ab = useDoc.getState().doc.artboards[0].id
  })
  const rooms = () => useDoc.getState().doc.artboards[0].rooms

  it('add, rename, delete', () => {
    addRoom(ab, rect('a', 0, 0, 400, 300))
    addRoom(ab, rect('b', 500, 0, 600, 100))
    renameRoom(ab, 'a', 'Kitchen')
    expect(rooms()[0].name).toBe('Kitchen')
    deleteRooms(ab, ['a'])
    expect(rooms().map((r) => r.id)).toEqual(['b'])
  })
  it('one undo step per action', () => {
    addRoom(ab, rect('a', 0, 0, 400, 300))
    expect(setRoomWallLength(ab, 'a', 0, 500)).toBe(true)
    expect(rooms()[0].vertices[1].x).toBe(500)
    useDoc.getState().undo()
    expect(rooms()[0].vertices[1].x).toBe(400)
    expect(setRoomWallLength(ab, 'a', 0, -1)).toBe(false)
    expect(setRoomWallLength(ab, 'zz', 0, 10)).toBe(false)
  })
  it('cutout targets only listed rooms', () => {
    addRoom(ab, rect('a', 0, 0, 400, 300))
    addRoom(ab, rect('b', 0, 400, 400, 700))
    const cutter = rect('c', 300, 200, 500, 500).vertices
    expect(cutoutArtboardRooms(ab, cutter, ['a'])).toBe(true)
    expect(rooms().find((r) => r.id === 'a')!.vertices).toHaveLength(6)
    expect(rooms().find((r) => r.id === 'b')!.vertices).toHaveLength(4)
    expect(cutoutArtboardRooms(ab, rect('c', 2000, 2000, 2100, 2100).vertices)).toBe(false)
  })
  it('merge replaces rooms with one', () => {
    addRoom(ab, rect('a', 0, 0, 200, 200))
    addRoom(ab, rect('b', 200, 0, 400, 200))
    addRoom(ab, rect('c', 900, 900, 1000, 1000))
    expect(mergeArtboardRooms(ab, ['a', 'b'])!.id).toBe('a')
    expect(rooms().map((r) => r.id)).toEqual(['a', 'c'])
    expect(mergeArtboardRooms(ab, ['a', 'c'])).toBeNull()
    expect(rooms()).toHaveLength(2)
  })
})
