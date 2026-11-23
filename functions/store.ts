// Single shared D1 persistence implementation for Simple Floorplan.
// Used by the commands route (functions/app.ts), the .sfp PUT route
// (functions/routes/formats.ts) and the MCP server (functions/mcp/store.ts).
//
// Storage layout: one row per snapshot version in floorplan_snapshots (the
// snapshot JSON holds everything EXCEPT measurements/roomNotes, which live in
// their own tables; survey items are mirrored in survey_items with soft deletes).
import { PRUNE_SNAPSHOTS_SQL, pruneCutoffVersion } from '../src/sync/projects'
import { parsePlan, type PlanDocV1 } from '../src/core/schema'
import { syncProjectTitle } from './routes/projectTitle'

export type ProjectRow = { id: string; name: string; title: string | null; updated_at: string }
export type MeasurementRow = { label: string; actual_cm: number; updated_at: string; source: string | null }

export type LoadedProjectDoc = {
  project: ProjectRow
  doc: PlanDocV1
  version: number
}

/**
 * Old values of the last snapshot, to keep when a client sends a snapshot WITHOUT the field (an old
 * cached client does not know it). Returns undefined when there is nothing to carry.
 */
export function carryOldMeasurements(prevDataJson: string | undefined): unknown[] | undefined {
  if (!prevDataJson) return undefined
  try {
    const prev = JSON.parse(prevDataJson) as { oldMeasurements?: unknown }
    return Array.isArray(prev.oldMeasurements) && prev.oldMeasurements.length ? prev.oldMeasurements : undefined
  } catch {
    return undefined // corrupt previous snapshot: nothing to carry
  }
}

/** Thrown by commitDoc when baseVersion does not match the loaded version (routes answer 409). */
export class VersionConflictError extends Error {
  latestVersion: number
  constructor(latestVersion: number) {
    super(`version_conflict: latest version is ${latestVersion}`)
    this.name = 'VersionConflictError'
    this.latestVersion = latestVersion
  }
}

const nowIso = (): string => new Date().toISOString()

// A NULL source in the database means "no source given" (old rows), which is no
// `source` field in JSON: the client then uses the default source (tape).
const toMeasurement = (r: MeasurementRow) => ({
  label: r.label,
  actualCm: r.actual_cm,
  updatedAt: r.updated_at,
  ...(r.source == null ? {} : { source: r.source }),
})

/** Load the latest snapshot merged with measurements, survey items and room notes. */
export async function loadProjectDoc(db: D1Database, id: string): Promise<LoadedProjectDoc | null> {
  const project = await db.prepare('SELECT * FROM projects WHERE id = ?').bind(id).first<ProjectRow>()
  if (!project) return null

  const snap = await db
    .prepare('SELECT data_json, version FROM floorplan_snapshots WHERE project_id = ? ORDER BY version DESC LIMIT 1')
    .bind(id)
    .first<{ data_json: string; version: number }>()

  const base: Record<string, unknown> = snap ? JSON.parse(snap.data_json) : {}

  const measurements: Record<string, unknown> = {}
  const { results: mRows } = await db
    .prepare('SELECT label, actual_cm, updated_at, source FROM measurements WHERE project_id = ?')
    .bind(id)
    .all<MeasurementRow>()
  for (const r of mRows) measurements[r.label] = toMeasurement(r)

  const elements: unknown[] = []
  const { results: iRows } = await db
    .prepare('SELECT data_json FROM survey_items WHERE project_id = ? AND deleted = 0')
    .bind(id)
    .all<{ data_json: string }>()
  for (const r of iRows) {
    try {
      elements.push(JSON.parse(r.data_json))
    } catch {
      // skip corrupt rows
    }
  }

  const roomNotes: Record<string, string> = {}
  const { results: nRows } = await db
    .prepare('SELECT room_code, text FROM room_notes WHERE project_id = ?')
    .bind(id)
    .all<{ room_code: string; text: string }>()
  for (const r of nRows) roomNotes[r.room_code] = r.text

  const doc = parsePlan({
    schemaVersion: base.schemaVersion ?? 1,
    projectId: id,
    title: typeof base.title === 'string' ? base.title : (project.title ?? ''),
    background: base.background,
    rooms: Array.isArray(base.rooms) ? base.rooms : [],
    elements,
    tapes: Array.isArray(base.tapes) ? base.tapes : [],
    pins: Array.isArray(base.pins) ? base.pins : [],
    ...(base.apartment ? { apartment: base.apartment } : {}),
    // Stored wall graph and old values (phase 5a): doc fields in the snapshot JSON, like rooms.
    ...(Array.isArray(base.nodes) ? { nodes: base.nodes } : {}),
    ...(Array.isArray(base.walls) ? { walls: base.walls } : {}),
    ...(Array.isArray(base.oldMeasurements) ? { oldMeasurements: base.oldMeasurements } : {}),
    measurements,
    roomNotes,
  })

  return { project, doc, version: snap?.version ?? 0 }
}

/**
 * Atomically commit the next doc as a new snapshot version: inserts the snapshot,
 * diffs measurements / survey_items / room_notes into their tables, syncs
 * projects.title (and updated_at) via syncProjectTitle, and prunes old snapshots.
 *
 * Throws VersionConflictError when `baseVersion` is given and differs from
 * `prev.version` (callers translate that into a 409 response).
 * `extraStatements` are appended to the same batch (used for idempotency keys).
 */
export async function commitDoc(
  db: D1Database,
  id: string,
  prev: { doc: PlanDocV1; version: number },
  nextDoc: PlanDocV1,
  baseVersion?: number,
  extraStatements?: D1PreparedStatement[],
): Promise<{ version: number; updatedAt: string }> {
  if (baseVersion !== undefined && baseVersion !== prev.version) {
    throw new VersionConflictError(prev.version)
  }
  const version = prev.version + 1
  const now = nowIso()
  const { measurements: nextMeasurements, roomNotes: nextNotes, ...snapshotFields } = nextDoc

  const statements: D1PreparedStatement[] = []

  // 1. New snapshot version
  statements.push(
    db
      .prepare('INSERT INTO floorplan_snapshots (id, project_id, data_json, version, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), id, JSON.stringify(snapshotFields), version, now),
  )

  // 2. Sync measurements table (diff prev -> next)
  const prevM = prev.doc.measurements
  for (const label of Object.keys(prevM)) {
    if (!(label in nextMeasurements)) {
      statements.push(db.prepare('DELETE FROM measurements WHERE project_id = ? AND label = ?').bind(id, label))
    }
  }
  for (const [label, m] of Object.entries(nextMeasurements)) {
    const old = prevM[label]
    if (!old || old.actualCm !== m.actualCm || old.updatedAt !== m.updatedAt || old.source !== m.source) {
      statements.push(
        db
          .prepare(
            `INSERT INTO measurements (project_id, label, actual_cm, updated_at, source) VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(project_id, label) DO UPDATE SET actual_cm = excluded.actual_cm, updated_at = excluded.updated_at, source = excluded.source`,
          )
          .bind(id, label, m.actualCm, m.updatedAt, m.source ?? null),
      )
    }
  }

  // 3. Sync survey_items table (soft-delete removed, upsert added/changed)
  const prevEls = new Map(prev.doc.elements.map((e) => [e.id, e]))
  const nextEls = new Map(nextDoc.elements.map((e) => [e.id, e]))
  for (const [elId] of prevEls) {
    if (!nextEls.has(elId)) {
      statements.push(
        db
          .prepare(
            `INSERT INTO survey_items (id, project_id, data_json, updated_at, deleted) VALUES (?, ?, ?, ?, 1)
             ON CONFLICT(id) DO UPDATE SET deleted = 1, updated_at = excluded.updated_at`,
          )
          .bind(elId, id, JSON.stringify({ id: elId }), now),
      )
    }
  }
  for (const [elId, el] of nextEls) {
    const old = prevEls.get(elId)
    const serialized = JSON.stringify(el)
    if (!old || JSON.stringify(old) !== serialized) {
      statements.push(
        db
          .prepare(
            `INSERT INTO survey_items (id, project_id, data_json, updated_at, deleted) VALUES (?, ?, ?, ?, 0)
             ON CONFLICT(id) DO UPDATE SET data_json = excluded.data_json, updated_at = excluded.updated_at, deleted = 0`,
          )
          .bind(elId, id, serialized, el.updatedAt || now),
      )
    }
  }

  // 4. Sync room_notes table
  const prevNotes = prev.doc.roomNotes
  for (const code of Object.keys(prevNotes)) {
    if (!(code in nextNotes)) {
      statements.push(db.prepare('DELETE FROM room_notes WHERE project_id = ? AND room_code = ?').bind(id, code))
    }
  }
  for (const [code, text] of Object.entries(nextNotes)) {
    if (prevNotes[code] !== text) {
      statements.push(
        db
          .prepare(
            `INSERT INTO room_notes (project_id, room_code, text, updated_at) VALUES (?, ?, ?, ?)
             ON CONFLICT(project_id, room_code) DO UPDATE SET text = excluded.text, updated_at = excluded.updated_at`,
          )
          .bind(id, code, text, now),
      )
    }
  }

  // 5. Prune old snapshots (keep the last 50 per project)
  statements.push(db.prepare(PRUNE_SNAPSHOTS_SQL).bind(id, pruneCutoffVersion(version)))

  if (extraStatements) statements.push(...extraStatements)

  await db.batch(statements)
  // 6. Keep projects.title (and a default name) in sync; always bumps updated_at.
  await syncProjectTitle(db, id, nextDoc.title, now)
  return { version, updatedAt: now }
}
