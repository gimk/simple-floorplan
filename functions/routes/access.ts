// Access-feature routes: API token admin + project event log.
// Mounted ONCE from functions/api/[[route]].ts via registerAccessRoutes(app)
// (the main app already has basePath('/api'), so paths here are relative).
// Scope enforcement for these routes happens in functions/auth.ts
// (accessMiddleware): /tokens* needs admin, /projects/:id/events needs read.
import { Hono } from 'hono'
import type { Env } from '../auth'
import { generateTokenPlaintext, hashToken, isValidTokenFormat, parseScopes } from '../../src/core/access'

const nowIso = (): string => new Date().toISOString()

type TokenRow = {
  id: string
  name: string
  token_hash: string
  scopes: string
  project_id: string | null
  created_at: string
  last_used_at: string | null
  revoked: number
}

type EventRow = {
  id: string
  project_id: string
  ts: string
  actor: string
  kind: string
  summary: string
  payload_json: string
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

export function registerAccessRoutes(app: Hono<{ Bindings: Env }>): void {
  // POST /api/tokens — create a token. Returns the plaintext token exactly once.
  // Body: { name, scopes: "read,measure" | ["read","measure"], projectId? }
  app.post('/tokens', async (c) => {
    const body: unknown = await c.req.json().catch(() => null)
    if (!isObj(body)) return c.json({ error: 'body must be a JSON object' }, 400)
    const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : null
    if (!name) return c.json({ error: 'name is required' }, 400)
    let scopeList: string[]
    try {
      const raw = body.scopes
      scopeList = parseScopes(Array.isArray(raw) ? raw.map(String).join(',') : String(raw ?? ''))
    } catch (err) {
      return c.json({ error: 'invalid scopes', message: (err as Error).message }, 400)
    }
    let projectId: string | null = null
    if (body.projectId !== undefined && body.projectId !== null) {
      if (typeof body.projectId !== 'string' || !body.projectId) {
        return c.json({ error: 'projectId must be a non-empty string or null' }, 400)
      }
      projectId = body.projectId
      const row = await c.env.DB.prepare('SELECT id FROM projects WHERE id = ?').bind(projectId).first<{ id: string }>()
      if (!row) return c.json({ error: 'project not found', projectId }, 404)
    }
    const token = generateTokenPlaintext()
    const tokenHash = await hashToken(token)
    const id = crypto.randomUUID()
    const now = nowIso()
    await c.env.DB.prepare(
      'INSERT INTO api_tokens (id, name, token_hash, scopes, project_id, created_at, last_used_at, revoked) VALUES (?, ?, ?, ?, ?, ?, NULL, 0)',
    )
      .bind(id, name, tokenHash, scopeList.join(','), projectId, now)
      .run()
    // Plaintext token is returned ONCE; only the hash is stored.
    return c.json({ id, name, scopes: scopeList, projectId, createdAt: now, token }, 201)
  })

  // GET /api/tokens — list tokens without secrets.
  app.get('/tokens', async (c) => {
    const { results } = await c.env.DB.prepare(
      'SELECT id, name, scopes, project_id, created_at, last_used_at, revoked FROM api_tokens ORDER BY created_at DESC',
    ).all<TokenRow>()
    return c.json({
      tokens: results.map((r) => ({
        id: r.id,
        name: r.name,
        scopes: r.scopes.split(',').map((s) => s.trim()),
        projectId: r.project_id,
        createdAt: r.created_at,
        lastUsedAt: r.last_used_at,
        revoked: r.revoked === 1,
      })),
    })
  })

  // DELETE /api/tokens/:id — revoke a token.
  app.delete('/tokens/:id', async (c) => {
    const id = c.req.param('id')
    const existing = await c.env.DB.prepare('SELECT id FROM api_tokens WHERE id = ?').bind(id).first<{ id: string }>()
    if (!existing) return c.json({ error: 'not_found' }, 404)
    await c.env.DB.prepare('UPDATE api_tokens SET revoked = 1 WHERE id = ?').bind(id).run()
    return c.json({ ok: true, id, revoked: true })
  })

  // GET /api/projects/:id/events?since=ISO&limit=100 — append-only event log (read scope).
  app.get('/projects/:id/events', async (c) => {
    const id = c.req.param('id')
    const exists = await c.env.DB.prepare('SELECT id FROM projects WHERE id = ?').bind(id).first<{ id: string }>()
    if (!exists) return c.json({ error: 'not_found' }, 404)
    const since = c.req.query('since') ?? '1970-01-01T00:00:00.000Z'
    if (Number.isNaN(Date.parse(since))) {
      return c.json({ error: 'since must be an ISO 8601 date' }, 400)
    }
    const limitRaw = Number(c.req.query('limit') ?? '100')
    const limit = Number.isInteger(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 1000) : 100
    const { results } = await c.env.DB.prepare(
      'SELECT id, project_id, ts, actor, kind, summary, payload_json FROM project_events WHERE project_id = ? AND ts > ? ORDER BY ts ASC, id ASC LIMIT ?',
    )
      .bind(id, since, limit)
      .all<EventRow>()
    return c.json({
      events: results.map((r) => ({
        id: r.id,
        projectId: r.project_id,
        ts: r.ts,
        actor: r.actor,
        kind: r.kind,
        summary: r.summary,
        payload: (() => {
          try {
            return JSON.parse(r.payload_json)
          } catch {
            return null
          }
        })(),
      })),
    })
  })
}

// Re-export for tests / type checks.
export { isValidTokenFormat }
