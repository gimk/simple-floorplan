import { describe, expect, it } from 'vitest'
import type { Opening, Room } from '../../model/types'
import { syncOpeningsForRoomChange, syncOpeningsForRoomMove } from './sync'

const rect = (id: string, x: number, y: number, w: number, h: number): Room => ({
  id, name: id, vertices: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }],
})
const door = (id: string, xCm: number, yCm: number, angleDeg = 0): Opening => ({ id, kind: 'door', xCm, yCm, angleDeg, widthCm: 90, hinge: 'left', swing: 'in' })
const shift = (r: Room, dx: number, dy: number): Room => ({ ...r, vertices: r.vertices.map((v) => ({ x: v.x + dx, y: v.y + dy })) })

describe('syncOpeningsForRoomMove', () => {
  it('moves an opening on a wall with the room', () => {
    const room = rect('a', 0, 0, 400, 300)
    const out = syncOpeningsForRoomMove([door('o', 100, 0)], room, shift(room, 50, 70))
    expect(out[0]).toMatchObject({ xCm: 150, yCm: 70, angleDeg: 0 })
  })

  it('keeps the same fraction t when a wall gets longer, and updates the angle', () => {
    const room = rect('a', 0, 0, 400, 300)
    const next: Room = { ...room, vertices: [{ x: 0, y: 0 }, { x: 800, y: 100 }, { x: 800, y: 300 }, { x: 0, y: 300 }] }
    const out = syncOpeningsForRoomMove([door('o', 100, 0)], room, next)
    expect(out[0].xCm).toBeCloseTo(200)
    expect(out[0].yCm).toBeCloseTo(25)
    expect(out[0].angleDeg).toBeCloseTo((Math.atan2(100, 800) * 180) / Math.PI)
  })

  it('leaves openings that are not on a wall of the room', () => {
    const room = rect('a', 0, 0, 400, 300)
    const far = door('o', 200, 150)
    const out = syncOpeningsForRoomMove([far], room, shift(room, 10, 10))
    expect(out[0]).toBe(far)
  })

  it('uses a 2 cm tolerance', () => {
    const room = rect('a', 0, 0, 400, 300)
    const out = syncOpeningsForRoomMove([door('near', 100, 1.5), door('far', 100, 3)], room, shift(room, 0, 10))
    expect(out[0].yCm).toBeCloseTo(10)
    expect(out[1].yCm).toBe(3)
  })

  it('keeps the opening side (no 180 degree flip) on a reversed wall', () => {
    const room = rect('a', 0, 0, 400, 300)
    const out = syncOpeningsForRoomMove([door('o', 100, 0, 180)], room, shift(room, 0, 5))
    expect(Math.abs(out[0].angleDeg)).toBeCloseTo(180)
  })
})

describe('syncOpeningsForRoomChange', () => {
  it('removes an opening whose only host room was deleted', () => {
    const a = rect('a', 0, 0, 400, 300)
    const out = syncOpeningsForRoomChange([door('o', 100, 0), door('free', 200, 150)], [a], [])
    expect(out.map((o) => o.id)).toEqual(['free'])
  })

  it('keeps an opening on a shared wall when the other room stays', () => {
    const a = rect('a', 0, 0, 400, 300)
    const b = rect('b', 400, 0, 300, 300)
    const o = door('o', 400, 150, 90)
    const out = syncOpeningsForRoomChange([o], [a, b], [b])
    expect(out).toEqual([o])
  })

  it('moves an opening with the moved room, leaves openings of unchanged rooms', () => {
    const a = rect('a', 0, 0, 400, 300)
    const b = rect('b', 1000, 0, 300, 300)
    const out = syncOpeningsForRoomChange([door('oa', 100, 0), door('ob', 1100, 0)], [a, b], [shift(a, 0, 20), b])
    expect(out[0].yCm).toBeCloseTo(20)
    expect(out[1].yCm).toBe(0)
  })

  it('keeps an opening on a wall that survives a cut (new room ids)', () => {
    const a = rect('a', 0, 0, 400, 300)
    const part = rect('a2', 0, 0, 200, 300)
    const out = syncOpeningsForRoomChange([door('on', 100, 0), door('gone', 300, 0)], [a], [part])
    expect(out.map((o) => o.id)).toEqual(['on'])
  })
})
