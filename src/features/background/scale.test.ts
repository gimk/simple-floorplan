import { describe, expect, it } from 'vitest'
import { resizeFromCorner, computeCmPerPx, cornerPx } from './scale'
import { worldOfPixel, type BgGeom } from './calibrate'
import { baseName, defaultCmPerPx, isImageFile, isPdfFile, topLeftForCenter } from './upload'

const bg: BgGeom = { xCm: 10, yCm: 20, naturalWidth: 400, naturalHeight: 300, cmPerPx: 1, rotationDeg: 0 }

describe('resizeFromCorner', () => {
  it('keeps the opposite corner fixed and doubles the scale', () => {
    const br = worldOfPixel(bg, cornerPx(bg, 2))
    const tl = worldOfPixel(bg, cornerPx(bg, 0))
    const r = resizeFromCorner(bg, 2, { x: tl.x + (br.x - tl.x) * 2, y: tl.y + (br.y - tl.y) * 2 })
    expect(r.cmPerPx).toBeCloseTo(2)
    const next = { ...bg, ...r }
    const tl2 = worldOfPixel(next, cornerPx(next, 0))
    expect(tl2.x).toBeCloseTo(tl.x); expect(tl2.y).toBeCloseTo(tl.y)
  })
  it('keeps the opposite corner fixed with rotation', () => {
    const rot = { ...bg, rotationDeg: 30 }
    const tr0 = worldOfPixel(rot, cornerPx(rot, 1))
    const bl0 = worldOfPixel(rot, cornerPx(rot, 3))
    const r = resizeFromCorner(rot, 3, { x: bl0.x + 50, y: bl0.y - 20 })
    const next = { ...rot, ...r }
    const tr1 = worldOfPixel(next, cornerPx(next, 1))
    expect(tr1.x).toBeCloseTo(tr0.x); expect(tr1.y).toBeCloseTo(tr0.y)
  })
})

describe('computeCmPerPx', () => {
  it('scales by real / measured', () => {
    expect(computeCmPerPx(bg, { x: 0, y: 0 }, { x: 100, y: 0 }, 300)).toBeCloseTo(3)
  })
  it('rejects zero distance or non-positive length', () => {
    expect(computeCmPerPx(bg, { x: 1, y: 1 }, { x: 1, y: 1 }, 100)).toBeNull()
    expect(computeCmPerPx(bg, { x: 0, y: 0 }, { x: 1, y: 0 }, 0)).toBeNull()
  })
})

describe('upload helpers', () => {
  it('default scale gives 1000 cm width', () => { expect(defaultCmPerPx(500) * 500).toBeCloseTo(1000) })
  it('centers', () => { expect(topLeftForCenter({ x: 0, y: 0 }, 100, 50)).toEqual({ xCm: -50, yCm: -25 }) })
  it('detects types', () => {
    expect(isPdfFile({ name: 'a.PDF', type: '' })).toBe(true)
    expect(isImageFile({ name: 'a.webp', type: '' })).toBe(true)
    expect(isImageFile({ name: 'a.txt', type: 'text/plain' })).toBe(false)
    expect(baseName('plan.v2.png')).toBe('plan.v2')
  })
})
