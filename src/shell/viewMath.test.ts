import { describe, expect, it } from 'vitest'
import { clampZoom, fitView, fmtScale, gridStep, MAX_ZOOM, MIN_ZOOM, scaleBarStep, wheelZoomFactor } from './viewMath'

describe('wheelZoomFactor', () => {
  it('caps a mouse notch to a small step', () => {
    expect(wheelZoomFactor(100)).toBeCloseTo(Math.exp(-0.15))
    expect(wheelZoomFactor(-100)).toBeCloseTo(Math.exp(0.15))
    expect(wheelZoomFactor(-100)).toBeLessThan(1.2)
  })
  it('keeps small trackpad pinch deltas as they are', () => {
    expect(wheelZoomFactor(-4)).toBeCloseTo(Math.exp(0.04))
  })
  it('converts line and page deltas to pixels before the cap', () => {
    expect(wheelZoomFactor(-3, 1)).toBeCloseTo(Math.exp(0.15))
    expect(wheelZoomFactor(0.5, 1)).toBeCloseTo(Math.exp(-0.08))
    expect(wheelZoomFactor(1, 2)).toBeCloseTo(Math.exp(-0.15))
  })
})

describe('clampZoom', () => {
  it('clamps to the allowed range', () => {
    expect(clampZoom(0.001)).toBe(MIN_ZOOM)
    expect(clampZoom(1000)).toBe(MAX_ZOOM)
    expect(clampZoom(2)).toBe(2)
  })
})

describe('fitView', () => {
  it('centers the bounds in the viewport', () => {
    const v = fitView({ minX: 0, minY: 0, maxX: 1000, maxY: 500 }, 1000, 500, 0)
    expect(v.zoom).toBeCloseTo(1) // bw=1000 -> 1000/1000 = 1, bh=500 -> 500/500 = 1
    expect(v.x).toBeCloseTo(0)
    expect(v.y).toBeCloseTo(0)
  })
  it('picks the limiting dimension and centers', () => {
    const v = fitView({ minX: 0, minY: 0, maxX: 1000, maxY: 500 }, 1000, 600, 0)
    expect(v.zoom).toBeCloseTo(1) // width limits: 1000/1000 = 1 < 600/500 = 1.2
    expect(v.x).toBeCloseTo(500 - 1000 / (2 * v.zoom))
    expect(v.y).toBeCloseTo(250 - 600 / (2 * v.zoom))
  })
  it('respects padding and clamps zoom', () => {
    const v = fitView({ minX: -100, minY: -100, maxX: 100, maxY: 100 }, 200, 200, 50)
    // usable = 100 px for 200 cm -> zoom 0.5
    expect(v.zoom).toBeCloseTo(0.5)
    const tiny = fitView({ minX: 0, minY: 0, maxX: 100000, maxY: 100000 }, 800, 600, 48)
    expect(tiny.zoom).toBe(MIN_ZOOM)
  })
})

describe('scaleBarStep', () => {
  it('picks a step whose screen width is near the target', () => {
    // zoom 1 px/cm -> want ~110 px -> 100 cm
    expect(scaleBarStep(1)).toBe(100)
    // zoom 0.2 px/cm -> 110 px target -> 500 cm = 100 px
    expect(scaleBarStep(0.2)).toBe(500)
    // zoom 10 px/cm -> 10 cm = 100 px
    expect(scaleBarStep(10)).toBe(10)
  })
  it('always returns a positive nice step', () => {
    for (const z of [MIN_ZOOM, 0.1, 1, 7, MAX_ZOOM]) {
      const s = scaleBarStep(z)
      expect(s).toBeGreaterThan(0)
    }
  })
})

describe('gridStep', () => {
  it('picks a step near the target screen spacing', () => {
    expect(gridStep(1)).toBe(25) // in-range px 20/25/50 -> 25 closest to 32
    expect(gridStep(0.1)).toBe(250) // 250 cm -> 25 px, closest to 32
    expect(gridStep(10)).toBe(2) // 2 cm -> 20 px (diff 12) beats 5 cm -> 50 px (diff 18)
  })
})

describe('fmtScale', () => {
  it('formats cm and m', () => {
    expect(fmtScale(50)).toBe('50 cm')
    expect(fmtScale(100)).toBe('1 m')
    expect(fmtScale(250)).toBe('2,5 m')
  })
})
