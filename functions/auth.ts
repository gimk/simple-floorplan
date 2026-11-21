// Auth + access-control middleware for the Hono API, plus the event-log hook.
// Pure decision logic lives in src/core/access.ts (unit-tested); this file only
// wires it to D1 and the request/response.
//
// Auth: `Authorization: Bearer sfp_...` (scoped token from api_tokens) OR the
// legacy `x-passcode` header (full admin, kept for the web app). If PASSCODE is
// unset and no Bearer token is sent, the API stays open (previous behavior).
import type { Context, Next } from 'hono'
import {
  eventKindForRoute,
  hasScope,
  hashToken,
  idempotencyCutoffIso,
  isValidTokenFormat,
  projectIdFromPath,
  requiredScopeForCommands,
  requiredScopeForRoute,
  summarizeCommand,
} from '../src/core/access'
import { registerAccessRoutes } from './routes/access'

export { registerAccessRoutes }

export type Env = {
  DB: D1Database
  IMAGES: R2Bucket
  PASSCODE?: string
}

export type AuthInfo = {
  actor: string // token name, or 'web'
  scopes: string[]
  projectId: string | null // token project restriction (null = all projects)
  viaToken: boolean
}

const AUTH_KEY = 'auth'

type AnyContext = Context<{ Bindings: Env }>

export function setAuth(c: AnyContext, info: AuthInfo): void {
  ;(c as unknown as { set: (k: string, v: unknown) => void }).set(AUTH_KEY, info)
}

export function getAuth(c: Context): AuthInfo | undefined {
  return (c as unknown as { get: (k: string) => unknown }).get(AUTH_KEY) as AuthInfo | undefined
}

const PUBLIC_DISCOVERY_PATHS = new Set(['/api/openapi.json', '/api/schema/plan.v1.json'])

const nowIso = (): string => new Date().toISOString()

type TokenRow = {
  id: string
  name: string
  scopes: string
  project_id: string | null
  revoked: number
}

async function authenticateBearer(
  c: AnyContext,
  token: string,
): Promise<{ ok: true; info: AuthInfo } | { ok: false; status: 401; error: string }> {
  if (!isValidTokenFormat(token)) {
    return { ok: false, status: 401, error: 'invalid bearer token format (expected sfp_...)' }
  }
  const tokenHash = await hashToken(token)
  const row = await c.env.DB.prepare(
    'SELECT id, name, scopes, project_id, revoked FROM api_tokens WHERE token_hash = ?',
  )
    .bind(tokenHash)
    .first<TokenRow>()
    .catch(() => null) // migration 0003 not applied yet
  if (!row || row.revoked === 1) {
    return { ok: false, status: 401, error: 'invalid or revoked token' }
  }
  const scopes = row.scopes.split(',').map((s) => s.trim()).filter(Boolean)
  // Best-effort usage tracking; do not fail the request on it.
  await c.env.DB.prepare('UPDATE api_tokens SET last_used_at = ? WHERE id = ?')
    .bind(nowIso(), row.id)
    .run()
    .catch(() => undefined)
  return { ok: true, info: { actor: row.name, scopes, projectId: row.project_id, viaToken: true } }
}

async function authenticate(c: AnyContext): Promise<{ ok: true; info: AuthInfo } | { ok: false; status: 401; error: string }> {
  const authHeader = c.req.header('authorization')
  if (authHeader && /^Bearer\s+/i.test(authHeader)) {
    return authenticateBearer(c, authHeader.replace(/^Bearer\s+/i, '').trim())
  }
  const passcode = c.env.PASSCODE
  if (passcode) {
    const given = c.req.header('x-passcode')
    if (given !== passcode) return { ok: false, status: 401, error: 'unauthorized' }
    return { ok: true, info: { actor: 'web', scopes: ['admin'], projectId: null, viaToken: false } }
  }
  // PASSCODE unset: keep the previous open behavior.
  return { ok: true, info: { actor: 'web', scopes: ['admin'], projectId: null, viaToken: false } }
}

const COMMANDS_RE = /^\/api\/projects\/([^/]+)\/commands$/

/** One middleware: authenticate, enforce route/command scopes, then log events. */
export async function accessMiddleware(c: AnyContext, next: Next): Promise<Response | void> {
  const method = c.req.method
  const path = c.req.path

  if (!PUBLIC_DISCOVERY_PATHS.has(path)) {
    const auth = await authenticate(c)
    if (!auth.ok) return c.json({ error: auth.error }, auth.status)
    setAuth(c, auth.info)

    const required = requiredScopeForRoute(method, path)
    if (required !== null) {
      // Per-command scope check for the commands batch (body is cached by Hono,
      // so the route handler can still read it).
      let need = required
      const cmdMatch = COMMANDS_RE.exec(path)
      if (cmdMatch && method === 'POST') {
        const body: unknown = await c.req.json().catch(() => null)
        const types =
          body && typeof body === 'object' && Array.isArray((body as { commands?: unknown }).commands)
            ? ((body as { commands: unknown[] }).commands.map((cmd) =>
                typeof cmd === 'object' && cmd !== null ? String((cmd as { type?: unknown }).type) : '',
              ))
            : []
        if (types.length > 0) need = requiredScopeForCommands(types)
        // Idempotency TTL: drop keys older than 24 h when reading the cache.
        await c.env.DB.prepare('DELETE FROM idempotency_keys WHERE project_id = ? AND created_at < ?')
          .bind(cmdMatch[1], idempotencyCutoffIso())
          .run()
          .catch(() => undefined)
      }
      if (!hasScope(auth.info.scopes, need)) {
        return c.json(
          {
            error: 'forbidden',
            requiredScope: need,
            message: `this request requires scope "${need}" (token has: ${auth.info.scopes.join(',') || 'none'})`,
          },
          403,
        )
      }
      // Project-restricted tokens may only touch their own project.
      const pathProject = projectIdFromPath(path)
      if (auth.info.projectId && pathProject && auth.info.projectId !== pathProject) {
        return c.json(
          { error: 'forbidden', message: `token is restricted to project ${auth.info.projectId}` },
          403,
        )
      }
    }
  } else {
    setAuth(c, { actor: 'web', scopes: ['admin'], projectId: null, viaToken: false })
  }

  await next()
  await logWriteEvent(c, method, path)
}

// ---------- event log ----------

async function logWriteEvent(c: AnyContext, method: string, path: string): Promise<void> {
  const kind = eventKindForRoute(method, path)
  if (!kind) return
  const res = c.res
  if (res.status < 200 || res.status >= 300) return

  const actor = getAuth(c)?.actor ?? 'web'
  const now = nowIso()
  const projectId = projectIdFromPath(path)

  try {
    if (kind === 'commands') {
      const body: unknown = await c.req.json().catch(() => null)
      const commands =
        body && typeof body === 'object' && Array.isArray((body as { commands?: unknown }).commands)
          ? (body as { commands: ({ type: string } & Record<string, unknown>)[] }).commands
          : []
      let results: unknown[] = []
      try {
        const data = (await res.clone().json()) as { results?: unknown[] }
        if (Array.isArray(data.results)) results = data.results
      } catch {
        // response was not JSON (should not happen on 2xx)
      }
      if (projectId && commands.length > 0) {
        const stmts = commands.map((cmd, i) =>
          c.env.DB.prepare(
            'INSERT INTO project_events (id, project_id, ts, actor, kind, summary, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?)',
          ).bind(
            crypto.randomUUID(),
            projectId,
            now,
            actor,
            'command',
            `${cmd.type}: ${summarizeCommand(cmd)}`,
            JSON.stringify({ type: cmd.type, command: cmd, result: results[i] ?? null }),
          ),
        )
        await c.env.DB.batch(stmts)
      }
      return
    }

    if (!projectId) {
      // POST /projects (project_create): the id is in the response body.
      if (kind === 'project_create') {
        try {
          const data = (await res.clone().json()) as { id?: string }
          if (data.id) {
            await insertEvent(c, data.id, now, actor, kind, 'project created', { method, path })
          }
        } catch {
          // ignore
        }
      }
      return
    }

    const seg = path.split('/')
    const last = seg[seg.length - 1]
    const secondLast = seg[seg.length - 2] ?? ''
    let summary = `${method} ${path}`
    if (kind === 'snapshot') summary = 'snapshot saved'
    else if (kind === 'measurement') summary = `measurement ${decodeURIComponent(last)} ${method === 'PUT' ? 'set' : 'cleared'}`
    else if (kind === 'item') summary = `item ${decodeURIComponent(last)} ${method === 'PUT' ? 'upserted' : 'deleted'}`
    else if (kind === 'note') summary = `room note ${decodeURIComponent(last)} set`
    else if (kind === 'image') summary = 'image uploaded'
    else if (kind === 'rename') summary = 'project renamed'
    else if (kind === 'project_delete') summary = 'project deleted'
    await insertEvent(c, projectId, now, actor, kind, summary, { method, path, [secondLast]: decodeURIComponent(last) })

    // A deleted project's tokens must not survive it. Event rows are kept as an
    // append-only audit trail (they reference the deleted project id).
    if (kind === 'project_delete') {
      await c.env.DB.prepare('DELETE FROM api_tokens WHERE project_id = ?').bind(projectId).run().catch(() => undefined)
    }
  } catch {
    // Event logging must never break the API (e.g. migration 0003 not applied yet).
  }
}

async function insertEvent(
  c: AnyContext,
  projectId: string,
  ts: string,
  actor: string,
  kind: string,
  summary: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await c.env.DB.prepare(
    'INSERT INTO project_events (id, project_id, ts, actor, kind, summary, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(crypto.randomUUID(), projectId, ts, actor, kind, summary, JSON.stringify(payload))
    .run()
}
