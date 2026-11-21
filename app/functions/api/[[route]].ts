// Cloudflare Pages Function: Hono API for Simple Floorplan.
// Storage: D1 (binding DB) for structured data, R2 (binding IMAGES) for images.
// Auth: header `x-passcode` must equal env PASSCODE (if PASSCODE is unset, allow all).
import { Hono } from 'hono'
import { handle } from 'hono/cloudflare-pages'

type Env = {
  DB: D1Database
  IMAGES: R2Bucket
  PASSCODE?: string
}

const app = new Hono<{ Bindings: Env }>().basePath('/api')

// ---------- small helpers (manual validation, no zod) ----------

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

const badRequest = (c: { json: (b: unknown, s: 400) => Response }, msg: string) =>
  c.json({ error: msg }, 400)

// ---------- row types ----------

type ProjectRow = { id: string; name: string; title: string | null; updated_at: string }
type MeasurementRow = { label: string; actual_cm: number; updated_at: string }
type ItemRow = { id: string; data_json: string; updated_at: string; deleted: number }
type NoteRow = { room_code: string; text: string; updated_at: string }

// ---------- auth middleware ----------

app.use('*', async (c, next) => {
  const passcode = c.env.PASSCODE
  if (passcode) {
    const given = c.req.header('x-passcode')
    if (given !== passcode) return c.json({ error: 'unauthorized' }, 401)
  }
  await next()
})

// ---------- helpers ----------

async function projectExists(db: D1Database, id: string): Promise<boolean> {
  const row = await db.prepare('SELECT id FROM projects WHERE id = ?').bind(id).first<{ id: string }>()
  return row !== null
}

const notFound = (c: { json: (b: unknown, s: 404) => Response }) => c.json({ error: 'not_found' }, 404)

const toMeasurement = (r: MeasurementRow) => ({
  label: r.label,
  actualCm: r.actual_cm,
  updatedAt: r.updated_at,
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

// GET /projects/:id — latest snapshot merged with measurements, items and notes
// into a PlanDoc-shaped JSON (plus `version` for optimistic concurrency).
app.get('/projects/:id', async (c) => {
  const id = c.req.param('id')
  const project = await c.env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(id).first<ProjectRow>()
  if (!project) return notFound(c)

  const snap = await c.env.DB.prepare(
    'SELECT data_json, version FROM floorplan_snapshots WHERE project_id = ? ORDER BY version DESC LIMIT 1',
  )
    .bind(id)
    .first<{ data_json: string; version: number }>()

  const base: Record<string, unknown> = snap ? JSON.parse(snap.data_json) : {}
  const measurements: Record<string, unknown> = {}
  const { results: mRows } = await c.env.DB.prepare(
    'SELECT label, actual_cm, updated_at FROM measurements WHERE project_id = ?',
  )
    .bind(id)
    .all<MeasurementRow>()
  for (const r of mRows) measurements[r.label] = toMeasurement(r)

  const elements: unknown[] = []
  const { results: iRows } = await c.env.DB.prepare(
    'SELECT data_json FROM survey_items WHERE project_id = ? AND deleted = 0',
  )
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
  const { results: nRows } = await c.env.DB.prepare(
    'SELECT room_code, text FROM room_notes WHERE project_id = ?',
  )
    .bind(id)
    .all<NoteRow>()
  for (const r of nRows) roomNotes[r.room_code] = r.text

  return c.json({
    projectId: id,
    title: typeof base.title === 'string' ? base.title : (project.title ?? ''),
    background: base.background,
    rooms: Array.isArray(base.rooms) ? base.rooms : [],
    elements,
    tapes: Array.isArray(base.tapes) ? base.tapes : [],
    measurements,
    roomNotes,
    version: snap?.version ?? 0,
  })
})

// PUT /projects/:id/snapshot — body = PlanDoc minus measurements/roomNotes, plus
// baseVersion. 409 with the latest version if baseVersion does not match.
app.put('/projects/:id/snapshot', async (c) => {
  const id = c.req.param('id')
  if (!(await projectExists(c.env.DB, id))) return notFound(c)
  const body: unknown = await c.req.json().catch(() => null)
  if (!isObj(body)) return badRequest(c, 'body must be a JSON object')
  const baseVersion = asNumber(body.baseVersion)
  if (baseVersion === null || !Number.isInteger(baseVersion) || baseVersion < 0)
    return badRequest(c, 'baseVersion must be a non-negative integer')
  for (const k of ['rooms', 'elements', 'tapes'] as const) {
    if (body[k] !== undefined && !Array.isArray(body[k])) return badRequest(c, `${k} must be an array`)
  }
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
  const data: Record<string, unknown> = { ...body }
  delete data.baseVersion
  delete data.measurements
  delete data.roomNotes
  const now = nowIso()
  await c.env.DB.prepare(
    'INSERT INTO floorplan_snapshots (id, project_id, data_json, version, created_at) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(crypto.randomUUID(), id, JSON.stringify(data), version, now)
    .run()
  await c.env.DB.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').bind(now, id).run()
  return c.json({ version })
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
  const updatedAt = asIso(body.updatedAt) ?? nowIso()
  const existing = await c.env.DB.prepare(
    'SELECT label, actual_cm, updated_at FROM measurements WHERE project_id = ? AND label = ?',
  )
    .bind(id, label)
    .first<MeasurementRow>()
  if (existing && existing.updated_at >= updatedAt) {
    return c.json({ ok: true, ignored: true, measurement: toMeasurement(existing) })
  }
  await c.env.DB.prepare(
    `INSERT INTO measurements (project_id, label, actual_cm, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(project_id, label) DO UPDATE SET actual_cm = excluded.actual_cm, updated_at = excluded.updated_at`,
  )
    .bind(id, label, actualCm, updatedAt)
    .run()
  await c.env.DB.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').bind(updatedAt, id).run()
  return c.json({ ok: true, ignored: false, measurement: { label, actualCm, updatedAt } })
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
    'SELECT label, actual_cm, updated_at FROM measurements WHERE project_id = ? AND updated_at > ?',
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
  const ext = EXT_BY_TYPE[contentType] ?? '.img'
  const key = `${id}/${crypto.randomUUID()}${ext}`
  await c.env.IMAGES.put(key, await file.arrayBuffer(), { httpMetadata: { contentType } })
  await c.env.DB.prepare('INSERT INTO images (key, project_id, content_type, created_at) VALUES (?, ?, ?, ?)').bind(
    key,
    id,
    contentType,
    nowIso(),
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

export const onRequest = handle(app)
