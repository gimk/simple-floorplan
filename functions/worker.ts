// Single Cloudflare Worker entrypoint (Static Assets + API).
//
// /api/* is handled here; every other request is served by the ASSETS binding (./dist).
// Self-contained: functions/ is not part of the tsc -b project, so the minimal
// Cloudflare runtime types are declared below.

interface D1Result<T> {
  results: T[]
}
interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>
  first<T = Record<string, unknown>>(): Promise<T | null>
  run(): Promise<unknown>
}
interface D1Database {
  prepare(query: string): D1PreparedStatement
}
interface R2ObjectBody {
  body: ReadableStream
  httpMetadata?: { contentType?: string }
}
interface R2Bucket {
  get(key: string): Promise<R2ObjectBody | null>
  put(key: string, value: ArrayBuffer, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>
  delete(key: string): Promise<void>
}
interface Fetcher {
  fetch(request: Request): Promise<Response>
}

interface Env {
  DB: D1Database
  IMAGES: R2Bucket
  ASSETS: Fetcher
  API_TOKEN?: string
}

type ProjectRow = { id: string; title: string; doc_json: string; updated_at: string }

const IMAGE_KEY_PREFIX = 'images/'
const SEGMENT = /^[A-Za-z0-9._-]+$/

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** Returns an error Response when a token is required and wrong, otherwise null. */
function checkAuth(request: Request, env: Env): Response | null {
  if (!env.API_TOKEN) return null
  if (request.headers.get('x-api-token') === env.API_TOKEN) return null
  return json({ error: 'Unauthorized' }, 401)
}

/** Returns the R2 object key, or null when any path segment is unsafe. */
function imageKey(segments: string[]): string | null {
  if (segments.length === 0) return null
  for (const p of segments) {
    if (!SEGMENT.test(p) || p === '.' || p === '..' || p.includes('..')) return null
  }
  return IMAGE_KEY_PREFIX + segments.join('/')
}

function methodNotAllowed(): Response {
  return json({ error: 'Method not allowed' }, 405)
}

async function listProjects(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    'SELECT id, title, updated_at FROM projects ORDER BY updated_at DESC',
  ).all<{ id: string; title: string; updated_at: string }>()
  return json({
    projects: results.map((r) => ({ id: r.id, title: r.title, updatedAt: r.updated_at })),
  })
}

async function getProject(env: Env, id: string): Promise<Response> {
  const row = await env.DB.prepare('SELECT id, title, doc_json, updated_at FROM projects WHERE id = ?')
    .bind(id)
    .first<ProjectRow>()
  if (!row) return json({ error: 'Not found' }, 404)
  return json({ id: row.id, title: row.title, doc: JSON.parse(row.doc_json), updatedAt: row.updated_at })
}

async function putProject(env: Env, id: string, request: Request): Promise<Response> {
  let body: { title?: unknown; doc?: unknown }
  try {
    body = (await request.json()) as { title?: unknown; doc?: unknown }
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }
  if (!id || typeof body.title !== 'string' || !body.title || !body.doc || typeof body.doc !== 'object') {
    return json({ error: 'id, title and doc are required' }, 400)
  }
  const updatedAt = new Date().toISOString()
  await env.DB.prepare('INSERT OR REPLACE INTO projects (id, title, doc_json, updated_at) VALUES (?, ?, ?, ?)')
    .bind(id, body.title, JSON.stringify(body.doc), updatedAt)
    .run()
  return json({ ok: true, updatedAt })
}

async function deleteProject(env: Env, id: string): Promise<Response> {
  await env.DB.prepare('DELETE FROM projects WHERE id = ?').bind(id).run()
  return json({ ok: true })
}

async function getImage(env: Env, key: string): Promise<Response> {
  const obj = await env.IMAGES.get(key)
  if (!obj) return json({ error: 'Not found' }, 404)
  return new Response(obj.body, {
    headers: {
      'Content-Type': obj.httpMetadata?.contentType ?? 'application/octet-stream',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  })
}

async function putImage(env: Env, key: string, request: Request): Promise<Response> {
  const contentType = request.headers.get('content-type') ?? 'application/octet-stream'
  await env.IMAGES.put(key, await request.arrayBuffer(), { httpMetadata: { contentType } })
  return json({ ok: true, key })
}

async function deleteImage(env: Env, key: string): Promise<Response> {
  await env.IMAGES.delete(key)
  return json({ ok: true })
}

async function handleApi(request: Request, env: Env, segments: string[]): Promise<Response> {
  const denied = checkAuth(request, env)
  if (denied) return denied

  const method = request.method
  const [resource, second, ...rest] = segments

  if (resource === 'projects') {
    if (second === undefined) {
      if (method === 'GET') return listProjects(env)
      return methodNotAllowed()
    }
    if (rest.length > 0) return json({ error: 'Not found' }, 404)
    if (method === 'GET') return getProject(env, second)
    if (method === 'PUT') return putProject(env, second, request)
    if (method === 'DELETE') return deleteProject(env, second)
    return methodNotAllowed()
  }

  if (resource === 'images') {
    const key = imageKey(second === undefined ? [] : [second, ...rest])
    if (!key) return json({ error: 'Invalid key' }, 400)
    if (method === 'GET') return getImage(env, key)
    if (method === 'PUT') return putImage(env, key, request)
    if (method === 'DELETE') return deleteImage(env, key)
    return methodNotAllowed()
  }

  return json({ error: 'Not found' }, 404)
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname !== '/api' && !url.pathname.startsWith('/api/')) {
      return env.ASSETS.fetch(request)
    }

    let segments: string[]
    try {
      segments = url.pathname
        .split('/')
        .filter((s) => s !== '')
        .map((s) => decodeURIComponent(s))
    } catch {
      return json({ error: 'Invalid path' }, 400)
    }

    // segments[0] is always 'api'
    return handleApi(request, env, segments.slice(1))
  },
}
