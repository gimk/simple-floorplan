import { describe, expect, it } from 'vitest'
import { demoRooms } from '../features/measure/demo'
import { convertToV2 } from '../model/v2/convert'
import { parseMeasureTarget, parseMeasureTargetJson, parsePlan, planJsonSchema, safeParsePlan, SnapshotPutBodySchema } from './schema'

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

describe('schema: measurement target (walls-plan 5c)', () => {
  const docWith = (measurement: unknown) => ({
    projectId: 'p1',
    rooms: [],
    measurements: { 'SE-2': measurement },
  })
  const face = { wallId: 'W12', side: 'L', roomId: 'room_SE', from: 0, to: 412, kind: 'face' }

  it('keeps the target of a measurement', () => {
    const doc = parsePlan(docWith({ label: 'SE-2', actualCm: 412, updatedAt: 'u', target: face }))
    expect(doc.measurements['SE-2'].target).toEqual(face)
  })

  it('accepts a measurement without target (documents saved before 5c)', () => {
    const old = parsePlan(docWith({ label: 'SE-2', actualCm: 412, updatedAt: 'u' }))
    expect(old.measurements['SE-2'].target).toBeUndefined()
    expect(old.measurements['SE-2'].actualCm).toBe(412)
  })

  it('accepts a minimal target (wall and side only) and every kind', () => {
    const min = parsePlan(docWith({ label: 'SE-2', actualCm: 412, updatedAt: 'u', target: { wallId: 'W12', side: 'R' } }))
    expect(min.measurements['SE-2'].target).toEqual({ wallId: 'W12', side: 'R' })
    for (const kind of ['face', 'centre', 'outside', 'thickness', 'diagonal'] as const) {
      const doc = parsePlan(docWith({ label: 'SE-2', actualCm: 412, updatedAt: 'u', target: { ...face, kind } }))
      expect(doc.measurements['SE-2'].target?.kind).toBe(kind)
    }
  })

  it('strips unknown keys of a target (an old writer does no harm)', () => {
    const doc = parsePlan(
      docWith({ label: 'SE-2', actualCm: 412, updatedAt: 'u', target: { ...face, extra: 1 } }),
    )
    expect(doc.measurements['SE-2'].target).toEqual(face)
    expect(doc.measurements['SE-2'].target as unknown as Record<string, unknown>).not.toHaveProperty('extra')
  })

  it('rejects a target with a wrong shape', () => {
    expect(safeParsePlan(docWith({ label: 'SE-2', actualCm: 412, updatedAt: 'u', target: null })).ok).toBe(false)
    expect(safeParsePlan(docWith({ label: 'SE-2', actualCm: 412, updatedAt: 'u', target: {} })).ok).toBe(false)
    expect(
      safeParsePlan(docWith({ label: 'SE-2', actualCm: 412, updatedAt: 'u', target: { wallId: 'W12', side: 'X' } })).ok,
    ).toBe(false)
    expect(
      safeParsePlan(docWith({ label: 'SE-2', actualCm: 412, updatedAt: 'u', target: { ...face, kind: 'length' } })).ok,
    ).toBe(false)
  })

  it('accepts a target in a snapshot body and exposes it in the JSON Schema', () => {
    const body = SnapshotPutBodySchema.parse({
      baseVersion: 0,
      measurements: { 'SE-2': { label: 'SE-2', actualCm: 412, updatedAt: 'u', target: face } },
    })
    expect(body.measurements?.['SE-2'].target).toEqual(face)
    const json = JSON.stringify(planJsonSchema())
    expect(json).toContain('wallId')
    expect(json).toContain('side')
  })

  it('parseMeasureTarget ignores an unknown shape, it never throws', () => {
    expect(parseMeasureTarget(face)).toEqual(face)
    expect(parseMeasureTarget(undefined)).toBeUndefined()
    expect(parseMeasureTarget(null)).toBeUndefined()
    expect(parseMeasureTarget('W12')).toBeUndefined()
    expect(parseMeasureTarget({ wallId: 'W12' })).toBeUndefined()
    expect(parseMeasureTarget({ wallId: 'W12', side: 'L', kind: 'other' })).toBeUndefined()
  })

  it('parseMeasureTargetJson reads the column and treats NULL or bad text as no target', () => {
    expect(parseMeasureTargetJson(JSON.stringify(face))).toEqual(face)
    expect(parseMeasureTargetJson(null)).toBeUndefined()
    expect(parseMeasureTargetJson(undefined)).toBeUndefined()
    expect(parseMeasureTargetJson('')).toBeUndefined()
    expect(parseMeasureTargetJson('{not json')).toBeUndefined()
    expect(parseMeasureTargetJson('{"wallId":"W12"}')).toBeUndefined()
  })
})

describe('schema: traced walls (walls-plan phase 6)', () => {
  const trace = { id: 't1', a: { x: 0, y: 0 }, b: { x: 400, y: 0 }, thicknessCm: 10, type: 'partition' }

  it('keeps the traces of a doc, and accepts a doc without them (older documents)', () => {
    const doc = parsePlan({ projectId: 'p1', rooms: [], traces: [trace] })
    expect(doc.traces).toEqual([trace])
    const old = parsePlan({ projectId: 'p1', rooms: [] })
    expect(old.traces).toBeUndefined()
  })

  it('keeps traces in a snapshot body and exposes them in the JSON Schema', () => {
    const body = SnapshotPutBodySchema.parse({ baseVersion: 3, traces: [trace] })
    expect(body.traces).toEqual([trace])
    expect(JSON.stringify(planJsonSchema())).toContain('thicknessCm')
    expect(JSON.stringify(planJsonSchema())).toContain('traces')
  })

  it('rejects a trace with no id, a bad type or a zero thickness', () => {
    expect(safeParsePlan({ projectId: 'p1', rooms: [], traces: [{ ...trace, id: '' }] }).ok).toBe(false)
    expect(safeParsePlan({ projectId: 'p1', rooms: [], traces: [{ ...trace, type: 'wood' }] }).ok).toBe(false)
    expect(safeParsePlan({ projectId: 'p1', rooms: [], traces: [{ ...trace, thicknessCm: 0 }] }).ok).toBe(false)
  })
})

describe('schema: v2 documents (walls-plan phase 5c)', () => {
  /** The demo apartment as a v1 document, with one value on a wall and one on a facade. */
  const v1Doc = () => ({
    projectId: 'p1',
    title: 'Demo',
    rooms: demoRooms(),
    elements: [],
    measurements: { 'SE-2': { label: 'SE-2', actualCm: 412, updatedAt: '2026-11-23T10:00:00Z' } },
    roomNotes: {},
    tapes: [],
  })

  it('keeps the cycles, the wall properties and schemaVersion 2 through JSON', () => {
    const { doc } = convertToV2(parsePlan(v1Doc()))
    const json = JSON.parse(JSON.stringify(doc))
    const back = parsePlan(json)

    expect(back.schemaVersion).toBe(2)
    // One face per room wall, with its wall id, side, span and corner id: nothing lost or rounded.
    expect(back.rooms.map((r) => r.cycle)).toEqual(doc.rooms.map((r) => r.cycle))
    for (const room of back.rooms) expect(room.cycle?.length).toBe(room.vertices.length)
    // Every stored wall keeps its properties and its faces.
    expect(back.walls).toEqual(doc.walls)
    for (const w of back.walls ?? []) {
      expect(typeof w.thicknessCm).toBe('number')
      expect(w.type).toBeDefined()
    }
    expect(back.nodes).toEqual(doc.nodes)
  })

  it('keeps a value and its target through JSON', () => {
    const { doc } = convertToV2(parsePlan(v1Doc()))
    const wall = doc.walls!.find((w) => w.faces.some((f) => f.roomId === 'demo-SE'))!
    const withTarget = {
      ...doc,
      measurements: {
        ...doc.measurements,
        'SE-2': { ...doc.measurements['SE-2'], target: { wallId: wall.id, side: 'L' as const, roomId: 'demo-SE', from: 10, to: 200, kind: 'face' as const } },
      },
    }
    const back = parsePlan(JSON.parse(JSON.stringify(withTarget)))
    expect(back.measurements['SE-2'].target).toEqual(withTarget.measurements['SE-2'].target)
  })

  it('a v1 document still parses with schemaVersion 1 and no cycle', () => {
    const doc = parsePlan(v1Doc())
    expect(doc.schemaVersion).toBe(1)
    for (const r of doc.rooms) expect(r.cycle).toBeUndefined()
  })

  it('accepts schemaVersion 2 in a snapshot body', () => {
    expect(SnapshotPutBodySchema.parse({ baseVersion: 1 }).schemaVersion).toBe(1)
    expect(SnapshotPutBodySchema.parse({ baseVersion: 1, schemaVersion: 2 }).schemaVersion).toBe(2)
    expect(safeParsePlan({ schemaVersion: 3, rooms: [] }).ok).toBe(false)
    expect(SnapshotPutBodySchema.safeParse({ baseVersion: 1, schemaVersion: 3 }).success).toBe(false)
  })

  it('rejects a cycle face with a bad side or no wall id', () => {
    const cycle = [{ wallId: 'W1', side: 'L', from: 0, to: 100, cornerId: 'v1' }]
    const room = { ...v1Doc().rooms[0], cycle }
    expect(parsePlan({ ...v1Doc(), rooms: [room] }).rooms[0].cycle).toEqual(cycle)
    expect(safeParsePlan({ ...v1Doc(), rooms: [{ ...room, cycle: [{ ...cycle[0], side: 'X' }] }] }).ok).toBe(false)
    expect(safeParsePlan({ ...v1Doc(), rooms: [{ ...room, cycle: [{ ...cycle[0], wallId: '' }] }] }).ok).toBe(false)
  })
})

describe('schema: conversion report (walls-plan 5c step 4)', () => {
  const entry = {
    wallId: 'W12',
    rooms: ['EN', 'CO'],
    linesApartCm: 1.5,
    thicknesses: [10, 12],
    types: ['partition', 'partition'],
    chosen: { type: 'partition', thicknessCm: 12 },
  }
  const conversion = {
    at: '2026-11-24T10:00:00.000Z',
    report: { entries: [entry], counts: { rooms: 3, walls: 8, sharedWalls: 4, droppedRoomWalls: 0 } },
  }

  it('keeps doc.conversion and its report through JSON (round trip)', () => {
    const doc = parsePlan({ projectId: 'p1', schemaVersion: 2, rooms: [], conversion })
    expect(doc.conversion).toEqual(conversion)
    expect(doc.conversion?.seen).toBeUndefined()
    // Saved and read back: the report survives a trip through the snapshot JSON.
    const back = parsePlan(JSON.parse(JSON.stringify(doc)))
    expect(back.conversion).toEqual(conversion)
    expect(back.conversion?.report.entries[0].linesApartCm).toBe(1.5)
  })

  it('keeps seen = true and reads a report without seen as not seen', () => {
    const seen = parsePlan({ projectId: 'p1', conversion: { ...conversion, seen: true } })
    expect(seen.conversion?.seen).toBe(true)
    const notSeen = parsePlan({ projectId: 'p1', conversion })
    expect(notSeen.conversion?.seen).not.toBe(true)
  })

  it('accepts a report without entries and gives the counts, and no conversion at all', () => {
    const empty = parsePlan({
      projectId: 'p1',
      conversion: { at: '2026-11-24T10:00:00.000Z', report: { counts: { rooms: 1, walls: 4 } } },
    })
    expect(empty.conversion?.report.entries).toEqual([])
    expect(empty.conversion?.report.counts).toEqual({ rooms: 1, walls: 4, sharedWalls: 0, droppedRoomWalls: 0 })
    expect(parsePlan({ projectId: 'p1' }).conversion).toBeUndefined()
  })

  it('rejects a conversion with no time or a negative count', () => {
    expect(safeParsePlan({ projectId: 'p1', conversion: { report: { counts: {} } } }).ok).toBe(false)
    expect(
      safeParsePlan({
        projectId: 'p1',
        conversion: { at: 't', report: { counts: { rooms: -1 } } },
      }).ok,
    ).toBe(false)
  })

  it('accepts conversion in a snapshot body and exposes it in the JSON Schema', () => {
    const body = SnapshotPutBodySchema.parse({ baseVersion: 2, schemaVersion: 2, conversion })
    expect(body.conversion).toEqual(conversion)
    const schema = JSON.stringify(planJsonSchema())
    expect(schema).toContain('conversion')
    expect(schema).toContain('sharedWalls')
  })
})
