// Pure access-control logic shared by the Hono functions (functions/auth.ts)
// and unit tests. No I/O here: everything is a plain function of its inputs.
//
// Scopes (cumulative): read < measure < edit < admin.
//   read   = all GET routes + POST /projects/:id/query + render.svg + events
//   measure= read + measurements/items/notes writes + measure-level commands
//   edit   = everything except token admin and project delete
//   admin  = everything (token admin, project delete)

export const SCOPES = ['read', 'measure', 'edit', 'admin'] as const
export type Scope = (typeof SCOPES)[number]

const SCOPE_RANK: Record<Scope, number> = { read: 1, measure: 2, edit: 3, admin: 4 }

/** Parse a comma-separated scope list. Throws on empty or unknown scopes. */
export function parseScopes(input: string): Scope[] {
  const parts = input.split(',').map((s) => s.trim()).filter((s) => s.length > 0)
  if (parts.length === 0) throw new Error('scopes must not be empty')
  const out: Scope[] = []
  for (const p of parts) {
    if (!(SCOPES as readonly string[]).includes(p)) {
      throw new Error(`unknown scope "${p}" (valid: ${SCOPES.join(',')})`)
    }
    if (!out.includes(p as Scope)) out.push(p as Scope)
  }
  return out
}

/** True when `have` is at least as powerful as `need` (admin covers all). */
export function scopeCovers(have: string, need: string): boolean {
  const h = SCOPE_RANK[have as Scope]
  const n = SCOPE_RANK[need as Scope]
  if (h === undefined || n === undefined) return false
  return h >= n
}

/** True when any scope in `scopes` covers `need`. */
export function hasScope(scopes: readonly string[], need: string): boolean {
  return scopes.some((s) => scopeCovers(s, need))
}

// ---------- tokens ----------

export const TOKEN_PREFIX = 'sfp_'
// 32 random bytes, base64url-encoded without padding -> 43 chars.
const TOKEN_BODY_RE = /^[A-Za-z0-9_-]{43}$/

export function isValidTokenFormat(token: string): boolean {
  return token.startsWith(TOKEN_PREFIX) && TOKEN_BODY_RE.test(token.slice(TOKEN_PREFIX.length))
}

const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

/** Generate a new plaintext token `sfp_<43 base64url chars>`. RNG injectable for tests. */
export function generateTokenPlaintext(rand: (size: number) => Uint8Array = defaultRand): string {
  const bytes = rand(32)
  if (bytes.length !== 32) throw new Error('rand must return 32 bytes')
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0
    out += B64URL[b0 >> 2]
    out += B64URL[((b0 & 0x03) << 4) | (b1 >> 4)]
    if (i + 1 < bytes.length) out += B64URL[((b1 & 0x0f) << 2) | (b2 >> 6)]
    if (i + 2 < bytes.length) out += B64URL[b2 & 0x3f]
  }
  return TOKEN_PREFIX + out
}

function defaultRand(size: number): Uint8Array {
  const b = new Uint8Array(size)
  crypto.getRandomValues(b)
  return b
}

/** SHA-256 hex of the plaintext token (this is what api_tokens.token_hash stores). */
export async function hashToken(token: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  let hex = ''
  for (const b of new Uint8Array(buf)) hex += b.toString(16).padStart(2, '0')
  return hex
}

// ---------- routing: required scope per route ----------

/** Strip an optional leading `/api` so patterns work with or without the base path. */
function normalizePath(path: string): string {
  return path.startsWith('/api/') ? path.slice(4) : path.startsWith('/api') ? path.slice(4) || '/' : path
}

type RoutePattern = { re: RegExp; byMethod: Record<string, string | null> }

// Ordered: more specific patterns first.
const ROUTE_PATTERNS: RoutePattern[] = [
  { re: /^\/openapi\.json$/, byMethod: { GET: null } },
  { re: /^\/schema\/plan\.v1\.json$/, byMethod: { GET: null } },
  // MCP endpoint: the route itself needs read; per-tool scopes are enforced
  // inside tools/call (see requiredScopeForMcpTool).
  { re: /^\/mcp$/, byMethod: { POST: 'read' } },
  { re: /^\/tokens$/, byMethod: { GET: 'admin', POST: 'admin' } },
  { re: /^\/tokens\/[^/]+$/, byMethod: { DELETE: 'admin', GET: 'admin', PATCH: 'admin' } },
  { re: /^\/projects$/, byMethod: { GET: 'read', POST: 'edit' } },
  { re: /^\/projects\/([^/]+)\/snapshot$/, byMethod: { PUT: 'edit' } },
  { re: /^\/projects\/([^/]+)\/commands$/, byMethod: { POST: 'measure' } }, // raised per command type
  { re: /^\/projects\/([^/]+)\/query$/, byMethod: { POST: 'read' } },
  { re: /^\/projects\/([^/]+)\/render\.svg$/, byMethod: { GET: 'read' } },
  { re: /^\/projects\/([^/]+)\/measurements\/[^/]+$/, byMethod: { PUT: 'measure', DELETE: 'measure' } },
  { re: /^\/projects\/([^/]+)\/items\/[^/]+$/, byMethod: { PUT: 'measure', DELETE: 'measure' } },
  { re: /^\/projects\/([^/]+)\/notes\/[^/]+$/, byMethod: { PUT: 'measure', DELETE: 'measure' } },
  { re: /^\/projects\/([^/]+)\/changes$/, byMethod: { GET: 'read' } },
  { re: /^\/projects\/([^/]+)\/events$/, byMethod: { GET: 'read' } },
  { re: /^\/projects\/([^/]+)\/images$/, byMethod: { POST: 'edit' } },
  { re: /^\/projects\/([^/]+)$/, byMethod: { GET: 'read', PATCH: 'edit', DELETE: 'admin' } },
  { re: /^\/images\/.+$/, byMethod: { GET: 'read' } },
]

/**
 * Required scope for a request, or null when the route is public.
 * Unknown routes require admin (safe default for token-authenticated callers).
 * `path` may include the `/api` prefix or not.
 */
export function requiredScopeForRoute(method: string, path: string): string | null {
  const m = method.toUpperCase()
  const p = normalizePath(path)
  for (const pat of ROUTE_PATTERNS) {
    if (!pat.re.test(p)) continue
    const scope = pat.byMethod[m]
    if (scope !== undefined) return scope
    return 'admin' // known path, unsupported method
  }
  return 'admin'
}

/** Extract the project id from `/projects/:id/...` paths, else null. */
export function projectIdFromPath(path: string): string | null {
  const m = /^\/projects\/([^/]+)(?:\/|$)/.exec(normalizePath(path))
  return m ? decodeURIComponent(m[1]) : null
}

// ---------- routing: scope per command type ----------

// Commands that only touch measurements / notes / pins / tapes: measure scope.
const MEASURE_COMMANDS = new Set([
  'set_measurement',
  'clear_measurement',
  'set_room_note',
  'add_pin',
  'add_tape',
])

export function commandScope(type: string): string {
  return MEASURE_COMMANDS.has(type) ? 'measure' : 'edit'
}

/** The strongest scope required by a batch of commands. */
export function requiredScopeForCommands(types: readonly string[]): string {
  let need = 'measure'
  for (const t of types) {
    if (commandScope(t) === 'edit') return 'edit'
  }
  return need
}

// ---------- MCP tools/call: scope per tool ----------

// MCP tools that only read data: read scope.
export const MCP_READ_ONLY_TOOLS = new Set([
  'list_projects',
  'get_plan',
  'get_unmeasured',
  'validate_plan',
  'find_shared_walls',
  'render_svg',
  'get_events',
])

// MCP tools that write: edit scope (run_commands is refined per command type,
// set_measurement only needs measure).
export const MCP_WRITE_TOOLS = new Set([
  'create_project',
  'run_commands',
  'set_measurement',
  'place_element',
  'add_room',
  'slice_room',
  'merge_rooms',
  'set_wall_props',
  'apply_measurements',
])

/**
 * Required scope for one MCP tools/call, or null for unknown tools (those fail
 * later with UnknownToolError). Read-only tools need read, set_measurement needs
 * measure, run_commands needs requiredScopeForCommands of its batch, and every
 * other known write tool needs edit.
 */
export function requiredScopeForMcpTool(name: string, args: Record<string, unknown>): string | null {
  if (MCP_READ_ONLY_TOOLS.has(name)) return 'read'
  if (name === 'set_measurement') return 'measure'
  if (name === 'run_commands') {
    const types =
      Array.isArray(args.commands)
        ? args.commands.map((cmd) =>
            typeof cmd === 'object' && cmd !== null ? String((cmd as { type?: unknown }).type) : '',
          )
        : []
    return requiredScopeForCommands(types)
  }
  if (MCP_WRITE_TOOLS.has(name)) return 'edit'
  return null
}

// ---------- event log ----------

/** Kind of event a write route produces, or null for reads/unknown. */
export function eventKindForRoute(method: string, path: string): string | null {
  const m = method.toUpperCase()
  if (m === 'GET') return null
  const p = normalizePath(path)
  if (/^\/projects$/.test(p) && m === 'POST') return 'project_create'
  if (/^\/projects\/[^/]+$/.test(p)) {
    if (m === 'PATCH') return 'rename'
    if (m === 'DELETE') return 'project_delete'
    return null
  }
  if (/\/snapshot$/.test(p)) return 'snapshot'
  if (/\/commands$/.test(p)) return 'commands'
  if (/\/measurements\//.test(p)) return 'measurement'
  if (/\/items\//.test(p)) return 'item'
  if (/\/notes\//.test(p)) return 'note'
  if (/\/images$/.test(p)) return 'image'
  return null
}

type CommandLike = { type: string } & Record<string, unknown>

/** Short human-readable summary of one command for the event log. */
export function summarizeCommand(cmd: CommandLike): string {
  const s = (v: unknown): string => (typeof v === 'string' ? v : '')
  const n = (v: unknown): string => (typeof v === 'number' && Number.isFinite(v) ? String(v) : '')
  switch (cmd.type) {
    case 'add_room':
      return `add_room ${s(cmd.code)}${s(cmd.name) ? ` (${s(cmd.name)})` : ''}`
    case 'update_room':
      return `update_room ${s(cmd.roomCode) || s(cmd.roomId)}`
    case 'delete_room':
      return `delete_room ${s(cmd.roomCode) || s(cmd.roomId)}`
    case 'slice_room':
      return `slice_room ${s(cmd.roomCode)} -> ${s(cmd.newRoomCode)}`
    case 'cutout_room':
      return `cutout_room ${s(cmd.roomCode)}`
    case 'merge_rooms':
      return `merge_rooms ${(cmd.roomCodes as unknown) instanceof Array ? (cmd.roomCodes as string[]).join('+') : ''}`
    case 'set_wall_props':
      return `set_wall_props ${typeof cmd.wall === 'string' ? cmd.wall : ''}`
    case 'set_wall_length':
      return `set_wall_length ${typeof cmd.wall === 'string' ? cmd.wall : ''} = ${n(cmd.lengthCm)} cm`
    case 'move_vertex':
      return `move_vertex ${s(cmd.roomCode)} #${n(cmd.vertexIndex)}`
    case 'place_element':
      return `place_element ${typeof cmd.wall === 'string' ? cmd.wall : ''} ${s(cmd.kind)}`
    case 'update_element':
      return `update_element ${s(cmd.elementId)}`
    case 'delete_element':
      return `delete_element ${s(cmd.elementId)}`
    case 'set_measurement':
      return `set_measurement ${s(cmd.label)} = ${n(cmd.actualCm)} cm`
    case 'clear_measurement':
      return `clear_measurement ${s(cmd.label)}`
    case 'apply_measurements':
      return `apply_measurements ${s(cmd.roomCode) || s(cmd.roomId) || ''}`
    case 'set_room_note':
      return `set_room_note ${s(cmd.roomCode) || s(cmd.roomId)}`
    case 'add_pin':
      return `add_pin ${s(cmd.roomCode) || s(cmd.roomId) || ''}`
    case 'add_tape':
      return `add_tape ${n(cmd.actualCm)} cm`
    default:
      return cmd.type
  }
}

// ---------- idempotency TTL ----------

export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000

/** ISO cutoff: keys created before this instant are expired and may be deleted. */
export function idempotencyCutoffIso(nowMs: number = Date.now()): string {
  return new Date(nowMs - IDEMPOTENCY_TTL_MS).toISOString()
}
