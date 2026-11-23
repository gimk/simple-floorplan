// Tests for the shared persistence module functions/store.ts using a tiny
// in-memory D1 stub that understands exactly the SQL statements the module issues.
import { describe, expect, it } from 'vitest'
import { parsePlan, type PlanDocV1 } from '../src/core/schema'
import { carryOldMeasurements, commitDoc, loadProjectDoc, VersionConflictError } from './store'

// ---------- tiny in-memory D1 stub ----------

type Row = Record<string, unknown>

class FakeStatement {
  constructor(
    private db: FakeDB,
    private sql: string,
    private args: unknown[] = [],
  ) {}
  bind(...args: unknown[]): FakeStatement {
    return new FakeStatement(this.db, this.sql, args)
  }
  async run(): Promise<{ success: boolean }> {
    this.db.exec(this.sql, this.args)
    return { success: true }
  }
  async first<T>(): Promise<T | null> {
    return (this.db.first(this.sql, this.args) as T | null) ?? null
  }
  async all<T>(): Promise<{ results: T[] }> {
    return { results: this.db.all(this.sql, this.args) as T[] }
  }
}

class FakeDB {
  projects = new Map<string, Row>()
  snapshots: Row[] = []
  measurements = new Map<string, Row>() // key: project_id|label
  surveyItems = new Map<string, Row>() // key: id
  roomNotes = new Map<string, Row>() // key: project_id|room_code
  idempotencyKeys = new Map<string, Row>() // key: project_id|key

  prepare(sql: string): FakeStatement {
    return new FakeStatement(this, sql)
  }

  async batch(stmts: FakeStatement[]): Promise<void> {
    for (const s of stmts) await s.run()
  }

  private norm(sql: string): string {
    return sql.replace(/\s+/g, ' ').trim()
  }

  first(sql: string, args: unknown[]): Row | undefined {
    const q = this.norm(sql)
    if (q.startsWith('SELECT * FROM projects WHERE id = ?')) return this.projects.get(String(args[0]))
    if (q.startsWith('SELECT name, title FROM projects WHERE id = ?')) {
      const p = this.projects.get(String(args[0]))
      return p ? { name: p.name, title: p.title } : undefined
    }
    if (q.startsWith('SELECT data_json, version FROM floorplan_snapshots')) {
      const rows = this.snapshots
        .filter((s) => s.project_id === args[0])
        .sort((a, b) => Number(b.version) - Number(a.version))
      return rows[0]
    }
    throw new Error(`stub: unsupported first() query: ${q}`)
  }

  all(sql: string, args: unknown[]): Row[] {
    const q = this.norm(sql)
    if (q.startsWith('SELECT label, actual_cm, updated_at, source FROM measurements WHERE project_id = ?')) {
      return [...this.measurements.values()].filter((r) => r.project_id === args[0])
    }
    if (q.startsWith('SELECT data_json FROM survey_items WHERE project_id = ? AND deleted = 0')) {
      return [...this.surveyItems.values()].filter((r) => r.project_id === args[0] && r.deleted === 0)
    }
    if (q.startsWith('SELECT room_code, text FROM room_notes WHERE project_id = ?')) {
      return [...this.roomNotes.values()].filter((r) => r.project_id === args[0])
    }
    throw new Error(`stub: unsupported all() query: ${q}`)
  }

  exec(sql: string, args: unknown[]): void {
    const q = this.norm(sql)
    if (q.startsWith('INSERT INTO floorplan_snapshots')) {
      this.snapshots.push({ id: args[0], project_id: args[1], data_json: args[2], version: args[3], created_at: args[4] })
      return
    }
    if (q.startsWith('DELETE FROM floorplan_snapshots WHERE project_id = ? AND version <= ?')) {
      this.snapshots = this.snapshots.filter((s) => !(s.project_id === args[0] && Number(s.version) <= Number(args[1])))
      return
    }
    if (q.startsWith('DELETE FROM measurements WHERE project_id = ? AND label = ?')) {
      this.measurements.delete(`${args[0]}|${args[1]}`)
      return
    }
    if (q.startsWith('INSERT INTO measurements')) {
      this.measurements.set(`${args[0]}|${args[1]}`, {
        project_id: args[0],
        label: args[1],
        actual_cm: args[2],
        updated_at: args[3],
        source: args[4], // nullable: NULL means "no source" (tape)
      })
      return
    }
    if (q.startsWith('INSERT INTO survey_items')) {
      // The deleted flag is a SQL literal: VALUES (..., 1) for tombstones, (..., 0) for upserts.
      const deleted = /VALUES \(\?, \?, \?, \?, 1\)/.test(q) ? 1 : 0
      this.surveyItems.set(String(args[0]), {
        id: args[0],
        project_id: args[1],
        data_json: args[2],
        updated_at: args[3],
        deleted,
      })
      return
    }
    if (q.startsWith('DELETE FROM room_notes WHERE project_id = ? AND room_code = ?')) {
      this.roomNotes.delete(`${args[0]}|${args[1]}`)
      return
    }
    if (q.startsWith('INSERT INTO room_notes')) {
      this.roomNotes.set(`${args[0]}|${args[1]}`, {
        project_id: args[0],
        room_code: args[1],
        text: args[2],
        updated_at: args[3],
      })
      return
    }
    if (q.startsWith('UPDATE projects SET name = ?, title = ?, updated_at = ? WHERE id = ?')) {
      const p = this.projects.get(String(args[3]))
      if (p) Object.assign(p, { name: args[0], title: args[1], updated_at: args[2] })
      return
    }
    if (q.startsWith('UPDATE projects SET updated_at = ? WHERE id = ?')) {
      const p = this.projects.get(String(args[1]))
      if (p) p.updated_at = args[0]
      return
    }
    if (q.startsWith('INSERT INTO idempotency_keys')) {
      this.idempotencyKeys.set(`${args[0]}|${args[1]}`, {
        project_id: args[0],
        key: args[1],
        status_code: 200,
        response_json: args[2],
        created_at: args[3],
      })
      return
    }
    throw new Error(`stub: unsupported exec: ${q}`)
  }
}

function makeDoc(projectId: string, overrides: Partial<PlanDocV1> = {}): PlanDocV1 {
  return parsePlan({
    schemaVersion: 1,
    projectId,
    title: 'Test plan',
    rooms: [
      {
        id: 'room_SE',
        code: 'SE',
        name: 'Living Room',
        vertices: [
          { id: 'v1', x: 0, y: 0 },
          { id: 'v2', x: 400, y: 0 },
          { id: 'v3', x: 400, y: 300 },
          { id: 'v4', x: 0, y: 300 },
        ],
        walls: {},
      },
    ],
    elements: [],
    tapes: [],
    pins: [],
    measurements: {},
    roomNotes: {},
    ...overrides,
  })
}

function addProject(db: FakeDB, id: string, name = 'New project', title: string | null = null): void {
  db.projects.set(id, { id, name, title, updated_at: '2026-11-21T00:00:00.000Z' })
}

// ---------- tests ----------

describe('functions/store.ts (shared D1 persistence)', () => {
  it('loadProjectDoc returns null for an unknown project', async () => {
    const db = new FakeDB()
    expect(await loadProjectDoc(db as unknown as D1Database, 'nope')).toBeNull()
  })

  it('commitDoc creates version 1 and loadProjectDoc round-trips the doc', async () => {
    const db = new FakeDB()
    addProject(db, 'p1')
    const empty = await loadProjectDoc(db as unknown as D1Database, 'p1')
    expect(empty).not.toBeNull()
    expect(empty!.version).toBe(0)
    expect(empty!.doc.rooms).toHaveLength(0)

    const doc = makeDoc('p1', {
      measurements: { 'SE-1': { label: 'SE-1', actualCm: 402, updatedAt: '2026-11-21T01:00:00.000Z' } },
      roomNotes: { SE: 'south facing' },
      elements: [
        {
          id: 'el1',
          roomId: 'room_SE',
          wallStart: 'v1',
          kind: 'window',
          offsetCm: 80,
          widthCm: 120,
          createdAt: '2026-11-21T01:00:00.000Z',
          updatedAt: '2026-11-21T01:00:00.000Z',
        } as PlanDocV1['elements'][number],
      ],
    })
    const { version, updatedAt } = await commitDoc(db as unknown as D1Database, 'p1', empty!, doc)
    expect(version).toBe(1)
    expect(updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)

    const loaded = await loadProjectDoc(db as unknown as D1Database, 'p1')
    expect(loaded!.version).toBe(1)
    expect(loaded!.doc.rooms).toHaveLength(1)
    expect(loaded!.doc.rooms[0].code).toBe('SE')
    expect(loaded!.doc.measurements['SE-1'].actualCm).toBe(402)
    expect(loaded!.doc.roomNotes.SE).toBe('south facing')
    expect(loaded!.doc.elements).toHaveLength(1)
    expect(loaded!.doc.elements[0].id).toBe('el1')
    // projects.title synced from the doc title (and default name replaced)
    expect(db.projects.get('p1')!.title).toBe('Test plan')
    expect(db.projects.get('p1')!.name).toBe('Test plan')
  })

  it('second commit bumps the version and syncs table diffs (delete measurement, change note, soft-delete element)', async () => {
    const db = new FakeDB()
    addProject(db, 'p2', 'Custom name', 'Old title')
    const v0 = (await loadProjectDoc(db as unknown as D1Database, 'p2'))!
    const doc1 = makeDoc('p2', {
      title: 'Old title',
      measurements: {
        'SE-1': { label: 'SE-1', actualCm: 402, updatedAt: '2026-11-21T01:00:00.000Z' },
        'SE-2': { label: 'SE-2', actualCm: 300, updatedAt: '2026-11-21T01:00:00.000Z' },
      },
      roomNotes: { SE: 'note v1' },
      elements: [
        { id: 'el1', roomId: 'room_SE', wallStart: 'v1', kind: 'door', offsetCm: 10, widthCm: 90, createdAt: '2026-11-21T01:00:00.000Z', updatedAt: '2026-11-21T01:00:00.000Z' } as PlanDocV1['elements'][number],
      ],
    })
    await commitDoc(db as unknown as D1Database, 'p2', v0, doc1)

    const v1 = (await loadProjectDoc(db as unknown as D1Database, 'p2'))!
    expect(v1.version).toBe(1)
    const doc2 = makeDoc('p2', {
      title: 'Old title', // unchanged -> projects.title stays
      measurements: { 'SE-1': { label: 'SE-1', actualCm: 405, updatedAt: '2026-11-21T02:00:00.000Z' } }, // SE-2 removed, SE-1 changed
      roomNotes: { SE: 'note v2' },
      elements: [], // el1 removed -> soft delete
    })
    const { version } = await commitDoc(db as unknown as D1Database, 'p2', v1, doc2)
    expect(version).toBe(2)

    expect(db.measurements.has('p2|SE-2')).toBe(false)
    expect(db.measurements.get('p2|SE-1')!.actual_cm).toBe(405)
    expect(db.roomNotes.get('p2|SE')!.text).toBe('note v2')
    expect(db.surveyItems.get('el1')!.deleted).toBe(1)

    const v2 = (await loadProjectDoc(db as unknown as D1Database, 'p2'))!
    expect(v2.version).toBe(2)
    expect(Object.keys(v2.doc.measurements)).toEqual(['SE-1'])
    expect(v2.doc.elements).toHaveLength(0)
    expect(v2.doc.roomNotes.SE).toBe('note v2')
    // custom name kept, title unchanged
    expect(db.projects.get('p2')!.name).toBe('Custom name')
    expect(db.projects.get('p2')!.title).toBe('Old title')
  })

  it('carries the measurement source through the table, and NULL source = no source in JSON', async () => {
    const db = new FakeDB()
    addProject(db, 'p5')
    const v0 = (await loadProjectDoc(db as unknown as D1Database, 'p5'))!
    const doc1 = makeDoc('p5', {
      measurements: {
        'SE-1': { label: 'SE-1', actualCm: 402, updatedAt: '2026-11-21T01:00:00.000Z', source: 'laser' },
        'SE-2': { label: 'SE-2', actualCm: 300, updatedAt: '2026-11-21T01:00:00.000Z' },
      },
    })
    await commitDoc(db as unknown as D1Database, 'p5', v0, doc1)
    expect(db.measurements.get('p5|SE-1')!.source).toBe('laser')
    // No source in the doc: the column stays NULL, no 'tape' is written.
    expect(db.measurements.get('p5|SE-2')!.source).toBeNull()

    const v1 = (await loadProjectDoc(db as unknown as D1Database, 'p5'))!
    expect(v1.doc.measurements['SE-1'].source).toBe('laser')
    // NULL in the database is no source in JSON (the client then uses tape).
    expect(v1.doc.measurements['SE-2'].source).toBeUndefined()

    // A source change alone is a change: it is written.
    const doc2 = makeDoc('p5', {
      measurements: {
        'SE-1': { label: 'SE-1', actualCm: 402, updatedAt: '2026-11-21T01:00:00.000Z', source: 'plan' },
        'SE-2': { label: 'SE-2', actualCm: 300, updatedAt: '2026-11-21T01:00:00.000Z' },
      },
    })
    await commitDoc(db as unknown as D1Database, 'p5', v1, doc2)
    expect(db.measurements.get('p5|SE-1')!.source).toBe('plan')
  })

  it('commitDoc throws VersionConflictError on baseVersion mismatch (routes answer 409)', async () => {
    const db = new FakeDB()
    addProject(db, 'p3')
    const v0 = (await loadProjectDoc(db as unknown as D1Database, 'p3'))!
    await commitDoc(db as unknown as D1Database, 'p3', v0, makeDoc('p3'))
    const v1 = (await loadProjectDoc(db as unknown as D1Database, 'p3'))!
    expect(v1.version).toBe(1)

    await expect(commitDoc(db as unknown as D1Database, 'p3', v1, makeDoc('p3'), 0)).rejects.toBeInstanceOf(
      VersionConflictError,
    )
    try {
      await commitDoc(db as unknown as D1Database, 'p3', v1, makeDoc('p3'), 0)
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(VersionConflictError)
      expect((err as VersionConflictError).latestVersion).toBe(1)
    }
    // matching baseVersion works
    const { version } = await commitDoc(db as unknown as D1Database, 'p3', v1, makeDoc('p3'), 1)
    expect(version).toBe(2)
  })

  it('commitDoc keeps apartment data (default ceiling height + surface reference) in the snapshot', async () => {
    const db = new FakeDB()
    addProject(db, 'p5')
    const v0 = (await loadProjectDoc(db as unknown as D1Database, 'p5'))!
    expect(v0.doc.apartment).toBeUndefined()

    const doc = makeDoc('p5', {
      apartment: {
        defaultCeilingCm: 250,
        references: [{ id: 'ref_1', source: 'dpe', label: 'DPE 2023', surfaceM2: 62.4, date: '2023-05-12' }],
      },
    })
    const { version } = await commitDoc(db as unknown as D1Database, 'p5', v0, doc)
    expect(version).toBe(1)

    const loaded = await loadProjectDoc(db as unknown as D1Database, 'p5')
    expect(loaded!.version).toBe(1)
    expect(loaded!.doc.apartment?.defaultCeilingCm).toBe(250)
    expect(loaded!.doc.apartment?.references).toHaveLength(1)
    expect(loaded!.doc.apartment?.references?.[0]).toEqual({
      id: 'ref_1',
      source: 'dpe',
      label: 'DPE 2023',
      surfaceM2: 62.4,
      date: '2023-05-12',
    })
  })

  it('commitDoc appends extraStatements to the same batch (idempotency keys)', async () => {
    const db = new FakeDB()
    addProject(db, 'p4')
    const v0 = (await loadProjectDoc(db as unknown as D1Database, 'p4'))!
    const extra = [
      db
        .prepare(
          'INSERT INTO idempotency_keys (project_id, key, status_code, response_json, created_at) VALUES (?, ?, 200, ?, ?) ON CONFLICT(project_id, key) DO NOTHING',
        )
        .bind('p4', 'key-1', '{"ok":true}', '2026-11-21T03:00:00.000Z'),
    ]
    await commitDoc(db as unknown as D1Database, 'p4', v0, makeDoc('p4'), undefined, extra as unknown as D1PreparedStatement[])
    expect(db.idempotencyKeys.get('p4|key-1')!.response_json).toBe('{"ok":true}')
    expect(db.snapshots.filter((s) => s.project_id === 'p4')).toHaveLength(1)
  })

  it('commitDoc stores and loadProjectDoc returns nodes, walls and oldMeasurements (round trip)', async () => {
    const db = new FakeDB()
    addProject(db, 'g1')
    const v0 = (await loadProjectDoc(db as unknown as D1Database, 'g1'))!
    expect(v0.doc.walls).toBeUndefined()
    const nodes = [{ id: 'N1', x: 0, y: 0 }, { id: 'N2', x: 300, y: 0 }]
    const walls = [{
      id: 'W1', a: 'N1', b: 'N2',
      faces: [{ side: 'R' as const, roomId: 'r1', wallStart: 'v0', from: 0, to: 300 }, { side: 'L' as const, from: 0, to: 300 }],
    }]
    const oldMeasurements = [{
      label: 'SE-2', actualCm: 412, updatedAt: '2026-11-01T10:00:00.000Z', source: 'laser' as const,
      roomCode: 'SE', reason: 'wall-split' as const, droppedAt: '2026-11-23T12:00:00.000Z',
    }]
    const doc = makeDoc('g1', { nodes, walls, oldMeasurements })
    await commitDoc(db as unknown as D1Database, 'g1', v0, doc)
    // The snapshot JSON holds them, like rooms.
    const snap = JSON.parse(String(db.snapshots[0].data_json))
    expect(snap.nodes).toEqual(nodes)
    expect(snap.walls).toEqual(walls)
    expect(snap.oldMeasurements).toEqual(oldMeasurements)
    const loaded = await loadProjectDoc(db as unknown as D1Database, 'g1')
    expect(loaded!.doc.nodes).toEqual(nodes)
    expect(loaded!.doc.walls).toEqual(walls)
    expect(loaded!.doc.oldMeasurements).toEqual(oldMeasurements)
  })

  it('snapshot versions are appended (old values stay in every version after the move)', async () => {
    const db = new FakeDB()
    addProject(db, 'g2')
    const old = [{ label: 'SE-2', actualCm: 412, updatedAt: 'a', roomCode: 'SE', reason: 'room-deleted' as const, droppedAt: 'b' }]
    let prev = (await loadProjectDoc(db as unknown as D1Database, 'g2'))!
    await commitDoc(db as unknown as D1Database, 'g2', prev, makeDoc('g2', { oldMeasurements: old }))
    prev = (await loadProjectDoc(db as unknown as D1Database, 'g2'))!
    await commitDoc(db as unknown as D1Database, 'g2', prev, { ...prev.doc, title: 'next' })
    expect(db.snapshots.filter((x) => x.project_id === 'g2').map((x) => x.version)).toEqual([1, 2])
    expect(JSON.parse(String(db.snapshots[1].data_json)).oldMeasurements).toEqual(old)
  })

  it('carryOldMeasurements keeps the old values for a client that does not send them', () => {
    const old = [{ label: 'SE-2', actualCm: 412 }]
    expect(carryOldMeasurements(JSON.stringify({ rooms: [], oldMeasurements: old }))).toEqual(old)
    expect(carryOldMeasurements(JSON.stringify({ rooms: [] }))).toBeUndefined()
    expect(carryOldMeasurements(JSON.stringify({ oldMeasurements: [] }))).toBeUndefined()
    expect(carryOldMeasurements(undefined)).toBeUndefined()
    expect(carryOldMeasurements('not json')).toBeUndefined()
  })
})
