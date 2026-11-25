import { describe, expect, it } from 'vitest'
import { applyBatch } from './commands'
import { parsePlan } from './schema'
import { planToDxf, DXF_LAYERS } from './dxf'
import type { PlanDocV1 } from './schema'

function sampleDoc(): PlanDocV1 {
  const base = parsePlan({
    projectId: 'p1',
    title: 'Apt 4B',
    rooms: [],
    elements: [],
    measurements: {},
    roomNotes: {},
    tapes: [],
    pins: [],
  })
  return applyBatch(base, [
    { type: 'add_room', code: 'SE', name: 'Living', rect: { x: 0, y: 0, w: 400, h: 300 }, ceilingCm: 260, walkOrder: 1 },
    { type: 'add_room', code: 'CU', name: 'Kitchen', rect: { x: 400, y: 0, w: 200, h: 300 }, ceilingCm: 260, walkOrder: 2 },
    { type: 'set_wall_props', wall: 'SE-2', wallType: 'bearing', thicknessCm: 25 },
    { type: 'set_wall_props', wall: 'CU-1', wallType: 'exterior', thicknessCm: 30 },
    { type: 'place_element', id: 'el_door', wall: 'SE-2', kind: 'door', offsetCm: 100, widthCm: 80, heightCm: 204 },
    { type: 'place_element', id: 'el_win', wall: 'CU-2', kind: 'window', variant: 'standard', offsetCm: 40, widthCm: 120, heightCm: 140, sillCm: 90 },
    { type: 'place_element', id: 'el_rad', wall: 'CU-3', kind: 'radiator', offsetCm: 10, widthCm: 100, heightCm: 60, depthCm: 20 },
  ]).doc
}

/** Parse DXF text into (code, value) pairs. */
function pairs(dxf: string): [number, string][] {
  const lines = dxf.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  expect(lines.length % 2).toBe(0)
  const out: [number, string][] = []
  for (let i = 0; i < lines.length; i += 2) {
    const code = Number(lines[i].trim())
    expect(Number.isInteger(code)).toBe(true)
    out.push([code, lines[i + 1]])
  }
  return out
}

describe('dxf: planToDxf', () => {
  it('parses as valid group-code pairs with SECTION/HEADER/TABLES/ENTITIES/EOF', () => {
    const dxf = planToDxf(sampleDoc())
    const ps = pairs(dxf)
    expect(ps[0][0]).toBe(999) // comment
    expect(ps).toContainEqual([0, 'SECTION'])
    expect(ps).toContainEqual([2, 'HEADER'])
    expect(ps).toContainEqual([1, 'AC1009'])
    expect(ps).toContainEqual([70, '5']) // $INSUNITS = cm
    const sections = ps.filter(([c, v]) => c === 2 && ['HEADER', 'TABLES', 'ENTITIES'].includes(v)).map(([, v]) => v)
    expect(sections).toEqual(['HEADER', 'TABLES', 'ENTITIES'])
    expect(ps[ps.length - 1]).toEqual([0, 'EOF'])
  })

  it('declares all required layers in the LAYER table', () => {
    const dxf = planToDxf(sampleDoc())
    const ps = pairs(dxf)
    for (const layer of DXF_LAYERS) {
      expect(ps).toContainEqual([2, layer])
    }
  })

  it('emits room outlines as closed POLYLINE/VERTEX on ROOMS and labels as TEXT', () => {
    const dxf = planToDxf(sampleDoc())
    const ps = pairs(dxf)
    const entityTypes = ps.filter(([c]) => c === 0).map(([, v]) => v)
    expect(entityTypes).toContain('POLYLINE')
    expect(entityTypes).toContain('VERTEX')
    expect(entityTypes).toContain('SEQEND')
    expect(entityTypes).toContain('TEXT')
    // closed flag (group values are strings)
    expect(ps).toContainEqual([70, '1'])
    // labels contain room codes
    const texts = ps.filter(([c]) => c === 1).map(([, v]) => v)
    expect(texts.some((t) => t.startsWith('SE Living'))).toBe(true)
    expect(texts.some((t) => t.startsWith('CU Kitchen'))).toBe(true)
  })

  it('emits walls as LINE pairs on type layers, doors as ARC, windows on WINDOWS, storage on STORAGE', () => {
    const dxf = planToDxf(sampleDoc())
    const ps = pairs(dxf)
    const entityTypes = ps.filter(([c]) => c === 0).map(([, v]) => v)
    expect(entityTypes).toContain('LINE')
    expect(entityTypes).toContain('ARC')
    // bearing + exterior layers used
    const layers = new Set(ps.filter(([c]) => c === 8).map(([, v]) => v))
    expect(layers.has('WALLS_BEARING')).toBe(true)
    expect(layers.has('WALLS_EXTERIOR')).toBe(true)
    expect(layers.has('WALLS_PARTITION')).toBe(true)
    expect(layers.has('DOORS')).toBe(true)
    expect(layers.has('WINDOWS')).toBe(true)
    expect(layers.has('STORAGE')).toBe(true)
    expect(layers.has('DIMENSIONS')).toBe(true)
    expect(layers.has('TEXT')).toBe(true)
  })

  it('flips y (DXF y-up) and writes cm coordinates', () => {
    const dxf = planToDxf(sampleDoc())
    const ps = pairs(dxf)
    // The SE room label sits at the world centroid (200,150) -> DXF (200,-150).
    let labelX: number | null = null
    let labelY: number | null = null
    for (let i = 0; i < ps.length; i++) {
      if (ps[i][0] === 1 && ps[i][1].startsWith('SE Living')) {
        // walk back within this entity for the 10/20 codes
        for (let j = i - 1; j >= 0 && ps[j][0] !== 0; j--) {
          if (ps[j][0] === 10) labelX = Number(ps[j][1])
          if (ps[j][0] === 20) labelY = Number(ps[j][1])
        }
      }
    }
    expect(labelX).toBe(200)
    expect(labelY).toBe(-150)
    // Room outlines stay within x [0,600]; y values are world-y negated (<= 0 for room geometry).
    const roomVertsY: number[] = []
    for (let i = 0; i < ps.length; i++) {
      if (ps[i][0] === 0 && ps[i][1] === 'VERTEX') {
        const y = ps.slice(i, i + 6).find(([c]) => c === 20)
        if (y) roomVertsY.push(Number(y[1]))
      }
    }
    expect(Math.min(...roomVertsY)).toBe(-300)
    expect(Math.max(...roomVertsY)).toBe(0)
  })

  it('handles an empty doc', () => {
    const empty = parsePlan({ projectId: 'e', title: '', rooms: [], elements: [], measurements: {}, roomNotes: {}, tapes: [], pins: [] })
    const dxf = planToDxf(empty)
    const ps = pairs(dxf)
    expect(ps[ps.length - 1]).toEqual([0, 'EOF'])
    expect(ps).toContainEqual([1, 'AC1009'])
  })
})

describe('dxf: built-in storage (docs/storage-plan.md, step 4)', () => {
  /** The sample plan with one built-in storage on the outer side of SE-4 (above y = 0). */
  function storageDoc(): PlanDocV1 {
    return applyBatch(sampleDoc(), [
      { type: 'add_storage', room: 'SE', wall: 'SE-4', offsetCm: 100, widthCm: 60, depthCm: 40, door: 'single' },
    ]).doc as PlanDocV1
  }

  /** Entities of the file as { type, layer, xs } blocks (each block starts with a group code 0). */
  function entities(dxf: string): { type: string; layer: string; xs: string[] }[] {
    const out: { type: string; layer: string; xs: string[] }[] = []
    const ps = pairs(dxf)
    let cur: { type: string; layer: string; xs: string[] } | null = null
    for (const [code, value] of ps) {
      if (code === 0) {
        // The points of a POLYLINE are VERTEX entities: they belong to the polyline before them.
        if (value === 'VERTEX' || value === 'SEQEND') continue
        cur = { type: value, layer: '', xs: [] }
        out.push(cur)
        continue
      }
      if (!cur) continue
      if (code === 8) cur.layer = value
      if (code === 10) cur.xs.push(value)
    }
    return out.filter((e) => ['POLYLINE', 'LINE', 'TEXT', 'ARC'].includes(e.type))
  }

  it('writes the storage outline and its hatch on the STORAGE layer', () => {
    const doc = storageDoc()
    const storage = doc.rooms.find((r) => r.storage)!
    const ents = entities(planToDxf(doc))
    // One closed outline per room: the outline of the storage is on STORAGE, the others on ROOMS.
    const outlines = ents.filter((e) => e.type === 'POLYLINE')
    const corners = storage.vertices.map((v) => String(v.x))
    const withCorners = outlines.filter((e) => corners.every((x) => e.xs.includes(x)))
    expect(withCorners).toHaveLength(1)
    expect(withCorners[0].layer).toBe('STORAGE')
    // The other rooms keep their outline on ROOMS.
    expect(outlines.filter((e) => e.layer === 'ROOMS')).toHaveLength(doc.rooms.filter((r) => !r.storage).length)
    // The hatch: the two diagonals of the storage, as LINEs on the same layer.
    expect(ents.filter((e) => e.type === 'LINE' && e.layer === 'STORAGE').length).toBeGreaterThanOrEqual(2)
  })

  it('draws the storage walls like other walls, with their own thickness', () => {
    const doc = storageDoc()
    const storage = doc.rooms.find((r) => r.storage)!
    const ents = entities(planToDxf(doc))
    // Two faces per wall, on WALLS_PARTITION (the storage walls are partitions), plus the hatch.
    const partitionLines = ents.filter((e) => e.type === 'LINE' && e.layer === 'WALLS_PARTITION').length
    expect(partitionLines).toBeGreaterThanOrEqual(2 * storage.vertices.length)
    // The label of the storage room is written as a TEXT, like every room label.
    const values = ents.filter((e) => e.type === 'TEXT').flatMap((e) => e.xs)
    expect(values.length).toBeGreaterThan(0)
    const texts = pairs(planToDxf(doc)).filter(([c]) => c === 1).map(([, v]) => v)
    expect(texts.some((t) => t.includes('Storage'))).toBe(true)
  })
})
