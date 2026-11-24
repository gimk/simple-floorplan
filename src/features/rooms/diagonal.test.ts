import { describe, expect, it } from 'vitest'
import type { PlanDoc, Room } from '../../model/types'
import { defaultDiagonal, diagonalPairs, nextDiagonal, setRoomDiagonal } from './diagonal'

const room = (n: number, extra: Partial<Room> = {}): Room => ({
  id: 'r', code: 'C2', name: 'Chambre 2', walkOrder: 1, holes: [], walls: {},
  vertices: Array.from({ length: n }, (_, i) => ({ id: `v${i}`, x: Math.cos(i) * 100, y: Math.sin(i) * 100 })),
  ...extra,
})
const doc = (r: Room, measurements: PlanDoc['measurements'] = {}): PlanDoc =>
  ({ projectId: 'p', title: 't', rooms: [r], elements: [], measurements, roomNotes: {}, tapes: [] } as unknown as PlanDoc)

describe('room diagonal', () => {
  it('lists the pairs of corners that are not neighbours', () => {
    expect(diagonalPairs(3)).toEqual([])
    expect(diagonalPairs(4)).toEqual([[0, 2], [1, 3]])
    expect(diagonalPairs(5)).toHaveLength(5)
  })
  it('starts at corner 1 and the corner across', () => {
    expect(defaultDiagonal(3)).toBeNull()
    expect(defaultDiagonal(4)).toEqual([0, 2])
    expect(defaultDiagonal(6)).toEqual([0, 3])
  })
  it('steps to the next pair and wraps', () => {
    expect(nextDiagonal(4, [0, 2])).toEqual([1, 3])
    expect(nextDiagonal(4, [1, 3])).toEqual([0, 2])
    expect(nextDiagonal(4, [3, 1])).toEqual([0, 2])
    expect(nextDiagonal(4, undefined)).toEqual([0, 2])
  })
  it('sets and removes the pair, and keeps a measured value', () => {
    const d = doc(room(4), { 'C2-D': { label: 'C2-D', actualCm: 442, updatedAt: '' } })
    const on = setRoomDiagonal(d, 'r', [0, 2])
    expect(on.rooms[0].diagonal).toEqual([0, 2])
    expect(on.measurements['C2-D'].actualCm).toBe(442)
    const off = setRoomDiagonal(on, 'r', null)
    expect(off.rooms[0].diagonal).toBeUndefined()
    expect(off.measurements['C2-D'].actualCm).toBe(442)
  })
})
