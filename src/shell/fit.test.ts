// Tests of the fit rule (visual review V-5): the plan frames in the free box of the canvas, with a
// larger margin under it (the hint bar + the zoom pill) than on the other three sides.
import { describe, expect, it } from 'vitest'
import { FIT_BOTTOM_PAD, FIT_INSETS, FIT_PAD, fitInsetView } from './fit'
import { MAX_ZOOM, MIN_ZOOM } from './viewMath'

const B = { minX: 0, minY: 0, maxX: 1000, maxY: 500 }

/** Screen box of the plan in a viewport of w × h px. */
const screenBox = (b: typeof B, w: number, h: number, insets = FIT_INSETS) => {
  const v = fitInsetView(b, w, h, insets)
  return {
    v,
    left: (b.minX - v.x) * v.zoom,
    top: (b.minY - v.y) * v.zoom,
    right: w - (b.maxX - v.x) * v.zoom,
    bottom: h - (b.maxY - v.y) * v.zoom,
  }
}

describe('fitInsetView', () => {
  it('keeps 56 px under the plan for the hint bar, and 16 px on the other sides', () => {
    expect(FIT_PAD).toBe(16)
    expect(FIT_BOTTOM_PAD).toBe(56)
    // A tall plan: the height limits, 900 - 16 - 56 = 828 px of free box for 1600 cm.
    const tall = { minX: 0, minY: 0, maxX: 1000, maxY: 1600 }
    const { v, left, right, top, bottom } = screenBox(tall, 1440, 900)
    expect(v.zoom).toBeCloseTo(828 / 1600, 6)
    expect(bottom).toBeCloseTo(56, 6)
    expect(top).toBeCloseTo(16, 6)
    // The plan is narrower than the free box: centred, so each side gets more than 16 px.
    expect(left).toBeGreaterThan(16)
    expect(left).toBeCloseTo(right, 6)
  })

  it('leaves the same 56 px under the plan when the width limits', () => {
    // A wide plan: the width limits (1440 - 32 = 1408 px for 4000 cm).
    const b = { minX: 0, minY: 0, maxX: 4000, maxY: 500 }
    const { v, bottom, left, right } = screenBox(b, 1440, 900)
    expect(v.zoom).toBeCloseTo(1408 / 4000, 6)
    expect(left).toBeCloseTo(16, 6)
    expect(right).toBeCloseTo(16, 6)
    // The plan is short: centred in the free height, so more than 56 px left under it.
    expect(bottom).toBeGreaterThan(56)
  })

  it('never puts the bottom of the plan under the bottom bar', () => {
    for (const [w, h] of [[390, 844], [1440, 900], [768, 1000], [1920, 1080]]) {
      const { bottom, top, left, right } = screenBox(B, w, h)
      expect(bottom).toBeGreaterThanOrEqual(56 - 1e-9)
      expect(top).toBeGreaterThanOrEqual(16 - 1e-9)
      expect(left).toBeGreaterThanOrEqual(16 - 1e-9)
      expect(right).toBeGreaterThanOrEqual(16 - 1e-9)
    }
  })

  it('clamps the zoom, and keeps a finite view in a canvas smaller than its margins', () => {
    expect(fitInsetView({ minX: 0, minY: 0, maxX: 100000, maxY: 100000 }, 800, 600).zoom).toBe(MIN_ZOOM)
    expect(fitInsetView({ minX: 0, minY: 0, maxX: 1, maxY: 1 }, 800, 600).zoom).toBe(MAX_ZOOM)
    const v = fitInsetView({ minX: 0, minY: 0, maxX: 100, maxY: 100 }, 40, 40)
    expect(Number.isFinite(v.x)).toBe(true)
    expect(Number.isFinite(v.y)).toBe(true)
    expect(v.zoom).toBeGreaterThan(0)
  })

  it('takes any margins: equal margins centre the plan as before', () => {
    const { left, right, top, bottom } = screenBox(B, 1000, 500, { top: 0, right: 0, bottom: 0, left: 0 })
    for (const m of [left, right, top, bottom]) expect(m).toBeCloseTo(0, 6)
  })
})
