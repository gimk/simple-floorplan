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

describe('snap disableSnap and precisionCm (Phase 3.5A)', () => {
  it('uses precisionCm as the grid when gridCm is omitted', () => {
    expect(snapPoint({ x: 1003.3, y: 1007.2 }, [], { precisionCm: 0.5 }).point).toEqual({ x: 1003.5, y: 1007 })
    expect(snapPoint({ x: 1003.4, y: 1007.6 }, [], { precisionCm: 1 }).point).toEqual({ x: 1003, y: 1008 })
  })
  it('gridCm wins over precisionCm', () => {
    expect(snapPoint({ x: 1003, y: 1007 }, [], { gridCm: 10, precisionCm: 1 }).point).toEqual({ x: 1000, y: 1010 })
  })
  it('disableSnap skips vertex, wall, anchor and grid snapping', () => {
    const r = snapPoint({ x: 403.26, y: 4.7 }, [other], { disableSnap: true, anchor: { x: 400, y: 0 } })
    expect(r.point).toEqual({ x: 403.26, y: 4.7 })
    expect(r.guides).toEqual([])
  })
  it('disableSnap rounds to precisionCm when given', () => {
    const r = snapPoint({ x: 403.26, y: 4.74 }, [other], { disableSnap: true, precisionCm: 0.1 })
    expect(r.point.x).toBeCloseTo(403.3)
    expect(r.point.y).toBeCloseTo(4.7)
    expect(r.guides).toEqual([])
    expect(snapPoint({ x: 403.6, y: 4.4 }, [other], { disableSnap: true, precisionCm: 1 }).point).toEqual({ x: 404, y: 4 })
  })
  it('snapRoomDelta with disableSnap returns the raw or rounded delta and no guides', () => {
    const room = rect('m', 404, 0, 500, 100)
    expect(snapRoomDelta(room, -3.7, 2.2, [other]).guides.length).toBeGreaterThan(0)
    expect(snapRoomDelta(room, -3.7, 2.2, [other], 12, { disableSnap: true })).toEqual({ dx: -3.7, dy: 2.2, guides: [] })
    expect(snapRoomDelta(room, -3.7, 2.2, [other], 12, { disableSnap: true, precisionCm: 1 })).toEqual({ dx: -4, dy: 2, guides: [] })
  })
})

describe('gap snapping with wall thickness', () => {
  const t = 10
  it('snapPoint snaps to the edge offset outward by the wall thickness', () => {
    // `other` is a rectangle (see above); its right edge is at x = 400.
    const r = snapPoint({ x: 412, y: 50 }, [other], { wallThicknessCm: t, thresholdCm: 5, gridCm: 0 })
    expect(r.point.x).toBeCloseTo(410)
    expect(r.guides.some((g) => g.kind === 'line')).toBe(true)
  })
  it('snapPoint ignores the offset edge when no thickness is given', () => {
    const r = snapPoint({ x: 412, y: 50 }, [other], { thresholdCm: 5, gridCm: 0 })
    expect(r.point.x).toBeCloseTo(412)
  })
  it('snapRoomDelta snaps at +/- thickness gap and keeps flush alignment', () => {
    const room = rect('m', 414, 0, 500, 100)
    const gapSnap = snapRoomDelta(room, 0, 0, [other], 5, { wallThicknessCm: t })
    expect(gapSnap.dx).toBeCloseTo(-4) // left edge 414 -> 410
    const flush = snapRoomDelta(rect('m', 403, 0, 500, 100), 0, 0, [other], 5, { wallThicknessCm: t })
    expect(flush.dx).toBeCloseTo(-3) // flush at 400 wins: closer than 410
    const none = snapRoomDelta(room, 0, 0, [other], 5)
    expect(none.dx).toBe(0)
  })
})

describe('snapPoint with several connected anchors', () => {
  it('snaps x and y to different anchors, however far they are on the other axis', () => {
    // prev and next are 2000 cm apart on the perpendicular axis; both still align.
    const prev = { x: 1000, y: 0 }
    const next = { x: 0, y: 2000 }
    const r = snapPoint({ x: 1003, y: 1998 }, [], { anchors: [prev, next] })
    expect(r.point).toEqual({ x: 1000, y: 2000 })
    expect(r.guides).toHaveLength(2)
    // One vertical guide from prev down to the point, one horizontal guide from next to the point.
    expect(r.guides).toContainEqual({ kind: 'line', a: { x: 1000, y: 0 }, b: { x: 1000, y: 2000 } })
    expect(r.guides).toContainEqual({ kind: 'line', a: { x: 0, y: 2000 }, b: { x: 1000, y: 2000 } })
  })
  it('keeps the single anchor option working, mixed with anchors', () => {
    const r = snapPoint({ x: 1003, y: 7 }, [], { anchor: { x: 1000, y: 0 }, anchors: [{ x: 0, y: 5 }] })
    expect(r.point).toEqual({ x: 1000, y: 5 })
    expect(r.guides).toHaveLength(2)
  })
  it('takes the closest anchor when two are within the threshold on the same axis', () => {
    const far = { x: 1000, y: 0 }
    const near = { x: 1004, y: 500 }
    const r = snapPoint({ x: 1003, y: 250 }, [], { anchors: [far, near] })
    expect(r.point.x).toBe(1004)
    expect(r.guides).toContainEqual({ kind: 'line', a: { x: 1004, y: 500 }, b: { x: 1004, y: 250 } })
    // Same result when the list is given the other way round.
    expect(snapPoint({ x: 1003, y: 250 }, [], { anchors: [near, far] }).point.x).toBe(1004)
  })
  it('leaves an axis alone when no anchor is within the threshold', () => {
    const r = snapPoint({ x: 1003, y: 700 }, [], { anchors: [{ x: 1000, y: 100 }] })
    expect(r.point).toEqual({ x: 1000, y: 700 })
    expect(r.guides).toHaveLength(1)
  })
  it('aligns the free axis to a connected anchor while sliding on a horizontal wall of another room', () => {
    // `other` bottom wall is horizontal at y = 300, from x = 0 to 400.
    const prev = { x: 200, y: 0 }
    const next = { x: 150, y: 1000 }
    const r = snapPoint({ x: 203, y: 306 }, [other], { anchors: [prev, next], gridCm: 0 })
    expect(r.point.y).toBeCloseTo(300)
    expect(r.point.x).toBeCloseTo(200)
    expect(r.guides).toContainEqual({ kind: 'line', a: { x: 200, y: 0 }, b: { x: 200, y: 300 } })
    // An anchor outside the wall span is not used.
    const outside = snapPoint({ x: 203, y: 306 }, [other], { anchors: [{ x: 500, y: 0 }], gridCm: 0 })
    expect(outside.point.x).toBeCloseTo(203)
  })
  it('aligns the free axis to a connected anchor while sliding on a vertical wall of another room', () => {
    // `other` right wall is vertical at x = 400, from y = 0 to 300.
    const prev = { x: 0, y: 148 }
    const next = { x: 900, y: 260 }
    const r = snapPoint({ x: 395, y: 150 }, [other], { anchors: [prev, next], gridCm: 0 })
    expect(r.point.x).toBeCloseTo(400)
    expect(r.point.y).toBeCloseTo(148)
    expect(r.guides).toContainEqual({ kind: 'line', a: { x: 0, y: 148 }, b: { x: 400, y: 148 } })
    const outside = snapPoint({ x: 395, y: 150 }, [other], { anchors: [{ x: 0, y: 500 }], gridCm: 0 })
    expect(outside.point.y).toBeCloseTo(150)
  })
})
