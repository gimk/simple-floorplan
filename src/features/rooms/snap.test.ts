import { describe, expect, it } from 'vitest'
import { snapPoint, type SnapOpts } from './snap'

const opts: SnapOpts = { grid: true, gridCm: 5, angles: true, vertices: true }

describe('snapPoint', () => {
  it('returns the point untouched when disabled', () => {
    const r = snapPoint({ x: 12.3, y: 7.7 }, { opts, tolCm: 10, disabled: true })
    expect(r.point).toEqual({ x: 12.3, y: 7.7 })
    expect(r.snapped).toBe(false)
  })
  it('snaps to the grid', () => {
    const r = snapPoint({ x: 12.4, y: 17.6 }, { opts, tolCm: 3 })
    expect(r.point).toEqual({ x: 10, y: 20 })
  })
  it('prefers an existing vertex over everything', () => {
    const r = snapPoint({ x: 101, y: 203 }, { opts, tolCm: 5, vertices: [{ x: 100, y: 200 }] })
    expect(r.point).toEqual({ x: 100, y: 200 })
    expect(r.guides[0].kind).toBe('vertex')
  })
  it('snaps to 90° from the previous vertex and grids the free coordinate', () => {
    const r = snapPoint({ x: 203, y: 2 }, { opts, tolCm: 6, refs: [{ x: 0, y: 0 }] })
    expect(r.point.y).toBeCloseTo(0)
    expect(r.point.x).toBe(205)
    expect(r.guides.some((g) => g.kind === 'angle')).toBe(true)
  })
  it('snaps to 45°', () => {
    const r = snapPoint({ x: 101, y: 98 }, { opts, tolCm: 6, refs: [{ x: 0, y: 0 }] })
    expect(r.point.x).toBeCloseTo(r.point.y)
    expect(r.point.x).toBeCloseTo(100)
  })
  it('aligns with the x of another vertex (wall extension)', () => {
    const r = snapPoint({ x: 301, y: 77 }, { opts: { ...opts, grid: false }, tolCm: 4, vertices: [{ x: 300, y: 0 }] })
    expect(r.point.x).toBe(300)
    expect(r.point.y).toBe(77)
    expect(r.guides[0].kind).toBe('x')
  })
  it('intersects a 90° ray with an alignment line', () => {
    const r = snapPoint({ x: 298, y: 2 }, { opts, tolCm: 6, refs: [{ x: 0, y: 0 }], vertices: [{ x: 300, y: 500 }] })
    expect(r.point.x).toBeCloseTo(300)
    expect(r.point.y).toBeCloseTo(0)
  })
  it('does nothing beyond tolerance when grid is off', () => {
    const r = snapPoint({ x: 50, y: 50 }, { opts: { ...opts, grid: false }, tolCm: 3, refs: [{ x: 0, y: 20 }], vertices: [{ x: 900, y: 900 }] })
    expect(r.point).toEqual({ x: 50, y: 50 })
    expect(r.snapped).toBe(false)
  })
})
