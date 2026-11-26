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
})
