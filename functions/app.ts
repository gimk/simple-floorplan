// Hono API for Simple Floorplan.
// Storage: D1 (binding DB) for structured data, R2 (binding IMAGES) for images.
// Auth: `Authorization: Bearer sfp_...` or the legacy `x-passcode` header (see auth.ts).
// Mounted by the Worker entry (functions/worker.ts) at the /api prefix.
import { Hono } from 'hono'
import { ZodError } from 'zod'
import { PRUNE_SNAPSHOTS_SQL, pruneCutoffVersion } from '../src/sync/projects'
import { planJsonSchema, SnapshotPutBodySchema } from '../src/core/schema'
import { applyBatch, CommandError, CommandsBatchRequestSchema } from '../src/core/commands'
import { QueryError, querySummary, runQuery } from '../src/core/queries'
import { renderPlanSvg } from '../src/core/export'
import { registerFormatsRoutes } from './routes/formats'
import { OPENAPI_SPEC } from './openapi'
import { mcpRoutes } from './routes/mcp'
import { accessMiddleware, registerAccessRoutes } from './auth'
import { syncProjectTitle } from './routes/projectTitle'
import { commitDoc, loadProjectDoc, type ProjectRow } from './store'
import { checkUpload, parseCaps, uploadWindowStartIso } from '../src/core/caps'

/** Bindings and vars this API needs. The Worker entry adds the ASSETS binding. */
export type Env = {
  DB: D1Database
  IMAGES: R2Bucket
  PASSCODE?: string
  // Cost caps from wrangler.toml [vars]; missing values use the defaults in src/core/caps.ts.
  MAX_UPLOAD_MB?: string
  MAX_R2_TOTAL_MB?: string
  MAX_UPLOADS_PER_DAY?: string
}

export const app = new Hono<{ Bindings: Env }>().basePath('/api')

// ---------- small helpers ----------

const nowIso = (): string => new Date().toISOString()

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const asNumber = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null

/** Returns the string if it parses as a date, else null. */
const asIso = (v: unknown): string | null => {
  if (typeof v !== 'string') return null
  return Number.isNaN(Date.parse(v)) ? null : v
}

const MEASURE_SOURCES = ['tape', 'laser', 'plan', 'other'] as const

/** Returns the measurement source if it is a known one, else null. Missing = null (tape). */
const asSource = (v: unknown): string | null =>
  typeof v === 'string' && (MEASURE_SOURCES as readonly string[]).includes(v) ? v : null

const badRequest = (c: { json: (b: unknown, s: 400) => Response }, msg: string, extra?: Record<string, unknown>) =>
  c.json({ error: msg, ...extra }, 400)

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(bin)
}

// ---------- row types ----------

type MeasurementRow = { label: string; actual_cm: number; updated_at: string }
type ItemRow = { id: string; data_json: string; updated_at: string; deleted: number }
type NoteRow = { room_code: string; text: string; updated_at: string }

// ---------- auth middleware ----------
// Scoped Bearer tokens + legacy x-passcode, per-route scope enforcement, and the
// write-event log all live in functions/auth.ts (pure logic: src/core/access.ts).

app.use('*', accessMiddleware)

// ---------- discovery endpoints ----------

app.get('/openapi.json', (c) => c.json(OPENAPI_SPEC))

app.get('/schema/plan.v1.json', (c) => {
  return new Response(JSON.stringify(planJsonSchema(), null, 2), {
    status: 200,
    headers: { 'content-type': 'application/schema+json; charset=utf-8' },
  })
})

// ---------- helpers ----------

async function projectExists(db: D1Database, id: string): Promise<boolean> {
  const row = await db.prepare('SELECT id FROM projects WHERE id = ?').bind(id).first<{ id: string }>()
  return row !== null
}

const notFound = (c: { json: (b: unknown, s: 404) => Response }) => c.json({ error: 'not_found' }, 404)

// A NULL source in the database (old row) is no `source` field in JSON: the client
// then uses the default source (tape).
const toMeasurement = (r: MeasurementRow) => ({
  label: r.label,
  actualCm: r.actual_cm,
  updatedAt: r.updated_at,
  ...(r.source == null ? {} : { source: r.source }),
})

// ---------- projects ----------

app.get('/projects', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT id, name, title, updated_at FROM projects ORDER BY updated_at DESC',
  ).all<ProjectRow>()
  return c.json(
    results.map((r) => ({ id: r.id, name: r.name, title: r.title, updatedAt: r.updated_at })),
  )
})

app.post('/projects', async (c) => {
  const body: unknown = await c.req.json().catch(() => null)
  if (!isObj(body)) return badRequest(c, 'body must be a JSON object')
  const name =
    typeof body.name === 'string' && body.name.trim() ? body.name.trim() : 'New project'
  const title = typeof body.title === 'string' ? body.title : null
  const id = crypto.randomUUID()
  const now = nowIso()
  await c.env.DB.prepare('INSERT INTO projects (id, name, title, updated_at) VALUES (?, ?, ?, ?)').bind(
    id,
    name,
    title,
    now,
  ).run()
  return c.json({ id, name, title, updatedAt: now }, 201)
})

// PATCH /projects/:id — rename ({ name?, title? }).
app.patch('/projects/:id', async (c) => {
  const id = c.req.param('id')
  const body: unknown = await c.req.json().catch(() => null)
  if (!isObj(body)) return badRequest(c, 'body must be a JSON object')
  const row = await c.env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(id).first<ProjectRow>()
  if (!row) return notFound(c)
  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : row.name
  const title = typeof body.title === 'string' ? body.title : row.title
  const now = nowIso()
  await c.env.DB.prepare('UPDATE projects SET name = ?, title = ?, updated_at = ? WHERE id = ?').bind(name, title, now, id).run()
  return c.json({ id, name, title, updatedAt: now })
})

// DELETE /projects/:id — the project, all its rows and its R2 images.
app.delete('/projects/:id', async (c) => {
  const id = c.req.param('id')
  if (!(await projectExists(c.env.DB, id))) return notFound(c)
  const { results } = await c.env.DB.prepare('SELECT key FROM images WHERE project_id = ?').bind(id).all<{ key: string }>()
  const keys = results.map((r) => r.key)
  // R2 delete takes up to 1000 keys per call.
  for (let i = 0; i < keys.length; i += 1000) await c.env.IMAGES.delete(keys.slice(i, i + 1000))
  // Explicit deletes: do not rely on foreign-key cascades being enabled.
  // The images rows go too, so SUM(size_bytes) stays exact for the R2 cost caps.
  await c.env.DB.batch(
    ['floorplan_snapshots', 'measurements', 'survey_items', 'room_notes', 'images'].map((t) =>
      c.env.DB.prepare(`DELETE FROM ${t} WHERE project_id = ?`).bind(id),
    ).concat(c.env.DB.prepare('DELETE FROM projects WHERE id = ?').bind(id)),
  )
  // Clean up idempotency_keys if migration 0002 is applied.
  await c.env.DB.prepare('DELETE FROM idempotency_keys WHERE project_id = ?').bind(id).run().catch(() => undefined)
  return c.json({ ok: true })
})

// GET /projects/:id — latest snapshot merged with measurements, items and notes
// into a PlanDoc-shaped JSON (plus `version` for optimistic concurrency).
app.get('/projects/:id', async (c) => {
  const id = c.req.param('id')
  const loaded = await loadProjectDoc(c.env.DB, id)
  if (!loaded) return notFound(c)
  return c.json({
    ...loaded.doc,
    version: loaded.version,
  })
})

// PUT /projects/:id/snapshot — body = PlanDoc minus measurements/roomNotes, plus
// baseVersion. 409 with the latest version if baseVersion does not match.
app.put('/projects/:id/snapshot', async (c) => {
  const id = c.req.param('id')
  if (!(await projectExists(c.env.DB, id))) return notFound(c)
  const rawBody: unknown = await c.req.json().catch(() => null)
  const parsed = SnapshotPutBodySchema.safeParse(rawBody)
  if (!parsed.success) {
    return badRequest(c, 'invalid snapshot payload', { issues: parsed.error.issues })
  }
  const { baseVersion, measurements: _m, roomNotes: _n, ...snapshotData } = parsed.data

  const latest = await c.env.DB.prepare(
    'SELECT MAX(version) AS v FROM floorplan_snapshots WHERE project_id = ?',
  )
    .bind(id)
    .first<{ v: number | null }>()
  const latestVersion = latest?.v ?? 0
  if (baseVersion !== latestVersion) {
    return c.json({ error: 'version_conflict', latestVersion }, 409)
  }
  const version = latestVersion + 1
  const now = nowIso()
  await c.env.DB.prepare(
    'INSERT INTO floorplan_snapshots (id, project_id, data_json, version, created_at) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(crypto.randomUUID(), id, JSON.stringify({ ...snapshotData, projectId: id }), version, now)
    .run()
  // Keep the projects list in sync: projects.title (and a default name) follow the snapshot title.
  await syncProjectTitle(c.env.DB, id, snapshotData.title, now)
  // Keep only the last 50 snapshots per project.
  await c.env.DB.prepare(PRUNE_SNAPSHOTS_SQL).bind(id, pruneCutoffVersion(version)).run()
  return c.json({ version })
})

// ---------- high-level commands (atomic batch + dryRun + Idempotency-Key) ----------

app.post('/projects/:id/commands', async (c) => {
  const id = c.req.param('id')
  const rawBody: unknown = await c.req.json().catch(() => null)
  const parsedReq = CommandsBatchRequestSchema.safeParse(rawBody)
  if (!parsedReq.success) {
    return badRequest(c, 'invalid commands payload', { issues: parsedReq.error.issues })
  }
  const { commands, dryRun, baseVersion } = parsedReq.data
  const idempotencyKey = c.req.header('Idempotency-Key')?.trim() || null

  // Replay cached response if Idempotency-Key was already committed.
  if (idempotencyKey && !dryRun) {
    const cached = await c.env.DB.prepare(
      'SELECT status_code, response_json FROM idempotency_keys WHERE project_id = ? AND key = ?',
    )
      .bind(id, idempotencyKey)
      .first<{ status_code: number; response_json: string }>()
    if (cached) {
      return new Response(cached.response_json, {
        status: cached.status_code,
        headers: { 'content-type': 'application/json; charset=utf-8', 'x-idempotent-replay': 'true' },
      })
    }
  }

  const loaded = await loadProjectDoc(c.env.DB, id)
  if (!loaded) return notFound(c)

  if (baseVersion !== undefined && baseVersion !== loaded.version) {
    return c.json({ error: 'version_conflict', latestVersion: loaded.version }, 409)
  }

  let applied: ReturnType<typeof applyBatch>
  try {
    applied = applyBatch(loaded.doc, commands)
  } catch (err) {
    if (err instanceof CommandError) {
      return badRequest(c, err.code, {
        message: err.message,
        commandIndex: (err as Error & { commandIndex?: number }).commandIndex,
      })
    }
    if (err instanceof ZodError) {
      return badRequest(c, 'INVALID_COMMAND', {
        issues: err.issues,
        commandIndex: (err as Error & { commandIndex?: number }).commandIndex,
      })
    }
    throw err
  }

  const nextDoc = applied.doc
  const summary = querySummary(nextDoc)

  if (dryRun) {
    return c.json({
      dryRun: true,
      version: loaded.version,
      doc: nextDoc,
      results: applied.results,
      warnings: applied.warnings,
      summary,
    })
  }

  const responsePayload = {
    version: loaded.version + 1,
    results: applied.results,
    warnings: applied.warnings,
    summary,
  }

  // Shared persistence (snapshot + measurements + items + notes + title sync).
  // The idempotency-key row joins the same atomic batch.
  const extraStatements: D1PreparedStatement[] = []
  if (idempotencyKey) {
    extraStatements.push(
      c.env.DB.prepare(
        `INSERT INTO idempotency_keys (project_id, key, status_code, response_json, created_at) VALUES (?, ?, 200, ?, ?)
         ON CONFLICT(project_id, key) DO NOTHING`,
      ).bind(id, idempotencyKey, JSON.stringify(responsePayload), nowIso()),
    )
  }
  const { version } = await commitDoc(c.env.DB, id, loaded, nextDoc, baseVersion, extraStatements)
  return c.json({ ...responsePayload, version })
})

// ---------- semantic queries ----------

app.post('/projects/:id/query', async (c) => {
  const id = c.req.param('id')
  const loaded = await loadProjectDoc(c.env.DB, id)
  if (!loaded) return notFound(c)
  const rawBody: unknown = await c.req.json().catch(() => null)
  try {
    const result = runQuery(loaded.doc, rawBody)
    return c.json(result)
  } catch (err) {
    if (err instanceof QueryError) {
      if (err.code === 'ROOM_NOT_FOUND') return c.json({ error: err.code, message: err.message }, 404)
      return badRequest(c, err.code, { message: err.message })
    }
    if (err instanceof ZodError) {
      return badRequest(c, 'INVALID_QUERY', { issues: err.issues })
    }
    throw err
  }
})

// ---------- headless SVG render ----------

app.get('/projects/:id/render.svg', async (c) => {
  const id = c.req.param('id')
  const loaded = await loadProjectDoc(c.env.DB, id)
  if (!loaded) return notFound(c)

  const includeBg = c.req.query('background') === '1'
  let backgroundHref: string | undefined
  if (includeBg && loaded.doc.background) {
    const bg = loaded.doc.background
    if (bg.r2Key) {
      const obj = await c.env.IMAGES.get(bg.r2Key)
      if (obj) {
        const ct = obj.httpMetadata?.contentType ?? 'image/png'
        const b64 = arrayBufferToBase64(await obj.arrayBuffer())
        backgroundHref = `data:${ct};base64,${b64}`
      }
    } else if (bg.src && bg.src.startsWith('data:')) {
      backgroundHref = bg.src
    }
  }

  const { svg } = renderPlanSvg(loaded.doc, { background: includeBg, backgroundHref })
  return new Response(svg, {
    status: 200,
    headers: { 'content-type': 'image/svg+xml; charset=utf-8' },
  })
})

// ---------- measurements (last-write-wins by updated_at) ----------

app.put('/projects/:id/measurements/:label', async (c) => {
  const id = c.req.param('id')
  const label = c.req.param('label')
  if (!(await projectExists(c.env.DB, id))) return notFound(c)
  const body: unknown = await c.req.json().catch(() => null)
  if (!isObj(body)) return badRequest(c, 'body must be a JSON object')
  const actualCm = asNumber(body.actualCm)
  if (actualCm === null) return badRequest(c, 'actualCm must be a finite number')
  // How the value was measured. Missing or unknown = no source (the client uses tape).
  const source = asSource(body.source)
  const updatedAt = asIso(body.updatedAt) ?? nowIso()
  const existing = await c.env.DB.prepare(
    'SELECT label, actual_cm, updated_at, source FROM measurements WHERE project_id = ? AND label = ?',
  )
    .bind(id, label)
    .first<MeasurementRow>()
  if (existing && existing.updated_at >= updatedAt) {
    return c.json({ ok: true, ignored: true, measurement: toMeasurement(existing) })
  }
  await c.env.DB.prepare(
    `INSERT INTO measurements (project_id, label, actual_cm, updated_at, source) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(project_id, label) DO UPDATE SET actual_cm = excluded.actual_cm, updated_at = excluded.updated_at, source = excluded.source`,
  )
    .bind(id, label, actualCm, updatedAt, source)
    .run()
  await c.env.DB.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').bind(updatedAt, id).run()
  return c.json({
    ok: true,
    ignored: false,
    measurement: { label, actualCm, updatedAt, ...(source == null ? {} : { source }) },
  })
})

app.delete('/projects/:id/measurements/:label', async (c) => {
  const id = c.req.param('id')
  const label = c.req.param('label')
  if (!(await projectExists(c.env.DB, id))) return notFound(c)
  await c.env.DB.prepare('DELETE FROM measurements WHERE project_id = ? AND label = ?').bind(id, label).run()
  return c.json({ ok: true })
})

// ---------- survey items (soft delete, last-write-wins) ----------

app.put('/projects/:id/items/:itemId', async (c) => {
  const id = c.req.param('id')
  const itemId = c.req.param('itemId')
  if (!(await projectExists(c.env.DB, id))) return notFound(c)
  const body: unknown = await c.req.json().catch(() => null)
  if (!isObj(body)) return badRequest(c, 'body must be a JSON object')
  if (typeof body.id === 'string' && body.id !== itemId) return badRequest(c, 'body id does not match URL id')
  const updatedAt = asIso(body.updatedAt) ?? nowIso()
  const data: Record<string, unknown> = { ...body, id: itemId }
  const existing = await c.env.DB.prepare(
    'SELECT data_json, updated_at, deleted FROM survey_items WHERE id = ? AND project_id = ?',
  )
    .bind(itemId, id)
    .first<ItemRow>()
  if (existing && existing.updated_at >= updatedAt) {
    let parsed: unknown = null
    try {
      parsed = JSON.parse(existing.data_json)
    } catch {
      // ignore
    }
    return c.json({ ok: true, ignored: true, item: { id: itemId, data: parsed, updatedAt: existing.updated_at, deleted: existing.deleted === 1 } })
  }
  await c.env.DB.prepare(
    `INSERT INTO survey_items (id, project_id, data_json, updated_at, deleted) VALUES (?, ?, ?, ?, 0)
     ON CONFLICT(id) DO UPDATE SET data_json = excluded.data_json, updated_at = excluded.updated_at, deleted = 0`,
  )
    .bind(itemId, id, JSON.stringify(data), updatedAt)
    .run()
  await c.env.DB.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').bind(updatedAt, id).run()
  return c.json({ ok: true, ignored: false, item: { id: itemId, data, updatedAt, deleted: false } })
})

app.delete('/projects/:id/items/:itemId', async (c) => {
  const id = c.req.param('id')
  const itemId = c.req.param('itemId')
  if (!(await projectExists(c.env.DB, id))) return notFound(c)
  const updatedAt = nowIso()
  const existing = await c.env.DB.prepare('SELECT id FROM survey_items WHERE id = ? AND project_id = ?')
    .bind(itemId, id)
    .first<{ id: string }>()
  if (existing) {
    await c.env.DB.prepare('UPDATE survey_items SET deleted = 1, updated_at = ? WHERE id = ? AND project_id = ?')
      .bind(updatedAt, itemId, id)
      .run()
  } else {
    // tombstone so other devices learn about the delete
    await c.env.DB.prepare(
      'INSERT INTO survey_items (id, project_id, data_json, updated_at, deleted) VALUES (?, ?, ?, ?, 1)',
    )
      .bind(itemId, id, JSON.stringify({ id: itemId }), updatedAt)
      .run()
  }
  await c.env.DB.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').bind(updatedAt, id).run()
  return c.json({ ok: true, item: { id: itemId, updatedAt, deleted: true } })
})

// ---------- room notes (last-write-wins) ----------

app.put('/projects/:id/notes/:code', async (c) => {
  const id = c.req.param('id')
  const code = c.req.param('code')
  if (!(await projectExists(c.env.DB, id))) return notFound(c)
  const body: unknown = await c.req.json().catch(() => null)
  if (!isObj(body)) return badRequest(c, 'body must be a JSON object')
  if (typeof body.text !== 'string') return badRequest(c, 'text must be a string')
  const updatedAt = asIso(body.updatedAt) ?? nowIso()
  const existing = await c.env.DB.prepare(
    'SELECT room_code, text, updated_at FROM room_notes WHERE project_id = ? AND room_code = ?',
  )
    .bind(id, code)
    .first<NoteRow>()
  if (existing && existing.updated_at >= updatedAt) {
    return c.json({
      ok: true,
      ignored: true,
      note: { roomCode: existing.room_code, text: existing.text, updatedAt: existing.updated_at },
    })
  }
  await c.env.DB.prepare(
    `INSERT INTO room_notes (project_id, room_code, text, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(project_id, room_code) DO UPDATE SET text = excluded.text, updated_at = excluded.updated_at`,
  )
    .bind(id, code, body.text, updatedAt)
    .run()
  await c.env.DB.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').bind(updatedAt, id).run()
  return c.json({ ok: true, ignored: false, note: { roomCode: code, text: body.text, updatedAt } })
})

// ---------- changes feed (for live sync from other devices) ----------

app.get('/projects/:id/changes', async (c) => {
  const id = c.req.param('id')
  if (!(await projectExists(c.env.DB, id))) return notFound(c)
  const since = c.req.query('since') ?? '1970-01-01T00:00:00.000Z'
  if (Number.isNaN(Date.parse(since))) return badRequest(c, 'since must be an ISO 8601 date')

  const { results: mRows } = await c.env.DB.prepare(
    'SELECT label, actual_cm, updated_at, source FROM measurements WHERE project_id = ? AND updated_at > ?',
  )
    .bind(id, since)
    .all<MeasurementRow>()

  const { results: iRows } = await c.env.DB.prepare(
    'SELECT id, data_json, updated_at, deleted FROM survey_items WHERE project_id = ? AND updated_at > ?',
  )
    .bind(id, since)
    .all<ItemRow>()

  const { results: nRows } = await c.env.DB.prepare(
    'SELECT room_code, text, updated_at FROM room_notes WHERE project_id = ? AND updated_at > ?',
  )
    .bind(id, since)
    .all<NoteRow>()

  return c.json({
    now: nowIso(),
    measurements: mRows.map(toMeasurement),
    items: iRows.map((r) => {
      let data: unknown = null
      try {
        data = JSON.parse(r.data_json)
      } catch {
        // ignore
      }
      return { id: r.id, data, updatedAt: r.updated_at, deleted: r.deleted === 1 }
    }),
    notes: nRows.map((r) => ({ roomCode: r.room_code, text: r.text, updatedAt: r.updated_at })),
  })
})

// ---------- images (R2) ----------

const EXT_BY_TYPE: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/svg+xml': '.svg',
  'application/pdf': '.pdf',
}

// Usage numbers for the cost caps: total bytes stored and uploads in the last 24 h.
// Both read the images rows, so a deleted project frees its space immediately.
async function imageUsage(db: D1Database, now: Date): Promise<{ usedBytes: number; uploadsLast24h: number }> {
  const totals = await db
    .prepare('SELECT COALESCE(SUM(size_bytes), 0) AS used FROM images')
    .first<{ used: number }>()
  const recent = await db
    .prepare('SELECT COUNT(*) AS n FROM images WHERE created_at >= ?')
    .bind(uploadWindowStartIso(now))
    .first<{ n: number }>()
  return { usedBytes: Number(totals?.used ?? 0), uploadsLast24h: Number(recent?.n ?? 0) }
}

app.post('/projects/:id/images', async (c) => {
  const id = c.req.param('id')
  if (!(await projectExists(c.env.DB, id))) return notFound(c)
  let form: FormData
  try {
    form = await c.req.formData()
  } catch {
    return badRequest(c, 'expected multipart/form-data with a "file" field')
  }
  const file = form.get('file')
  if (!(file instanceof File)) return badRequest(c, 'missing "file" field')
  const contentType = file.type || 'application/octet-stream'
  if (!contentType.startsWith('image/')) return badRequest(c, 'only image uploads are allowed')
  // Cost caps: refuse BEFORE R2 is written, so the bucket never passes the cap.
  // 413 file_too_large / 507 storage_cap_reached / 429 daily_upload_cap.
  const usage = await imageUsage(c.env.DB, new Date())
  const rejected = checkUpload({ sizeBytes: file.size, ...usage }, parseCaps(c.env))
  if (rejected) return c.json(rejected.body, rejected.status)
  const ext = EXT_BY_TYPE[contentType] ?? '.img'
  const key = `${id}/${crypto.randomUUID()}${ext}`
  await c.env.IMAGES.put(key, await file.arrayBuffer(), { httpMetadata: { contentType } })
  await c.env.DB.prepare(
    'INSERT INTO images (key, project_id, content_type, created_at, size_bytes) VALUES (?, ?, ?, ?, ?)',
  ).bind(
    key,
    id,
    contentType,
    nowIso(),
    file.size,
  ).run()
  return c.json({ key, url: `/api/images/${encodeURIComponent(key)}` }, 201)
})

// Wildcard route: R2 keys contain "/".
app.get('/images/*', async (c) => {
  const key = decodeURIComponent(c.req.path.replace(/^\/api\/images\//, ''))
  if (!key) return notFound(c)
  const obj = await c.env.IMAGES.get(key)
  if (!obj) return notFound(c)
  const meta = await c.env.DB.prepare('SELECT content_type FROM images WHERE key = ?')
    .bind(key)
    .first<{ content_type: string }>()
  const headers = new Headers()
  headers.set('content-type', obj.httpMetadata?.contentType ?? meta?.content_type ?? 'application/octet-stream')
  headers.set('cache-control', 'public, max-age=31536000, immutable')
  headers.set('etag', obj.etag)
  return new Response(obj.body, { headers })
})

app.route('/mcp', mcpRoutes)

// Access feature routes: POST/GET/DELETE /api/tokens + GET /api/projects/:id/events.
registerAccessRoutes(app)

registerFormatsRoutes(app)
