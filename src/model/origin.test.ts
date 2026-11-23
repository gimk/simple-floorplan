import { describe, expect, it } from 'vitest'
import { normalizeOrigin, originOffset } from './origin'
import { emptyDoc } from './store'
import type { PlanDoc, Room } from './types'

const room = (id: string, x0: number, y0: number, x1: number, y1: number): Room => ({
  id, code: id, name: id, walkOrder: 0, walls: {},
  vertices: [{ id: id + 'a', x: x0, y: y0 }, { id: id + 'b', x: x1, y: y0 }, { id: id + 'c', x: x1, y: y1 }, { id: id + 'd', x: x0, y: y1 }],
  holes: [[{ id: id + 'h', x: x0 + 10, y: y0 + 10 }, { id: id + 'i', x: x0 + 20, y: y0 + 10 }, { id: id + 'j', x: x0 + 20, y: y0 + 20 }]],
})

const doc = (): PlanDoc => ({
  ...emptyDoc(),
  rooms: [room('A', 100.5, 50.25, 400, 300), room('B', 400, -20, 600, 300)],
  tapes: [
    { id: 't1', a: { x: 200, y: 100 }, b: { x: 300, y: 100 } },
    { id: 't2', a: { x: 0, y: 0 }, b: { x: 0, y: 0 }, label: 'X', actualCm: 10 },
  ],
  pins: [{ id: 'p', at: { x: 150, y: 60 }, photoKeys: [], createdAt: '', updatedAt: '' }],
})

describe('origin', () => {
  it('finds the offset to the top-left corner of the rooms', () => {
    expect(originOffset(doc())).toEqual({ x: -100.5, y: 20 })
    expect(originOffset(emptyDoc())).toEqual({ x: 0, y: 0 })
  })

  it('moves everything placed, and puts the top-left corner at exactly 0,0', () => {
    const { doc: d, offset } = normalizeOrigin(doc())
    expect(offset).toEqual({ x: -100.5, y: 20 })
    const xs = d.rooms.flatMap((r) => r.vertices.map((v) => v.x)), ys = d.rooms.flatMap((r) => r.vertices.map((v) => v.y))
    expect(Math.min(...xs)).toBe(0)
    expect(Math.min(...ys)).toBe(0)
    expect(d.rooms[0].holes[0][0]).toMatchObject({ x: 10, y: 80.25 })
    expect(d.tapes[0].a).toEqual({ x: 99.5, y: 120 })
    expect(d.tapes[1].a).toEqual({ x: 0, y: 0 }) // unplaced tape stays
    expect(d.pins![0].at).toEqual({ x: 49.5, y: 80 })
  })

  it('does nothing when the plan is already at 0,0', () => {
    const first = normalizeOrigin(doc()).doc
    const again = normalizeOrigin(first)
    expect(again.doc).toBe(first)
    expect(again.offset).toEqual({ x: -0, y: -0 })
  })
})
