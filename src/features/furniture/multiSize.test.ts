// Multi-selection size editing (right-panel card for several furniture items): a shared value is
// written as one number, a field with different values stays blank ("Mixed"), a circle stays round
// and the width / depth limits of the single item card apply. Units: cm.
import { describe, expect, it } from 'vitest'
import type { FurnitureItem } from '../../model/types'
import {
  allCircles,
  clampSizeCm,
  commonSizeCm,
  isSizeValueValid,
  sizeOf,
  sizePatch,
  sizePatches,
} from './multiSize'
import { MAX_FURNITURE_CM, MIN_FURNITURE_CM } from './geometry'

const item = (p: Partial<FurnitureItem> = {}): FurnitureItem => ({
  id: 'f1',
  name: 'Sofa',
  shape: 'rect',
  xCm: 100,
  yCm: 200,
  widthCm: 100,
  depthCm: 50,
  rotationDeg: 0,
  color: '#4b5563',
  ...p,
})

const circle = (p: Partial<FurnitureItem> = {}): FurnitureItem => item({ id: 'c1', shape: 'circle', widthCm: 80, depthCm: 80, ...p })

describe('allCircles', () => {
  it('is true only when every item is a circle', () => {
    expect(allCircles([circle(), circle({ id: 'c2' })])).toBe(true)
    expect(allCircles([circle(), item()])).toBe(false)
    expect(allCircles([item(), item({ id: 'f2' })])).toBe(false)
  })

  it('is false for an empty selection', () => {
    expect(allCircles([])).toBe(false)
  })
})

describe('sizeOf', () => {
  it('reads width, depth and the effective height', () => {
    const f = item({ widthCm: 120, depthCm: 60, heightCm: 95 })
    expect(sizeOf(f, 'width')).toBe(120)
    expect(sizeOf(f, 'depth')).toBe(60)
    expect(sizeOf(f, 'height')).toBe(95)
  })

  it('uses the default height when heightCm is omitted', () => {
    expect(sizeOf(item(), 'height')).toBe(80)
  })
})

describe('commonSizeCm', () => {
  it('returns the shared width and depth', () => {
    const items = [item({ id: 'a', widthCm: 120, depthCm: 60 }), item({ id: 'b', widthCm: 120, depthCm: 60 })]
    expect(commonSizeCm(items, 'width')).toBe(120)
    expect(commonSizeCm(items, 'depth')).toBe(60)
  })

  it('returns null (mixed) when one width or one depth differs', () => {
    const widths = [item({ id: 'a', widthCm: 120 }), item({ id: 'b', widthCm: 140 })]
    expect(commonSizeCm(widths, 'width')).toBeNull()
    const depths = [item({ id: 'a', depthCm: 60 }), item({ id: 'b', depthCm: 70 })]
    expect(commonSizeCm(depths, 'depth')).toBeNull()
  })

  it('counts an omitted heightCm with its default, so it is not mixed', () => {
    const items = [item({ id: 'a' }), item({ id: 'b', heightCm: 80 })]
    expect(commonSizeCm(items, 'height')).toBe(80)
  })

  it('returns null when the stored heights differ', () => {
    const items = [item({ id: 'a', heightCm: 80 }), item({ id: 'b', heightCm: 120 })]
    expect(commonSizeCm(items, 'height')).toBeNull()
  })

  it('returns null for an empty selection', () => {
    expect(commonSizeCm([], 'width')).toBeNull()
    expect(commonSizeCm([], 'height')).toBeNull()
  })
})

describe('sizePatch on a rect', () => {
  it('writes the width only', () => {
    expect(sizePatch(item(), 'width', 140)).toEqual({ widthCm: 140 })
  })

  it('writes the depth only', () => {
    expect(sizePatch(item(), 'depth', 70)).toEqual({ depthCm: 70 })
  })

  it('writes the height', () => {
    expect(sizePatch(item(), 'height', 95)).toEqual({ heightCm: 95 })
  })

  it('is a no-op when the value is the stored one', () => {
    expect(sizePatch(item(), 'width', 100)).toBeNull()
    expect(sizePatch(item(), 'depth', 50)).toBeNull()
    expect(sizePatch(item({ heightCm: 95 }), 'height', 95)).toBeNull()
  })

  it('keeps the precision of the typed value', () => {
    expect(sizePatch(item(), 'width', 42.55)).toEqual({ widthCm: 42.55 })
  })
})

describe('sizePatch on a circle', () => {
  it('sets both sides on a width edit, so the circle stays round', () => {
    expect(sizePatch(circle(), 'width', 120)).toEqual({ widthCm: 120, depthCm: 120 })
  })

  it('sets both sides on a depth edit too', () => {
    expect(sizePatch(circle(), 'depth', 120)).toEqual({ depthCm: 120, widthCm: 120 })
  })

  it('makes an oval round again', () => {
    expect(sizePatch(circle({ widthCm: 100, depthCm: 50 }), 'depth', 60)).toEqual({ depthCm: 60, widthCm: 60 })
  })

  it('is a no-op on a round circle, and only rounds an oval one', () => {
    expect(sizePatch(circle(), 'width', 80)).toBeNull()
    expect(sizePatch(circle({ widthCm: 100, depthCm: 50 }), 'width', 100)).toEqual({ depthCm: 100 })
  })
})

describe('sizePatches on a mixed rect + circle selection', () => {
  it('gives each item its own patch, in selection order', () => {
    const items = [item({ id: 'r1', widthCm: 100, depthCm: 50 }), circle({ id: 'c1', widthCm: 80 })]
    const patches = sizePatches(items, 'width', 200)
    expect([...patches.entries()]).toEqual([
      ['r1', { widthCm: 200 }],
      ['c1', { widthCm: 200, depthCm: 200 }],
    ])
  })

  it('patches only the items that change', () => {
    const items = [item({ id: 'r1', widthCm: 200 }), item({ id: 'r2', widthCm: 100 })]
    const patches = sizePatches(items, 'width', 200)
    expect([...patches.keys()]).toEqual(['r2'])
    expect(patches.get('r2')).toEqual({ widthCm: 200 })
  })

  it('returns an empty map when nothing changes (no undo step)', () => {
    const items = [item({ id: 'r1', widthCm: 200 }), circle({ id: 'c1', widthCm: 200, depthCm: 200 })]
    expect(sizePatches(items, 'width', 200).size).toBe(0)
  })

  it('patches the height of every item that differs', () => {
    const items = [item({ id: 'r1', heightCm: 80 }), circle({ id: 'c1', heightCm: 120 })]
    const patches = sizePatches(items, 'height', 100)
    expect(patches.get('r1')).toEqual({ heightCm: 100 })
    expect(patches.get('c1')).toEqual({ heightCm: 100 })
  })
})

describe('validation and clamping', () => {
  it('clamps a width and a depth to the size limits', () => {
    expect(sizePatch(item(), 'width', 5)).toEqual({ widthCm: MIN_FURNITURE_CM })
    expect(sizePatch(item(), 'width', 5000)).toEqual({ widthCm: MAX_FURNITURE_CM })
    expect(sizePatch(item(), 'depth', 1)).toEqual({ depthCm: MIN_FURNITURE_CM })
    expect(sizePatch(item(), 'depth', 9999)).toEqual({ depthCm: MAX_FURNITURE_CM })
  })

  it('clamps both sides of a circle to the size limits', () => {
    expect(sizePatch(circle(), 'width', 2)).toEqual({ widthCm: MIN_FURNITURE_CM, depthCm: MIN_FURNITURE_CM })
    expect(sizePatch(circle(), 'depth', 4000)).toEqual({ depthCm: MAX_FURNITURE_CM, widthCm: MAX_FURNITURE_CM })
  })

  it('clampSizeCm keeps a value already inside the limits', () => {
    expect(clampSizeCm(120)).toBe(120)
    expect(clampSizeCm(MIN_FURNITURE_CM)).toBe(MIN_FURNITURE_CM)
  })

  it('rejects an empty width or depth, like the single item card', () => {
    expect(isSizeValueValid('width', null)).toBe(false)
    expect(isSizeValueValid('depth', null)).toBe(false)
    expect(sizePatch(item(), 'width', null)).toBeNull()
    expect(sizePatch(item(), 'depth', null)).toBeNull()
  })

  it('rejects a height of zero or less', () => {
    expect(isSizeValueValid('height', 0)).toBe(false)
    expect(isSizeValueValid('height', -10)).toBe(false)
    expect(sizePatch(item(), 'height', 0)).toBeNull()
    expect(sizePatch(item(), 'height', -10)).toBeNull()
  })

  it('accepts an empty height and clears the stored height', () => {
    expect(isSizeValueValid('height', null)).toBe(true)
    expect(sizePatch(item({ heightCm: 120 }), 'height', null)).toEqual({ heightCm: undefined })
  })

  it('is a no-op when an item that stores no height is emptied', () => {
    expect(sizePatch(item(), 'height', null)).toBeNull()
  })

  it('is a no-op when the typed height is the default height', () => {
    // heightCm omitted = 80 cm; typing 80 must not store a redundant field.
    expect(sizePatch(item(), 'height', 80)).toBeNull()
  })
})
