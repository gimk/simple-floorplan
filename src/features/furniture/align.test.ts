import { describe, expect, it } from 'vitest'
import type { FurnitureItem, Room } from '../../model/types'
import { alignFurnitureInRoom, findFurnitureRoom } from './align'

const room = (name: string, vertices: { x: number; y: number }[]) => ({ id: name, name, vertices }) as unknown as Room
const item = (p: Partial<FurnitureItem>) =>
  ({ id: 'f', name: 'f', shape: 'rect', xCm: 100, yCm: 100, widthCm: 40, depthCm: 20, rotationDeg: 0, color: '#fff', ...p }) as FurnitureItem

const rect = room('Rect', [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }, { x: 0, y: 300 }])
// L shape: wide bottom wing (y 200..400, x 0..400), narrow top wing (y 0..200, x 0..150).
const ell = room('L', [{ x: 0, y: 0 }, { x: 150, y: 0 }, { x: 150, y: 200 }, { x: 400, y: 200 }, { x: 400, y: 400 }, { x: 0, y: 400 }])

describe('findFurnitureRoom', () => {
  it('finds by centre, by corner, and returns null outside', () => {
    expect(findFurnitureRoom(item({}), [rect])).toBe(rect)
    expect(findFurnitureRoom(item({ xCm: -10, yCm: 100, widthCm: 60 }), [rect])).toBe(rect)
    expect(findFurnitureRoom(item({ xCm: 900, yCm: 900 }), [rect])).toBeNull()
  })
})

describe('alignFurnitureInRoom', () => {
  it('aligns in a rectangle', () => {
    const f = item({})
    expect(alignFurnitureInRoom(f, [rect], 'left', 1)).toEqual({ xCm: 20, yCm: 100 })
    expect(alignFurnitureInRoom(f, [rect], 'right', 1)).toEqual({ xCm: 380, yCm: 100 })
    expect(alignFurnitureInRoom(f, [rect], 'top', 1)).toEqual({ xCm: 100, yCm: 10 })
    expect(alignFurnitureInRoom(f, [rect], 'bottom', 1)).toEqual({ xCm: 100, yCm: 290 })
    expect(alignFurnitureInRoom(f, [rect], 'center-x', 1)).toEqual({ xCm: 200, yCm: 100 })
    expect(alignFurnitureInRoom(f, [rect], 'center-y', 1)).toEqual({ xCm: 100, yCm: 150 })
    expect(alignFurnitureInRoom(f, [rect], 'center', 1)).toEqual({ xCm: 200, yCm: 150 })
  })

  it('uses the rotated bounds', () => {
    const f = item({ rotationDeg: 90 }) // 20 wide, 40 tall on screen
    expect(alignFurnitureInRoom(f, [rect], 'left', 1)).toEqual({ xCm: 10, yCm: 100 })
    expect(alignFurnitureInRoom(f, [rect], 'top', 1)).toEqual({ xCm: 100, yCm: 20 })
  })

  it('uses ellipse bounds', () => {
    const f = item({ shape: 'circle', widthCm: 60, depthCm: 60 })
    expect(alignFurnitureInRoom(f, [rect], 'right', 1)).toEqual({ xCm: 370, yCm: 100 })
  })

  it('stays in the wing of an L-shaped room', () => {
    const top = item({ xCm: 70, yCm: 100 })
    expect(alignFurnitureInRoom(top, [ell], 'right', 1)).toEqual({ xCm: 130, yCm: 100 })
    expect(alignFurnitureInRoom(top, [ell], 'center', 1)).toEqual({ xCm: 75, yCm: 200 }) // column x=75 spans y 0..400
    const bottom = item({ xCm: 300, yCm: 300 })
    expect(alignFurnitureInRoom(bottom, [ell], 'top', 1)).toEqual({ xCm: 300, yCm: 210 })
    expect(alignFurnitureInRoom(bottom, [ell], 'center-x', 1)).toEqual({ xCm: 200, yCm: 300 })
  })

  it('rounds to precision and returns null outside', () => {
    expect(alignFurnitureInRoom(item({ widthCm: 41 }), [rect], 'left', 1)).toEqual({ xCm: 21, yCm: 100 })
    expect(alignFurnitureInRoom(item({ xCm: 900, yCm: 900 }), [rect], 'center', 1)).toBeNull()
  })
})
