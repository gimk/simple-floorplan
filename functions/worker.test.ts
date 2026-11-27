// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest'
import worker from './worker'

// ---------------------------------------------------------------------------
// In-memory D1 + R2 mocks: only the SQL shapes used by worker.ts.
// ---------------------------------------------------------------------------

type ProjectRow = { id: string; title: string; doc_json: string; version: number; updated_at: string }
type TokenRow = {
  id: string
  name: string
  token_hash: string
  scopes: string
  project_id: string | null
  created_at: string
  revoked_at: string | null
  last_used_at: string | null
}

class MockD1 {
  projects = new Map<string, ProjectRow>()
  tokens: TokenRow[] = []

  prepare(sql: string) {
    return new Statement(this, sql.replace(/\s+/g, ' ').trim(), [])
  }
}

class Statement {
  constructor(
    private db: MockD1,
    private sql: string,
    private args: unknown[],
  ) {}

  bind(...values: unknown[]) {
    return new Statement(this.db, this.sql, values)
  }

  async all<T>(): Promise<{ results: T[] }> {
    const { db, sql, args } = this
    if (sql.startsWith('SELECT id, title, version, updated_at FROM projects')) {
      let rows = [...db.projects.values()]
      if (sql.includes('WHERE id = ?')) rows = rows.filter((r) => r.id === args[0])
      rows.sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      return { results: rows as unknown as T[] }
    }
    if (sql.startsWith('SELECT id, name, scopes, project_id, created_at, revoked_at, last_used_at FROM api_tokens')) {
      return { results: [...db.tokens].reverse() as unknown as T[] }
    }
    throw new Error(`Unmocked all(): ${sql}`)
  }

  async first<T>(): Promise<T | null> {
    const { db, sql, args } = this
    if (sql.startsWith('SELECT id, title, doc_json, version, updated_at FROM projects WHERE id = ?')) {
      return (db.projects.get(args[0] as string) as unknown as T) ?? null
    }
    if (sql.startsWith('SELECT id, scopes, project_id FROM api_tokens WHERE token_hash = ?')) {
      return (db.tokens.find((t) => t.token_hash === args[0] && t.revoked_at === null) as unknown as T) ?? null
    }
    throw new Error(`Unmocked first(): ${sql}`)
  }

  async run(): Promise<{ meta: { changes: number } }> {
    const { db, sql, args } = this
    if (sql.startsWith('INSERT INTO projects')) {
      const [id, title, doc_json, updated_at] = args as string[]
      if (db.projects.has(id)) throw new Error('UNIQUE constraint failed')
      db.projects.set(id, { id, title, doc_json, version: 1, updated_at })
      return { meta: { changes: 1 } }
    }
    if (sql.startsWith('UPDATE projects SET')) {
      const [title, doc_json, version, updated_at, id, expected] = args as [string, string, number, string, string, number]
      const row = db.projects.get(id)
      if (!row || row.version !== expected) return { meta: { changes: 0 } }
      db.projects.set(id, { id, title, doc_json, version, updated_at })
      return { meta: { changes: 1 } }
    }
    if (sql.startsWith('DELETE FROM projects')) {
      return { meta: { changes: db.projects.delete(args[0] as string) ? 1 : 0 } }
    }
    if (sql.startsWith('INSERT INTO api_tokens')) {
      const [id, name, token_hash, scopes, project_id, created_at] = args as [string, string, string, string, string | null, string]
      db.tokens.push({ id, name, token_hash, scopes, project_id, created_at, revoked_at: null, last_used_at: null })
      return { meta: { changes: 1 } }
    }
    if (sql.startsWith('UPDATE api_tokens SET last_used_at')) {
      const t = db.tokens.find((x) => x.id === args[1])
      if (t) t.last_used_at = args[0] as string
      return { meta: { changes: t ? 1 : 0 } }
    }
    if (sql.startsWith('UPDATE api_tokens SET revoked_at')) {
      const t = db.tokens.find((x) => x.id === args[1] && x.revoked_at === null)
      if (t) t.revoked_at = args[0] as string
      return { meta: { changes: t ? 1 : 0 } }
    }
    throw new Error(`Unmocked run(): ${sql}`)
  }
}

class MockR2 {
  objects = new Map<string, { bytes: ArrayBuffer; contentType?: string }>()
  /** Small page size, so cascade delete has to follow the cursor. */
  pageSize = 2

  async get(key: string) {
    const o = this.objects.get(key)
    if (!o) return null
    return { body: new Response(o.bytes).body as ReadableStream, httpMetadata: { contentType: o.contentType } }
  }

  async put(key: string, value: ArrayBuffer, options?: { httpMetadata?: { contentType?: string } }) {
    this.objects.set(key, { bytes: value, contentType: options?.httpMetadata?.contentType })
  }

  async delete(keys: string | string[]) {
    for (const k of Array.isArray(keys) ? keys : [keys]) this.objects.delete(k)
  }

  async list(options: { prefix?: string; cursor?: string } = {}) {
    const all = [...this.objects.keys()].filter((k) => k.startsWith(options.prefix ?? '')).sort()
    // The cursor is the last key of the previous page, so deletes between pages do not shift it.
    const rest = options.cursor ? all.filter((k) => k > options.cursor!) : all
    const page = rest.slice(0, this.pageSize)
    const truncated = rest.length > this.pageSize
    return { objects: page.map((key) => ({ key })), truncated, cursor: truncated ? page[page.length - 1] : undefined }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MASTER = 'master-secret'

let db: MockD1
let r2: MockR2
let env: Parameters<typeof worker.fetch>[1]

function makeEnv(extra: Record<string, unknown> = { PASSCODE: MASTER }) {
  db = new MockD1()
  r2 = new MockR2()
  env = {
    DB: db,
    IMAGES: r2,
    ASSETS: { fetch: async () => new Response('asset') },
    ...extra,
  } as unknown as Parameters<typeof worker.fetch>[1]
}

type CallOptions = { body?: unknown; token?: string | null; bearer?: string; headers?: Record<string, string>; raw?: BodyInit }

async function call(method: string, path: string, opts: CallOptions = {}) {
  const headers: Record<string, string> = { ...opts.headers }
  const token = opts.token === undefined ? MASTER : opts.token
  if (opts.bearer) headers.authorization = `Bearer ${opts.bearer}`
  else if (token) headers['x-api-token'] = token
  let body: BodyInit | undefined = opts.raw
  if (opts.body !== undefined) {
    body = JSON.stringify(opts.body)
    headers['content-type'] = 'application/json'
  }
  const res = await worker.fetch(new Request(`http://localhost${path}`, { method, headers, body }), env)
  const text = await res.text()
  let data: any = text
  try {
    data = JSON.parse(text)
  } catch {
    // Not JSON (SVG, image bytes).
  }
  return { status: res.status, data, headers: res.headers }
}

function emptyDoc(id: string, title = 'Test') {
  return {
    schemaVersion: 3,
    id,
    title,
    refImages: [],
    artboards: [
      { id: 'ab1', name: 'Plan A', xCm: 0, yCm: 0, ceilingHeightCm: 250, precisionCm: 1, rooms: [], openings: [], furniture: [] },
    ],
  }
}

async function makeToken(scopes: 'read' | 'edit' | 'admin', projectId: string | null = null) {
  const res = await call('POST', '/api/tokens', { body: { name: `t-${scopes}`, scopes, projectId } })
  expect(res.status).toBe(201)
  return res.data as { id: string; token: string }
}

const addRoom = { type: 'add_room_rect', xCm: 0, yCm: 0, widthCm: 400, heightCm: 300 }

beforeEach(() => makeEnv())

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('discovery and static', () => {
  it('serves openapi and schema without auth', async () => {
    const spec = await call('GET', '/api/openapi.json', { token: null })
    expect(spec.status).toBe(200)
    expect(spec.data.openapi).toBe('3.1.0')
    expect(spec.data.components.securitySchemes.BearerAuth).toBeDefined()
    for (const p of ['/api/tokens', '/api/projects/{id}/commands', '/api/projects/{id}/query', '/api/projects/{id}/render.svg']) {
      expect(spec.data.paths[p]).toBeDefined()
    }
    expect(spec.data.paths['/api/projects/{id}'].patch).toBeDefined()
    const schema = await call('GET', '/api/schema/project.v3.json', { token: null })
    expect(schema.status).toBe(200)
    expect(schema.data.title).toContain('ProjectDoc')
  })

  it('passes non-API paths to ASSETS', async () => {
    const res = await worker.fetch(new Request('http://localhost/index.html'), env)
    expect(await res.text()).toBe('asset')
  })
})

describe('authentication', () => {
  it('rejects missing and wrong credentials', async () => {
    expect((await call('GET', '/api/projects', { token: null })).status).toBe(401)
    expect((await call('GET', '/api/projects', { token: 'nope' })).status).toBe(401)
    expect((await call('GET', '/api/projects', { bearer: 'sfp_unknown' })).status).toBe(401)
  })

  it('accepts the master secret in x-api-token and as Bearer', async () => {
    expect((await call('GET', '/api/projects')).status).toBe(200)
    expect((await call('GET', '/api/projects', { token: null, bearer: MASTER })).status).toBe(200)
  })

  it('API_TOKEN works when PASSCODE is unset', async () => {
    makeEnv({ API_TOKEN: 'legacy' })
    expect((await call('GET', '/api/projects', { token: 'legacy' })).status).toBe(200)
    expect((await call('GET', '/api/projects', { token: MASTER })).status).toBe(401)
  })

  it('is open in local dev, but a bad Bearer token still fails', async () => {
    makeEnv({})
    expect((await call('GET', '/api/projects', { token: null })).status).toBe(200)
    expect((await call('GET', '/api/tokens', { token: null })).status).toBe(200)
    expect((await call('GET', '/api/projects', { bearer: 'sfp_unknown' })).status).toBe(401)
  })
})

describe('tokens', () => {
  it('creates, lists and revokes a token', async () => {
    const created = await call('POST', '/api/tokens', { body: { name: 'agent', scopes: 'edit', projectId: 'p1' } })
    expect(created.status).toBe(201)
    expect(created.data.token).toMatch(/^sfp_[0-9a-f]{32}$/)
    expect(created.data).toMatchObject({ name: 'agent', scopes: 'edit', projectId: 'p1' })
    expect(db.tokens[0].token_hash).not.toBe(created.data.token)

    const list = await call('GET', '/api/tokens')
    expect(list.status).toBe(200)
    expect(list.data.tokens).toHaveLength(1)
    expect(list.data.tokens[0]).toMatchObject({ id: created.data.id, name: 'agent', scopes: 'edit', projectId: 'p1', revokedAt: null })
    expect(JSON.stringify(list.data)).not.toContain(created.data.token)
    expect(JSON.stringify(list.data)).not.toContain('token_hash')

    const used = await call('GET', '/api/projects/p1', { token: null, bearer: created.data.token })
    expect(used.status).toBe(404) // allowed, project does not exist
    expect((await call('GET', '/api/tokens')).data.tokens[0].lastUsedAt).toBeTruthy()

    const revoked = await call('DELETE', `/api/tokens/${created.data.id}`)
    expect(revoked.status).toBe(200)
    expect(revoked.data).toEqual({ ok: true })
    expect((await call('GET', '/api/tokens')).data.tokens[0].revokedAt).toBeTruthy()
    expect((await call('GET', '/api/projects/p1', { token: null, bearer: created.data.token })).status).toBe(401)
  })

  it('defaults to read scope and validates the body', async () => {
    const res = await call('POST', '/api/tokens', { body: { name: 'r' } })
    expect(res.data.scopes).toBe('read')
    expect(res.data.projectId).toBeNull()
    expect((await call('POST', '/api/tokens', { body: { scopes: 'read' } })).status).toBe(400)
    expect((await call('POST', '/api/tokens', { body: { name: 'x', scopes: 'root' } })).status).toBe(400)
  })

  it('token endpoints need admin', async () => {
    const edit = await makeToken('edit')
    const admin = await makeToken('admin')
    expect((await call('GET', '/api/tokens', { token: null, bearer: edit.token })).status).toBe(403)
    const forbidden = await call('POST', '/api/tokens', { token: null, bearer: edit.token, body: { name: 'x' } })
    expect(forbidden.status).toBe(403)
    expect(forbidden.data).toEqual({ error: 'Forbidden' })
    expect((await call('DELETE', `/api/tokens/${admin.id}`, { token: null, bearer: edit.token })).status).toBe(403)
    expect((await call('GET', '/api/tokens', { token: null, bearer: admin.token })).status).toBe(200)
  })
})

describe('scope enforcement', () => {
  it('read token cannot write', async () => {
    await call('POST', '/api/projects', { body: { id: 'p1' } })
    const read = await makeToken('read')
    const opts = { token: null, bearer: read.token }
    expect((await call('GET', '/api/projects', opts)).status).toBe(200)
    expect((await call('GET', '/api/projects/p1', opts)).status).toBe(200)
    expect((await call('POST', '/api/projects/p1/query', { ...opts, body: { kind: 'summary' } })).status).toBe(200)
    expect((await call('GET', '/api/projects/p1/render.svg', opts)).status).toBe(200)
    expect((await call('POST', '/api/projects', { ...opts, body: {} })).status).toBe(403)
    expect((await call('PUT', '/api/projects/p1', { ...opts, body: { doc: emptyDoc('p1') } })).status).toBe(403)
    expect((await call('PATCH', '/api/projects/p1', { ...opts, body: { title: 'x' } })).status).toBe(403)
    expect((await call('DELETE', '/api/projects/p1', opts)).status).toBe(403)
    expect((await call('POST', '/api/projects/p1/commands', { ...opts, body: { command: addRoom } })).status).toBe(403)
    expect((await call('PUT', '/api/images/p1/a', { ...opts, raw: 'x' })).status).toBe(403)
    expect((await call('DELETE', '/api/images/p1/a', opts)).status).toBe(403)
    expect(db.projects.has('p1')).toBe(true)
  })

  it('edit token can write projects and images', async () => {
    const edit = await makeToken('edit')
    const opts = { token: null, bearer: edit.token }
    expect((await call('POST', '/api/projects', { ...opts, body: { id: 'p2' } })).status).toBe(201)
    expect((await call('PUT', '/api/images/p2/a', { ...opts, raw: 'abc', headers: { 'content-type': 'image/png' } })).status).toBe(200)
    expect((await call('GET', '/api/images/p2/a', opts)).data).toBe('abc')
    expect((await call('DELETE', '/api/projects/p2', opts)).status).toBe(200)
  })

  it('project-limited token only reaches its project', async () => {
    await call('POST', '/api/projects', { body: { id: 'a' } })
    await call('POST', '/api/projects', { body: { id: 'b' } })
    const t = await makeToken('edit', 'a')
    const opts = { token: null, bearer: t.token }
    const list = await call('GET', '/api/projects', opts)
    expect(list.data.projects.map((p: { id: string }) => p.id)).toEqual(['a'])
    expect((await call('GET', '/api/projects/a', opts)).status).toBe(200)
    const other = await call('GET', '/api/projects/b', opts)
    expect(other.status).toBe(403)
    expect(other.data).toEqual({ error: 'Forbidden' })
    expect((await call('POST', '/api/projects/b/commands', { ...opts, body: { command: addRoom } })).status).toBe(403)
    expect((await call('POST', '/api/projects/b/query', { ...opts, body: { kind: 'summary' } })).status).toBe(403)
    expect((await call('GET', '/api/projects/b/render.svg', opts)).status).toBe(403)
    expect((await call('DELETE', '/api/projects/b', opts)).status).toBe(403)
    expect((await call('PUT', '/api/images/a/x', { ...opts, raw: '1' })).status).toBe(200)
    expect((await call('PUT', '/api/images/b/x', { ...opts, raw: '1' })).status).toBe(403)
    expect((await call('GET', '/api/images/b/x', opts)).status).toBe(403)
    expect((await call('POST', '/api/projects', { ...opts, body: { id: 'c' } })).status).toBe(403)
    expect((await call('GET', '/api/tokens', opts)).status).toBe(403)
  })
})

describe('projects CRUD', () => {
  it('POST creates an empty valid project', async () => {
    const res = await call('POST', '/api/projects', { body: { title: 'Flat' } })
    expect(res.status).toBe(201)
    expect(res.data).toMatchObject({ title: 'Flat', version: 1 })
    expect(res.data.id).toBeTruthy()
    const got = await call('GET', `/api/projects/${res.data.id}`)
    expect(got.data.version).toBe(1)
    expect(got.data.doc).toMatchObject({ schemaVersion: 3, id: res.data.id, title: 'Flat' })
    expect(got.data.doc.artboards).toHaveLength(1)
  })

  it('POST with id and doc, 409 on duplicate, 400 on invalid doc', async () => {
    const ok = await call('POST', '/api/projects', { body: { id: 'p1', doc: emptyDoc('p1', 'One') } })
    expect(ok.status).toBe(201)
    expect(ok.data).toMatchObject({ id: 'p1', title: 'One', version: 1 })
    expect((await call('POST', '/api/projects', { body: { id: 'p1' } })).status).toBe(409)
    const bad = await call('POST', '/api/projects', { body: { id: 'p9', doc: { schemaVersion: 3 } } })
    expect(bad.status).toBe(400)
    expect(bad.data.error).toBe('invalid_document')
    expect(bad.data.issues.length).toBeGreaterThan(0)
  })

  it('GET list and record include version', async () => {
    await call('POST', '/api/projects', { body: { id: 'p1' } })
    const list = await call('GET', '/api/projects')
    expect(list.data.projects[0]).toMatchObject({ id: 'p1', version: 1 })
    expect(list.data.projects[0].updatedAt).toBeTruthy()
    expect((await call('GET', '/api/projects/missing')).status).toBe(404)
  })

  it('PUT keeps the browser contract: upsert, version bump', async () => {
    const first = await call('PUT', '/api/projects/p1', { body: { title: 'T', doc: emptyDoc('p1', 'T') } })
    expect(first.status).toBe(200)
    expect(first.data).toMatchObject({ ok: true, version: 1 })
    const second = await call('PUT', '/api/projects/p1', { body: { title: 'T2', doc: emptyDoc('p1', 'T2') } })
    expect(second.data).toMatchObject({ ok: true, version: 2 })
    const got = await call('GET', '/api/projects/p1')
    expect(got.data).toMatchObject({ title: 'T2', version: 2 })
  })

  it('PUT rejects an invalid document', async () => {
    const res = await call('PUT', '/api/projects/p1', { body: { title: 'T', doc: { schemaVersion: 2, id: 'p1' } } })
    expect(res.status).toBe(400)
    expect(res.data.error).toBe('invalid_document')
    expect(Array.isArray(res.data.issues)).toBe(true)
    expect(db.projects.size).toBe(0)
    expect((await call('PUT', '/api/projects/p1', { body: { title: 'T' } })).status).toBe(400)
  })

  it('PUT gives 409 on a stale baseVersion or If-Match', async () => {
    await call('PUT', '/api/projects/p1', { body: { title: 'T', doc: emptyDoc('p1') } })
    await call('PUT', '/api/projects/p1', { body: { title: 'T', doc: emptyDoc('p1') } }) // now v2
    const stale = await call('PUT', '/api/projects/p1', { body: { title: 'X', doc: emptyDoc('p1'), baseVersion: 1 } })
    expect(stale.status).toBe(409)
    expect(stale.data).toEqual({ error: 'version_conflict', currentVersion: 2 })
    const staleHeader = await call('PUT', '/api/projects/p1', { body: { title: 'X', doc: emptyDoc('p1') }, headers: { 'if-match': '"1"' } })
    expect(staleHeader.status).toBe(409)
    const fresh = await call('PUT', '/api/projects/p1', { body: { title: 'X', doc: emptyDoc('p1'), baseVersion: 2 } })
    expect(fresh.status).toBe(200)
    expect(fresh.data.version).toBe(3)
    const freshHeader = await call('PUT', '/api/projects/p1', { body: { title: 'Y', doc: emptyDoc('p1') }, headers: { 'if-match': '3' } })
    expect(freshHeader.data.version).toBe(4)
  })

  it('PATCH renames the project and the stored doc', async () => {
    await call('POST', '/api/projects', { body: { id: 'p1', title: 'Old' } })
    const res = await call('PATCH', '/api/projects/p1', { body: { title: 'New', baseVersion: 1 } })
    expect(res.status).toBe(200)
    expect(res.data).toMatchObject({ ok: true, id: 'p1', title: 'New', version: 2 })
    const got = await call('GET', '/api/projects/p1')
    expect(got.data.title).toBe('New')
    expect(got.data.doc.title).toBe('New')
    const stale = await call('PATCH', '/api/projects/p1', { body: { title: 'Z', baseVersion: 1 } })
    expect(stale.status).toBe(409)
    expect(stale.data.currentVersion).toBe(2)
    expect((await call('PATCH', '/api/projects/nope', { body: { title: 'Z' } })).status).toBe(404)
    expect((await call('PATCH', '/api/projects/p1', { body: {} })).status).toBe(400)
  })

  it('DELETE removes the row and every image (paginated)', async () => {
    await call('POST', '/api/projects', { body: { id: 'p1' } })
    await call('POST', '/api/projects', { body: { id: 'p10' } })
    for (const n of ['a', 'b', 'c', 'd', 'e']) await call('PUT', `/api/images/p1/${n}`, { raw: n })
    await call('PUT', '/api/images/p10/keep', { raw: 'k' })
    const res = await call('DELETE', '/api/projects/p1')
    expect(res.status).toBe(200)
    expect(res.data).toEqual({ ok: true, deletedImages: 5 })
    expect(db.projects.has('p1')).toBe(false)
    expect([...r2.objects.keys()]).toEqual(['images/p10/keep'])
    expect(db.projects.has('p10')).toBe(true)
    expect((await call('DELETE', '/api/projects/ghost')).data).toEqual({ ok: true, deletedImages: 0 })
  })
})

describe('commands', () => {
  beforeEach(async () => {
    await call('POST', '/api/projects', { body: { id: 'p1', title: 'Flat' } })
  })

  it('applies a live command and bumps the version', async () => {
    const res = await call('POST', '/api/projects/p1/commands', { body: { command: addRoom } })
    expect(res.status).toBe(200)
    expect(res.data).toMatchObject({ ok: true, dryRun: false, version: 2 })
    expect(res.data.updatedAt).toBeTruthy()
    expect(res.data.result.roomId).toBeTruthy()
    const got = await call('GET', '/api/projects/p1')
    expect(got.data.version).toBe(2)
    expect(got.data.doc.artboards[0].rooms).toHaveLength(1)
  })

  it('applies a batch and syncs the title', async () => {
    const res = await call('POST', '/api/projects/p1/commands', {
      body: { commands: [{ type: 'set_title', title: 'Renamed' }, addRoom] },
    })
    expect(res.status).toBe(200)
    expect(res.data.result.results).toHaveLength(2)
    const got = await call('GET', '/api/projects/p1')
    expect(got.data.title).toBe('Renamed')
    expect(got.data.doc.title).toBe('Renamed')
  })

  it('dryRun saves nothing', async () => {
    const res = await call('POST', '/api/projects/p1/commands', { body: { command: addRoom, dryRun: true } })
    expect(res.status).toBe(200)
    expect(res.data).toMatchObject({ ok: true, dryRun: true, version: 1 })
    expect(res.data.result.roomId).toBeTruthy()
    const got = await call('GET', '/api/projects/p1')
    expect(got.data.version).toBe(1)
    expect(got.data.doc.artboards[0].rooms).toHaveLength(0)
  })

  it('returns 400 for an invalid command and leaves the project alone', async () => {
    const res = await call('POST', '/api/projects/p1/commands', { body: { command: { type: 'nope' } } })
    expect(res.status).toBe(400)
    expect(res.data.ok).toBe(false)
    expect(res.data.error).toContain('nope')
    const batch = await call('POST', '/api/projects/p1/commands', { body: { commands: [addRoom, { type: 'rename_room', roomId: 'x', name: 'y' }] } })
    expect(batch.status).toBe(400)
    expect(batch.data.error).toContain('command 1')
    expect((await call('GET', '/api/projects/p1')).data.version).toBe(1)
    expect((await call('POST', '/api/projects/p1/commands', { body: {} })).status).toBe(400)
  })

  it('404 for a missing project, 409 for a stale baseVersion', async () => {
    expect((await call('POST', '/api/projects/ghost/commands', { body: { command: addRoom } })).status).toBe(404)
    await call('POST', '/api/projects/p1/commands', { body: { command: addRoom } })
    const stale = await call('POST', '/api/projects/p1/commands', { body: { command: addRoom, baseVersion: 1 } })
    expect(stale.status).toBe(409)
    expect(stale.data).toEqual({ error: 'version_conflict', currentVersion: 2 })
    const header = await call('POST', '/api/projects/p1/commands', { body: { command: addRoom }, headers: { 'if-match': '1' } })
    expect(header.status).toBe(409)
    const ok = await call('POST', '/api/projects/p1/commands', { body: { command: addRoom, baseVersion: 2 } })
    expect(ok.data.version).toBe(3)
  })
})

describe('query and render', () => {
  beforeEach(async () => {
    await call('POST', '/api/projects', { body: { id: 'p1', title: 'Flat' } })
    await call('POST', '/api/projects/p1/commands', { body: { commands: [{ ...addRoom, name: 'Living' }] } })
  })

  it('summary', async () => {
    const res = await call('POST', '/api/projects/p1/query', { body: { kind: 'summary' } })
    expect(res.status).toBe(200)
    expect(res.data.ok).toBe(true)
    expect(res.data.summary.title).toBe('Flat')
    expect(res.data.summary.artboards[0].rooms[0]).toMatchObject({ name: 'Living', areaM2: 12 })
  })

  it('validate', async () => {
    const res = await call('POST', '/api/projects/p1/query', { body: { kind: 'validate' } })
    expect(res.data).toMatchObject({ ok: true, valid: true })
    expect(Array.isArray(res.data.issues)).toBe(true)
  })

  it('walls', async () => {
    const res = await call('POST', '/api/projects/p1/query', { body: { kind: 'walls' } })
    expect(res.status).toBe(200)
    expect(res.data.walls).toHaveLength(4)
    expect(res.data.walls[0]).toMatchObject({
      artboardId: expect.any(String),
      roomId: expect.any(String),
      roomName: 'Living',
      edgeIndex: 0,
      lengthCm: 400,
      openingIds: [],
    })
    expect(res.data.walls[0].ref).toBe(`${res.data.walls[0].roomId}#0`)
    expect(res.data.walls[0].start).toBeDefined()
    expect(res.data.walls[0].end).toBeDefined()
    expect(typeof res.data.walls[0].angleDeg).toBe('number')
  })

  it('rooms and artboard', async () => {
    const rooms = await call('POST', '/api/projects/p1/query', { body: { kind: 'rooms' } })
    expect(rooms.data.rooms).toHaveLength(1)
    const artboard = await call('POST', '/api/projects/p1/query', { body: { kind: 'artboard' } })
    expect(artboard.data.artboard.rooms).toHaveLength(1)
    expect((await call('POST', '/api/projects/p1/query', { body: { kind: 'artboard', artboardId: 'zzz' } })).status).toBe(404)
  })

  it('errors', async () => {
    expect((await call('POST', '/api/projects/p1/query', { body: { kind: 'bogus' } })).status).toBe(400)
    expect((await call('POST', '/api/projects/ghost/query', { body: { kind: 'summary' } })).status).toBe(404)
  })

  it('render.svg', async () => {
    const res = await call('GET', '/api/projects/p1/render.svg')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/svg+xml; charset=utf-8')
    expect(res.data).toContain('<svg')
    expect(res.data).toContain('Living')
    const id = (await call('GET', '/api/projects/p1')).data.doc.artboards[0].id
    expect((await call('GET', `/api/projects/p1/render.svg?artboard=${id}`)).status).toBe(200)
    expect((await call('GET', '/api/projects/p1/render.svg?artboard=nope')).status).toBe(404)
    expect((await call('GET', '/api/projects/ghost/render.svg')).status).toBe(404)
  })
})
