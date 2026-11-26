import { describe, expect, it } from 'vitest'
import type { Artboard, Room } from '../../model/types'
import { boxFromPoints, boxIntersectsRoom, findArtboardAtPoint, findRoomsInBox } from './boxSelect'

const rect = (id: string, x0: number, y0: number, x1: number, y1: number): Room => ({
  id, name: id,
  vertices: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }],
})
const board = (id: string, xCm: number, yCm: number, rooms: Room[]): Artboard =>
  ({ id, name: id, xCm, yCm, rooms, openings: [], furniture: [], precisionCm: 1 }) as unknown as Artboard

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
