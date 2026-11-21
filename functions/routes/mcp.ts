// Hono sub-app for the MCP Streamable HTTP endpoint (/api/mcp).
// Auth is handled by the parent /api middleware in functions/app.ts;
// here we read the authenticated identity (getAuth) and pass it into the
// dispatcher so tools/call can enforce per-tool scopes and append write events
// to the project event log, exactly like the commands route does.
import { Hono } from 'hono'
import { dispatchRpc, JSON_RPC_ERRORS } from '../mcp/dispatcher'
import { createD1McpStore } from '../mcp/store'
import { getAuth } from '../auth'
import { summarizeCommand } from '../../src/core/access'
import type { McpCallContext, McpStore } from '../mcp/types'

export type McpRouteEnv = {
  DB: D1Database
  IMAGES?: R2Bucket
}

const nowIso = (): string => new Date().toISOString()

/** Build the per-request MCP context from the authenticated identity + D1. */
export function mcpCallContext(db: D1Database, actor: string, scopes: string[], projectId: string | null): McpCallContext {
  return {
    actor,
    scopes,
    projectId,
    async logCommandEvents(projectId, commands, results) {
      const now = nowIso()
      const stmts = commands.map((cmd, i) =>
        db
          .prepare(
            'INSERT INTO project_events (id, project_id, ts, actor, kind, summary, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?)',
          )
          .bind(
            crypto.randomUUID(),
            projectId,
            now,
            actor,
            'command',
            `${cmd.type}: ${summarizeCommand(cmd)}`,
            JSON.stringify({ type: cmd.type, command: cmd, result: results[i] ?? null, via: 'mcp' }),
          ),
      )
      await db.batch(stmts)
    },
    async logEvent(projectId, kind, summary, payload) {
      await db
        .prepare(
          'INSERT INTO project_events (id, project_id, ts, actor, kind, summary, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .bind(crypto.randomUUID(), projectId, nowIso(), actor, kind, summary, JSON.stringify(payload))
        .run()
    },
  }
}

export function createMcpRoute(storeFactory?: (env: McpRouteEnv) => McpStore) {
  const mcp = new Hono<{ Bindings: McpRouteEnv }>()

  mcp.get('/', (c) => {
    return c.json(
      { error: 'method_not_allowed', message: 'MCP endpoint is stateless Streamable HTTP; use POST.' },
      405,
      { Allow: 'POST' },
    )
  })

  mcp.delete('/', (c) => {
    return c.json(
      { error: 'method_not_allowed', message: 'MCP endpoint is stateless; session deletion is not used.' },
      405,
      { Allow: 'POST' },
    )
  })

  mcp.post('/', async (c) => {
    let payload: unknown
    try {
      payload = await c.req.json()
    } catch {
      return c.json(
        {
          jsonrpc: '2.0',
          id: null,
          error: {
            code: JSON_RPC_ERRORS.PARSE_ERROR,
            message: 'Parse error: request body must be valid JSON.',
          },
        },
        400,
      )
    }

    const store = storeFactory ? storeFactory(c.env) : createD1McpStore(c.env.DB, c.env.IMAGES)
    const auth = getAuth(c)
    const ctx: McpCallContext | undefined = auth
      ? mcpCallContext(c.env.DB, auth.actor, auth.scopes, auth.projectId)
      : undefined
    const outcome = await dispatchRpc(store, payload, ctx)

    if (outcome.status === 202) {
      return new Response(null, { status: 202 })
    }

    return new Response(JSON.stringify(outcome.body), {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
      },
    })
  })

  return mcp
}

export const mcpRoutes = createMcpRoute()
