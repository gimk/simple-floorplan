import { describe, expect, it } from 'vitest'
import { calibrateScale, pixelAtWorld, worldOfPixel, type BgGeom } from './calibrate'
import { dist } from '../../model/geometry'

const bg: BgGeom = { xCm: 10, yCm: 20, naturalWidth: 1000, naturalHeight: 500, cmPerPx: 0.5, rotationDeg: 0 }

describe('calibrateScale', () => {
  it('scales about point A so A–B becomes the real length (no rotation)', () => {
    const a = { x: 110, y: 120 }, b = { x: 310, y: 120 } // 200 cm apart on screen
    const r = calibrateScale(bg, a, b, 400) // real length 400 cm -> factor 2
    expect(r.cmPerPx).toBeCloseTo(1)
    const next: BgGeom = { ...bg, ...r }
    const pa = pixelAtWorld(bg, a)
    const pb = pixelAtWorld(bg, b)
    const wa = worldOfPixel(next, pa)
    expect(wa.x).toBeCloseTo(a.x, 6)
    expect(wa.y).toBeCloseTo(a.y, 6)
    expect(dist(wa, worldOfPixel(next, pb))).toBeCloseTo(400, 6)
  })

  it('keeps point A fixed in world space when the image is rotated', () => {
    const rot: BgGeom = { ...bg, rotationDeg: 12 }
    const a = { x: 300, y: 200 }, b = { x: 450, y: 260 }
    const r = calibrateScale(rot, a, b, 250)
    const next: BgGeom = { ...rot, ...r }
    const wa = worldOfPixel(next, pixelAtWorld(rot, a))
    expect(wa.x).toBeCloseTo(a.x, 6)
    expect(wa.y).toBeCloseTo(a.y, 6)
    expect(dist(wa, worldOfPixel(next, pixelAtWorld(rot, b)))).toBeCloseTo(250, 6)
  })

  it('shrinks the image when the real length is smaller than the measured one', () => {
    const flat: BgGeom = { xCm: 0, yCm: 0, naturalWidth: 200, naturalHeight: 100, cmPerPx: 1, rotationDeg: 0 }
    const r = calibrateScale(flat, { x: 0, y: 0 }, { x: 100, y: 0 }, 50)
    expect(r.cmPerPx).toBeCloseTo(0.5)
    // center moves to A + 0.5*(center - A) = (50, 25); new half-size = (50, 25) -> top-left stays at A
    expect(r.xCm).toBeCloseTo(0, 6)
    expect(r.yCm).toBeCloseTo(0, 6)
  })

  it('is idempotent when the real length equals the current A–B distance', () => {
    const a = { x: 0, y: 0 }, b = { x: 300, y: 400 } // 500 cm
    const r = calibrateScale(bg, a, b, 500)
    expect(r.cmPerPx).toBeCloseTo(bg.cmPerPx, 9)
    expect(r.xCm).toBeCloseTo(bg.xCm, 6)
    expect(r.yCm).toBeCloseTo(bg.yCm, 6)
  })
})
