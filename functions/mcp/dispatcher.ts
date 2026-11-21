// Pure stateless JSON-RPC 2.0 + MCP protocol dispatcher (2025-06-18 & 2025-03-26).
import { hasScope, requiredScopeForMcpTool } from '../../src/core/access'
import { getPrompt, MCP_PROMPTS } from './prompts'
import { MCP_RESOURCE_TEMPLATES, MCP_RESOURCES, readResource, ResourceNotFoundError } from './resources'
import { callTool, MCP_TOOLS, UnknownToolError } from './tools'
import type { JsonRpcId, JsonRpcResponse, McpCallContext, McpStore, McpToolResult } from './types'

export const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26'] as const
export const DEFAULT_PROTOCOL_VERSION = '2025-06-18'

export const SERVER_INFO = {
  name: 'simple-floorplan',
  version: '1.0.0',
}

export const SERVER_INSTRUCTIONS =
  'Simple Floorplan MCP server. World units are centimeters (cm), x right, y down. ' +
  'Walls are addressed by survey label CODE-1..n (1-based polygon order), diagonals by CODE-D, and ceiling heights by CODE-H. ' +
  'Use dryRun: true to preview structural edits (like merge_rooms or apply_measurements) before committing.'

export const JSON_RPC_ERRORS = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  RESOURCE_NOT_FOUND: -32002,
} as const

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function errorResponse(id: JsonRpcId, code: number, message: string, data?: unknown): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id,
    error: data !== undefined ? { code, message, data } : { code, message },
  }
}

function okResponse(id: JsonRpcId, result: unknown): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id,
    result,
  }
}

async function handleSingleMessage(store: McpStore, raw: unknown, ctx?: McpCallContext): Promise<JsonRpcResponse | null> {
  if (!isObj(raw)) {
    return errorResponse(null, JSON_RPC_ERRORS.INVALID_REQUEST, 'Invalid JSON-RPC request object.')
  }

  const hasId = 'id' in raw && raw.id !== undefined
  const id: JsonRpcId = hasId && (typeof raw.id === 'string' || typeof raw.id === 'number' || raw.id === null) ? raw.id : null

  if (raw.jsonrpc !== '2.0' || typeof raw.method !== 'string' || !raw.method) {
    return errorResponse(id, JSON_RPC_ERRORS.INVALID_REQUEST, 'Request must have jsonrpc: "2.0" and a non-empty method string.')
  }

  const method = raw.method
  const params = isObj(raw.params) ? raw.params : {}

  // Notifications have no id and must not receive a JSON-RPC response.
  if (method === 'notifications/initialized' || method === 'notifications/cancelled') {
    return hasId ? okResponse(id, {}) : null
  }
  if (!hasId && method.startsWith('notifications/')) {
    return null
  }

  try {
    let result: unknown

    switch (method) {
      case 'initialize': {
        const requested = typeof params.protocolVersion === 'string' ? params.protocolVersion : DEFAULT_PROTOCOL_VERSION
        const protocolVersion = (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
          ? requested
          : DEFAULT_PROTOCOL_VERSION
        result = {
          protocolVersion,
          capabilities: {
            tools: { listChanged: false },
            resources: { subscribe: false, listChanged: false },
            prompts: { listChanged: false },
          },
          serverInfo: SERVER_INFO,
          instructions: SERVER_INSTRUCTIONS,
        }
        break
      }

      case 'ping': {
        result = {}
        break
      }

      case 'tools/list': {
        result = { tools: MCP_TOOLS }
        break
      }

      case 'tools/call': {
        const toolName = typeof params.name === 'string' ? params.name : ''
        if (!toolName) {
          return hasId ? errorResponse(id, JSON_RPC_ERRORS.INVALID_PARAMS, 'tools/call requires params.name.') : null
        }
        const toolArgs = isObj(params.arguments) ? params.arguments : {}
        // Enforce token scopes inside tools/call (the /api/mcp route itself only
        // requires read). Missing scope -> JSON-RPC tool error with isError: true.
        if (ctx) {
          const required = requiredScopeForMcpTool(toolName, toolArgs)
          if (required !== null && !hasScope(ctx.scopes, required)) {
            const toolResult: McpToolResult = {
              isError: true,
              content: [
                {
                  type: 'text',
                  text: `forbidden: tool "${toolName}" requires scope "${required}" (token has: ${ctx.scopes.join(',') || 'none'})`,
                },
              ],
              structuredContent: {
                ok: false,
                error: {
                  code: 'FORBIDDEN',
                  requiredScope: required,
                  message: `this tool requires scope "${required}" (token has: ${ctx.scopes.join(',') || 'none'})`,
                },
              },
            }
            result = toolResult
            break
          }
          // Project-restricted tokens may only touch their own project.
          const argProjectId = typeof toolArgs.projectId === 'string' ? toolArgs.projectId : null
          if (ctx.projectId && argProjectId && ctx.projectId !== argProjectId) {
            const toolResult: McpToolResult = {
              isError: true,
              content: [
                { type: 'text', text: `forbidden: token is restricted to project ${ctx.projectId}` },
              ],
              structuredContent: {
                ok: false,
                error: { code: 'FORBIDDEN', message: `token is restricted to project ${ctx.projectId}` },
              },
            }
            result = toolResult
            break
          }
        }
        result = await callTool(store, toolName, toolArgs, ctx)
        break
      }

      case 'resources/list': {
        result = { resources: MCP_RESOURCES }
        break
      }

      case 'resources/templates/list': {
        result = { resourceTemplates: MCP_RESOURCE_TEMPLATES }
        break
      }

      case 'resources/read': {
        const uri = typeof params.uri === 'string' ? params.uri : ''
        if (!uri) {
          return hasId ? errorResponse(id, JSON_RPC_ERRORS.INVALID_PARAMS, 'resources/read requires params.uri.') : null
        }
        const content = await readResource(store, uri)
        result = { contents: [content] }
        break
      }

      case 'prompts/list': {
        result = { prompts: MCP_PROMPTS }
        break
      }

      case 'prompts/get': {
        const promptName = typeof params.name === 'string' ? params.name : ''
        if (!promptName) {
          return hasId ? errorResponse(id, JSON_RPC_ERRORS.INVALID_PARAMS, 'prompts/get requires params.name.') : null
        }
        const rawArgs = isObj(params.arguments) ? params.arguments : {}
        const strArgs: Record<string, string> = {}
        for (const [k, v] of Object.entries(rawArgs)) {
          if (typeof v === 'string') strArgs[k] = v
          else if (v !== null && v !== undefined) strArgs[k] = String(v)
        }
        const prompt = getPrompt(promptName, strArgs)
        if (!prompt) {
          return hasId ? errorResponse(id, JSON_RPC_ERRORS.INVALID_PARAMS, `Unknown prompt: ${promptName}`) : null
        }
        result = prompt
        break
      }

      default:
        return hasId ? errorResponse(id, JSON_RPC_ERRORS.METHOD_NOT_FOUND, `Method not found: ${method}`) : null
    }

    return hasId ? okResponse(id, result) : null
  } catch (err) {
    if (!hasId) return null
    if (err instanceof UnknownToolError) {
      return errorResponse(id, JSON_RPC_ERRORS.INVALID_PARAMS, err.message)
    }
    if (err instanceof ResourceNotFoundError) {
      return errorResponse(id, JSON_RPC_ERRORS.RESOURCE_NOT_FOUND, err.message)
    }
    const message = err instanceof Error ? err.message : 'Internal server error'
    return errorResponse(id, JSON_RPC_ERRORS.INTERNAL_ERROR, message)
  }
}

export type DispatchOutcome =
  | { status: 200; body: JsonRpcResponse | JsonRpcResponse[] }
  | { status: 202; body: null }

/**
 * Dispatch a parsed JSON-RPC 2.0 single request or batch array.
 * Returns { status: 202, body: null } when only notifications were sent.
 * `ctx` carries the caller identity (actor/scopes/project restriction) used for
 * in-tool scope enforcement and event logging; omit it to skip enforcement.
 */
export async function dispatchRpc(store: McpStore, payload: unknown, ctx?: McpCallContext): Promise<DispatchOutcome> {
  if (Array.isArray(payload)) {
    if (payload.length === 0) {
      return {
        status: 200,
        body: errorResponse(null, JSON_RPC_ERRORS.INVALID_REQUEST, 'JSON-RPC batch array must not be empty.'),
      }
    }
    const responses: JsonRpcResponse[] = []
    for (const item of payload) {
      const res = await handleSingleMessage(store, item, ctx)
      if (res !== null) responses.push(res)
    }
    if (responses.length === 0) {
      return { status: 202, body: null }
    }
    return { status: 200, body: responses }
  }

  const res = await handleSingleMessage(store, payload, ctx)
  if (res === null) {
    return { status: 202, body: null }
  }
  return { status: 200, body: res }
}
