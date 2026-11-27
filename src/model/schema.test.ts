import { describe, expect, it } from 'vitest'
import { createDefaultProject, parseProjectDoc, projectDocSchema } from './schema'

describe('schema', () => {
  it('default project is valid with one artboard "Plan A"', () => {
    const d = createDefaultProject()
    expect(d.schemaVersion).toBe(3)
    expect(d.artboards).toHaveLength(1)
    expect(d.artboards[0]).toMatchObject({ name: 'Plan A', xCm: 0, yCm: 0, ceilingHeightCm: 250 })
    expect(projectDocSchema.safeParse(d).success).toBe(true)
  })

  it('rejects a wrong schemaVersion', () => {
    const r = parseProjectDoc({ ...createDefaultProject(), schemaVersion: 2 })
    expect(r.ok).toBe(false)
  })

  it('rejects a doc with no artboard', () => {
    expect(parseProjectDoc({ ...createDefaultProject(), artboards: [] }).ok).toBe(false)
  })

  it('rejects a bad opening kind and a non-finite vertex', () => {
    const d = createDefaultProject()
    d.artboards[0].openings.push({ id: 'o', kind: 'gate' as never, xCm: 0, yCm: 0, angleDeg: 0, widthCm: 90 })
    expect(parseProjectDoc(d).ok).toBe(false)
    const e = createDefaultProject()
    e.artboards[0].rooms.push({ id: 'r', name: 'R', vertices: [{ x: NaN, y: 0 }] })
    expect(parseProjectDoc(e).ok).toBe(false)
  })

  it('accepts full content', () => {
    const d = createDefaultProject()
    d.artboards[0].rooms.push({ id: 'r', name: 'Room', vertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }], fill: '#fff' })
    d.artboards[0].openings.push({ id: 'o', kind: 'door', xCm: 50, yCm: 0, angleDeg: 0, widthCm: 90, hinge: 'left', swing: 'in' })
    d.artboards[0].furniture.push({ id: 'f', name: 'Bed', shape: 'rect', xCm: 10, yCm: 10, widthCm: 160, depthCm: 200, rotationDeg: 0, color: '#abc' })
    expect(parseProjectDoc(d).ok).toBe(true)
  })

  it('returns an error message, never throws', () => {
    const r = parseProjectDoc(null)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.length).toBeGreaterThan(0)
  })

  it('defaults precisionCm to 1 and leaves widthCm/heightCm unset', () => {
    const d = createDefaultProject()
    expect(d.artboards[0].precisionCm).toBe(1)
    expect(d.artboards[0].widthCm).toBeUndefined()
    expect(d.artboards[0].heightCm).toBeUndefined()
    const legacy = { ...d, artboards: [{ ...d.artboards[0], precisionCm: undefined }] }
    const r = parseProjectDoc(legacy)
    expect(r.ok && r.doc.artboards[0].precisionCm).toBe(1)
  })

  it('accepts precision 0.1, 0.5, 1 and rejects others', () => {
    const d = createDefaultProject()
    for (const p of [0.1, 0.5, 1]) {
      expect(parseProjectDoc({ ...d, artboards: [{ ...d.artboards[0], precisionCm: p }] }).ok).toBe(true)
    }
    expect(parseProjectDoc({ ...d, artboards: [{ ...d.artboards[0], precisionCm: 2 }] }).ok).toBe(false)
  })

  it('accepts manual widthCm/heightCm and rejects non-positive ones', () => {
    const d = createDefaultProject()
    const ok = parseProjectDoc({ ...d, artboards: [{ ...d.artboards[0], widthCm: 900, heightCm: 700 }] })
    expect(ok.ok && ok.doc.artboards[0]).toMatchObject({ widthCm: 900, heightCm: 700 })
    expect(parseProjectDoc({ ...d, artboards: [{ ...d.artboards[0], widthCm: 0 }] }).ok).toBe(false)
  })

  it('accepts the door and window variants and an omitted one', () => {
    const d = createDefaultProject()
    const withVariant = (variant?: string) => {
      const o = { id: 'o', kind: 'door', xCm: 0, yCm: 0, angleDeg: 0, widthCm: 90, ...(variant ? { variant } : {}) }
      return parseProjectDoc({ ...d, artboards: [{ ...d.artboards[0], openings: [o] }] })
    }
    for (const variant of ['standard', 'pocket', 'bypass', 'french', 'sliding', 'casement', 'double-casement']) {
      const r = withVariant(variant)
      expect(r.ok && r.doc.artboards[0].openings[0].variant).toBe(variant)
    }
    // No variant at all is valid: a door without a variant is a standard door.
    const none = withVariant()
    expect(none.ok).toBe(true)
    expect(none.ok && none.doc.artboards[0].openings[0].variant).toBeUndefined()
  })

  it('accepts the casement window variants on a window opening', () => {
    const d = createDefaultProject()
    const withWindow = (variant: string) => {
      const o = { id: 'o', kind: 'window', xCm: 0, yCm: 0, angleDeg: 0, widthCm: 90, hinge: 'left', swing: 'out', variant }
      return parseProjectDoc({ ...d, artboards: [{ ...d.artboards[0], openings: [o] }] })
    }
    for (const variant of ['casement', 'double-casement']) {
      const r = withWindow(variant)
      expect(r.ok && r.doc.artboards[0].openings[0]).toMatchObject({ kind: 'window', variant })
    }
    expect(withWindow('casement-swing').ok).toBe(false)
  })

  it('rejects an unknown opening variant', () => {
    const d = createDefaultProject()
    const o = { id: 'o', kind: 'door', xCm: 0, yCm: 0, angleDeg: 0, widthCm: 90, variant: 'pocket-sliding' }
    const r = parseProjectDoc({ ...d, artboards: [{ ...d.artboards[0], openings: [o] }] })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('variant')
  })
})

describe('wallThicknessCm', () => {
  const withThickness = (v: unknown) => {
    const d = createDefaultProject()
    return { ...d, artboards: [{ ...d.artboards[0], wallThicknessCm: v }] }
  }
  it('is optional, so older files stay valid', () => {
    const d = createDefaultProject()
    const { wallThicknessCm: _w, ...rest } = d.artboards[0]
    expect(parseProjectDoc({ ...d, artboards: [rest] }).ok).toBe(true)
  })
  it('accepts 0 to 50 and rejects values outside', () => {
    expect(parseProjectDoc(withThickness(0)).ok).toBe(true)
    expect(parseProjectDoc(withThickness(50)).ok).toBe(true)
    expect(parseProjectDoc(withThickness(-1)).ok).toBe(false)
    expect(parseProjectDoc(withThickness(51)).ok).toBe(false)
  })
  it('new artboards default to 10 cm', () => {
    expect(createDefaultProject().artboards[0].wallThicknessCm).toBe(10)
  })
})
