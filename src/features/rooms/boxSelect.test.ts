import { describe, expect, it } from 'vitest'
import { selectItems } from '../../model/selection'
import type { Room } from '../../model/types'
import { boxOf, itemsInBox } from './boxSelect'

const box = (id: string, x0: number, y0: number, x1: number, y1: number): Room => ({
  id, code: id, name: id, walkOrder: 0, holes: [], walls: {},
  vertices: [{ id: id + 'a', x: x0, y: y0 }, { id: id + 'b', x: x1, y: y0 }, { id: id + 'c', x: x1, y: y1 }, { id: id + 'd', x: x0, y: y1 }],
})
const rooms = [box('A', 0, 0, 400, 300), box('B', 400, 0, 800, 300)]

describe('itemsInBox', () => {
  it('selects rooms fully inside first', () => {
    expect(itemsInBox(rooms, boxOf({ x: -10, y: -10 }, { x: 410, y: 310 }))).toEqual([{ kind: 'room', roomId: 'A' }])
  })
  it('selects walls with both ends inside when no room is inside', () => {
    expect(itemsInBox(rooms, boxOf({ x: 390, y: -10 }, { x: 410, y: 310 }))).toEqual([
      { kind: 'wall', roomId: 'A', wallStart: 'Ab' },
      { kind: 'wall', roomId: 'B', wallStart: 'Bd' },
    ])
  })
  it('selects points when no wall is inside', () => {
    expect(itemsInBox(rooms, boxOf({ x: 390, y: -10 }, { x: 410, y: 10 }))).toEqual([
      { kind: 'vertex', roomId: 'A', vertexId: 'Ab' },
      { kind: 'vertex', roomId: 'B', vertexId: 'Ba' },
    ])
  })
  it('is empty on empty space', () => {
    expect(itemsInBox(rooms, boxOf({ x: 1000, y: 0 }, { x: 1100, y: 100 }))).toEqual([])
  })
})

describe('selectItems', () => {
  const empty = { selection: null, multi: [] }
  const a = { kind: 'room' as const, roomId: 'A' }, b = { kind: 'room' as const, roomId: 'B' }
  it('replaces the selection', () => {
    expect(selectItems({ selection: a, multi: [] }, [b], false)).toEqual({ selection: b, multi: [] })
  })
  it('adds with Shift when the kind is the same', () => {
    expect(selectItems({ selection: a, multi: [] }, [b, a], true)).toEqual({ selection: b, multi: [a, b] })
  })
  it('clears on an empty box, keeps the selection with Shift', () => {
    expect(selectItems({ selection: a, multi: [] }, [], false)).toEqual(empty)
    expect(selectItems({ selection: a, multi: [] }, [], true)).toEqual({ selection: a, multi: [] })
  })
})
