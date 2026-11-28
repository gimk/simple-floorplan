import { describe, expect, it } from 'vitest'
import type { FurnitureItem } from '../../model/types'
import { cachedPlanSymbolParts, planSymbolParts } from './planSymbol'

const item = (p: Partial<FurnitureItem> = {}): FurnitureItem => ({
  id: 'f', name: 'Bed', shape: 'rect', xCm: 0, yCm: 0, widthCm: 160, depthCm: 200, rotationDeg: 0, color: '#8a6b4a', heightCm: 50, ...p,
})

describe('planSymbolParts', () => {
  it('the plain box model gives no parts', () => {
    expect(planSymbolParts(item({ model: 'box' }))).toEqual([])
    expect(planSymbolParts(item({ name: 'Thing' }))).toEqual([])
  })

  it('a bed gives several parts inside the footprint, lowest top first', () => {
    const parts = planSymbolParts(item())
    expect(parts.length).toBeGreaterThan(2)
    for (const p of parts) {
      expect(Math.abs(p.x) + p.w / 2).toBeLessThanOrEqual(80 + 1e-6)
      expect(Math.abs(p.y) + p.h / 2).toBeLessThanOrEqual(100 + 1e-6)
    }
  })

  it('the stored model wins over the name', () => {
    expect(planSymbolParts(item({ name: 'Bed', model: 'box' }))).toEqual([])
    expect(planSymbolParts(item({ name: 'Thing', model: 'toilet', widthCm: 40, depthCm: 65, heightCm: 80 })).length).toBeGreaterThan(0)
  })

  it('mirror applies the flip; the default does not', () => {
    const flipped = item({ flipY: true })
    const plain = planSymbolParts(flipped)
    const mirrored = planSymbolParts(flipped, { mirror: true })
    expect(plain.map((p) => p.y)).toEqual(planSymbolParts(item()).map((p) => p.y))
    expect(mirrored.map((p) => p.y)).toEqual(plain.map((p) => -p.y))
  })

  it('caches per item object', () => {
    const it1 = item()
    expect(cachedPlanSymbolParts(it1)).toBe(cachedPlanSymbolParts(it1))
  })
})
