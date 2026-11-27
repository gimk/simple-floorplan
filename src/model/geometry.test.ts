import { describe, expect, it } from 'vitest'
import { area, boxFits, centroid, fmtCm, innerRing, labelPlacement, labelPoint, pointInPolygon, projectOnSegment } from './geometry'

const P = (...xy: number[]) => Array.from({ length: xy.length / 2 }, (_, i) => ({ x: xy[2 * i], y: xy[2 * i + 1] }))

describe('basic helpers', () => {
  it('computes area, centroid and formatting', () => {
    const r = P(0, 0, 400, 0, 400, 300, 0, 300)
    expect(area(r)).toBe(120000)
    expect(centroid(r)).toEqual({ x: 200, y: 150 })
    expect(fmtCm(412.54)).toBe('412,5')
    expect(fmtCm(412)).toBe('412')
  })
  it('projects a point on a segment and tests containment', () => {
    const p = projectOnSegment({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })
    expect(p.t).toBeCloseTo(0.5)
    expect(p.distance).toBeCloseTo(3)
    expect(pointInPolygon({ x: 1, y: 1 }, P(0, 0, 4, 0, 4, 4, 0, 4))).toBe(true)
    expect(pointInPolygon({ x: 9, y: 1 }, P(0, 0, 4, 0, 4, 4, 0, 4))).toBe(false)
  })
})

describe('innerRing', () => {
  it('moves a rectangle in by half the thickness', () => {
    const r = P(0, 0, 400, 0, 400, 300, 0, 300)
    expect(innerRing(r, r.map(() => 5))).toEqual(P(5, 5, 395, 5, 395, 295, 5, 295))
  })
  it('works in both winding directions and at a reflex corner', () => {
    const L = P(0, 0, 400, 0, 400, 200, 200, 200, 200, 400, 0, 400)
    const a = innerRing(L, L.map(() => 5))
    const b = innerRing([...L].reverse(), L.map(() => 5)).reverse()
    a.forEach((p, i) => { expect(p.x).toBeCloseTo(b[i].x); expect(p.y).toBeCloseTo(b[i].y) })
    expect(a[3]).toEqual({ x: 195, y: 195 })
    expect(a[0]).toEqual({ x: 5, y: 5 })
  })
})


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
  it('caches a single ring and still sees a ring moved in place', () => {
    const r = P(0, 0, 400, 0, 400, 300, 0, 300)
    const first = labelPoint([r])
    expect(first).toEqual({ x: 200, y: 150 })
    // Same array, same coordinates: the cached point comes back, and the caller may write to it.
    const again = labelPoint([r])
    expect(again).toEqual(first)
    expect(again).not.toBe(first)
    again.x = -1
    expect(labelPoint([r])).toEqual({ x: 200, y: 150 })
    // Same array, new coordinates: the stale point must not be reused.
    for (const v of r) { v.x += 100 }
    expect(labelPoint([r])).toEqual({ x: 300, y: 150 })
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
