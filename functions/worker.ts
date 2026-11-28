// Single Cloudflare Worker entrypoint (Static Assets + API).
//
// /api/* is handled here; every other request is served by the ASSETS binding (./dist).
// Self-contained: functions/ is not part of the tsc -b project, so the minimal
// Cloudflare runtime types are declared below.
import { applyCommand, applyCommands, summarizeProject, validateProject } from '../src/core/index'
import type { AgentCommand } from '../src/core/index'
import { renderArtboardSvg } from '../src/features/export/artboardSvg'
import { createArtboard, newId } from '../src/model/schema'
import type { ProjectDoc } from '../src/model/types'
import { handleMcp } from './mcp'

interface D1Result<T> {
  results: T[]
}
interface D1RunResult {
  meta?: { changes?: number }
}
interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>
  first<T = Record<string, unknown>>(): Promise<T | null>
  run(): Promise<D1RunResult>
}
interface D1Database {
  prepare(query: string): D1PreparedStatement
}
interface R2ObjectBody {
  body: ReadableStream
  httpMetadata?: { contentType?: string }
}
interface R2Objects {
  objects: { key: string }[]
  truncated: boolean
  cursor?: string
}
interface R2Bucket {
  get(key: string): Promise<R2ObjectBody | null>
  put(key: string, value: ArrayBuffer, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>
  delete(keys: string | string[]): Promise<void>
  list(options?: { prefix?: string; cursor?: string }): Promise<R2Objects>
}
interface Fetcher {
  fetch(request: Request): Promise<Response>
}

export interface Env {
  DB: D1Database
  IMAGES: R2Bucket
  ASSETS: Fetcher
  API_TOKEN?: string
  PASSCODE?: string
}

type ProjectRow = { id: string; title: string; doc_json: string; version: number; updated_at: string }
export type Scope = 'read' | 'edit' | 'admin'
export type Auth = { scope: Scope; projectId: string | null }
export type JsonObject = Record<string, unknown>

const IMAGE_KEY_PREFIX = 'images/'
const SEGMENT = /^[A-Za-z0-9._-]+$/
const SCOPE_RANK: Record<Scope, number> = { read: 1, edit: 2, admin: 3 }
const isScope = (v: unknown): v is Scope => v === 'read' || v === 'edit' || v === 'admin'
const PROJECT_COLUMNS = 'id, title, doc_json, version, updated_at'

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const forbidden = (): Response => json({ error: 'Forbidden' }, 403)

const encoder = new TextEncoder()

/**
 * Constant-time string compare: the loop always runs over the longer input, so the
 * running time does not depend on where (or whether) the two strings differ.
 */
function safeEqual(a: string, b: string): boolean {
  const ab = encoder.encode(a)
  const bb = encoder.encode(b)
  let diff = ab.length ^ bb.length
  const len = Math.max(ab.length, bb.length)
  for (let i = 0; i < len; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0)
  return diff === 0
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

async function sha256Hex(value: string): Promise<string> {
  return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))))
}

// ---------------------------------------------------------------------------
// Authentication and scopes
// ---------------------------------------------------------------------------

/** Looks up a programmatic token by its SHA-256 hash. Null when unknown, revoked, or the table is missing. */
async function lookupToken(env: Env, presented: string): Promise<Auth | null> {
  try {
    const hash = await sha256Hex(presented)
    const row = await env.DB.prepare('SELECT id, scopes, project_id FROM api_tokens WHERE token_hash = ? AND revoked_at IS NULL')
      .bind(hash)
      .first<{ id: string; scopes: string; project_id: string | null }>()
    if (!row || !isScope(row.scopes)) return null
    try {
      await env.DB.prepare('UPDATE api_tokens SET last_used_at = ? WHERE id = ?').bind(new Date().toISOString(), row.id).run()
    } catch {
      // Best effort: a failed bookkeeping write must not block the request.
    }
    return { scope: row.scopes, projectId: row.project_id ?? null }
  } catch {
    return null
  }
}

/**
 * Resolves the caller. Accepts "Authorization: Bearer <token>" and "x-api-token: <secret>".
 * The master secret (PASSCODE or API_TOKEN) is admin on every project. With no secret set, local dev is
 * open (admin) unless the caller sent an explicit Bearer token. Otherwise the token is looked up in D1.
 */
async function authenticate(request: Request, env: Env): Promise<Auth | null> {
  const bearer = /^Bearer\s+(.+)$/i.exec(request.headers.get('authorization') ?? '')?.[1]?.trim()
  const presented = bearer || request.headers.get('x-api-token') || ''
  const secret = env.PASSCODE || env.API_TOKEN
  if (presented && secret && safeEqual(presented, secret)) return { scope: 'admin', projectId: null }
  if (presented) {
    const found = await lookupToken(env, presented)
    if (found) return found
  }
  if (bearer) return null
  if (!secret) return { scope: 'admin', projectId: null }
  return null
}

/** Null when the caller may do it; a 403 Response when the scope is too low or the project is not theirs. */
export function guard(auth: Auth, need: Scope, projectId?: string): Response | null {
  if (SCOPE_RANK[auth.scope] < SCOPE_RANK[need]) return forbidden()
  if (projectId !== undefined && auth.projectId !== null && auth.projectId !== projectId) return forbidden()
  if (need === 'admin' && auth.projectId !== null) return forbidden()
  return null
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

async function readObject(request: Request): Promise<JsonObject | null> {
  try {
    const body = (await request.json()) as unknown
    return body && typeof body === 'object' && !Array.isArray(body) ? (body as JsonObject) : null
  } catch {
    return null
  }
}

/** baseVersion from the body, else from If-Match. null: not given. 'invalid': given but not an integer. */
function baseVersionOf(request: Request, body: JsonObject): number | null | 'invalid' {
  if (body.baseVersion !== undefined) {
    return typeof body.baseVersion === 'number' && Number.isInteger(body.baseVersion) ? body.baseVersion : 'invalid'
  }
  const header = request.headers.get('if-match')
  if (header === null) return null
  const m = /^(?:W\/)?"?(\d+)"?$/.exec(header.trim())
  return m ? Number(m[1]) : 'invalid'
}

const invalidBaseVersion = (): Response => json({ error: 'baseVersion must be an integer' }, 400)
const conflict = (currentVersion: number): Response => json({ error: 'version_conflict', currentVersion }, 409)

function loadRow(env: Env, id: string): Promise<ProjectRow | null> {
  return env.DB.prepare(`SELECT ${PROJECT_COLUMNS} FROM projects WHERE id = ?`).bind(id).first<ProjectRow>()
}

/** Compare-and-swap update: returns the new version, or null when the row changed meanwhile. */
async function saveRow(env: Env, row: ProjectRow, title: string, doc: unknown): Promise<{ version: number; updatedAt: string } | null> {
  const updatedAt = new Date().toISOString()
  const version = row.version + 1
  const res = await env.DB.prepare('UPDATE projects SET title = ?, doc_json = ?, version = ?, updated_at = ? WHERE id = ? AND version = ?')
    .bind(title, JSON.stringify(doc), version, updatedAt, row.id, row.version)
    .run()
  if (res?.meta?.changes === 0) return null
  return { version, updatedAt }
}

export async function listProjects(env: Env, auth: Auth): Promise<Response> {
  type Item = { id: string; title: string; version: number; updated_at: string }
  const { results } = auth.projectId
    ? await env.DB.prepare('SELECT id, title, version, updated_at FROM projects WHERE id = ? ORDER BY updated_at DESC').bind(auth.projectId).all<Item>()
    : await env.DB.prepare('SELECT id, title, version, updated_at FROM projects ORDER BY updated_at DESC').all<Item>()
  return json({
    projects: results.map((r) => ({ id: r.id, title: r.title, version: r.version, updatedAt: r.updated_at })),
  })
}

export async function getProject(env: Env, id: string): Promise<Response> {
  const row = await loadRow(env, id)
  if (!row) return json({ error: 'Not found' }, 404)
  return json({ id: row.id, title: row.title, doc: JSON.parse(row.doc_json), version: row.version, updatedAt: row.updated_at })
}

export async function createProject(env: Env, auth: Auth, request: Request): Promise<Response> {
  const body = await readObject(request)
  if (!body) return json({ error: 'Invalid JSON' }, 400)
  if (body.title !== undefined && typeof body.title !== 'string') return json({ error: 'title must be a string' }, 400)
  if (body.id !== undefined && typeof body.id !== 'string') return json({ error: 'id must be a string' }, 400)
  if (body.doc !== undefined && (!body.doc || typeof body.doc !== 'object' || Array.isArray(body.doc))) {
    return json({ error: 'doc must be an object' }, 400)
  }
  const given = (body.doc as JsonObject | undefined) ?? {}
  const idCandidate = body.id ?? (typeof given.id === 'string' && given.id ? given.id : newId())
  if (!SEGMENT.test(idCandidate) || idCandidate.includes('..')) return json({ error: 'Invalid id' }, 400)
  if (auth.projectId !== null && auth.projectId !== idCandidate) return forbidden()
  const title = body.title ?? (typeof given.title === 'string' ? given.title : 'Untitled project')
  const input =
    body.doc === undefined
      ? { schemaVersion: 3, id: idCandidate, title, refImages: [], artboards: [createArtboard('Plan A')] }
      : { ...given, id: idCandidate, title }
  const v = validateProject(input)
  if (!v.ok || !v.doc) return json({ error: 'invalid_document', issues: v.issues }, 400)
  if (await loadRow(env, idCandidate)) return json({ error: 'Project already exists' }, 409)
  const updatedAt = new Date().toISOString()
  await env.DB.prepare('INSERT INTO projects (id, title, doc_json, version, updated_at) VALUES (?, ?, ?, 1, ?)')
    .bind(idCandidate, title, JSON.stringify(v.doc), updatedAt)
    .run()
  return json({ id: idCandidate, title, version: 1, updatedAt }, 201)
}

async function putProject(env: Env, id: string, request: Request): Promise<Response> {
  const body = await readObject(request)
  if (!body) return json({ error: 'Invalid JSON' }, 400)
  if (!id || !body.doc || typeof body.doc !== 'object' || Array.isArray(body.doc)) {
    return json({ error: 'id and doc are required' }, 400)
  }
  if (body.title !== undefined && typeof body.title !== 'string') return json({ error: 'title must be a string' }, 400)
  const base = baseVersionOf(request, body)
  if (base === 'invalid') return invalidBaseVersion()
  const v = validateProject(body.doc)
  if (!v.ok || !v.doc) return json({ error: 'invalid_document', issues: v.issues }, 400)
  const title = body.title || v.doc.title || 'Untitled project'
  const row = await loadRow(env, id)
  if (!row) {
    const updatedAt = new Date().toISOString()
    await env.DB.prepare('INSERT INTO projects (id, title, doc_json, version, updated_at) VALUES (?, ?, ?, 1, ?)')
      .bind(id, title, JSON.stringify(v.doc), updatedAt)
      .run()
    return json({ ok: true, version: 1, updatedAt })
  }
  if (base !== null && base !== row.version) return conflict(row.version)
  const saved = await saveRow(env, row, title, v.doc)
  if (!saved) return conflict((await loadRow(env, id))?.version ?? row.version + 1)
  return json({ ok: true, version: saved.version, updatedAt: saved.updatedAt })
}

async function patchProject(env: Env, id: string, request: Request): Promise<Response> {
  const body = await readObject(request)
  if (!body) return json({ error: 'Invalid JSON' }, 400)
  if (typeof body.title !== 'string' || !body.title) return json({ error: 'title is required' }, 400)
  const base = baseVersionOf(request, body)
  if (base === 'invalid') return invalidBaseVersion()
  const row = await loadRow(env, id)
  if (!row) return json({ error: 'Not found' }, 404)
  if (base !== null && base !== row.version) return conflict(row.version)
  const doc = { ...(JSON.parse(row.doc_json) as JsonObject), title: body.title }
  const saved = await saveRow(env, row, body.title, doc)
  if (!saved) return conflict((await loadRow(env, id))?.version ?? row.version + 1)
  return json({ ok: true, id, title: body.title, version: saved.version, updatedAt: saved.updatedAt })
}

/** Deletes every R2 object under images/<projectId>/, page by page. Returns how many were deleted. */
async function deleteProjectImages(env: Env, id: string): Promise<number> {
  const prefix = `${IMAGE_KEY_PREFIX}${id}/`
  let cursor: string | undefined
  let count = 0
  for (;;) {
    const page = await env.IMAGES.list(cursor ? { prefix, cursor } : { prefix })
    const keys = page.objects.map((o) => o.key)
    if (keys.length > 0) {
      await env.IMAGES.delete(keys)
      count += keys.length
    }
    if (!page.truncated || !page.cursor) break
    cursor = page.cursor
  }
  return count
}

export async function deleteProject(env: Env, id: string): Promise<Response> {
  await env.DB.prepare('DELETE FROM projects WHERE id = ?').bind(id).run()
  const deletedImages = await deleteProjectImages(env, id)
  return json({ ok: true, deletedImages })
}

export async function runCommands(env: Env, id: string, request: Request): Promise<Response> {
  const body = await readObject(request)
  if (!body) return json({ error: 'Invalid JSON' }, 400)
  const base = baseVersionOf(request, body)
  if (base === 'invalid') return invalidBaseVersion()
  const single = body.command
  const many = body.commands
  if ((single === undefined) === (many === undefined)) return json({ error: 'Send exactly one of command or commands' }, 400)
  if (many !== undefined && !Array.isArray(many)) return json({ error: 'commands must be an array' }, 400)
  const row = await loadRow(env, id)
  if (!row) return json({ error: 'Not found' }, 404)
  if (base !== null && base !== row.version) return conflict(row.version)
  const dryRun = body.dryRun === true
  const doc = JSON.parse(row.doc_json) as ProjectDoc
  const res = Array.isArray(many)
    ? applyCommands(doc, many as AgentCommand[], { dryRun })
    : applyCommand(doc, single as AgentCommand, { dryRun })
  if (!res.ok) return json({ ok: false, error: res.error, issues: res.issues }, 400)
  if (dryRun) return json({ ok: true, dryRun: true, version: row.version, result: res.result })
  const saved = await saveRow(env, row, res.doc.title, res.doc)
  if (!saved) return conflict((await loadRow(env, id))?.version ?? row.version + 1)
  return json({ ok: true, dryRun: false, version: saved.version, updatedAt: saved.updatedAt, result: res.result })
}

const QUERY_KINDS = ['summary', 'validate', 'rooms', 'walls', 'artboard']

export async function queryProject(env: Env, id: string, request: Request): Promise<Response> {
  const body = await readObject(request)
  if (!body) return json({ error: 'Invalid JSON' }, 400)
  const kind = body.kind
  if (typeof kind !== 'string' || !QUERY_KINDS.includes(kind)) return json({ error: `kind must be one of ${QUERY_KINDS.join(', ')}` }, 400)
  if (body.artboardId !== undefined && typeof body.artboardId !== 'string') return json({ error: 'artboardId must be a string' }, 400)
  const row = await loadRow(env, id)
  if (!row) return json({ error: 'Not found' }, 404)
  const doc = JSON.parse(row.doc_json) as ProjectDoc
  if (kind === 'validate') {
    const v = validateProject(doc)
    return json({ ok: true, valid: v.ok, issues: v.issues })
  }
  const summary = summarizeProject(doc)
  if (kind === 'summary') return json({ ok: true, summary })
  const wanted = body.artboardId
  const artboards = wanted === undefined ? summary.artboards : summary.artboards.filter((a) => a.id === wanted)
  if (artboards.length === 0 && (wanted !== undefined || kind === 'artboard')) return json({ error: 'Artboard not found' }, 404)
  if (kind === 'artboard') return json({ ok: true, artboard: artboards[0] })
  if (kind === 'rooms') {
    return json({ ok: true, rooms: artboards.flatMap((a) => a.rooms.map((r) => ({ artboardId: a.id, ...r }))) })
  }
  const walls = artboards.flatMap((a) =>
    a.rooms.flatMap((r) => r.walls.map((w) => ({ artboardId: a.id, roomId: r.id, roomName: r.name, ...w }))),
  )
  return json({ ok: true, walls })
}

export async function renderProject(env: Env, id: string, request: Request): Promise<Response> {
  const row = await loadRow(env, id)
  if (!row) return json({ error: 'Not found' }, 404)
  const doc = JSON.parse(row.doc_json) as ProjectDoc
  const wanted = new URL(request.url).searchParams.get('artboard')
  const artboard = wanted ? doc.artboards.find((a) => a.id === wanted) : doc.artboards[0]
  if (!artboard) return json({ error: 'Artboard not found' }, 404)
  return new Response(renderArtboardSvg(artboard).svg, { headers: { 'Content-Type': 'image/svg+xml; charset=utf-8' } })
}

// ---------------------------------------------------------------------------
// Tokens (admin)
// ---------------------------------------------------------------------------

async function createToken(env: Env, request: Request): Promise<Response> {
  const body = await readObject(request)
  if (!body) return json({ error: 'Invalid JSON' }, 400)
  if (typeof body.name !== 'string' || !body.name.trim()) return json({ error: 'name is required' }, 400)
  const scopes = body.scopes ?? 'read'
  if (!isScope(scopes)) return json({ error: "scopes must be 'read', 'edit' or 'admin'" }, 400)
  const projectId = body.projectId ?? null
  if (projectId !== null && (typeof projectId !== 'string' || !projectId)) return json({ error: 'projectId must be a string or null' }, 400)
  const token = `sfp_${toHex(crypto.getRandomValues(new Uint8Array(16)))}`
  const id = newId()
  const createdAt = new Date().toISOString()
  await env.DB.prepare('INSERT INTO api_tokens (id, name, token_hash, scopes, project_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, body.name.trim(), await sha256Hex(token), scopes, projectId, createdAt)
    .run()
  return json({ id, name: body.name.trim(), token, scopes, projectId, createdAt }, 201)
}

async function listTokens(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    'SELECT id, name, scopes, project_id, created_at, revoked_at, last_used_at FROM api_tokens ORDER BY created_at DESC',
  ).all<{ id: string; name: string; scopes: string; project_id: string | null; created_at: string; revoked_at: string | null; last_used_at: string | null }>()
  return json({
    tokens: results.map((t) => ({
      id: t.id,
      name: t.name,
      scopes: t.scopes,
      projectId: t.project_id ?? null,
      createdAt: t.created_at,
      revokedAt: t.revoked_at ?? null,
      lastUsedAt: t.last_used_at ?? null,
    })),
  })
}

async function revokeToken(env: Env, id: string): Promise<Response> {
  await env.DB.prepare('UPDATE api_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').bind(new Date().toISOString(), id).run()
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

// ---------------------------------------------------------------------------
// Discovery documents (unauthenticated): OpenAPI 3.1 spec and ProjectDoc v3 JSON Schema.
// Source of truth: src/model/schema.ts (zod) and src/model/types.ts (types).
// ---------------------------------------------------------------------------

const DISCOVERY_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'public, max-age=300',
}

function discoveryJson(data: unknown): Response {
  return new Response(JSON.stringify(data), { headers: DISCOVERY_HEADERS })
}

/** Rewrites JSON Schema '#/$defs/X' references to OpenAPI '#/components/schemas/X' references. */
function toComponentRefs<T>(value: T): T {
  return JSON.parse(JSON.stringify(value).replaceAll('#/$defs/', '#/components/schemas/')) as T
}

const PROJECT_DOC_DEFS = {
  Vec: {
    type: 'object',
    description: 'A point in artboard-local cm. x is right, y is down.',
    required: ['x', 'y'],
    properties: { x: { type: 'number' }, y: { type: 'number' } },
  },
  Room: {
    type: 'object',
    description: 'Room polygon in artboard-local cm. The vertices are the interior; walls are drawn outward from each edge.',
    required: ['id', 'name', 'vertices'],
    properties: {
      id: { type: 'string', minLength: 1 },
      name: { type: 'string' },
      vertices: { type: 'array', items: { $ref: '#/$defs/Vec' } },
      fill: { type: 'string', description: 'Fill colour (CSS colour string).' },
      floorPattern: { type: 'string', enum: ['solid', 'wood', 'parquet', 'tile', 'stone', 'carpet', 'grass'] },
      wallColors: {
        type: 'object',
        description: 'Accent colour per wall. Keys are edge indices ("0", "1", ...).',
        additionalProperties: { type: 'string' },
      },
      wallKinds: {
        type: 'object',
        description:
          'Kind per wall. Keys are edge indices ("0", "1", ...); values are "wall" or "fence". ' +
          'A fence is a low railing (for example a balcony parapet) drawn about 100 cm high. Omitted means "wall".',
        additionalProperties: { type: 'string', enum: ['wall', 'fence'] },
      },
    },
  },
  Opening: {
    type: 'object',
    description: 'A door, window or opening placed on a wall. xCm and yCm are the centre of the opening.',
    required: ['id', 'kind', 'xCm', 'yCm', 'angleDeg', 'widthCm'],
    properties: {
      id: { type: 'string', minLength: 1 },
      kind: { type: 'string', enum: ['door', 'window', 'opening'] },
      roomId: { type: 'string', minLength: 1, description: 'Room whose wall hosts the opening. Optional.' },
      xCm: { type: 'number' },
      yCm: { type: 'number' },
      angleDeg: { type: 'number' },
      widthCm: { type: 'number', exclusiveMinimum: 0 },
      hinge: { type: 'string', enum: ['left', 'right'] },
      swing: { type: 'string', enum: ['in', 'out'] },
      heightCm: { type: 'number', exclusiveMinimum: 0 },
      sillCm: { type: 'number', minimum: 0 },
      variant: {
        type: 'string',
        enum: ['standard', 'pocket', 'bypass', 'french', 'sliding', 'casement', 'double-casement'],
        description: 'Door styles: standard, pocket, bypass, french. Window styles: standard, sliding, casement, double-casement. Omitted means standard.',
      },
    },
  },
  FurnitureItem: {
    type: 'object',
    required: ['id', 'name', 'shape', 'xCm', 'yCm', 'widthCm', 'depthCm', 'rotationDeg', 'color'],
    properties: {
      id: { type: 'string', minLength: 1 },
      name: { type: 'string' },
      shape: { type: 'string', enum: ['rect', 'circle'] },
      xCm: { type: 'number' },
      yCm: { type: 'number' },
      widthCm: { type: 'number', exclusiveMinimum: 0 },
      depthCm: { type: 'number', exclusiveMinimum: 0 },
      rotationDeg: { type: 'number' },
      color: { type: 'string' },
      heightCm: { type: 'number', exclusiveMinimum: 0 },
      showDirection: { type: 'boolean', description: 'Draw a front-direction arrow near the local -Y edge.' },
      cornerRadiusCm: { type: 'number', minimum: 0, description: 'Border radius of a rect item, for all 4 corners. Ignored for circle.' },
      cornerRadiiCm: {
        type: 'array',
        minItems: 4,
        maxItems: 4,
        items: { type: 'number', minimum: 0 },
        description: 'One border radius per corner of a rect item, in the order top-left, top-right, bottom-right, bottom-left. Wins over cornerRadiusCm. Ignored for circle.',
      },
    },
  },
  Artboard: {
    type: 'object',
    required: ['id', 'name', 'xCm', 'yCm', 'rooms', 'openings', 'furniture'],
    properties: {
      id: { type: 'string', minLength: 1 },
      name: { type: 'string' },
      xCm: { type: 'number' },
      yCm: { type: 'number' },
      ceilingHeightCm: { type: 'number', exclusiveMinimum: 0, default: 250 },
      precisionCm: { type: 'number', enum: [0.1, 0.5, 1], default: 1, description: 'Drawing precision (snap and rounding step) in cm.' },
      wallThicknessCm: { type: 'number', minimum: 0, maximum: 50, description: 'Omitted means 10. 0 turns thick walls off.' },
      widthCm: { type: 'number', exclusiveMinimum: 0, description: 'Optional manual frame width. Acts as the minimum frame size.' },
      heightCm: { type: 'number', exclusiveMinimum: 0, description: 'Optional manual frame height. Acts as the minimum frame size.' },
      rooms: { type: 'array', items: { $ref: '#/$defs/Room' } },
      openings: { type: 'array', items: { $ref: '#/$defs/Opening' } },
      furniture: { type: 'array', items: { $ref: '#/$defs/FurnitureItem' } },
    },
  },
  RefImage: {
    type: 'object',
    required: ['id', 'name', 'src', 'naturalWidth', 'naturalHeight', 'xCm', 'yCm', 'cmPerPx', 'rotationDeg', 'opacity', 'visible', 'locked'],
    properties: {
      id: { type: 'string', minLength: 1 },
      name: { type: 'string' },
      src: { type: 'string', description: 'Data URL, or a /api/images/{projectId}/{imageId} path for cloud-synced images.' },
      naturalWidth: { type: 'number', exclusiveMinimum: 0 },
      naturalHeight: { type: 'number', exclusiveMinimum: 0 },
      xCm: { type: 'number' },
      yCm: { type: 'number' },
      cmPerPx: { type: 'number', exclusiveMinimum: 0 },
      rotationDeg: { type: 'number' },
      opacity: { type: 'number', minimum: 0, maximum: 1 },
      visible: { type: 'boolean' },
      locked: { type: 'boolean' },
    },
  },
}

/** ProjectDoc v3 body (without the $schema / $defs wrapper). */
const PROJECT_DOC_BODY = {
  type: 'object',
  description: 'Simple Floorplan project document, schemaVersion 3. Units: cm and degrees. x is right, y is down.',
  required: ['schemaVersion', 'id', 'title', 'refImages', 'artboards'],
  properties: {
    schemaVersion: { const: 3 },
    id: { type: 'string', minLength: 1 },
    title: { type: 'string' },
    refImages: { type: 'array', items: { $ref: '#/$defs/RefImage' } },
    artboards: { type: 'array', minItems: 1, items: { $ref: '#/$defs/Artboard' } },
  },
}

const PROJECT_DOC_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Simple Floorplan ProjectDoc v3',
  ...PROJECT_DOC_BODY,
  $defs: PROJECT_DOC_DEFS,
}

const OPENAPI_SCHEMAS = toComponentRefs({
  ...PROJECT_DOC_DEFS,
  ProjectDoc: PROJECT_DOC_BODY,
  Error: {
    type: 'object',
    required: ['error'],
    properties: { error: { type: 'string' } },
  },
  OkResult: {
    type: 'object',
    required: ['ok'],
    properties: { ok: { type: 'boolean', const: true } },
  },
  ProjectSummary: {
    type: 'object',
    required: ['id', 'title', 'version', 'updatedAt'],
    properties: {
      id: { type: 'string' },
      title: { type: 'string' },
      version: { type: 'integer', minimum: 1 },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  },
  ProjectList: {
    type: 'object',
    required: ['projects'],
    properties: { projects: { type: 'array', items: { $ref: '#/$defs/ProjectSummary' } } },
  },
  ProjectRecord: {
    type: 'object',
    required: ['id', 'title', 'doc', 'version', 'updatedAt'],
    properties: {
      id: { type: 'string' },
      title: { type: 'string' },
      doc: { $ref: '#/$defs/ProjectDoc' },
      version: { type: 'integer', minimum: 1, description: 'Starts at 1. Every write adds 1.' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  },
  ProjectCreate: {
    type: 'object',
    properties: {
      id: { type: 'string', pattern: '^[A-Za-z0-9._-]+$', description: 'Optional. A UUID is generated when omitted.' },
      title: { type: 'string' },
      doc: { $ref: '#/$defs/ProjectDoc', description: 'Optional. Omitted means an empty v3 document with one artboard.' },
    },
  },
  ProjectCreated: {
    type: 'object',
    required: ['id', 'title', 'version', 'updatedAt'],
    properties: {
      id: { type: 'string' },
      title: { type: 'string' },
      version: { type: 'integer', const: 1 },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  },
  ProjectWrite: {
    type: 'object',
    required: ['doc'],
    properties: {
      title: { type: 'string', minLength: 1, description: 'Defaults to doc.title.' },
      doc: { $ref: '#/$defs/ProjectDoc', description: 'Validated with the ProjectDoc schema and the semantic checks. Errors give 400 invalid_document.' },
      baseVersion: { type: 'integer', description: 'Optional. The write fails with 409 when the stored version differs. The If-Match header does the same.' },
    },
  },
  ProjectSaved: {
    type: 'object',
    required: ['ok', 'version', 'updatedAt'],
    properties: {
      ok: { type: 'boolean', const: true },
      version: { type: 'integer' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  },
  ProjectPatch: {
    type: 'object',
    properties: { title: { type: 'string', minLength: 1 }, baseVersion: { type: 'integer' } },
  },
  ProjectPatched: {
    type: 'object',
    required: ['ok', 'id', 'title', 'version', 'updatedAt'],
    properties: {
      ok: { type: 'boolean', const: true },
      id: { type: 'string' },
      title: { type: 'string' },
      version: { type: 'integer' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  },
  ProjectDeleted: {
    type: 'object',
    required: ['ok', 'deletedImages'],
    properties: { ok: { type: 'boolean', const: true }, deletedImages: { type: 'integer' } },
  },
  ValidationIssue: {
    type: 'object',
    required: ['code', 'severity', 'path', 'message'],
    properties: {
      code: { type: 'string' },
      severity: { type: 'string', enum: ['error', 'warning'] },
      path: { type: 'string' },
      message: { type: 'string' },
    },
  },
  InvalidDocument: {
    type: 'object',
    required: ['error', 'issues'],
    properties: {
      error: { type: 'string', const: 'invalid_document' },
      issues: { type: 'array', items: { $ref: '#/$defs/ValidationIssue' } },
    },
  },
  VersionConflict: {
    type: 'object',
    required: ['error', 'currentVersion'],
    properties: { error: { type: 'string', const: 'version_conflict' }, currentVersion: { type: 'integer' } },
  },
  AgentCommand: {
    type: 'object',
    required: ['type'],
    description:
      'One command, for example {"type":"add_room_rect","xCm":0,"yCm":0,"widthCm":400,"heightCm":300}. ' +
      'Types: set_title, add_artboard, update_artboard, duplicate_artboard, delete_artboard, add_room_rect, add_room_polygon, rename_room, ' +
      'move_room, set_wall_length, move_vertex, insert_vertex, delete_vertex, delete_rooms, cutout_rooms, merge_rooms, set_room_style, ' +
      'add_opening_on_wall, update_opening, delete_opening, add_furniture, update_furniture, reorder_furniture, duplicate_furniture, delete_furniture, group_furniture, ungroup_furniture. ' +
      'Most commands take an optional artboardId (default: the first artboard).',
    properties: { type: { type: 'string' } },
    additionalProperties: true,
  },
  CommandsRequest: {
    type: 'object',
    description: 'Send command or commands (not both). A batch is all or nothing.',
    properties: {
      command: { $ref: '#/$defs/AgentCommand' },
      commands: { type: 'array', items: { $ref: '#/$defs/AgentCommand' } },
      dryRun: { type: 'boolean', description: 'Compute and check the result, but save nothing.' },
      baseVersion: { type: 'integer' },
    },
  },
  CommandsResponse: {
    type: 'object',
    required: ['ok', 'dryRun', 'version', 'result'],
    properties: {
      ok: { type: 'boolean', const: true },
      dryRun: { type: 'boolean' },
      version: { type: 'integer', description: 'The new version, or the current one for a dry run.' },
      updatedAt: { type: 'string', format: 'date-time', description: 'Not set for a dry run.' },
      result: { type: 'object', additionalProperties: true },
    },
  },
  CommandFailed: {
    type: 'object',
    required: ['ok', 'error'],
    properties: {
      ok: { type: 'boolean', const: false },
      error: { type: 'string' },
      issues: { type: 'array', items: { $ref: '#/$defs/ValidationIssue' } },
    },
  },
  QueryRequest: {
    type: 'object',
    required: ['kind'],
    properties: {
      kind: { type: 'string', enum: ['summary', 'validate', 'rooms', 'walls', 'artboard'] },
      artboardId: { type: 'string', description: 'Limits rooms, walls and artboard to one artboard. Default: all (artboard: the first).' },
    },
  },
  QueryResponse: {
    type: 'object',
    required: ['ok'],
    description:
      'summary: {summary}. validate: {valid, issues}. artboard: {artboard}. rooms: {rooms}. ' +
      'walls: {walls} (artboardId, roomId, roomName, ref, edgeIndex, lengthCm, angleDeg, start, end, openingIds).',
    properties: { ok: { type: 'boolean', const: true } },
    additionalProperties: true,
  },
  ApiTokenCreate: {
    type: 'object',
    required: ['name'],
    properties: {
      name: { type: 'string', minLength: 1 },
      scopes: { type: 'string', enum: ['read', 'edit', 'admin'], default: 'read' },
      projectId: { type: ['string', 'null'], description: 'Limits the token to one project.' },
    },
  },
  ApiTokenCreated: {
    type: 'object',
    required: ['id', 'name', 'token', 'scopes', 'projectId', 'createdAt'],
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      token: { type: 'string', description: 'sfp_ + 32 hex characters. Shown only once.' },
      scopes: { type: 'string', enum: ['read', 'edit', 'admin'] },
      projectId: { type: ['string', 'null'] },
      createdAt: { type: 'string', format: 'date-time' },
    },
  },
  ApiTokenInfo: {
    type: 'object',
    required: ['id', 'name', 'scopes', 'projectId', 'createdAt', 'revokedAt', 'lastUsedAt'],
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      scopes: { type: 'string', enum: ['read', 'edit', 'admin'] },
      projectId: { type: ['string', 'null'] },
      createdAt: { type: 'string', format: 'date-time' },
      revokedAt: { type: ['string', 'null'], format: 'date-time' },
      lastUsedAt: { type: ['string', 'null'], format: 'date-time' },
    },
  },
  ApiTokenList: {
    type: 'object',
    required: ['tokens'],
    properties: { tokens: { type: 'array', items: { $ref: '#/$defs/ApiTokenInfo' } } },
  },
  ImageSaved: {
    type: 'object',
    required: ['ok', 'key'],
    properties: { ok: { type: 'boolean', const: true }, key: { type: 'string' } },
  },
})

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` })
const jsonContent = (name: string) => ({ 'application/json': { schema: ref(name) } })
const jsonBody = (name: string) => ({ required: true, content: jsonContent(name) })
const okResponse = (description: string, name: string) => ({ description, content: jsonContent(name) })
const errResponse = (description: string, name = 'Error') => ({ description, content: jsonContent(name) })
const R401 = { $ref: '#/components/responses/Unauthorized' }
const R403 = { $ref: '#/components/responses/Forbidden' }
const R409 = errResponse('baseVersion (or If-Match) differs from the stored version.', 'VersionConflict')
const ID_PARAM = { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Project id.' }
const IF_MATCH = {
  name: 'If-Match',
  in: 'header',
  required: false,
  schema: { type: 'string' },
  description: 'Same as baseVersion in the body. The body wins when both are sent.',
}

const OPENAPI_SPEC = {
  openapi: '3.1.0',
  info: {
    title: 'Simple Floorplan API',
    version: '1.1.0',
    description:
      'Cloudflare Worker API for Simple Floorplan project sync (D1), images (R2) and programmatic editing. ' +
      'Documents use ProjectDoc schemaVersion 3 (see /api/schema/project.v3.json). ' +
      'Units: cm and degrees. x is right, y is down. ' +
      'The two discovery routes need no token. Other routes need "Authorization: Bearer <token>" or "x-api-token: <secret>" ' +
      'when the server has a PASSCODE or API_TOKEN secret; with neither set, the API is public. ' +
      'The master secret has the admin scope. Scoped tokens (sfp_...) come from POST /api/tokens. ' +
      'Scopes: read < edit < admin. Every project has an integer version (starts at 1, +1 on each write); ' +
      'send baseVersion (or If-Match) to get 409 instead of overwriting a newer change.',
  },
  servers: [{ url: '/' }],
  security: [{ BearerAuth: [] }, { ApiTokenHeader: [] }],
  paths: {
    '/api/openapi.json': {
      get: {
        operationId: 'getOpenApiSpec',
        summary: 'This OpenAPI document',
        security: [],
        responses: { '200': { description: 'OpenAPI 3.1.0 document.', content: { 'application/json': { schema: { type: 'object' } } } } },
      },
    },
    '/api/schema/project.v3.json': {
      get: {
        operationId: 'getProjectSchema',
        summary: 'JSON Schema (draft 2020-12) for ProjectDoc v3',
        security: [],
        responses: { '200': { description: 'JSON Schema document.', content: { 'application/json': { schema: { type: 'object' } } } } },
      },
    },
    '/api/projects': {
      get: {
        operationId: 'listProjects',
        summary: 'List projects, most recently updated first (scope: read)',
        description: 'A token limited to one project sees only that project.',
        responses: { '200': okResponse('Project summaries.', 'ProjectList'), '401': R401, '403': R403 },
      },
      post: {
        operationId: 'createProject',
        summary: 'Create a project (scope: edit)',
        requestBody: jsonBody('ProjectCreate'),
        responses: {
          '201': okResponse('Created, version 1.', 'ProjectCreated'),
          '400': errResponse('Invalid JSON or invalid document (error "invalid_document" with issues).', 'InvalidDocument'),
          '401': R401,
          '403': R403,
          '409': errResponse('A project with this id exists.'),
        },
      },
    },
    '/api/projects/{id}': {
      parameters: [ID_PARAM],
      get: {
        operationId: 'getProject',
        summary: 'Get one project with its document and version (scope: read)',
        responses: { '200': okResponse('Project record.', 'ProjectRecord'), '401': R401, '403': R403, '404': errResponse('Project not found.') },
      },
      put: {
        operationId: 'putProject',
        summary: 'Create or replace a project (upsert) (scope: edit)',
        parameters: [IF_MATCH],
        requestBody: jsonBody('ProjectWrite'),
        responses: {
          '200': okResponse('Saved. version and updatedAt are set by the server.', 'ProjectSaved'),
          '400': errResponse('Invalid JSON, or invalid document (error "invalid_document" with issues).', 'InvalidDocument'),
          '401': R401,
          '403': R403,
          '409': R409,
        },
      },
      patch: {
        operationId: 'patchProject',
        summary: 'Rename a project (scope: edit)',
        parameters: [IF_MATCH],
        requestBody: jsonBody('ProjectPatch'),
        responses: {
          '200': okResponse('Renamed. The title inside the stored document changes too.', 'ProjectPatched'),
          '400': errResponse('Invalid JSON or missing title.'),
          '401': R401,
          '403': R403,
          '404': errResponse('Project not found.'),
          '409': R409,
        },
      },
      delete: {
        operationId: 'deleteProject',
        summary: 'Delete a project and all its images (scope: edit)',
        responses: {
          '200': okResponse('Deleted. Also returned when the id did not exist.', 'ProjectDeleted'),
          '401': R401,
          '403': R403,
        },
      },
    },
    '/api/projects/{id}/commands': {
      parameters: [ID_PARAM],
      post: {
        operationId: 'applyCommands',
        summary: 'Apply one command or a batch to the stored document (scope: edit)',
        parameters: [IF_MATCH],
        requestBody: jsonBody('CommandsRequest'),
        responses: {
          '200': okResponse('Applied (or checked, for dryRun).', 'CommandsResponse'),
          '400': errResponse('The command failed or would make the document invalid.', 'CommandFailed'),
          '401': R401,
          '403': R403,
          '404': errResponse('Project not found.'),
          '409': R409,
        },
      },
    },
    '/api/projects/{id}/query': {
      parameters: [ID_PARAM],
      post: {
        operationId: 'queryProject',
        summary: 'Read-only semantic query (scope: read)',
        requestBody: jsonBody('QueryRequest'),
        responses: {
          '200': okResponse('Query result.', 'QueryResponse'),
          '400': errResponse('Unknown kind.'),
          '401': R401,
          '403': R403,
          '404': errResponse('Project or artboard not found.'),
        },
      },
    },
    '/api/projects/{id}/render.svg': {
      parameters: [ID_PARAM],
      get: {
        operationId: 'renderProject',
        summary: 'Render one artboard as SVG (scope: read)',
        parameters: [{ name: 'artboard', in: 'query', required: false, schema: { type: 'string' }, description: 'Artboard id. Default: the first.' }],
        responses: {
          '200': { description: 'SVG picture.', content: { 'image/svg+xml': { schema: { type: 'string' } } } },
          '401': R401,
          '403': R403,
          '404': errResponse('Project or artboard not found.'),
        },
      },
    },
    '/api/mcp': {
      post: {
        operationId: 'mcp',
        summary: 'MCP server (Streamable HTTP, JSON-RPC 2.0) (scope: read; tools check their own scope)',
        description:
          'Model Context Protocol endpoint. Methods: initialize, notifications/initialized, ping, tools/list, tools/call. ' +
          'Tools: list_projects, get_project, create_project, query_project, run_commands, render_svg, delete_project. ' +
          'Tool errors return a result with isError true. JSON-RPC errors: -32700 parse, -32600 request, -32601 method, -32602 params.',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['jsonrpc', 'method'], properties: { jsonrpc: { const: '2.0' }, id: { type: ['string', 'integer'] }, method: { type: 'string' }, params: { type: 'object' } } } } } },
        responses: {
          '200': { description: 'JSON-RPC response.', content: { 'application/json': { schema: { type: 'object' } } } },
          '202': { description: 'Notification accepted. Empty body.' },
          '401': R401,
          '403': R403,
        },
      },
    },
    '/api/tokens': {
      get: {
        operationId: 'listTokens',
        summary: 'List API tokens, never their secrets (scope: admin)',
        responses: { '200': okResponse('Tokens.', 'ApiTokenList'), '401': R401, '403': R403 },
      },
      post: {
        operationId: 'createToken',
        summary: 'Create an API token (scope: admin)',
        requestBody: jsonBody('ApiTokenCreate'),
        responses: {
          '201': okResponse('Created. The token value is shown only in this response.', 'ApiTokenCreated'),
          '400': errResponse('Invalid body.'),
          '401': R401,
          '403': R403,
        },
      },
    },
    '/api/tokens/{id}': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Token id.' }],
      delete: {
        operationId: 'revokeToken',
        summary: 'Revoke an API token (scope: admin)',
        responses: { '200': okResponse('Revoked.', 'OkResult'), '401': R401, '403': R403 },
      },
    },
    '/api/images/{projectId}/{imageId}': {
      parameters: [
        {
          name: 'projectId',
          in: 'path',
          required: true,
          schema: { type: 'string', pattern: '^[A-Za-z0-9._-]+$' },
          description: 'Path segment. Allowed characters: letters, digits, ".", "_", "-". ".." is refused.',
        },
        {
          name: 'imageId',
          in: 'path',
          required: true,
          schema: { type: 'string', pattern: '^[A-Za-z0-9._-]+$' },
          description: 'Path segment, same rules as projectId. The R2 object key is images/ + the path (for example images/{projectId}/{imageId}). The Worker also accepts deeper paths.',
        },
      ],
      get: {
        operationId: 'getImage',
        summary: 'Get an uploaded image (scope: read)',
        responses: {
          '200': {
            description: 'Image bytes, sent with the Content-Type stored at upload.',
            content: { '*/*': { schema: { type: 'string', format: 'binary' } } },
          },
          '400': errResponse('Unsafe path segment.'),
          '401': R401,
          '403': R403,
          '404': errResponse('Image not found.'),
        },
      },
      put: {
        operationId: 'putImage',
        summary: 'Upload or replace an image (scope: edit)',
        requestBody: {
          required: true,
          description: 'Raw image bytes. The Content-Type header is stored; defaults to application/octet-stream.',
          content: { '*/*': { schema: { type: 'string', format: 'binary' } } },
        },
        responses: {
          '200': okResponse('Stored.', 'ImageSaved'),
          '400': errResponse('Unsafe path segment.'),
          '401': R401,
          '403': R403,
        },
      },
      delete: {
        operationId: 'deleteImage',
        summary: 'Delete an image (scope: edit)',
        responses: {
          '200': okResponse('Deleted. Also returned when the key did not exist.', 'OkResult'),
          '400': errResponse('Unsafe path segment.'),
          '401': R401,
          '403': R403,
        },
      },
    },
  },
  components: {
    securitySchemes: {
      BearerAuth: {
        type: 'http',
        scheme: 'bearer',
        description: 'A scoped API token (sfp_...) from POST /api/tokens, or the master secret (admin).',
      },
      ApiTokenHeader: {
        type: 'apiKey',
        in: 'header',
        name: 'x-api-token',
        description: 'The master secret (PASSCODE or API_TOKEN; PASSCODE is used first when both are set), or a scoped token.',
      },
    },
    responses: {
      Unauthorized: errResponse('Missing or wrong credentials. Only returned when a secret is set or a Bearer token was sent.'),
      Forbidden: errResponse('The token scope is too low, or the token is limited to another project.'),
    },
    schemas: OPENAPI_SCHEMAS,
  },
}

async function handleApi(request: Request, env: Env, segments: string[]): Promise<Response> {
  // Discovery routes come before auth, so an agent can read the API without a token.
  if (request.method === 'GET' && segments.length === 1 && segments[0] === 'openapi.json') {
    return discoveryJson(OPENAPI_SPEC)
  }
  if (request.method === 'GET' && segments.length === 2 && segments[0] === 'schema' && segments[1] === 'project.v3.json') {
    return discoveryJson(PROJECT_DOC_SCHEMA)
  }

  const auth = await authenticate(request, env)
  if (!auth) return json({ error: 'Unauthorized' }, 401)

  const method = request.method
  const [resource, second, third, ...more] = segments

  if (resource === 'mcp' && second === undefined) {
    if (method !== 'POST') return methodNotAllowed()
    return guard(auth, 'read') ?? handleMcp(request, env, auth)
  }

  if (resource === 'projects') {
    if (second === undefined) {
      if (method === 'GET') return guard(auth, 'read') ?? listProjects(env, auth)
      if (method === 'POST') return guard(auth, 'edit') ?? createProject(env, auth, request)
      return methodNotAllowed()
    }
    if (third === undefined) {
      if (method === 'GET') return guard(auth, 'read', second) ?? getProject(env, second)
      if (method === 'PUT') return guard(auth, 'edit', second) ?? putProject(env, second, request)
      if (method === 'PATCH') return guard(auth, 'edit', second) ?? patchProject(env, second, request)
      if (method === 'DELETE') return guard(auth, 'edit', second) ?? deleteProject(env, second)
      return methodNotAllowed()
    }
    if (more.length > 0) return json({ error: 'Not found' }, 404)
    if (third === 'commands') {
      return method === 'POST' ? (guard(auth, 'edit', second) ?? runCommands(env, second, request)) : methodNotAllowed()
    }
    if (third === 'query') {
      return method === 'POST' ? (guard(auth, 'read', second) ?? queryProject(env, second, request)) : methodNotAllowed()
    }
    if (third === 'render.svg') {
      return method === 'GET' ? (guard(auth, 'read', second) ?? renderProject(env, second, request)) : methodNotAllowed()
    }
    return json({ error: 'Not found' }, 404)
  }

  if (resource === 'tokens') {
    if (second === undefined) {
      if (method === 'GET') return guard(auth, 'admin') ?? listTokens(env)
      if (method === 'POST') return guard(auth, 'admin') ?? createToken(env, request)
      return methodNotAllowed()
    }
    if (third !== undefined) return json({ error: 'Not found' }, 404)
    if (method === 'DELETE') return guard(auth, 'admin') ?? revokeToken(env, second)
    return methodNotAllowed()
  }

  if (resource === 'images') {
    const parts = second === undefined ? [] : [second, third, ...more].filter((s): s is string => s !== undefined)
    const key = imageKey(parts)
    if (!key) return json({ error: 'Invalid key' }, 400)
    if (method === 'GET') return guard(auth, 'read', parts[0]) ?? getImage(env, key)
    if (method === 'PUT') return guard(auth, 'edit', parts[0]) ?? putImage(env, key, request)
    if (method === 'DELETE') return guard(auth, 'edit', parts[0]) ?? deleteImage(env, key)
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
