import { describe, expect, it } from 'vitest'
import type { Artboard, Opening, Room } from '../../model/types'
import {
  boxFromPoints,
  boxIntersectsRoom,
  findArtboardAtPoint,
  findOpeningsInBox,
  findRoomsInBox,
  findWallsInBox,
} from './boxSelect'

const rect = (id: string, x0: number, y0: number, x1: number, y1: number): Room => ({
  id, name: id,
  vertices: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }],
})
const board = (id: string, xCm: number, yCm: number, rooms: Room[]): Artboard =>
  ({ id, name: id, xCm, yCm, rooms, openings: [], furniture: [], precisionCm: 1 }) as unknown as Artboard
const withOpenings = (a: Artboard, openings: Opening[]): Artboard => ({ ...a, openings })
const opening = (id: string, xCm: number, yCm: number): Opening => ({
  id, kind: 'door', xCm, yCm, angleDeg: 0, widthCm: 90,
})

describe('boxFromPoints', () => {
  it('orders the corners', () => {
    expect(boxFromPoints({ x: 10, y: 20 }, { x: 0, y: 5 })).toEqual({ minX: 0, minY: 5, maxX: 10, maxY: 20 })
  })
})

describe('boxIntersectsRoom', () => {
  const ab = board('a', 0, 0, [])
  const room = rect('r', 100, 100, 300, 300)
  it('vertex inside the box', () => {
    expect(boxIntersectsRoom({ minX: 90, minY: 90, maxX: 110, maxY: 110 }, room, ab)).toBe(true)
  })
  it('edge crosses the box without a vertex inside', () => {
    expect(boxIntersectsRoom({ minX: 150, minY: 50, maxX: 200, maxY: 150 }, room, ab)).toBe(true)
  })
  it('box wholly inside a large room', () => {
    expect(boxIntersectsRoom({ minX: 180, minY: 180, maxX: 220, maxY: 220 }, room, ab)).toBe(true)
  })
  it('disjoint box', () => {
    expect(boxIntersectsRoom({ minX: 400, minY: 400, maxX: 500, maxY: 500 }, room, ab)).toBe(false)
  })
  it('applies the artboard offset', () => {
    const off = board('b', 1000, 0, [])
    expect(boxIntersectsRoom({ minX: 90, minY: 90, maxX: 110, maxY: 110 }, room, off)).toBe(false)
    expect(boxIntersectsRoom({ minX: 1090, minY: 90, maxX: 1110, maxY: 110 }, room, off)).toBe(true)
  })
})

describe('findRoomsInBox', () => {
  const a = board('a', 0, 0, [rect('r1', 0, 0, 100, 100)])
  const b = board('b', 0, 0, [rect('r2', 0, 0, 100, 100), rect('r3', 50, 50, 150, 150)])
  const box = { minX: 40, minY: 40, maxX: 60, maxY: 60 }
  it('uses the preferred artboard when it has matches', () => {
    expect(findRoomsInBox(box, [a, b], 'b')).toEqual({ artboardId: 'b', roomIds: ['r2', 'r3'] })
  })
  it('falls back to the first artboard with matches', () => {
    expect(findRoomsInBox(box, [a, b], 'zzz')).toEqual({ artboardId: 'a', roomIds: ['r1'] })
    expect(findRoomsInBox(box, [a, b])).toEqual({ artboardId: 'a', roomIds: ['r1'] })
  })
  it('returns null when nothing matches', () => {
    expect(findRoomsInBox({ minX: 900, minY: 900, maxX: 950, maxY: 950 }, [a, b])).toBeNull()
  })
})

describe('findArtboardAtPoint', () => {
  const a = board('a', 0, 0, [])
  const b = board('b', 100, 100, [])
  it('returns the artboard whose frame contains the point', () => {
    expect(findArtboardAtPoint({ x: 10, y: 10 }, [a, b])?.id).toBe('a')
  })
  it('prefers the last drawn on overlap', () => {
    expect(findArtboardAtPoint({ x: 200, y: 200 }, [a, b])?.id).toBe('b')
  })
  it('returns null outside every frame', () => {
    expect(findArtboardAtPoint({ x: 5000, y: 5000 }, [a, b])).toBeNull()
  })
})

describe('findWallsInBox', () => {
  // One 100 x 100 room: edges 0 (top), 1 (right), 2 (bottom), 3 (left).
  const a = board('a', 0, 0, [rect('r1', 0, 0, 100, 100)])
  it('finds nothing when every edge is partly outside', () => {
    expect(findWallsInBox({ minX: 40, minY: 40, maxX: 60, maxY: 60 }, a)).toEqual([])
  })
  it('finds the edges whose two end vertices are both inside', () => {
    // Edge 0 (top) keeps both ends inside; edges 1, 2 and 3 keep one end at y = 100, outside.
    expect(findWallsInBox({ minX: -10, minY: -10, maxX: 110, maxY: 60 }, a)).toEqual([
      { kind: 'wall', roomId: 'r1', edgeIndex: 0 },
    ])
  })
  it('needs both end vertices inside, so one vertex inside is not enough', () => {
    // Box covers the top-left corner only: edges 0 and 3 each keep one end outside.
    expect(findWallsInBox({ minX: -10, minY: -10, maxX: 50, maxY: 50 }, a)).toEqual([])
  })
  it('finds all edges when the box contains the room', () => {
    expect(findWallsInBox({ minX: -10, minY: -10, maxX: 110, maxY: 110 }, a)).toHaveLength(4)
  })
  it('returns [] for a box outside the room', () => {
    expect(findWallsInBox({ minX: 500, minY: 500, maxX: 600, maxY: 600 }, a)).toEqual([])
  })
  it('covers the edges of every room of the artboard', () => {
    const two = board('b', 0, 0, [rect('r1', 0, 0, 100, 100), rect('r2', 200, 0, 300, 100)])
    expect(findWallsInBox({ minX: -10, minY: -10, maxX: 110, maxY: 110 }, two)).toEqual([
      { kind: 'wall', roomId: 'r1', edgeIndex: 0 },
      { kind: 'wall', roomId: 'r1', edgeIndex: 1 },
      { kind: 'wall', roomId: 'r1', edgeIndex: 2 },
      { kind: 'wall', roomId: 'r1', edgeIndex: 3 },
    ])
  })
  it('is empty for an artboard with no room', () => {
    expect(findWallsInBox({ minX: -10, minY: -10, maxX: 110, maxY: 110 }, board('c', 0, 0, []))).toEqual([])
  })
})

describe('findOpeningsInBox', () => {
  const a = withOpenings(board('a', 0, 0, [rect('r1', 0, 0, 100, 100)]), [
    opening('o1', 50, 0),
    opening('o2', 100, 50),
    opening('o3', 50, 100),
    opening('o4', 900, 900),
  ])
  it('takes the openings whose centre is inside the box', () => {
    expect(findOpeningsInBox({ minX: 40, minY: -10, maxX: 60, maxY: 10 }, a)).toEqual([
      { kind: 'opening', openingId: 'o1' },
    ])
  })
  it('finds several openings inside one box', () => {
    expect(findOpeningsInBox({ minX: 40, minY: -10, maxX: 110, maxY: 10 }, a)).toEqual([
      { kind: 'opening', openingId: 'o1' },
    ])
    expect(findOpeningsInBox({ minX: 40, minY: -10, maxX: 110, maxY: 60 }, a)).toEqual([
      { kind: 'opening', openingId: 'o1' },
      { kind: 'opening', openingId: 'o2' },
    ])
  })
  it('ignores an opening whose centre is outside the box', () => {
    // The box touches o1's wall but holds no centre.
    expect(findOpeningsInBox({ minX: 10, minY: 0, maxX: 40, maxY: 5 }, a)).toEqual([])
    expect(findOpeningsInBox({ minX: 200, minY: 200, maxX: 300, maxY: 300 }, a)).toEqual([])
  })
  it('is empty for an artboard with no opening', () => {
    expect(findOpeningsInBox({ minX: -10, minY: -10, maxX: 110, maxY: 110 }, board('c', 0, 0, []))).toEqual([])
  })
})
