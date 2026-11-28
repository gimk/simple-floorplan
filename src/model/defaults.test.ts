import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CEILING_HEIGHT_CM,
  DEFAULT_FURNITURE_HEIGHT_CM,
  DEFAULT_OPENING_HEIGHT_CM,
  DEFAULT_OPENING_SILL_CM,
  furnitureHeightCm,
  openingHeightCm,
  openingSillCm,
} from './defaults'
import { createDefaultProject, parseProjectDoc } from './schema'
import type { FurnitureItem, Opening, SavedView } from './types'

/** One opening of `kind`, with the optional vertical fields the test wants. */
const opening = (kind: Opening['kind'], extra: Partial<Opening> = {}): Opening => ({
  id: `o-${kind}`,
  kind,
  xCm: 0,
  yCm: 0,
  angleDeg: 0,
  widthCm: 90,
  ...extra,
})

/** One furniture item, with an optional height. */
const furniture = (extra: Partial<FurnitureItem> = {}): FurnitureItem => ({
  id: 'f1',
  name: 'Chair',
  shape: 'rect',
  xCm: 0,
  yCm: 0,
  widthCm: 50,
  depthCm: 50,
  rotationDeg: 0,
  color: '#abc',
  ...extra,
})

const view = (extra: Partial<SavedView> = {}): SavedView => ({
  id: 'v1',
  name: 'Kitchen corner',
  position: [100, 180, 250],
  target: [100, 0, 100],
  wallMode: 'cutaway',
  ...extra,
})

describe('defaults constants', () => {
  it('keeps the documented ceiling and furniture heights', () => {
    expect(DEFAULT_CEILING_HEIGHT_CM).toBe(250)
    expect(DEFAULT_FURNITURE_HEIGHT_CM).toBe(80)
  })

  it('keeps the documented opening defaults', () => {
    expect(DEFAULT_OPENING_HEIGHT_CM).toEqual({ door: 205, window: 120, opening: 210 })
    expect(DEFAULT_OPENING_SILL_CM).toEqual({ door: 0, window: 90, opening: 0 })
  })
})

describe('openingSillCm', () => {
  it('returns the default of each kind when the opening sets none', () => {
    expect(openingSillCm(opening('door'))).toBe(0)
    expect(openingSillCm(opening('window'))).toBe(90)
    expect(openingSillCm(opening('opening'))).toBe(0)
  })

  it('prefers the sill of the opening', () => {
    expect(openingSillCm(opening('window', { sillCm: 40 }))).toBe(40)
    expect(openingSillCm(opening('door', { sillCm: 15 }))).toBe(15)
  })

  it('never goes below 0', () => {
    expect(openingSillCm(opening('window', { sillCm: -30 }))).toBe(0)
  })

  it('stays below the ceiling when a ceiling height is given', () => {
    expect(openingSillCm(opening('window', { sillCm: 200 }), 150)).toBe(150)
    expect(openingSillCm(opening('window', { sillCm: 140 }), 250)).toBe(140)
  })

  it('ignores a ceiling height that is not a number or not positive', () => {
    expect(openingSillCm(opening('window', { sillCm: 200 }), Number.NaN)).toBe(200)
    expect(openingSillCm(opening('window', { sillCm: 200 }), 0)).toBe(200)
  })
})

describe('openingHeightCm', () => {
  it('returns the default of each kind when the opening sets none', () => {
    expect(openingHeightCm(opening('door'))).toBe(205)
    expect(openingHeightCm(opening('window'))).toBe(120)
    expect(openingHeightCm(opening('opening'))).toBe(210)
  })

  it('prefers the height of the opening', () => {
    expect(openingHeightCm(opening('door', { heightCm: 240 }))).toBe(240)
  })

  it('never goes below 0', () => {
    expect(openingHeightCm(opening('door', { heightCm: -10 }))).toBe(0)
  })

  it('clamps sill + height to the ceiling when one is given', () => {
    // A 120 cm window sill leaves 130 cm under a 250 cm ceiling: no clamp.
    expect(openingHeightCm(opening('window'), 250)).toBe(120)
    // Under a 150 cm ceiling the window keeps 150 - 90 = 60 cm.
    expect(openingHeightCm(opening('window'), 150)).toBe(60)
    // A 240 cm door under a 205 cm... ceiling of 200 cm: sill 0, so 200 cm.
    expect(openingHeightCm(opening('door', { heightCm: 240 }), 200)).toBe(200)
    // A custom sill is taken into account: 120 + 100 = 220 under a 200 cm ceiling -> 80 cm.
    expect(openingHeightCm(opening('door', { sillCm: 120, heightCm: 100 }), 200)).toBe(80)
  })

  it('gives 0 when the sill reaches the ceiling', () => {
    expect(openingHeightCm(opening('window', { sillCm: 250 }), 250)).toBe(0)
    expect(openingHeightCm(opening('window', { sillCm: 300 }), 250)).toBe(0)
  })

  it('keeps the default height with a ceiling, never above it', () => {
    const ceiling = DEFAULT_CEILING_HEIGHT_CM
    for (const kind of ['door', 'window', 'opening'] as const) {
      const o = opening(kind)
      expect(openingHeightCm(o, ceiling)).toBe(DEFAULT_OPENING_HEIGHT_CM[kind])
      expect(openingSillCm(o, ceiling) + openingHeightCm(o, ceiling)).toBeLessThanOrEqual(ceiling)
    }
  })

  it('ignores a ceiling height that is not a number or not positive', () => {
    expect(openingHeightCm(opening('door', { heightCm: 400 }), Number.NaN)).toBe(400)
    expect(openingHeightCm(opening('door', { heightCm: 400 }), 0)).toBe(400)
  })
})

describe('furnitureHeightCm', () => {
  it('falls back to the default height', () => {
    expect(furnitureHeightCm(furniture())).toBe(DEFAULT_FURNITURE_HEIGHT_CM)
  })

  it('prefers the height of the item', () => {
    expect(furnitureHeightCm(furniture({ heightCm: 200 }))).toBe(200)
    expect(furnitureHeightCm(furniture({ heightCm: 1 }))).toBe(1)
  })
})

describe('schema: Artboard.views', () => {
  it('parses an artboard with saved views and keeps them', () => {
    const d = createDefaultProject()
    d.artboards[0].views = [
      view(),
      view({ id: 'v2', name: 'Top', position: [0, 400, 0], target: [0, 0, 0], fov: 35, projection: 'ortho', wallMode: 'off' }),
    ]
    const r = parseProjectDoc(d)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.doc.artboards[0].views).toEqual(d.artboards[0].views)
  })

  it('accepts an artboard with no views (old documents)', () => {
    const d = createDefaultProject()
    delete d.artboards[0].views
    const r = parseProjectDoc(d)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.doc.artboards[0].views).toBeUndefined()
  })

  it('accepts an empty views list', () => {
    const d = createDefaultProject()
    d.artboards[0].views = []
    const r = parseProjectDoc(d)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.doc.artboards[0].views).toEqual([])
  })

  it('refuses a bad wall mode, a bad projection and a bad 3D point', () => {
    const withViews = (views: unknown) => {
      const d = createDefaultProject()
      d.artboards[0].views = views as SavedView[]
      return parseProjectDoc(d).ok
    }
    expect(withViews([view({ wallMode: 'side' as SavedView['wallMode'] })])).toBe(false)
    expect(withViews([view({ projection: 'isometric' as SavedView['projection'] })])).toBe(false)
    expect(withViews([{ ...view(), position: [0, 0] }])).toBe(false)
    expect(withViews([{ ...view(), target: [0, 0, Number.POSITIVE_INFINITY] }])).toBe(false)
    expect(withViews([{ ...view(), fov: 0 }])).toBe(false)
    expect(withViews([{ ...view(), id: '' }])).toBe(false)
    expect(withViews([{ ...view(), name: undefined }])).toBe(false)
  })

  it('accepts a view without fov or projection', () => {
    const d = createDefaultProject()
    d.artboards[0].views = [view()]
    const r = parseProjectDoc(d)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.doc.artboards[0].views?.[0].fov).toBeUndefined()
      expect(r.doc.artboards[0].views?.[0].projection).toBeUndefined()
    }
  })
})
