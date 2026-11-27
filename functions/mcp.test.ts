// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest'
import worker from './worker'

// In-memory D1 + R2 mocks: only the SQL shapes used by worker.ts.
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


const MASTER = 'master-secret'
let db: MockD1
let r2: MockR2
let env: Parameters<typeof worker.fetch>[1]
let nextId = 1

beforeEach(() => {
  db = new MockD1()
  r2 = new MockR2()
  nextId = 1
  env = { DB: db, IMAGES: r2, ASSETS: { fetch: async () => new Response('asset') }, PASSCODE: MASTER } as unknown as Parameters<typeof worker.fetch>[1]
})

type Rpc = { jsonrpc: string; id: unknown; result?: any; error?: { code: number; message: string } }

async function post(body: unknown, token: string | null = MASTER, raw?: string) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (token) headers.authorization = `Bearer ${token}`
  const res = await worker.fetch(new Request('http://localhost/api/mcp', { method: 'POST', headers, body: raw ?? JSON.stringify(body) }), env)
  const text = await res.text()
  return { status: res.status, text, data: (text ? JSON.parse(text) : null) as Rpc }
}

async function rpc(method: string, params?: unknown, token: string | null = MASTER) {
  return post({ jsonrpc: '2.0', id: nextId++, method, params }, token)
}

async function tool(name: string, args: unknown = {}, token: string | null = MASTER) {
  const res = await rpc('tools/call', { name, arguments: args }, token)
  expect(res.status).toBe(200)
  return res.data.result as { content: { type: string; text: string }[]; structuredContent?: any; isError?: boolean }
}

async function makeToken(scopes: 'read' | 'edit', projectId: string | null = null) {
  const res = await worker.fetch(
    new Request('http://localhost/api/tokens', {
      method: 'POST',
      headers: { authorization: `Bearer ${MASTER}`, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 't', scopes, projectId }),
    }),
    env,
  )
  return ((await res.json()) as { token: string }).token
}

const addRoom = { type: 'add_room_rect', xCm: 0, yCm: 0, widthCm: 400, heightCm: 300, name: 'Living' }

describe('protocol', () => {
  it('initialize', async () => {
    const res = await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'x', version: '1' } })
    expect(res.data.result).toEqual({
      protocolVersion: '2025-03-26',
      capabilities: { tools: {} },
      serverInfo: { name: 'simple-floorplan', version: '3.0.0' },
    })
  })

  it('notifications/initialized returns 202 with an empty body', async () => {
    const res = await post({ jsonrpc: '2.0', method: 'notifications/initialized' })
    expect(res.status).toBe(202)
    expect(res.text).toBe('')
  })

  it('ping', async () => {
    expect((await rpc('ping')).data.result).toEqual({})
  })

  it('tools/list gives 7 tools with object schemas', async () => {
    const res = await rpc('tools/list')
    const tools = res.data.result.tools as { name: string; inputSchema: { type: string } }[]
    expect(tools.map((t) => t.name).sort()).toEqual(
      ['create_project', 'delete_project', 'get_project', 'list_projects', 'query_project', 'render_svg', 'run_commands'],
    )
    for (const t of tools) expect(t.inputSchema.type).toBe('object')
  })

  it('parse error, invalid request, unknown method, invalid params', async () => {
    expect((await post(null, MASTER, '{nope')).data.error?.code).toBe(-32700)
    expect((await post([1])).data.error?.code).toBe(-32600)
    expect((await rpc('nope/method')).data.error?.code).toBe(-32601)
    expect((await rpc('tools/call', 'x')).data.error?.code).toBe(-32602)
    expect((await rpc('tools/call', { name: 'ghost', arguments: {} })).data.error?.code).toBe(-32602)
    expect((await rpc('tools/call', { name: 'list_projects', arguments: [] })).data.error?.code).toBe(-32602)
  })

  it('needs auth and POST', async () => {
    expect((await rpc('ping', undefined, null)).status).toBe(401)
    expect((await rpc('ping', undefined, 'wrong')).status).toBe(401)
    const get = await worker.fetch(new Request('http://localhost/api/mcp', { headers: { authorization: `Bearer ${MASTER}` } }), env)
    expect(get.status).toBe(405)
  })

  it('is listed in the OpenAPI spec', async () => {
    const spec = (await (await worker.fetch(new Request('http://localhost/api/openapi.json'), env)).json()) as any
    expect(spec.paths['/api/mcp'].post).toBeDefined()
  })
})

describe('tools', () => {
  it('create_project, list_projects, get_project', async () => {
    const created = await tool('create_project', { id: 'p1', title: 'Flat' })
    expect(created.isError).toBeUndefined()
    expect(created.structuredContent).toMatchObject({ id: 'p1', title: 'Flat', version: 1 })
    expect(JSON.parse(created.content[0].text)).toEqual(created.structuredContent)
    const list = await tool('list_projects')
    expect(list.structuredContent.projects).toHaveLength(1)
    const got = await tool('get_project', { projectId: 'p1' })
    expect(got.structuredContent).toMatchObject({ id: 'p1', title: 'Flat', version: 1 })
    expect(got.structuredContent.doc.artboards).toHaveLength(1)
  })

  it('create_project errors: duplicate and invalid doc', async () => {
    await tool('create_project', { id: 'p1' })
    expect((await tool('create_project', { id: 'p1' })).isError).toBe(true)
    const bad = await tool('create_project', { id: 'p2', doc: { schemaVersion: 3 } })
    expect(bad.isError).toBe(true)
    expect(bad.structuredContent.error).toBe('invalid_document')
  })

  it('get_project and delete_project: not found and missing argument', async () => {
    expect((await tool('get_project', { projectId: 'ghost' })).isError).toBe(true)
    expect((await tool('get_project', {})).isError).toBe(true)
  })

  it('run_commands applies, dryRun saves nothing, baseVersion conflicts', async () => {
    await tool('create_project', { id: 'p1' })
    const dry = await tool('run_commands', { projectId: 'p1', command: addRoom, dryRun: true })
    expect(dry.structuredContent).toMatchObject({ ok: true, dryRun: true, version: 1 })
    expect(db.projects.get('p1')?.version).toBe(1)
    const live = await tool('run_commands', { projectId: 'p1', commands: [addRoom], baseVersion: 1 })
    expect(live.structuredContent).toMatchObject({ ok: true, dryRun: false, version: 2 })
    expect(db.projects.get('p1')?.version).toBe(2)
    const stale = await tool('run_commands', { projectId: 'p1', command: addRoom, baseVersion: 1 })
    expect(stale.isError).toBe(true)
    expect(stale.structuredContent).toEqual({ error: 'version_conflict', currentVersion: 2 })
    const bad = await tool('run_commands', { projectId: 'p1', command: { type: 'nope' } })
    expect(bad.isError).toBe(true)
    expect(db.projects.get('p1')?.version).toBe(2)
  })

  it('query_project', async () => {
    await tool('create_project', { id: 'p1' })
    await tool('run_commands', { projectId: 'p1', command: addRoom })
    const summary = await tool('query_project', { projectId: 'p1', kind: 'summary' })
    expect(summary.structuredContent.summary.artboards[0].rooms[0]).toMatchObject({ name: 'Living', areaM2: 12 })
    expect((await tool('query_project', { projectId: 'p1', kind: 'walls' })).structuredContent.walls).toHaveLength(4)
    expect((await tool('query_project', { projectId: 'p1', kind: 'rooms' })).structuredContent.rooms).toHaveLength(1)
    expect((await tool('query_project', { projectId: 'p1', kind: 'validate' })).structuredContent.valid).toBe(true)
    expect((await tool('query_project', { projectId: 'p1', kind: 'artboard' })).structuredContent.artboard.rooms).toHaveLength(1)
    expect((await tool('query_project', { projectId: 'p1', kind: 'bogus' })).isError).toBe(true)
    expect((await tool('query_project', { projectId: 'ghost', kind: 'summary' })).isError).toBe(true)
  })

  it('render_svg', async () => {
    await tool('create_project', { id: 'p1' })
    await tool('run_commands', { projectId: 'p1', command: addRoom })
    const svg = await tool('render_svg', { projectId: 'p1' })
    expect(svg.content[0].text).toContain('<svg')
    expect(svg.content[0].text).toContain('Living')
    expect((await tool('render_svg', { projectId: 'p1', artboardId: 'nope' })).isError).toBe(true)
  })

  it('delete_project removes the row and its images', async () => {
    await tool('create_project', { id: 'p1' })
    await tool('create_project', { id: 'p10' })
    for (const n of ['a', 'b', 'c']) await r2.put(`images/p1/${n}`, new ArrayBuffer(1))
    await r2.put('images/p10/keep', new ArrayBuffer(1))
    const res = await tool('delete_project', { projectId: 'p1' })
    expect(res.structuredContent).toEqual({ ok: true, deletedImages: 3 })
    expect(db.projects.has('p1')).toBe(false)
    expect([...r2.objects.keys()]).toEqual(['images/p10/keep'])
  })
})

describe('scope enforcement', () => {
  it('read token can read but not write', async () => {
    await tool('create_project', { id: 'p1' })
    const read = await makeToken('read')
    expect((await tool('list_projects', {}, read)).isError).toBeUndefined()
    expect((await tool('get_project', { projectId: 'p1' }, read)).isError).toBeUndefined()
    expect((await tool('query_project', { projectId: 'p1', kind: 'summary' }, read)).isError).toBeUndefined()
    expect((await tool('render_svg', { projectId: 'p1' }, read)).isError).toBeUndefined()
    expect((await tool('run_commands', { projectId: 'p1', command: addRoom }, read)).isError).toBe(true)
    expect((await tool('create_project', { id: 'p2' }, read)).isError).toBe(true)
    expect((await tool('delete_project', { projectId: 'p1' }, read)).isError).toBe(true)
    expect(db.projects.get('p1')?.version).toBe(1)
    expect(db.projects.has('p2')).toBe(false)
  })

  it('project-limited token only reaches its project', async () => {
    await tool('create_project', { id: 'a' })
    await tool('create_project', { id: 'b' })
    const t = await makeToken('edit', 'a')
    expect((await tool('list_projects', {}, t)).structuredContent.projects.map((p: { id: string }) => p.id)).toEqual(['a'])
    expect((await tool('get_project', { projectId: 'a' }, t)).isError).toBeUndefined()
    expect((await tool('get_project', { projectId: 'b' }, t)).isError).toBe(true)
    expect((await tool('run_commands', { projectId: 'b', command: addRoom }, t)).isError).toBe(true)
    expect((await tool('delete_project', { projectId: 'b' }, t)).isError).toBe(true)
    expect((await tool('create_project', { id: 'c' }, t)).isError).toBe(true)
    expect((await tool('run_commands', { projectId: 'a', command: addRoom }, t)).isError).toBeUndefined()
    expect(db.projects.has('b')).toBe(true)
  })
})
