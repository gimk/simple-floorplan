// Streamable HTTP MCP endpoint (JSON-RPC 2.0), POST /api/mcp. Zero dependencies.
// Tools reuse the REST handlers of worker.ts, so both APIs always behave the same.
import { createProject, deleteProject, getProject, guard, listProjects, queryProject, renderProject, runCommands } from './worker'
import type { Auth, Env, JsonObject, Scope } from './worker'

export type AuthContext = Auth

const PROTOCOL_VERSION = '2025-03-26'
const SERVER_INFO = { name: 'simple-floorplan', version: '3.0.0' }

type Id = string | number | null
type ToolResult = { content: { type: 'text'; text: string }[]; structuredContent?: unknown; isError?: boolean }
type Tool = {
  name: string
  description: string
  scope: Scope
  inputSchema: JsonObject
  run: (env: Env, auth: AuthContext, args: JsonObject) => Promise<ToolResult>
}

const projectId = { type: 'string', description: 'Project id.' }

function textResult(result: unknown, isError = false): ToolResult {
  const out: ToolResult = { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], structuredContent: result }
  if (isError) {
    out.isError = true
    if (typeof result !== 'object' || result === null || Array.isArray(result)) delete out.structuredContent
  }
  return out
}

const toolError = (message: string): ToolResult => textResult({ error: message }, true)

/** Converts a REST handler Response into a tool result. */
async function fromResponse(res: Response): Promise<ToolResult> {
  const text = await res.text()
  let data: unknown = text
  try {
    data = JSON.parse(text)
  } catch {
    // Not JSON.
  }
  return textResult(data, !res.ok)
}

function post(body: JsonObject): Request {
  return new Request('http://mcp.internal/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function pick(args: JsonObject, keys: string[]): JsonObject {
  const out: JsonObject = {}
  for (const k of keys) if (args[k] !== undefined) out[k] = args[k]
  return out
}

const TOOLS: Tool[] = [
  {
    name: 'list_projects',
    description: 'List projects, most recently updated first. A project-limited token sees only its project.',
    scope: 'read',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: async (env, auth) => fromResponse(await listProjects(env, auth)),
  },
  {
    name: 'get_project',
    description: 'Get one project: id, title, version, updatedAt and the full ProjectDoc v3.',
    scope: 'read',
    inputSchema: { type: 'object', required: ['projectId'], properties: { projectId }, additionalProperties: false },
    run: async (env, _auth, args) => fromResponse(await getProject(env, args.projectId as string)),
  },
  {
    name: 'create_project',
    description: 'Create a project (version 1). Without doc, the project has one empty artboard.',
    scope: 'edit',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        id: { type: 'string', pattern: '^[A-Za-z0-9._-]+$', description: 'Optional. A UUID is generated when omitted.' },
        doc: { type: 'object', description: 'Optional ProjectDoc v3 (see /api/schema/project.v3.json).', additionalProperties: true },
      },
      additionalProperties: false,
    },
    run: async (env, auth, args) => fromResponse(await createProject(env, auth, post(pick(args, ['title', 'id', 'doc'])))),
  },
  {
    name: 'query_project',
    description: 'Read-only semantic query: summary, validate, rooms, walls or artboard.',
    scope: 'read',
    inputSchema: {
      type: 'object',
      required: ['projectId', 'kind'],
      properties: {
        projectId,
        kind: { type: 'string', enum: ['summary', 'validate', 'rooms', 'walls', 'artboard'] },
        artboardId: { type: 'string', description: 'Limits rooms, walls and artboard to one artboard.' },
      },
      additionalProperties: false,
    },
    run: async (env, _auth, args) => fromResponse(await queryProject(env, args.projectId as string, post(pick(args, ['kind', 'artboardId'])))),
  },
  {
    name: 'run_commands',
    description:
      'Apply one command or a batch (all or nothing) to the stored document. ' +
      'Example command: {"type":"add_room_rect","xCm":0,"yCm":0,"widthCm":400,"heightCm":300}. ' +
      'Use dryRun to check without saving. baseVersion gives a version_conflict error when the project changed.',
    scope: 'edit',
    inputSchema: {
      type: 'object',
      required: ['projectId'],
      properties: {
        projectId,
        command: { type: 'object', required: ['type'], properties: { type: { type: 'string' } }, additionalProperties: true },
        commands: { type: 'array', items: { type: 'object', required: ['type'], properties: { type: { type: 'string' } }, additionalProperties: true } },
        dryRun: { type: 'boolean', description: 'Compute and check the result, but save nothing.' },
        baseVersion: { type: 'integer' },
      },
      additionalProperties: false,
    },
    run: async (env, _auth, args) =>
      fromResponse(await runCommands(env, args.projectId as string, post(pick(args, ['command', 'commands', 'dryRun', 'baseVersion'])))),
  },
  {
    name: 'render_svg',
    description: 'Render one artboard as an SVG picture (text). Default: the first artboard.',
    scope: 'read',
    inputSchema: {
      type: 'object',
      required: ['projectId'],
      properties: { projectId, artboardId: { type: 'string', description: 'Default: the first artboard.' } },
      additionalProperties: false,
    },
    run: async (env, _auth, args) => {
      const url = new URL('http://mcp.internal/')
      if (typeof args.artboardId === 'string') url.searchParams.set('artboard', args.artboardId)
      const res = await renderProject(env, args.projectId as string, new Request(url))
      if (!res.ok) return fromResponse(res)
      return { content: [{ type: 'text', text: await res.text() }] }
    },
  },
  {
    name: 'delete_project',
    description: 'Delete a project and all its images. Cannot be undone.',
    scope: 'edit',
    inputSchema: { type: 'object', required: ['projectId'], properties: { projectId }, additionalProperties: false },
    run: async (env, _auth, args) => fromResponse(await deleteProject(env, args.projectId as string)),
  },
]

function rpcResult(id: Id, result: unknown): Response {
  return Response.json({ jsonrpc: '2.0', id, result })
}

function rpcError(id: Id, code: number, message: string): Response {
  return Response.json({ jsonrpc: '2.0', id, error: { code, message } })
}

async function callTool(env: Env, auth: AuthContext, params: JsonObject): Promise<ToolResult | { invalid: string }> {
  const name = params.name
  if (typeof name !== 'string') return { invalid: 'params.name must be a string' }
  const args = params.arguments ?? {}
  if (typeof args !== 'object' || args === null || Array.isArray(args)) return { invalid: 'params.arguments must be an object' }
  const tool = TOOLS.find((t) => t.name === name)
  if (!tool) return { invalid: `Unknown tool: ${name}` }
  const a = args as JsonObject
  const needsProject = Object.hasOwn(tool.inputSchema.properties as JsonObject, 'projectId') && tool.name !== 'create_project'
  if (needsProject && (typeof a.projectId !== 'string' || !a.projectId)) return toolError('projectId must be a non-empty string')
  const denied = guard(auth, tool.scope, needsProject ? (a.projectId as string) : undefined)
  if (denied) return toolError(`Forbidden: this token cannot use ${tool.name}`)
  try {
    return await tool.run(env, auth, a)
  } catch (e) {
    return toolError(e instanceof Error ? e.message : 'Internal error')
  }
}

export async function handleMcp(req: Request, env: Env, auth: AuthContext): Promise<Response> {
  let msg: unknown
  try {
    msg = await req.json()
  } catch {
    return rpcError(null, -32700, 'Parse error')
  }
  if (typeof msg !== 'object' || msg === null || Array.isArray(msg)) return rpcError(null, -32600, 'Invalid Request')
  const m = msg as JsonObject
  const hasId = m.id !== undefined && m.id !== null
  const id = (hasId ? m.id : null) as Id
  if (hasId && typeof m.id !== 'string' && typeof m.id !== 'number') return rpcError(null, -32600, 'Invalid Request')
  if (m.jsonrpc !== '2.0' || typeof m.method !== 'string') return rpcError(id, -32600, 'Invalid Request')

  // A message without id is a notification: no JSON-RPC response.
  if (!hasId) return new Response(null, { status: 202 })

  switch (m.method) {
    case 'initialize':
      return rpcResult(id, { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: SERVER_INFO })
    case 'ping':
      return rpcResult(id, {})
    case 'tools/list':
      return rpcResult(id, { tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) })
    case 'tools/call': {
      const params = m.params
      if (typeof params !== 'object' || params === null || Array.isArray(params)) return rpcError(id, -32602, 'Invalid params')
      const res = await callTool(env, auth, params as JsonObject)
      if ('invalid' in res) return rpcError(id, -32602, res.invalid)
      return rpcResult(id, res)
    }
    default:
      if (m.method === 'notifications/initialized') return new Response(null, { status: 202 })
      return rpcError(id, -32601, `Method not found: ${m.method}`)
  }
}
