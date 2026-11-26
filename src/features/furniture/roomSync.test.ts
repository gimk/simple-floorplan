import { describe, expect, it } from 'vitest'
import type { Artboard, FurnitureItem, Room } from '../../model/types'
import { furnitureIdsInRooms, translateFurnitureByIds } from './roomSync'

const rect = (id: string, x: number, y: number, w: number, h: number): Room => ({
  id, name: id, vertices: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }],
})

const item = (id: string, xCm: number, yCm: number): FurnitureItem => ({
  id, name: id, shape: 'rect', xCm, yCm, widthCm: 100, depthCm: 60, rotationDeg: 0, color: '#fff',
})

const artboard = (rooms: Room[], furniture: FurnitureItem[]): Artboard => ({
  id: 'ab', name: 'ab', xCm: 0, yCm: 0, ceilingHeightCm: 250, precisionCm: 1,
  rooms, openings: [], furniture,
})

describe('furnitureIdsInRooms', () => {
  it('finds the items inside a room and ignores the items outside', () => {
    const ab = artboard(
      [rect('a', 0, 0, 400, 300)],
      [item('in1', 100, 100), item('in2', 399, 299), item('out1', 500, 100), item('out2', -10, 150)],
    )
    expect([...furnitureIdsInRooms(ab, ['a'])].sort()).toEqual(['in1', 'in2'])
  })

  it('returns the union of the items of several rooms, without duplicates', () => {
    const ab = artboard(
      [
        rect('a', 0, 0, 400, 300),
        rect('b', 400, 0, 400, 300),
        rect('c', 0, 300, 400, 300),
      ],
      // `between` straddles the a/b wall at x = 400: its centre x = 400 is on the shared edge.
      [item('inA', 100, 100), item('inB', 500, 100), item('inC', 100, 400), item('between', 400, 150)],
    )
    const ids = furnitureIdsInRooms(ab, ['a', 'b'])
    const list = [...ids]
    expect(list).toHaveLength(new Set(list).size)
    expect(list).toContain('inA')
    expect(list).toContain('inB')
    expect(list).not.toContain('inC')
    for (const id of ['inA', 'inB']) expect(list.filter((x) => x === id)).toHaveLength(1)
  })

  it('ignores unknown room ids and an empty room list', () => {
    const ab = artboard([rect('a', 0, 0, 400, 300)], [item('in1', 100, 100)])
    expect(furnitureIdsInRooms(ab, []).size).toBe(0)
    expect(furnitureIdsInRooms(ab, ['missing']).size).toBe(0)
    expect([...furnitureIdsInRooms(ab, ['a', 'missing'])]).toEqual(['in1'])
  })
})

describe('translateFurnitureByIds', () => {
  it('shifts only the matched ids and leaves the other items untouched', () => {
    const furniture = [item('a', 10, 20), item('b', 30, 40)]
    const out = translateFurnitureByIds(furniture, new Set(['a']), 5, -7)
    expect(out).not.toBe(furniture)
    expect(out[0]).toMatchObject({ id: 'a', xCm: 15, yCm: 13 })
    expect(out[1]).toBe(furniture[1])
    // The input is not changed.
    expect(furniture[0]).toMatchObject({ xCm: 10, yCm: 20 })
  })

  it('keeps every other property of a moved item', () => {
    const src = { ...item('a', 0, 0), rotationDeg: 45, heightCm: 90, cornerRadiusCm: 4 }
    const out = translateFurnitureByIds([src], new Set(['a']), 100, 200)
    expect(out[0]).toEqual({ ...src, xCm: 100, yCm: 200 })
  })

  it('returns a copy unchanged when no id matches', () => {
    const furniture = [item('a', 10, 20)]
    const out = translateFurnitureByIds(furniture, new Set(['zzz']), 5, 5)
    expect(out).not.toBe(furniture)
    expect(out[0]).toBe(furniture[0])
  })
})
