import { describe, expect, it } from 'vitest'
import { boxFits, labelPlacement, labelPoint, pointInPolygon } from './geometry'

const P = (...xy: number[]) => Array.from({ length: xy.length / 2 }, (_, i) => ({ x: xy[2 * i], y: xy[2 * i + 1] }))

describe('labelPoint', () => {
  it('keeps the centre of a rectangle', () => {
    expect(labelPoint([P(0, 0, 400, 0, 400, 300, 0, 300)])).toEqual({ x: 200, y: 150 })
  })
  it('puts an L-shaped corridor label inside its widest arm, away from the walls', () => {
    // Thin arm 100 wide along the bottom, wide arm 200 wide on the left.
    const l = P(0, 0, 200, 0, 200, 400, 600, 400, 600, 500, 0, 500)
    const p = labelPoint([l])
    expect(pointInPolygon(p, l)).toBe(true)
    expect(p.x).toBeLessThan(200) // centroid is near the inner corner; the label goes into the wide arm
    expect(Math.min(p.x, 200 - p.x)).toBeGreaterThan(60)
  })
  it('avoids a hole at the centre', () => {
    const outer = P(0, 0, 400, 0, 400, 400, 0, 400)
    const hole = P(150, 150, 250, 150, 250, 250, 150, 250)
    const p = labelPoint([outer, hole])
    expect(pointInPolygon(p, hole)).toBe(false)
  })
})

describe('labelPlacement', () => {
  it('keeps a fitting label at the centre', () => {
    expect(labelPlacement([P(0, 0, 400, 0, 400, 300, 0, 300)], 100, 40)).toEqual({ p: { x: 200, y: 150 }, vertical: false })
  })
  it('turns the label in a narrow vertical corridor', () => {
    const r = labelPlacement([P(0, 0, 90, 0, 90, 500, 0, 500)], 150, 40)
    expect(r.vertical).toBe(true)
    expect(r.p.x).toBeCloseTo(45, 0)
  })
  it('moves the label into the part of an L where the box fits', () => {
    // A 300×300 room with a 60 cm wide corridor arm going right.
    const l = P(0, 0, 300, 0, 300, 120, 900, 120, 900, 180, 300, 180, 300, 300, 0, 300)
    const r = labelPlacement([l], 120, 40)
    expect(r.vertical).toBe(false)
    expect(boxFits(r.p, 120, 40, [l])).toBe(true)
  })
})
