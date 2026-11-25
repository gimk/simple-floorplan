import { describe, expect, it } from 'vitest'
import { parsePlan, type PlanDocV1 } from '../../src/core/schema'
import { dispatchRpc, JSON_RPC_ERRORS } from './dispatcher'
import { createMcpRoute } from '../routes/mcp'
import type { JsonRpcResponse, LoadedProject, McpCallContext, McpStore, McpToolResult, ProjectEvent, ProjectSummaryRow } from './types'

function createFakeStore(): McpStore & { events: ProjectEvent[] } {
  const projects = new Map<string, { meta: ProjectSummaryRow; doc: PlanDocV1; version: number }>()
  const events: ProjectEvent[] = []
  let seq = 0

  return {
    async listProjects() {
      return [...projects.values()].map((p) => p.meta)
    },
    async createProject({ name, title }) {
      seq += 1
      const id = `proj_${seq}`
      const now = '2026-11-21T12:00:00.000Z'
      const meta: ProjectSummaryRow = { id, name, title: title ?? null, updatedAt: now }
      const doc = parsePlan({
        schemaVersion: 1,
        projectId: id,
        title: title ?? name,
        rooms: [],
        elements: [],
        tapes: [],
        pins: [],
        measurements: {},
        roomNotes: {},
      })
      projects.set(id, { meta, doc, version: 0 })
      return meta
    },
    async loadProject(id): Promise<LoadedProject | null> {
      const entry = projects.get(id)
      if (!entry) return null
      return {
        project: { ...entry.meta },
        doc: structuredClone(entry.doc),
        version: entry.version,
      }
    },
    async commitDoc(id, prev, nextDoc) {
      const entry = projects.get(id)
      if (!entry) throw new Error(`Missing project ${id}`)
      const version = prev.version + 1
      const updatedAt = '2026-11-21T12:05:00.000Z'
      entry.doc = structuredClone(nextDoc)
      entry.version = version
      entry.meta = { ...entry.meta, updatedAt }
      return { version, updatedAt }
    },
    async listEvents(projectId, since, limit) {
      const sinceIso = since ?? '1970-01-01T00:00:00.000Z'
      const max = limit !== undefined ? Math.min(limit, 1000) : 100
      return events
        .filter((e) => e.projectId === projectId && e.ts > sinceIso)
        .sort((a, b) => a.ts.localeCompare(b.ts) || a.id.localeCompare(b.id))
        .slice(0, max)
    },
    async getBackgroundHref() {
      return undefined
    },
    events,
  }
}

function asResult(res: JsonRpcResponse): Record<string, unknown> {
  if ('error' in res) throw new Error(`Unexpected RPC error ${res.error.code}: ${res.error.message}`)
  return res.result as Record<string, unknown>
}

describe('MCP JSON-RPC dispatcher', () => {
  it('handles initialize (2025-06-18 and 2025-03-26), notifications/initialized, and ping', async () => {
    const store = createFakeStore()

    const init1 = await dispatchRpc(store, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18' },
    })
    expect(init1.status).toBe(200)
    const r1 = asResult(init1.body as JsonRpcResponse)
    expect(r1.protocolVersion).toBe('2025-06-18')
    expect((r1.serverInfo as { name: string }).name).toBe('simple-floorplan')
    expect(r1.capabilities).toEqual({
      tools: { listChanged: false },
      resources: { subscribe: false, listChanged: false },
      prompts: { listChanged: false },
    })

    const init2 = await dispatchRpc(store, {
      jsonrpc: '2.0',
      id: 2,
      method: 'initialize',
      params: { protocolVersion: '2025-03-26' },
    })
    expect(asResult(init2.body as JsonRpcResponse).protocolVersion).toBe('2025-03-26')

    const notif = await dispatchRpc(store, {
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    })
    expect(notif).toEqual({ status: 202, body: null })

    const ping = await dispatchRpc(store, { jsonrpc: '2.0', id: 3, method: 'ping' })
    expect(asResult(ping.body as JsonRpcResponse)).toEqual({})
  })

  it('lists all tools, resources, resource templates, and prompts', async () => {
    const store = createFakeStore()

    const tools = asResult((await dispatchRpc(store, { jsonrpc: '2.0', id: 1, method: 'tools/list' })).body as JsonRpcResponse)
    const toolNames = (tools.tools as { name: string; inputSchema: Record<string, unknown> }[]).map((t) => t.name)
    expect(toolNames).toEqual([
      'list_projects',
      'create_project',
      'get_plan',
      'get_unmeasured',
      'validate_plan',
      'find_shared_walls',
      'run_commands',
      'set_measurement',
      'place_element',
      'add_storage',
      'update_storage',
      'delete_storage',
      'add_room',
      'slice_room',
      'merge_rooms',
      'set_wall_props',
      'apply_measurements',
      'render_svg',
      'get_events',
    ])

    const resources = asResult((await dispatchRpc(store, { jsonrpc: '2.0', id: 2, method: 'resources/list' })).body as JsonRpcResponse)
    expect((resources.resources as { uri: string }[]).map((r) => r.uri)).toEqual(['floorplan://projects'])

    const templates = asResult(
      (await dispatchRpc(store, { jsonrpc: '2.0', id: 3, method: 'resources/templates/list' })).body as JsonRpcResponse,
    )
    expect((templates.resourceTemplates as { uriTemplate: string }[]).map((t) => t.uriTemplate)).toEqual([
      'floorplan://projects/{id}/plan.json',
      'floorplan://projects/{id}/summary.json',
      'floorplan://projects/{id}/unmeasured.json',
      'floorplan://projects/{id}/render.svg',
      'floorplan://projects/{id}/events.json',
    ])

    const prompts = asResult((await dispatchRpc(store, { jsonrpc: '2.0', id: 4, method: 'prompts/list' })).body as JsonRpcResponse)
    expect((prompts.prompts as { name: string }[]).map((p) => p.name)).toEqual([
      'trace_plan_image',
      'finish_survey',
      'renovation_option',
      'contractor_export',
    ])
  })

  it('runs full floorplan workflow via tools and reads all resources', async () => {
    const store = createFakeStore()
    const call = async (name: string, args: Record<string, unknown>) => {
      const out = await dispatchRpc(store, {
        jsonrpc: '2.0',
        id: name,
        method: 'tools/call',
        params: { name, arguments: args },
      })
      return asResult(out.body as JsonRpcResponse) as unknown as McpToolResult
    }

    // 1. Create & list projects
    const created = await call('create_project', { name: 'Apt 4B', title: 'Apt 4B - 3rd floor' })
    expect(created.isError).toBeUndefined()
    const projectId = (created.structuredContent?.project as { id: string }).id
    expect(projectId).toBe('proj_1')

    const listed = await call('list_projects', {})
    expect((listed.structuredContent?.projects as unknown[]).length).toBe(1)

    // 2. Add two adjacent rooms
    const r1 = await call('add_room', {
      projectId,
      code: 'SE',
      name: 'Living Room',
      rect: { x: 0, y: 0, w: 400, h: 300 },
      ceilingCm: 265,
    })
    expect(r1.isError).toBeUndefined()
    expect(r1.structuredContent?.version).toBe(1)

    const r2 = await call('add_room', {
      projectId,
      code: 'CU',
      name: 'Kitchen',
      rect: { x: 400, y: 0, w: 300, h: 300 },
      ceilingCm: 265,
    })
    expect(r2.isError).toBeUndefined()
    expect(r2.structuredContent?.version).toBe(2)

    // 3. Set wall props + place element + set measurement
    const wp = await call('set_wall_props', { projectId, wall: 'SE-2', wallType: 'partition', thicknessCm: 10 })
    expect(wp.isError).toBeUndefined()

    const el = await call('place_element', { projectId, wall: 'SE-1', kind: 'window', offsetCm: 80, widthCm: 120 })
    expect(el.isError).toBeUndefined()

    const meas = await call('set_measurement', { projectId, label: 'SE-1', cm: 402 })
    expect(meas.isError).toBeUndefined()

    // 4. Queries: get_plan, get_unmeasured, validate_plan, find_shared_walls
    const summary = await call('get_plan', { projectId, format: 'summary' })
    // Inside faces (10 cm walls). SE 400 x 300 -> 390 x 290 = 11.31 m². CU 300 x 300 -> 290 x 290 = 8.41 m². Sum 19.72 m².
    expect(summary.structuredContent?.totalIndoorAreaM2).toBe(19.72)

    const fullJson = await call('get_plan', { projectId, format: 'json' })
    expect((fullJson.structuredContent?.rooms as unknown[]).length).toBe(2)

    const unmeasured = await call('get_unmeasured', { projectId, roomCode: 'SE' })
    expect((unmeasured.structuredContent?.done as number)).toBe(1)

    const valid = await call('validate_plan', { projectId })
    expect(valid.structuredContent?.valid).toBe(true)

    const shared = await call('find_shared_walls', { projectId, roomCodes: ['SE', 'CU'] })
    expect((shared.structuredContent?.sharedWalls as unknown[]).length).toBe(1)

    // 5. apply_measurements (dryRun) + merge_rooms (dryRun) + slice_room + run_commands
    const applied = await call('apply_measurements', { projectId, roomCode: 'SE', dryRun: true })
    expect(applied.structuredContent?.dryRun).toBe(true)

    const mergedPreview = await call('merge_rooms', {
      projectId,
      roomCodes: ['SE', 'CU'],
      keepCode: 'SE',
      newName: 'Open Living',
      dryRun: true,
    })
    expect(mergedPreview.isError).toBeUndefined()
    expect(mergedPreview.structuredContent?.dryRun).toBe(true)

    const sliced = await call('slice_room', {
      projectId,
      roomCode: 'CU',
      a: { x: 550, y: -10 },
      b: { x: 550, y: 310 },
      newRoomCode: 'EN',
      newRoomName: 'Entry',
    })
    expect(sliced.isError).toBeUndefined()

    const batch = await call('run_commands', {
      projectId,
      commands: [{ type: 'set_room_note', roomCode: 'SE', text: 'South facing' }],
    })
    expect(batch.isError).toBeUndefined()

    // 6. render_svg returns both text and resource_link
    const svgRes = await call('render_svg', { projectId })
    expect(svgRes.content[0].type).toBe('text')
    expect((svgRes.content[0] as { text: string }).text).toContain('<svg')
    expect(svgRes.content[1]).toMatchObject({
      type: 'resource_link',
      uri: `floorplan://projects/${projectId}/render.svg`,
      mimeType: 'image/svg+xml',
    })

    // 7. Read all 6 resource URIs
    for (const uri of [
      'floorplan://projects',
      `floorplan://projects/${projectId}/plan.json`,
      `floorplan://projects/${projectId}/summary.json`,
      `floorplan://projects/${projectId}/unmeasured.json`,
      `floorplan://projects/${projectId}/render.svg`,
      `floorplan://projects/${projectId}/events.json`,
    ]) {
      const readRes = asResult(
        (await dispatchRpc(store, { jsonrpc: '2.0', id: uri, method: 'resources/read', params: { uri } })).body as JsonRpcResponse,
      )
      const contents = readRes.contents as { uri: string; text: string; mimeType: string }[]
      expect(contents).toHaveLength(1)
      expect(contents[0].uri).toBe(uri)
      expect(contents[0].text.length).toBeGreaterThan(10)
    }

    // 8. Prompts/get
    const promptRes = asResult(
      (
        await dispatchRpc(store, {
          jsonrpc: '2.0',
          id: 'p1',
          method: 'prompts/get',
          params: { name: 'renovation_option', arguments: { projectId, roomCodes: 'SE,CU' } },
        })
      ).body as JsonRpcResponse,
    )
    expect((promptRes.messages as { content: { text: string } }[])[0].content.text).toContain('find_shared_walls')
  })

  it('supports JSON-RPC batch arrays and returns proper error codes', async () => {
    const store = createFakeStore()

    // Mixed batch: request + notification -> returns only the response for the request
    const batch = await dispatchRpc(store, [
      { jsonrpc: '2.0', id: 1, method: 'ping' },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'unknown/method' },
    ])
    expect(batch.status).toBe(200)
    const arr = batch.body as JsonRpcResponse[]
    expect(arr).toHaveLength(2)
    expect(arr[0]).toEqual({ jsonrpc: '2.0', id: 1, result: {} })
    expect(arr[1]).toMatchObject({ jsonrpc: '2.0', id: 2, error: { code: JSON_RPC_ERRORS.METHOD_NOT_FOUND } })

    // Notifications-only batch -> 202
    const notifOnly = await dispatchRpc(store, [{ jsonrpc: '2.0', method: 'notifications/initialized' }])
    expect(notifOnly).toEqual({ status: 202, body: null })

    // Empty batch -> -32600
    const emptyBatch = await dispatchRpc(store, [])
    expect(emptyBatch.status).toBe(200)
    expect(emptyBatch.body).toMatchObject({ error: { code: JSON_RPC_ERRORS.INVALID_REQUEST } })

    // Unknown tool -> -32602
    const badTool = await dispatchRpc(store, {
      jsonrpc: '2.0',
      id: 9,
      method: 'tools/call',
      params: { name: 'does_not_exist', arguments: {} },
    })
    expect(badTool.body).toMatchObject({ error: { code: JSON_RPC_ERRORS.INVALID_PARAMS } })

    // Missing resource -> -32002
    const badRes = await dispatchRpc(store, {
      jsonrpc: '2.0',
      id: 10,
      method: 'resources/read',
      params: { uri: 'floorplan://projects/missing/plan.json' },
    })
    expect(badRes.body).toMatchObject({ error: { code: JSON_RPC_ERRORS.RESOURCE_NOT_FOUND } })
  })

  it('Hono route returns 405 on GET, 400 -32700 on invalid JSON, and 200 JSON on POST', async () => {
    const store = createFakeStore()
    const route = createMcpRoute(() => store)

    const getRes = await route.request('/', { method: 'GET' })
    expect(getRes.status).toBe(405)
    expect(getRes.headers.get('allow')).toBe('POST')

    const badJson = await route.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not-json',
    })
    expect(badJson.status).toBe(400)
    const badBody = (await badJson.json()) as { error: { code: number } }
    expect(badBody.error.code).toBe(JSON_RPC_ERRORS.PARSE_ERROR)

    const pingRes = await route.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    })
    expect(pingRes.status).toBe(200)
    expect(pingRes.headers.get('content-type')).toContain('application/json')
    expect(await pingRes.json()).toEqual({ jsonrpc: '2.0', id: 1, result: {} })
  })

  it('enforces token scopes inside tools/call and returns isError with the required scope', async () => {
    const store = createFakeStore()
    const readCtx: McpCallContext = { actor: 'reader', scopes: ['read'], projectId: null }
    const measureCtx: McpCallContext = { actor: 'survey', scopes: ['read', 'measure'], projectId: null }

    const call = async (ctx: McpCallContext | undefined, name: string, args: Record<string, unknown>) => {
      const out = await dispatchRpc(store, {
        jsonrpc: '2.0',
        id: name,
        method: 'tools/call',
        params: { name, arguments: args },
      }, ctx)
      return asResult(out.body as JsonRpcResponse) as unknown as McpToolResult
    }

    // Create a project as admin (no ctx -> no enforcement, as in the route when unauthenticated).
    const created = await call(undefined, 'create_project', { name: 'Apt' })
    const projectId = (created.structuredContent?.project as { id: string }).id

    // read-only tool allowed with read scope
    const plan = await call(readCtx, 'get_plan', { projectId })
    expect(plan.isError).toBeUndefined()

    // set_measurement needs measure -> read-only token gets isError + requiredScope
    const denied = await call(readCtx, 'set_measurement', { projectId, label: 'SE-1', cm: 400 })
    expect(denied.isError).toBe(true)
    expect(denied.structuredContent?.error).toMatchObject({ code: 'FORBIDDEN', requiredScope: 'measure' })

    // measure token can set_measurement but not add_room (edit)
    const measOk = await call(measureCtx, 'set_measurement', { projectId, label: 'SE-1', cm: 400 })
    expect(measOk.isError).toBeUndefined()
    const editDenied = await call(measureCtx, 'add_room', { projectId, code: 'SE', rect: { x: 0, y: 0, w: 100, h: 100 } })
    expect(editDenied.isError).toBe(true)
    expect(editDenied.structuredContent?.error).toMatchObject({ code: 'FORBIDDEN', requiredScope: 'edit' })

    // run_commands scope is refined per command type: set_measurement batch needs only measure
    const batchMeasure = await call(measureCtx, 'run_commands', {
      projectId,
      commands: [{ type: 'set_measurement', label: 'SE-2', actualCm: 300 }],
    })
    expect(batchMeasure.isError).toBeUndefined()
    const batchEdit = await call(measureCtx, 'run_commands', {
      projectId,
      commands: [{ type: 'add_room', code: 'CU', rect: { x: 0, y: 0, w: 100, h: 100 } }],
    })
    expect(batchEdit.isError).toBe(true)
    expect(batchEdit.structuredContent?.error).toMatchObject({ requiredScope: 'edit' })

    // project-restricted token may not touch another project
    const restricted: McpCallContext = { actor: 'restricted', scopes: ['admin'], projectId }
    const other = await call(restricted, 'get_plan', { projectId: 'someone-else' })
    expect(other.isError).toBe(true)
    expect(other.structuredContent?.error).toMatchObject({ code: 'FORBIDDEN' })
  })

  it('logs one event per command after a successful MCP write, and get_events reads them back', async () => {
    const store = createFakeStore()
    let seq = 0
    const ctx: McpCallContext = {
      actor: 'survey-agent',
      scopes: ['admin'],
      projectId: null,
      async logCommandEvents(projectId, commands, results) {
        for (let i = 0; i < commands.length; i++) {
          seq += 1
          store.events.push({
            id: `evt_${seq}`,
            projectId,
            ts: `2026-11-21T12:0${seq}:00.000Z`,
            actor: 'survey-agent',
            kind: 'command',
            summary: `${commands[i].type}: ...`,
            payload: { type: commands[i].type, command: commands[i], result: results[i] ?? null, via: 'mcp' },
          })
        }
      },
      async logEvent(projectId, kind, summary, payload) {
        seq += 1
        store.events.push({ id: `evt_${seq}`, projectId, ts: `2026-11-21T12:0${seq}:00.000Z`, actor: 'survey-agent', kind, summary, payload })
      },
    }

    const call = async (name: string, args: Record<string, unknown>) => {
      const out = await dispatchRpc(store, {
        jsonrpc: '2.0',
        id: name,
        method: 'tools/call',
        params: { name, arguments: args },
      }, ctx)
      return asResult(out.body as JsonRpcResponse) as unknown as McpToolResult
    }

    const created = await call('create_project', { name: 'Apt 4B' })
    const projectId = (created.structuredContent?.project as { id: string }).id
    // project_create event logged
    expect(store.events.filter((e) => e.kind === 'project_create')).toHaveLength(1)

    // dryRun must NOT log events
    await call('run_commands', {
      projectId,
      dryRun: true,
      commands: [{ type: 'add_room', code: 'SE', rect: { x: 0, y: 0, w: 400, h: 300 } }],
    })
    expect(store.events.filter((e) => e.kind === 'command')).toHaveLength(0)

    // real write: one event per command
    const batch = await call('run_commands', {
      projectId,
      commands: [
        { type: 'add_room', code: 'SE', rect: { x: 0, y: 0, w: 400, h: 300 } },
        { type: 'set_measurement', label: 'SE-1', actualCm: 402 },
      ],
    })
    expect(batch.isError).toBeUndefined()
    const cmdEvents = store.events.filter((e) => e.kind === 'command')
    expect(cmdEvents).toHaveLength(2)
    expect((cmdEvents[0].payload as { type: string }).type).toBe('add_room')
    expect((cmdEvents[1].payload as { type: string }).type).toBe('set_measurement')

    // single-command tools log one event too
    await call('set_measurement', { projectId, label: 'SE-2', cm: 300 })
    expect(store.events.filter((e) => e.kind === 'command')).toHaveLength(3)

    // get_events tool returns them (with since filter)
    const ev = await call('get_events', { projectId })
    expect(ev.isError).toBeUndefined()
    expect((ev.structuredContent?.events as unknown[]).length).toBe(4)
    const evSince = await call('get_events', { projectId, since: '2026-11-21T12:03:00.000Z' })
    expect((evSince.structuredContent?.events as unknown[]).length).toBe(1)

    // events.json resource mirrors the tool
    const res = asResult(
      (await dispatchRpc(store, { jsonrpc: '2.0', id: 'r', method: 'resources/read', params: { uri: `floorplan://projects/${projectId}/events.json` } }, ctx)).body as JsonRpcResponse,
    )
    const content = (res.contents as { text: string }[])[0]
    expect(JSON.parse(content.text).events).toHaveLength(4)
  })

  it('adds, updates and deletes a built-in storage (docs/storage-plan.md, step 4)', async () => {
    const store = createFakeStore()
    const call = async (name: string, args: Record<string, unknown>) => {
      const out = await dispatchRpc(store, {
        jsonrpc: '2.0',
        id: name,
        method: 'tools/call',
        params: { name, arguments: args },
      })
      return asResult(out.body as JsonRpcResponse) as unknown as McpToolResult
    }

    const created = await call('create_project', { name: 'Apt', title: 'Apt' })
    const projectId = (created.structuredContent?.project as { id: string }).id
    await call('add_room', { projectId, code: 'SE', name: 'Living', rect: { x: 0, y: 0, w: 400, h: 300 } })

    // Add: a 60 x 40 closet on the outer side of SE-4, with a double door.
    const added = await call('add_storage', {
      projectId,
      room: 'SE',
      wall: 'SE-4',
      offsetCm: 100,
      widthCm: 60,
      depthCm: 40,
      door: 'double',
    })
    expect(added.isError).toBeUndefined()
    const addedRow = (added.structuredContent?.results as { code?: string; widthCm?: number; depthCm?: number }[])[0]
    const storageCode = addedRow.code as string
    expect(storageCode).toBeTruthy()
    expect(addedRow.widthCm).toBe(60)
    expect(addedRow.depthCm).toBe(40)

    // The storage is listed under its room, not as a room of its own.
    const plan = await call('get_plan', { projectId, format: 'summary' })
    const rooms = plan.structuredContent?.rooms as { code: string; storages: { widthCm: number; door: string }[] }[]
    expect(rooms).toHaveLength(1)
    expect(rooms[0].storages).toHaveLength(1)
    expect(rooms[0].storages[0]).toMatchObject({ widthCm: 60, depthCm: 40, door: 'double' })

    // Update: wider, with a sliding door.
    const updated = await call('update_storage', { projectId, storage: storageCode, widthCm: 80, door: 'sliding' })
    expect(updated.isError).toBeUndefined()
    expect((updated.structuredContent?.results as { widthCm?: number }[])[0].widthCm).toBe(80)
    const plan2 = await call('get_plan', { projectId, format: 'summary' })
    const rooms2 = plan2.structuredContent?.rooms as { storages: { widthCm: number; door: string }[] }[]
    expect(rooms2[0].storages[0]).toMatchObject({ widthCm: 80, door: 'sliding' })

    // Delete: the storage and its front door are gone.
    const deleted = await call('delete_storage', { projectId, storage: storageCode })
    expect(deleted.isError).toBeUndefined()
    const plan3 = await call('get_plan', { projectId, format: 'summary' })
    const rooms3 = plan3.structuredContent?.rooms as { storages: unknown[] }[]
    expect(rooms3[0].storages).toEqual([])
  })

  it('refuses a storage on a wall that does not belong to the room', async () => {
    const store = createFakeStore()
    const created = await dispatchRpc(store, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'create_project', arguments: { name: 'Apt', title: 'Apt' } },
    })
    const projectId = (asResult(created.body as JsonRpcResponse) as unknown as McpToolResult)
      .structuredContent?.project as { id: string }
    const out = await dispatchRpc(store, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'add_storage', arguments: { projectId: projectId.id, room: 'SE', wall: 'SE-1', offsetCm: 10, widthCm: 40, depthCm: 30 } },
    })
    const res = asResult(out.body as JsonRpcResponse) as unknown as McpToolResult
    expect(res.isError).toBe(true)
  })
})
