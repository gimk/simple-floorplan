import { describe, expect, it } from 'vitest'
import { FURNITURE_PRESETS } from '../furniture/presets'
import type { FurnitureItem } from '../../model/types'
import { RUG_LIFT_CM, RUG_MAX_HEIGHT_CM } from './buildScene'
import { deriveShades, furnitureArchetype, furnitureParts } from './furnitureSolids'
import type { FurnitureArchetype } from './furnitureSolids'

const EXPECTED: Record<string, FurnitureArchetype> = {
  bed: 'bed', 'single-bed': 'bed', 'bed-140': 'bed', 'bed-180': 'bed', 'baby-cot': 'cot', 'bedside-table': 'pedestal',
  sofa: 'sofa', armchair: 'sofa', 'sofa-2': 'sofa', 'corner-sofa': 'cornerSofa', 'dining-chair': 'chair', 'office-chair': 'officeChair',
  'dining-table': 'table', 'round-table': 'roundTable', 'coffee-table': 'table', desk: 'desk', 'dining-table-4': 'table', 'side-table': 'roundTable',
  wardrobe: 'tallStorage', bookshelf: 'bookshelf', 'chest-of-drawers': 'lowStorage', sideboard: 'lowStorage', 'tv-unit': 'tvUnit', 'shoe-cabinet': 'tallStorage',
  'kitchen-counter': 'counter', 'base-cabinet-60': 'counter', 'sink-unit': 'sink', cooker: 'cooker', dishwasher: 'appliance', fridge: 'appliance',
  'american-fridge': 'americanFridge', 'kitchen-island': 'counter', bathtub: 'bathtub', 'shower-tray': 'shower', toilet: 'toilet',
  washbasin: 'basin', 'double-washbasin': 'basin', 'washing-machine': 'drumAppliance', dryer: 'drumAppliance',
  rug: 'rug', 'rug-160': 'rug', 'round-rug': 'rug',
}

function item(p: (typeof FURNITURE_PRESETS)[number], extra: Partial<FurnitureItem> = {}): FurnitureItem {
  return {
    id: p.id, name: p.name, shape: p.shape, xCm: 0, yCm: 0, widthCm: p.widthCm, depthCm: p.depthCm,
    rotationDeg: 0, color: '#6b8fb5', heightCm: p.heightCm, ...extra,
  }
}
const radii = [0, 0, 0, 0] as [number, number, number, number]
const EPS = 1e-6

describe('furnitureSolids', () => {
  it('covers all 42 presets in the expected map', () => {
    expect(FURNITURE_PRESETS).toHaveLength(42)
    expect(Object.keys(EXPECTED).sort()).toEqual(FURNITURE_PRESETS.map((p) => p.id).sort())
  })

  for (const p of FURNITURE_PRESETS) {
    it(`${p.id}: archetype, valid parts, strictly inside the bounds`, () => {
      const f = item(p)
      const h = p.heightCm ?? 0
      const kind = furnitureArchetype(f, h)
      expect(kind).toBe(EXPECTED[p.id])
      expect(kind).not.toBe('box')
      const parts = furnitureParts(f, h, radii)
      expect(parts.length).toBeGreaterThanOrEqual(1)
      const lift = h <= RUG_MAX_HEIGHT_CM ? RUG_LIFT_CM : 0
      for (const part of parts) {
        expect(part.color).toMatch(/^#[0-9a-f]{6}$/)
        // A lying cylinder keeps its pre-rotation sizes: swap y and z for its extents.
        const lying = !!part.rotationX
        const ey = lying ? part.sz : part.sy, ez = lying ? part.sy : part.sz
        expect(part.cx - part.sx / 2).toBeGreaterThanOrEqual(-p.widthCm / 2 - EPS)
        expect(part.cx + part.sx / 2).toBeLessThanOrEqual(p.widthCm / 2 + EPS)
        expect(part.cy - ey / 2).toBeGreaterThanOrEqual(lift - EPS)
        expect(part.cy + ey / 2).toBeLessThanOrEqual(lift + h + EPS)
        expect(part.cz - ez / 2).toBeGreaterThanOrEqual(-p.depthCm / 2 - EPS)
        expect(part.cz + ez / 2).toBeLessThanOrEqual(p.depthCm / 2 + EPS)
        expect(part.sx).toBeGreaterThan(0)
      }
    })
  }

  it('uses 1 pillow under 110 cm and 2 pillows from 110 cm', () => {
    const pillows = (id: string) => {
      const p = FURNITURE_PRESETS.find((x) => x.id === id)!
      const frameTop = (p.heightCm ?? 0) * 0.72
      return furnitureParts(item(p), p.heightCm ?? 0, radii).filter((x) => Math.abs(x.cy - x.sy / 2 - frameTop) < 1e-6).length
    }
    expect(pillows('single-bed')).toBe(1)
    expect(pillows('bed-140')).toBe(2)
  })

  it('tv unit stands a flat-screen TV on a low cabinet', () => {
    const p = FURNITURE_PRESETS.find((x) => x.id === 'tv-unit')!
    const f = item(p, { presetId: 'tv-unit', widthCm: 180, depthCm: 40, heightCm: 120 })
    const parts = furnitureParts(f, 120, radii)
    // The TV panel reaches above the cabinet, and nothing leaves the item box.
    expect(parts.some((x) => x.cy + x.sy / 2 > 100)).toBe(true)
    for (const part of parts) {
      expect(part.cy - part.sy / 2).toBeGreaterThanOrEqual(-EPS)
      expect(part.cy + part.sy / 2).toBeLessThanOrEqual(120 + EPS)
    }
  })

  it('corner sofa reads as an L: the front corner opposite the chaise is empty', () => {
    const p = FURNITURE_PRESETS.find((x) => x.id === 'corner-sofa')!
    const parts = furnitureParts(item(p), 80, radii)
    const inFrontLeft = parts.some((x) => x.cx - x.sx / 2 < -p.widthCm / 4 && x.cz - x.sz / 2 < -p.depthCm / 4 && x.cy - x.sy / 2 < 80)
    expect(inFrontLeft).toBe(false)
    expect(parts.some((x) => x.cx + x.sx / 2 > p.widthCm / 2 - 1 && x.cz - x.sz / 2 < -p.depthCm / 4)).toBe(true)
  })

  it('mirrors cx on flipX and cz on flipY', () => {
    const p = FURNITURE_PRESETS.find((x) => x.id === 'corner-sofa')!
    const a = furnitureParts(item(p), 80, radii)
    const x = furnitureParts(item(p, { flipX: true }), 80, radii)
    const y = furnitureParts(item(p, { flipY: true }), 80, radii)
    expect(x).toHaveLength(a.length)
    a.forEach((part, i) => {
      expect(x[i].cx).toBeCloseTo(-part.cx)
      expect(x[i].cz).toBeCloseTo(part.cz)
      expect(y[i].cz).toBeCloseTo(-part.cz)
      expect(y[i].cx).toBeCloseTo(part.cx)
    })
  })

  it('falls back to one box for custom or renamed items', () => {
    const p = FURNITURE_PRESETS.find((x) => x.id === 'sofa')!
    const f = item(p, { name: 'My thing' })
    expect(furnitureArchetype(f, 80)).toBe('box')
    const parts = furnitureParts(f, 80, radii)
    expect(parts).toHaveLength(1)
    expect(parts[0]).toMatchObject({ kind: 'box', sx: 220, sy: 80, sz: 95, cy: 40 })
    const round = furnitureParts(f, 80, [5, 5, 5, 5])
    expect(round[0].kind).toBe('roundedBox')
    expect(round[0].cornerRadiiCm).toEqual([5, 5, 5, 5])
    const circle = furnitureParts(item(p, { name: 'Pouf', shape: 'circle' }), 40, radii)
    expect(circle[0].kind).toBe('cylinder')
  })

  it('lifts a rug by RUG_LIFT_CM', () => {
    const p = FURNITURE_PRESETS.find((x) => x.id === 'rug')!
    const parts = furnitureParts(item(p), 1, radii)
    expect(parts).toHaveLength(1)
    expect(parts[0].cy).toBeCloseTo(RUG_LIFT_CM + 0.5)
    const unnamed = furnitureParts(item(p, { name: 'Mat' }), 1, radii)
    expect(unnamed[0].cy).toBeCloseTo(RUG_LIFT_CM + 0.5)
  })

  it('simplified mode returns one solid per item', () => {
    for (const id of ['bed', 'corner-sofa', 'bathtub', 'office-chair']) {
      const p = FURNITURE_PRESETS.find((x) => x.id === id)!
      const parts = furnitureParts(item(p), p.heightCm ?? 0, radii, { simplified: true })
      expect(parts).toHaveLength(1)
      expect(parts[0].color).toBe(deriveShades('#6b8fb5').base)
    }
  })

  it('derives ordered shades and survives a bad colour', () => {
    const s = deriveShades('#6b8fb5')
    const lum = (h: string) => parseInt(h.slice(1, 3), 16) + parseInt(h.slice(3, 5), 16) + parseInt(h.slice(5, 7), 16)
    expect(lum(s.light)).toBeGreaterThan(lum(s.base))
    expect(lum(s.dark)).toBeLessThan(lum(s.base))
    expect(lum(s.deep)).toBeLessThan(lum(s.dark))
    expect(deriveShades('nope').base).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('tells similar names apart', () => {
    const n = (name: string) => furnitureArchetype({ name }, 80)
    expect(n('Bedside Table')).toBe('pedestal')
    expect(n('Baby Cot')).toBe('cot')
    expect(n('Corner Sofa')).toBe('cornerSofa')
    expect(n('Office Chair')).toBe('officeChair')
    expect(n('Double Washbasin')).toBe('basin')
    expect(n('American Fridge')).toBe('americanFridge')
    expect(n('Sink Unit')).toBe('sink')
  })

  it('keeps every part finite and inside the box for tiny or zero sizes, odd colours and flips', () => {
    for (const p of FURNITURE_PRESETS) {
      for (const [w, d, h] of [[15, 15, 15], [15, 15, 1], [40, 30, 0], [200, 90, 5]]) {
        for (const flip of [false, true]) {
          const f = item(p, { widthCm: w, depthCm: d, color: 'not-a-colour', flipX: flip, flipY: flip })
          const parts = furnitureParts(f, h, radii)
          expect(parts.length).toBeGreaterThanOrEqual(1)
          const lift = h <= RUG_MAX_HEIGHT_CM ? RUG_LIFT_CM : 0
          for (const q of parts) {
            for (const v of [q.cx, q.cy, q.cz, q.sx, q.sy, q.sz]) expect(Number.isFinite(v)).toBe(true)
            const ey = q.rotationX ? q.sz : q.sy, ez = q.rotationX ? q.sy : q.sz
            expect(q.cx - q.sx / 2).toBeGreaterThanOrEqual(-w / 2 - EPS)
            expect(q.cx + q.sx / 2).toBeLessThanOrEqual(w / 2 + EPS)
            expect(q.cy - ey / 2).toBeGreaterThanOrEqual(lift - EPS)
            expect(q.cy + ey / 2).toBeLessThanOrEqual(lift + h + EPS)
            expect(q.cz - ez / 2).toBeGreaterThanOrEqual(-d / 2 - EPS)
            expect(q.cz + ez / 2).toBeLessThanOrEqual(d / 2 + EPS)
          }
        }
      }
    }
  })

  describe('tables', () => {
    const table = (extra: Partial<FurnitureItem>): FurnitureItem => ({
      id: 't', name: 'Dining Table', shape: 'rect', xCm: 0, yCm: 0, widthCm: 180, depthCm: 90,
      rotationDeg: 0, color: '#6b8fb5', heightCm: 75, ...extra,
    })
    const inside = (parts: ReturnType<typeof furnitureParts>, w: number, d: number, h: number) => {
      for (const q of parts) {
        expect(q.cx - q.sx / 2).toBeGreaterThanOrEqual(-w / 2 - EPS)
        expect(q.cx + q.sx / 2).toBeLessThanOrEqual(w / 2 + EPS)
        expect(q.cy - q.sy / 2).toBeGreaterThanOrEqual(-EPS)
        expect(q.cy + q.sy / 2).toBeLessThanOrEqual(h + EPS)
        expect(q.cz - q.sz / 2).toBeGreaterThanOrEqual(-d / 2 - EPS)
        expect(q.cz + q.sz / 2).toBeLessThanOrEqual(d / 2 + EPS)
      }
    }

    it('oval dining table: cylinder top and two balanced pedestals with feet', () => {
      const f = table({ shape: 'circle' })
      expect(furnitureArchetype(f, 75)).toBe('roundTable')
      const parts = furnitureParts(f, 75, radii)
      expect(parts.every((q) => q.kind === 'cylinder')).toBe(true)
      const top = parts.reduce((a, b) => (b.cy > a.cy ? b : a))
      expect(top).toMatchObject({ sx: 180, sz: 90 })
      const base = parts.filter((q) => q !== top)
      expect(base).toHaveLength(4)
      const xs = base.map((q) => q.cx)
      expect(Math.min(...xs)).toBeCloseTo(-Math.max(...xs))
      expect(Math.max(...xs)).toBeGreaterThan(20)
      inside(parts, 180, 90, 75)
    })

    it('round dining table: cylinder top and one centre pedestal', () => {
      const f = table({ shape: 'circle', widthCm: 120, depthCm: 120 })
      const parts = furnitureParts(f, 75, radii)
      expect(parts).toHaveLength(3)
      expect(parts.every((q) => q.kind === 'cylinder')).toBe(true)
      expect(parts.some((q) => q.sx === 120 && q.sz === 120)).toBe(true)
      expect(parts.filter((q) => q.sx < 120).every((q) => q.cx === 0 && q.cz === 0)).toBe(true)
      inside(parts, 120, 120, 75)
    })

    it('rounded rect dining table: roundedBox top, legs inset inside the curve', () => {
      const r = 40
      const f = table({})
      const parts = furnitureParts(f, 75, [r, r, r, r])
      const top = parts.find((q) => q.kind === 'roundedBox')!
      expect(top.cornerRadiiCm).toEqual([r, r, r, r])
      const legs = parts.filter((q) => q.kind === 'box')
      expect(legs).toHaveLength(4)
      const plain = furnitureParts(f, 75, radii).filter((q) => q.kind === 'box' && q.sy > 50)
      expect(Math.abs(legs[0].cx)).toBeLessThan(Math.abs(plain[0].cx))
      // Leg outer corner must be inside the arc of the rounded corner.
      for (const q of legs) {
        const ox = Math.abs(q.cx) + q.sx / 2 - (90 - r), oz = Math.abs(q.cz) + q.sz / 2 - (45 - r)
        if (ox > 0 && oz > 0) expect(Math.hypot(ox, oz)).toBeLessThanOrEqual(r)
      }
      inside(parts, 180, 90, 75)
    })
  })

  it('bed, sofa and corner sofa solids do not overlap (no coplanar faces)', () => {
    for (const id of ['bed-140', 'sofa', 'corner-sofa']) {
      const p = FURNITURE_PRESETS.find((x) => x.id === id)!
      const parts = furnitureParts(item(p), p.heightCm ?? 0, radii)
      for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) {
        const a = parts[i], b = parts[j]
        const ov = (c1: number, s1: number, c2: number, s2: number) => Math.min(c1 + s1 / 2, c2 + s2 / 2) - Math.max(c1 - s1 / 2, c2 - s2 / 2)
        const inside = ov(a.cx, a.sx, b.cx, b.sx) > 1e-6 && ov(a.cy, a.sy, b.cy, b.sy) > 1e-6 && ov(a.cz, a.sz, b.cz, b.sz) > 1e-6
        // Cushions and pillows sit on the body; only same-level big solids must not intersect.
        if (a.color === b.color) continue
        if (inside) expect(`${id}: part ${i} and ${j} intersect`).toBe('')
      }
    }
  })
})

describe('furnitureArchetype with presetId', () => {
  for (const p of FURNITURE_PRESETS) {
    it(`${p.id}: keeps its archetype after a rename`, () => {
      const f = item(p, { name: 'Renamed Item', presetId: p.id })
      expect(furnitureArchetype(f, p.heightCm ?? 0)).toBe(EXPECTED[p.id])
    })
  }

  it('a circle dining-table still gives roundTable', () => {
    const f: FurnitureItem = { ...item(FURNITURE_PRESETS.find((p) => p.id === 'dining-table')!, { name: 'Renamed Item', presetId: 'dining-table' }), shape: 'circle' }
    expect(furnitureArchetype(f, 75)).toBe('roundTable')
  })

  it('legacy items without presetId still match by name', () => {
    expect(furnitureArchetype({ name: 'Sofa', shape: 'rect' }, 80)).toBe('sofa')
    expect(furnitureArchetype({ name: 'Renamed Item', shape: 'rect' }, 80)).toBe('box')
  })

  it('an unknown presetId falls back to the name', () => {
    expect(furnitureArchetype({ name: 'Bed', shape: 'rect', presetId: 'custom-123' }, 50)).toBe('bed')
    expect(furnitureArchetype({ name: 'Bed', shape: 'rect', presetId: 'toString' }, 50)).toBe('bed')
  })
})

describe('furnitureArchetype with a chosen model', () => {
  it('a stored model wins over the preset id and the name', () => {
    expect(furnitureArchetype({ name: 'Sofa', shape: 'rect', presetId: 'bed', model: 'desk' }, 75)).toBe('desk')
    expect(furnitureArchetype({ name: 'Thing', shape: 'circle', model: 'table' }, 75)).toBe('table')
  })
  it('an unknown model value falls back to automatic', () => {
    expect(furnitureArchetype({ name: 'Bed', shape: 'rect', model: 'nope' as never }, 50)).toBe('bed')
  })
})
