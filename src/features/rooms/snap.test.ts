import { describe, expect, it } from 'vitest'
import type { Room } from '../../model/types'
import { snapPoint, snapRoomDelta } from './snap'

const rect = (id: string, x0: number, y0: number, x1: number, y1: number): Room => ({
  id, name: id,
  vertices: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }],
})
const other = rect('o', 0, 0, 400, 300)

describe('snapPoint', () => {
  it('snaps to the grid (5 cm default)', () => {
    expect(snapPoint({ x: 1003, y: 1007 }, []).point).toEqual({ x: 1005, y: 1005 })
  })
  it('grid can be turned off or changed', () => {
    expect(snapPoint({ x: 1003, y: 1007 }, [], { gridCm: 0 }).point).toEqual({ x: 1003, y: 1007 })
    expect(snapPoint({ x: 1003, y: 1007 }, [], { gridCm: 10 }).point).toEqual({ x: 1000, y: 1010 })
  })
  it('snaps to a vertex first, with a point guide', () => {
    const r = snapPoint({ x: 405, y: 4 }, [other])
    expect(r.point).toEqual({ x: 400, y: 0 })
    expect(r.guides[0].kind).toBe('point')
  })
  it('snaps to a wall segment', () => {
    const r = snapPoint({ x: 203, y: 6 }, [other])
    expect(r.point.x).toBeCloseTo(203)
    expect(r.point.y).toBeCloseTo(0)
    expect(r.guides.some((g) => g.kind === 'line')).toBe(true)
  })
  it('ignores things beyond the threshold', () => {
    expect(snapPoint({ x: 200, y: -50 }, [other], { gridCm: 0 }).point).toEqual({ x: 200, y: -50 })
    expect(snapPoint({ x: 200, y: -8 }, [other], { gridCm: 0, thresholdCm: 5 }).point).toEqual({ x: 200, y: -8 })
  })
  it('aligns with the anchor horizontally and vertically', () => {
    const r = snapPoint({ x: 1003, y: 700 }, [], { anchor: { x: 1000, y: 100 } })
    expect(r.point).toEqual({ x: 1000, y: 700 })
    expect(r.guides).toHaveLength(1)
    const both = snapPoint({ x: 1003, y: 104 }, [], { anchor: { x: 1000, y: 100 } })
    expect(both.point).toEqual({ x: 1000, y: 100 })
  })
})

describe('snapRoomDelta', () => {
  it('pulls a room edge onto a neighbour edge', () => {
    // Room 100x100 at x 410..510 moved so it should sit against the wall at x=400.
    const room = rect('m', 410, 0, 510, 100)
    const r = snapRoomDelta(room, -5, 0, [other])
    expect(r.dx).toBe(-10)
    expect(r.dy).toBe(0)
    expect(r.guides.some((g) => g.kind === 'line')).toBe(true)
  })
  it('snaps both axes and gives a point guide at a corner', () => {
    const room = rect('m', 410, 310, 510, 410)
    const r = snapRoomDelta(room, -6, -6, [other])
    expect(r.dx).toBe(-10)
    expect(r.dy).toBe(-10)
    expect(r.guides.some((g) => g.kind === 'point')).toBe(true)
  })
  it('does nothing beyond the threshold or with no other rooms', () => {
    const room = rect('m', 1000, 1000, 1100, 1100)
    expect(snapRoomDelta(room, 7, 3, [other])).toEqual({ dx: 7, dy: 3, guides: [] })
    expect(snapRoomDelta(room, 7, 3, [])).toEqual({ dx: 7, dy: 3, guides: [] })
  })
  it('respects a custom threshold', () => {
    const room = rect('m', 420, 0, 520, 100)
    expect(snapRoomDelta(room, 0, 0, [other], 5).dx).toBe(0)
    expect(snapRoomDelta(room, 0, 0, [other], 25).dx).toBe(-20)
  })
})
