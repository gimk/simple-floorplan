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
