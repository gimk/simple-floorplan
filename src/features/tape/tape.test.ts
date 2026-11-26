import { describe, expect, it } from 'vitest'
import type { Artboard, FurnitureItem, Room } from '../../model/types'
import { fmtTapeCm, measureSegment, snapTapePoint } from './geometry'

const room = (id: string, x0: number, y0: number, x1: number, y1: number): Room => ({
  id, name: id,
  vertices: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }],
})

const item = (over: Partial<FurnitureItem> = {}): FurnitureItem => ({
  id: 'f1', name: 'Desk', shape: 'rect',
  xCm: 100, yCm: 100, widthCm: 80, depthCm: 40, rotationDeg: 0, color: '#94a3b8',
  ...over,
})

/** Artboard at (0, 0) holding one 400 x 300 room. */
const board = (over: Partial<Artboard> = {}): Artboard => ({
  id: 'a1', name: 'A1', xCm: 0, yCm: 0, ceilingHeightCm: 250, precisionCm: 0.1,
  rooms: [room('r1', 0, 0, 400, 300)], openings: [], furniture: [],
  ...over,
})

describe('measureSegment', () => {
  it('measures a 3-4-5 triangle', () => {
    const m = measureSegment({ x: 0, y: 0 }, { x: 30, y: 40 })
    expect(m.distCm).toBeCloseTo(50, 9)
    expect(m.dxCm).toBe(30)
    expect(m.dyCm).toBe(40)
    expect(m.angleDeg).toBeCloseTo(53.1301, 3)
  })

  it('keeps the signed deltas of the direction a -> b', () => {
    const m = measureSegment({ x: 100, y: 100 }, { x: 40, y: 130 })
    expect(m.dxCm).toBe(-60)
    expect(m.dyCm).toBe(30)
    expect(m.distCm).toBeCloseTo(Math.hypot(60, 30), 9)
    expect(m.angleDeg).toBeCloseTo(153.4349, 3)
  })

  it('normalizes the angle to [0, 360) with y pointing down', () => {
    expect(measureSegment({ x: 0, y: 0 }, { x: 10, y: 0 }).angleDeg).toBe(0)
    expect(measureSegment({ x: 0, y: 0 }, { x: 0, y: 10 }).angleDeg).toBe(90)
    expect(measureSegment({ x: 0, y: 0 }, { x: -10, y: 0 }).angleDeg).toBe(180)
    expect(measureSegment({ x: 0, y: 0 }, { x: 0, y: -10 }).angleDeg).toBe(270)
  })

  it('measures a zero-length segment', () => {
    const m = measureSegment({ x: 12, y: 34 }, { x: 12, y: 34 })
    expect(m).toEqual({ distCm: 0, dxCm: 0, dyCm: 0, angleDeg: 0 })
  })
})

describe('fmtTapeCm', () => {
  it('rounds to 0.1 cm with a dot', () => {
    expect(fmtTapeCm(142.46)).toBe('142.5 cm')
    expect(fmtTapeCm(142)).toBe('142 cm')
    expect(fmtTapeCm(0.04)).toBe('0 cm')
  })
})

describe('snapTapePoint', () => {
  it('does nothing when there is no candidate inside the threshold', () => {
    const r = snapTapePoint({ x: 200, y: 150 }, [board()], 10)
    expect(r).toEqual({ point: { x: 200, y: 150 }, snapped: false })
  })

  it('snaps to a room vertex and reports snapped', () => {
    const r = snapTapePoint({ x: 404, y: 297 }, [board()], 10)
    expect(r).toEqual({ point: { x: 400, y: 300 }, snapped: true })
  })

  it('adds the artboard offset to vertices and walls', () => {
    const ab = board({ xCm: 1000, yCm: 500 })
    expect(snapTapePoint({ x: 1003, y: 497 }, [ab], 10)).toEqual({ point: { x: 1000, y: 500 }, snapped: true })
    // Middle of the (world) bottom wall of that artboard.
    expect(snapTapePoint({ x: 1200, y: 804 }, [ab], 10)).toEqual({ point: { x: 1200, y: 800 }, snapped: true })
    // The same local point of a board at 0,0 is far from the moved one.
    expect(snapTapePoint({ x: 1003, y: 497 }, [board()], 10).snapped).toBe(false)
  })

  it('prefers a vertex over a closer wall point', () => {
    // The wall point (395, 0) is 4 cm away, the vertex (400, 0) is about 6.4 cm away.
    const r = snapTapePoint({ x: 395, y: 4 }, [board()], 10)
    expect(r).toEqual({ point: { x: 400, y: 0 }, snapped: true })
  })

  it('snaps to the closest point of a wall segment', () => {
    const r = snapTapePoint({ x: 200, y: 306 }, [board()], 10)
    expect(r.point.x).toBeCloseTo(200, 9)
    expect(r.point.y).toBeCloseTo(300, 9)
    expect(r.snapped).toBe(true)
  })

  it('snaps to a furniture corner', () => {
    // Corners of an 80 x 40 item centred on (100, 100): (60,80) (140,80) (140,120) (60,120).
    const ab = board({ rooms: [], furniture: [item()] })
    expect(snapTapePoint({ x: 58, y: 82 }, [ab], 10)).toEqual({ point: { x: 60, y: 80 }, snapped: true })
    expect(snapTapePoint({ x: 143, y: 118 }, [ab], 10)).toEqual({ point: { x: 140, y: 120 }, snapped: true })
  })

  it('rotates the furniture corners before snapping', () => {
    const ab = board({ xCm: 0, yCm: 0, rooms: [], furniture: [item({ rotationDeg: 90 })] })
    // 90 degrees: the corners move to (120,60) (120,140) (80,140) (80,60).
    const r = snapTapePoint({ x: 118, y: 62 }, [ab], 10)
    expect(r.snapped).toBe(true)
    expect(r.point.x).toBeCloseTo(120, 9)
    expect(r.point.y).toBeCloseTo(60, 9)
  })

  it('prefers a furniture corner over a closer wall point', () => {
    // The item corner (200, 300) sits on the bottom wall: the wall is 2 cm away, the corner 3.6 cm.
    const ab = board({ furniture: [item({ xCm: 240, yCm: 320 })] })
    expect(snapTapePoint({ x: 203, y: 298 }, [ab], 10)).toEqual({ point: { x: 200, y: 300 }, snapped: true })
  })

  it('projects onto the nearest 45 degree ray from the anchor with Shift', () => {
    const r = snapTapePoint({ x: 100, y: 90 }, [], 10, { anchor: { x: 0, y: 0 }, shift: true })
    expect(r.snapped).toBe(false)
    expect(r.point.x).toBeCloseTo(95.1315, 3)
    expect(r.point.y).toBeCloseTo(95.1315, 3)
    // 0 degrees stays horizontal, 90 degrees stays vertical (the radius is kept).
    const flat = snapTapePoint({ x: 120, y: 7 }, [], 10, { anchor: { x: 0, y: 0 }, shift: true }).point
    expect(flat.y).toBe(0)
    expect(flat.x).toBeCloseTo(Math.hypot(120, 7), 9)
    const up = snapTapePoint({ x: 8, y: 120 }, [], 10, { anchor: { x: 0, y: 0 }, shift: true }).point
    expect(up.x).toBe(0)
    expect(up.y).toBeCloseTo(Math.hypot(8, 120), 9)
  })

  it('does not constrain the angle with Shift when there is no anchor', () => {
    const r = snapTapePoint({ x: 100, y: 90 }, [], 10, { shift: true })
    expect(r).toEqual({ point: { x: 100, y: 90 }, snapped: false })
  })

  it('returns the point unchanged with disableSnap, whatever is nearby', () => {
    const r = snapTapePoint({ x: 404, y: 297 }, [board()], 10, { disableSnap: true })
    expect(r).toEqual({ point: { x: 404, y: 297 }, snapped: false })
  })

  it('keeps the Shift constraint when snapping is disabled', () => {
    const r = snapTapePoint({ x: 100, y: 90 }, [board()], 10, { anchor: { x: 0, y: 0 }, shift: true, disableSnap: true })
    expect(r.snapped).toBe(false)
    expect(r.point.x).toBeCloseTo(95.1315, 3)
  })

  it('uses the closest of several nearby vertices', () => {
    const ab = board({ rooms: [room('r1', 0, 0, 400, 300), room('r2', 404, 0, 800, 300)] })
    expect(snapTapePoint({ x: 401, y: 0 }, [ab], 10)).toEqual({ point: { x: 400, y: 0 }, snapped: true })
    expect(snapTapePoint({ x: 403, y: 0 }, [ab], 10)).toEqual({ point: { x: 404, y: 0 }, snapped: true })
  })

  it('ignores candidates outside the threshold', () => {
    expect(snapTapePoint({ x: 395, y: 5 }, [board()], 2).snapped).toBe(false)
    expect(snapTapePoint({ x: 395, y: 5 }, [board()], 20).snapped).toBe(true)
  })
})
