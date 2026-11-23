import { describe, expect, it } from 'vitest'
import { parsePlan, planJsonSchema, safeParsePlan, SnapshotPutBodySchema } from './schema'

describe('schema: parsePlan & migration', () => {
  it('migrates a minimal legacy doc missing schemaVersion, pins, tapes, holes, walls, walkOrder', () => {
    const legacy = {
      projectId: 'p1',
      title: 'Old Apt',
      rooms: [
        {
          id: 'r1',
          code: 'SE',
          name: 'Living',
          vertices: [
            { id: 'v1', x: 0, y: 0 },
            { id: 'v2', x: 400, y: 0 },
            { id: 'v3', x: 400, y: 300 },
            { id: 'v4', x: 0, y: 300 },
          ],
        },
      ],
    }

    const doc = parsePlan(legacy)
    expect(doc.schemaVersion).toBe(1)
    expect(doc.pins).toEqual([])
    expect(doc.tapes).toEqual([])
    expect(doc.elements).toEqual([])
    expect(doc.measurements).toEqual({})
    expect(doc.roomNotes).toEqual({})
    expect(doc.rooms[0].holes).toEqual([])
    expect(doc.rooms[0].walls).toEqual({})
    expect(doc.rooms[0].walkOrder).toBe(1)
  })

  it('rejects invalid room polygons (< 3 vertices) and negative element widths', () => {
    const badRoom = safeParsePlan({
      projectId: 'p1',
      rooms: [{ id: 'r1', code: 'A', name: 'Bad', vertices: [{ id: 'v1', x: 0, y: 0 }] }],
    })
    expect(badRoom.ok).toBe(false)

    const badEl = safeParsePlan({
      projectId: 'p1',
      elements: [
        {
          id: 'e1',
          roomId: 'r1',
          wallStart: 'v1',
          kind: 'door',
          offsetCm: 10,
          widthCm: -50,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
      ],
    })
    expect(badEl.ok).toBe(false)
  })

  it('validates SnapshotPutBodySchema with baseVersion', () => {
    const ok = SnapshotPutBodySchema.safeParse({ baseVersion: 2, title: 'Apt', rooms: [] })
    expect(ok.success).toBe(true)
    const bad = SnapshotPutBodySchema.safeParse({ baseVersion: -1 })
    expect(bad.success).toBe(false)
  })

  it('exports JSON Schema via z.toJSONSchema', () => {
    const schema = planJsonSchema()
    expect(schema.$id).toContain('plan.v1.json')
    expect(schema.type).toBe('object')
    expect((schema.properties as Record<string, unknown>).schemaVersion).toBeDefined()
    expect((schema.properties as Record<string, unknown>).rooms).toBeDefined()
  })
})

describe('schema: apartment data', () => {
  it('accepts old documents without apartment data', () => {
    const doc = parsePlan({ projectId: 'p1', title: 'Old', rooms: [] })
    expect(doc.apartment).toBeUndefined()
    expect(doc.pins).toEqual([])
  })

  it('accepts and normalises apartment data', () => {
    const doc = parsePlan({
      projectId: 'p1',
      apartment: {
        defaultCeilingCm: 250,
        references: [
          { id: 'r1', source: 'dpe', surfaceM2: 62.4, label: 'DPE 2023', date: '2023-04-01' },
          { id: 'r2', source: 'carrez', surfaceM2: 60.1, roomCode: 'SE', note: 'lower 1.8 m excluded' },
        ],
      },
      rooms: [],
    })
    expect(doc.apartment?.defaultCeilingCm).toBe(250)
    expect(doc.apartment?.references).toHaveLength(2)
    expect(doc.apartment?.references?.[0].source).toBe('dpe')
  })

  it('rejects invalid apartment data', () => {
    expect(safeParsePlan({ apartment: { defaultCeilingCm: 0 } }).ok).toBe(false)
    expect(safeParsePlan({ apartment: { references: [{ id: 'r1', source: 'tax', surfaceM2: 10 }] } }).ok).toBe(false)
    expect(safeParsePlan({ apartment: { references: [{ id: 'r1', source: 'dpe', surfaceM2: -1 }] } }).ok).toBe(false)
    expect(safeParsePlan({ apartment: { references: [{ id: 'r1', source: 'dpe', surfaceM2: 10, date: '2023' }] } }).ok).toBe(false)
    expect(safeParsePlan({ apartment: { references: [{ source: 'dpe', surfaceM2: 10 }] } }).ok).toBe(false)
  })

  it('exposes apartment in the exported JSON Schema', () => {
    const schema = planJsonSchema()
    expect((schema.properties as Record<string, unknown>).apartment).toBeDefined()
  })
})

describe('schema: renovation wall status (7.4)', () => {
  const plan = (walls: Record<string, unknown>) => ({
    projectId: 'p1',
    rooms: [
      {
        id: 'r1',
        code: 'SE',
        name: 'Living',
        vertices: [
          { id: 'v1', x: 0, y: 0 },
          { id: 'v2', x: 400, y: 0 },
          { id: 'v3', x: 400, y: 300 },
        ],
        walls,
      },
    ],
  })

  it('accepts existing, demolish and new, and keeps the field absent when omitted', () => {
    for (const status of ['existing', 'demolish', 'new']) {
      const doc = parsePlan(plan({ v1: { type: 'partition', thicknessCm: 10, status } }))
      expect(doc.rooms[0].walls.v1.status).toBe(status)
    }
    const plain = parsePlan(plan({ v1: { type: 'bearing', thicknessCm: 25 } }))
    expect(plain.rooms[0].walls.v1.status).toBeUndefined()
  })

  it('rejects an unknown status', () => {
    expect(safeParsePlan(plan({ v1: { type: 'partition', thicknessCm: 10, status: 'remove' } })).ok).toBe(false)
    expect(safeParsePlan(plan({ v1: { type: 'partition', thicknessCm: 10, status: null } })).ok).toBe(false)
  })

  it('exposes the status enum in the exported JSON Schema', () => {
    const json = JSON.stringify(planJsonSchema())
    expect(json).toContain('demolish')
    expect(json).toContain('"new"')
  })
})

describe('schema: pin photo sketches', () => {
  const mark = { id: 'mk1', a: { x: 0.1, y: 0.2 }, b: { x: 0.6, y: 0.25 }, valueCm: 250, label: 'SE-2', note: 'pipe' }
  const docWith = (sketches: unknown) => ({
    projectId: 'p1',
    rooms: [],
    elements: [],
    measurements: {},
    roomNotes: {},
    tapes: [],
    pins: [{ id: 'p1', at: { x: 0, y: 0 }, photoKeys: ['proj/a.jpg'], sketches, createdAt: 'c', updatedAt: 'u' }],
  })

  it('keeps the marks of a pin photo', () => {
    const doc = parsePlan(docWith({ 'proj/a.jpg': [mark] }))
    expect(doc.pins[0].sketches).toEqual({ 'proj/a.jpg': [mark] })
  })

  it('accepts a pin without sketches (documents saved before it existed)', () => {
    const doc = parsePlan(docWith(undefined))
    expect(doc.pins[0].sketches).toBeUndefined()
  })

  it('rejects a mark without points and a non-positive value', () => {
    expect(safeParsePlan(docWith({ 'proj/a.jpg': [{ id: 'mk1', valueCm: 100 }] })).ok).toBe(false)
    expect(safeParsePlan(docWith({ 'proj/a.jpg': [{ ...mark, valueCm: -5 }] })).ok).toBe(false)
    expect(safeParsePlan(docWith({ 'proj/a.jpg': [{ ...mark, id: '' }] })).ok).toBe(false)
  })

  it('accepts sketches in a snapshot body and exposes them in the JSON Schema', () => {
    const body = SnapshotPutBodySchema.parse({
      baseVersion: 0,
      pins: [{ id: 'p1', at: { x: 0, y: 0 }, photoKeys: ['proj/a.jpg'], sketches: { 'proj/a.jpg': [mark] }, createdAt: 'c', updatedAt: 'u' }],
    })
    expect(body.pins[0].sketches).toEqual({ 'proj/a.jpg': [mark] })
    const json = JSON.stringify(planJsonSchema())
    expect(json).toContain('sketches')
    expect(json).toContain('valueCm')
  })
})

describe('schema: measurement source (walls-plan 3a)', () => {
  const docWith = (measurement: unknown) => ({
    projectId: 'p1',
    rooms: [],
    measurements: { 'SE-2': measurement },
  })

  it('keeps the source of a measurement', () => {
    const doc = parsePlan(docWith({ label: 'SE-2', actualCm: 412, updatedAt: 'u', source: 'laser' }))
    expect(doc.measurements['SE-2'].source).toBe('laser')
  })

  it('accepts every source, and a measurement without source (documents saved before 3a)', () => {
    for (const source of ['tape', 'laser', 'plan', 'other']) {
      const doc = parsePlan(docWith({ label: 'SE-2', actualCm: 412, updatedAt: 'u', source }))
      expect(doc.measurements['SE-2'].source).toBe(source)
    }
    const old = parsePlan(docWith({ label: 'SE-2', actualCm: 412, updatedAt: 'u' }))
    expect(old.measurements['SE-2'].source).toBeUndefined()
    expect(old.measurements['SE-2'].actualCm).toBe(412)
  })

  it('rejects an unknown source', () => {
    expect(safeParsePlan(docWith({ label: 'SE-2', actualCm: 412, updatedAt: 'u', source: 'ruler' })).ok).toBe(false)
    expect(safeParsePlan(docWith({ label: 'SE-2', actualCm: 412, updatedAt: 'u', source: null })).ok).toBe(false)
  })

  it('accepts a source in a snapshot body and exposes it in the JSON Schema', () => {
    const body = SnapshotPutBodySchema.parse({
      baseVersion: 0,
      measurements: { 'SE-2': { label: 'SE-2', actualCm: 412, updatedAt: 'u', source: 'plan' } },
    })
    expect(body.measurements?.['SE-2'].source).toBe('plan')
    expect(JSON.stringify(planJsonSchema())).toContain('laser')
  })
})
