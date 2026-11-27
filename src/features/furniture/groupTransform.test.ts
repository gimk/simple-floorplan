// Pure group transform math tests: bounds of rotated items, corner/edge scale, Shift ratio,
// minimum size clamping, and group rotation around center. Units: cm, degrees.
import { describe, expect, it } from 'vitest'
import type { FurnitureItem } from '../../model/types'
import { MIN_FURNITURE_CM } from './geometry'
import { groupBounds, resizeGroupFromHandle, rotateGroupByDelta } from './groupTransform'
import type { FurnitureTransformStart } from './groupTransform'

const item = (p: Partial<FurnitureItem> = {}): FurnitureItem => ({
  id: 'f1',
  name: 'Sofa',
  shape: 'rect',
  xCm: 100,
  yCm: 100,
  widthCm: 100,
  depthCm: 50,
  rotationDeg: 0,
  color: '#4b5563',
  ...p,
})

const toStarts = (items: FurnitureItem[]): Map<string, FurnitureTransformStart> =>
  new Map(
    items.map((f) => [
      f.id,
      { xCm: f.xCm, yCm: f.yCm, widthCm: f.widthCm, depthCm: f.depthCm, rotationDeg: f.rotationDeg },
    ]),
  )

describe('groupBounds', () => {
  it('returns null for an empty list', () => {
    expect(groupBounds([])).toBeNull()
  })

  it('computes the union box of rotated items', () => {
    const sq = item({ id: 'f1', xCm: 100, yCm: 100, widthCm: 100, depthCm: 100, rotationDeg: 45 })
    const other = item({ id: 'f2', xCm: 300, yCm: 200, widthCm: 40, depthCm: 40, rotationDeg: 0 })
    const half = (100 * Math.SQRT2) / 2
    const b = groupBounds([sq, other])!
    expect(b.minX).toBeCloseTo(100 - half, 5)
    expect(b.minY).toBeCloseTo(100 - half, 5)
    expect(b.maxX).toBeCloseTo(320, 5)
    expect(b.maxY).toBeCloseTo(220, 5)
  })
})

describe('resizeGroupFromHandle', () => {
  it('scales centers and sizes from the opposite corner anchor', () => {
    const f1 = item({ id: 'f1', xCm: 150, yCm: 125, widthCm: 100, depthCm: 50, rotationDeg: 0 })
    const f2 = item({ id: 'f2', xCm: 250, yCm: 175, widthCm: 100, depthCm: 50, rotationDeg: 0 })
    // Bounds: x 100..300 (w=200), y 100..200 (h=100). Drag BR corner to (500, 400) -> sx=2, sy=3.
    const starts = toStarts([f1, f2])
    const bounds = groupBounds([f1, f2])!
    const res = resizeGroupFromHandle(starts, bounds, { sx: 1, sy: 1 }, { x: 500, y: 400 }, { shift: false })

    expect(res.get('f1')).toEqual({ xCm: 200, yCm: 175, widthCm: 200, depthCm: 150 })
    expect(res.get('f2')).toEqual({ xCm: 400, yCm: 325, widthCm: 200, depthCm: 150 })
  })

  it('scales rotated items along their own local axes without changing rotation', () => {
    // Item rotated 90 deg: local width runs along world Y, local depth runs along world X.
    const f1 = item({ id: 'f1', xCm: 150, yCm: 150, widthCm: 100, depthCm: 40, rotationDeg: 90 })
    const f2 = item({ id: 'f2', xCm: 250, yCm: 150, widthCm: 60, depthCm: 60, rotationDeg: 45 })
    const starts = toStarts([f1, f2])
    const bounds = groupBounds([f1, f2])!
    // Drag right edge to double width (sx = 2, sy = 1).
    const w0 = bounds.maxX - bounds.minX
    const res = resizeGroupFromHandle(starts, bounds, { sx: 1, sy: 0 }, { x: bounds.minX + 2 * w0, y: 0 }, { shift: false })

    const r1 = res.get('f1')!
    expect(r1.widthCm).toBeCloseTo(100, 5) // sy = 1 along local width
    expect(r1.depthCm).toBeCloseTo(80, 5) // sx = 2 along local depth

    const r2 = res.get('f2')!
    const expectedScale = Math.hypot(2 * Math.SQRT1_2, 1 * Math.SQRT1_2)
    expect(r2.widthCm).toBeCloseTo(60 * expectedScale, 5)
    expect(r2.depthCm).toBeCloseTo(60 * expectedScale, 5)
  })

  it('keeps the box ratio when Shift is held (bigger factor wins on corners)', () => {
    const f1 = item({ id: 'f1', xCm: 150, yCm: 125, widthCm: 100, depthCm: 50, rotationDeg: 0 })
    const f2 = item({ id: 'f2', xCm: 250, yCm: 175, widthCm: 100, depthCm: 50, rotationDeg: 0 })
    // Bounds: x 100..300 (w=200), y 100..200 (h=100).
    // Drag BR to (500, 250): raw sx = 2, raw sy = 1.5 -> Shift picks k = 2.
    const starts = toStarts([f1, f2])
    const bounds = groupBounds([f1, f2])!
    const res = resizeGroupFromHandle(starts, bounds, { sx: 1, sy: 1 }, { x: 500, y: 250 }, { shift: true })

    expect(res.get('f1')).toEqual({ xCm: 200, yCm: 150, widthCm: 200, depthCm: 100 })
    expect(res.get('f2')).toEqual({ xCm: 400, yCm: 250, widthCm: 200, depthCm: 100 })
  })

  it('enforces the minimum furniture size when dragged past the anchor', () => {
    const f1 = item({ id: 'f1', xCm: 150, yCm: 150, widthCm: 100, depthCm: 100, rotationDeg: 0 })
    const f2 = item({ id: 'f2', xCm: 250, yCm: 150, widthCm: 100, depthCm: 100, rotationDeg: 0 })
    const starts = toStarts([f1, f2])
    const bounds = groupBounds([f1, f2])!
    const res = resizeGroupFromHandle(starts, bounds, { sx: 1, sy: 1 }, { x: 0, y: 0 }, { shift: false })

    expect(res.get('f1')!.widthCm).toBeGreaterThanOrEqual(MIN_FURNITURE_CM)
    expect(res.get('f1')!.depthCm).toBeGreaterThanOrEqual(MIN_FURNITURE_CM)
  })

  it('alt keeps the group center fixed and scales 2x delta (with and without shift)', () => {
    // f1 at (150, 125) 100x50, f2 at (250, 175) 100x50 -> bounds x: 100..300 (w=200), y: 100..200 (h=100), center (200, 150).
    const f1 = item({ id: 'f1', xCm: 150, yCm: 125, widthCm: 100, depthCm: 50, rotationDeg: 0 })
    const f2 = item({ id: 'f2', xCm: 250, yCm: 175, widthCm: 100, depthCm: 50, rotationDeg: 0 })
    const starts = toStarts([f1, f2])
    const bounds = groupBounds([f1, f2])!

    // Drag BR to (400, 225): dx from center = 200 (sx = 2), dy from center = 75 (sy = 1.5).
    const res = resizeGroupFromHandle(starts, bounds, { sx: 1, sy: 1 }, { x: 400, y: 225 }, { shift: false, alt: true })
    expect(res.get('f1')).toEqual({ xCm: 100, yCm: 112.5, widthCm: 200, depthCm: 75 })
    expect(res.get('f2')).toEqual({ xCm: 300, yCm: 187.5, widthCm: 200, depthCm: 75 })

    // With shift + alt: bigger factor (sx = 2) wins -> both sx=2, sy=2 around center (200, 150).
    const resShift = resizeGroupFromHandle(starts, bounds, { sx: 1, sy: 1 }, { x: 400, y: 225 }, { shift: true, alt: true })
    expect(resShift.get('f1')).toEqual({ xCm: 100, yCm: 100, widthCm: 200, depthCm: 100 })
    expect(resShift.get('f2')).toEqual({ xCm: 300, yCm: 200, widthCm: 200, depthCm: 100 })

    // Edge handle with alt: right edge dragged to 350 (dx from center = 150 -> sx = 1.5, sy = 1).
    const resEdge = resizeGroupFromHandle(starts, bounds, { sx: 1, sy: 0 }, { x: 350, y: 150 }, { shift: false, alt: true })
    expect(resEdge.get('f1')).toEqual({ xCm: 125, yCm: 125, widthCm: 150, depthCm: 50 })
    expect(resEdge.get('f2')).toEqual({ xCm: 275, yCm: 175, widthCm: 150, depthCm: 50 })
  })
})

describe('rotateGroupByDelta', () => {
  it('rotates all items 90 degrees clockwise around the box center and normalizes angles', () => {
    const f1 = item({ id: 'f1', xCm: 100, yCm: 100, widthCm: 60, depthCm: 40, rotationDeg: 0 })
    const f2 = item({ id: 'f2', xCm: 300, yCm: 100, widthCm: 60, depthCm: 40, rotationDeg: 300 })
    const starts = toStarts([f1, f2])
    const center = { x: 200, y: 100 }
    // Center is (200, 100). f1 at (100, 100) -> (200, 0); f2 at (300, 100) -> (200, 200).
    const res = rotateGroupByDelta(starts, center, 90)

    expect(res.get('f1')!.xCm).toBeCloseTo(200, 5)
    expect(res.get('f1')!.yCm).toBeCloseTo(0, 5)
    expect(res.get('f1')!.rotationDeg).toBe(90)

    expect(res.get('f2')!.xCm).toBeCloseTo(200, 5)
    expect(res.get('f2')!.yCm).toBeCloseTo(200, 5)
    expect(res.get('f2')!.rotationDeg).toBe(30)
  })
})
