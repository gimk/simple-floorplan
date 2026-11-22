import { ZodError } from 'zod'
import { applyBatch, CommandError, CommandsBatchRequestSchema } from '../../src/core/commands'
import { renderPlanSvg } from '../../src/core/export'
import { QueryError, querySummary, runQuery } from '../../src/core/queries'
import type { McpCallContext, McpStore, McpToolDefinition, McpToolResult } from './types'

export class UnknownToolError extends Error {
  constructor(name: string) {
    super(`Unknown tool: ${name}`)
    this.name = 'UnknownToolError'
  }
}

const WALL_REF_SCHEMA = {
  description:
    'Wall reference: survey label string like "SE-2", or { roomCode: "SE", wallIndex: 2 } (1-based), or { roomId, wallStart }.',
  oneOf: [
    { type: 'string', minLength: 1 },
    {
      type: 'object',
      properties: {
        roomCode: { type: 'string', minLength: 1 },
        wallIndex: { type: 'integer', minimum: 1 },
      },
      required: ['roomCode', 'wallIndex'],
    },
    {
      type: 'object',
      properties: {
        roomId: { type: 'string', minLength: 1 },
        wallStart: { type: 'string', minLength: 1 },
      },
      required: ['roomId', 'wallStart'],
    },
  ],
}

const VEC_SCHEMA = {
  type: 'object',
  properties: {
    x: { type: 'number', description: 'X coordinate in centimeters (right is positive).' },
    y: { type: 'number', description: 'Y coordinate in centimeters (down is positive).' },
  },
  required: ['x', 'y'],
}

const RECT_SCHEMA = {
  type: 'object',
  properties: {
    x: { type: 'number', description: 'Top-left X in cm.' },
    y: { type: 'number', description: 'Top-left Y in cm.' },
    w: { type: 'number', exclusiveMinimum: 0, description: 'Width in cm.' },
    h: { type: 'number', exclusiveMinimum: 0, description: 'Height in cm.' },
  },
  required: ['x', 'y', 'w', 'h'],
}

export const MCP_TOOLS: McpToolDefinition[] = [
  {
    name: 'list_projects',
    description: 'List all floorplan projects with their IDs, names, titles, and last updated timestamps.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'create_project',
    description: 'Create a new empty floorplan project and return its ID and metadata.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 1, description: 'Short project name (e.g. "Apartment 4B").' },
        title: { type: 'string', description: 'Optional display title shown on exported plans.' },
      },
      required: ['name'],
    },
  },
  {
    name: 'get_plan',
    description:
      'Read a floorplan project. Use format="summary" (default) for a compact overview of rooms, areas, survey progress, and takeoff, or format="json" for the full PlanDoc v1 document.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', minLength: 1, description: 'Project ID.' },
        format: {
          type: 'string',
          enum: ['summary', 'json'],
          default: 'summary',
          description: '"summary" for compact overview (default) or "json" for full PlanDoc v1.',
        },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'get_unmeasured',
    description:
      'List remaining unmeasured survey IDs (walls CODE-1..n, diagonals CODE-D, ceiling heights CODE-H) in walking order, with planned centimeter estimates.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', minLength: 1, description: 'Project ID.' },
        roomCode: { type: 'string', description: 'Optional room code filter (e.g. "CU").' },
        roomId: { type: 'string', description: 'Optional room ID filter.' },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'validate_plan',
    description:
      'Validate plan geometry, wall elements, and measurements. Reports errors (invalid polygons, self-intersections, element overflows/overlaps, dangling references) and warnings (discrepancies > 2 cm, out-of-square diagonals, opposite-wall differences).',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', minLength: 1, description: 'Project ID.' },
        roomCode: { type: 'string', description: 'Optional room code filter.' },
        roomId: { type: 'string', description: 'Optional room ID filter.' },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'find_shared_walls',
    description:
      'Detect collinear shared walls between rooms (within gap/overlap tolerances) and report whether each shared wall is bearing, partition, or exterior.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', minLength: 1, description: 'Project ID.' },
        roomCodes: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional list of room codes to compare (e.g. ["SE", "CU"]).',
        },
        roomIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional list of room IDs to compare.',
        },
        maxGapCm: { type: 'number', minimum: 0, maximum: 200, description: 'Maximum wall separation in cm (default 35).' },
        minOverlapCm: { type: 'number', minimum: 0, description: 'Minimum collinear overlap in cm (default 10).' },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'run_commands',
    description:
      'Execute an atomic batch of high-level floorplan commands (add_room, update_room, delete_room, slice_room, cutout_room, merge_rooms, set_wall_props, set_wall_length, move_vertex, place_element, update_element, delete_element, set_measurement, clear_measurement, apply_measurements, set_room_note, add_pin, add_tape, set_apartment). Supports dryRun preview and baseVersion optimistic concurrency.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', minLength: 1, description: 'Project ID.' },
        commands: {
          type: 'array',
          minItems: 1,
          items: { type: 'object' },
          description: 'Ordered list of command objects with a "type" discriminator.',
        },
        dryRun: { type: 'boolean', default: false, description: 'When true, compute and preview results without saving.' },
        baseVersion: { type: 'integer', minimum: 0, description: 'Optional expected snapshot version for optimistic concurrency.' },
      },
      required: ['projectId', 'commands'],
    },
  },
  {
    name: 'set_measurement',
    description: 'Record a verified on-site laser measurement in centimeters for a survey label (e.g. "CU-1", "CU-D", "CU-H").',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', minLength: 1, description: 'Project ID.' },
        label: { type: 'string', minLength: 1, description: 'Survey label such as "CU-1", "CU-D", or "CU-H".' },
        cm: { type: 'number', exclusiveMinimum: 0, description: 'Measured length in centimeters.' },
        dryRun: { type: 'boolean', default: false, description: 'Preview without saving.' },
        baseVersion: { type: 'integer', minimum: 0, description: 'Optional expected snapshot version.' },
      },
      required: ['projectId', 'label', 'cm'],
    },
  },
  {
    name: 'place_element',
    description: 'Place a door, window, opening, radiator, cupboard, or other element along a wall in centimeters.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', minLength: 1, description: 'Project ID.' },
        wall: WALL_REF_SCHEMA,
        kind: {
          type: 'string',
          enum: ['door', 'window', 'opening', 'radiator', 'cupboard', 'other'],
          description: 'Element kind.',
        },
        variant: {
          type: 'string',
          enum: ['single', 'double', 'sliding', 'pocket', 'standard', 'french', 'fixed', 'wardrobe', 'wall-cabinet', 'recessed'],
          description: 'Optional visual/functional variant.',
        },
        offsetCm: { type: 'number', minimum: 0, description: 'Distance from wall start vertex in cm.' },
        widthCm: { type: 'number', exclusiveMinimum: 0, description: 'Element width in cm (defaults by kind).' },
        heightCm: { type: 'number', exclusiveMinimum: 0, description: 'Optional height in cm.' },
        sillCm: { type: 'number', minimum: 0, description: 'Optional window sill height in cm.' },
        depthCm: { type: 'number', exclusiveMinimum: 0, description: 'Optional depth in cm (radiators/cupboards).' },
        hinge: { type: 'string', enum: ['start', 'end'], description: 'Door hinge side.' },
        swing: { type: 'string', enum: ['in', 'out'], description: 'Door swing direction.' },
        note: { type: 'string', description: 'Optional note.' },
        dryRun: { type: 'boolean', default: false, description: 'Preview without saving.' },
        baseVersion: { type: 'integer', minimum: 0, description: 'Optional expected snapshot version.' },
      },
      required: ['projectId', 'wall', 'kind', 'offsetCm'],
    },
  },
  {
    name: 'add_room',
    description: 'Add a new room defined by either a rectangle (rect) or a polygon (vertices) in centimeters (x right, y down).',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', minLength: 1, description: 'Project ID.' },
        code: { type: 'string', description: 'Optional unique room code (e.g. "CU", "SE"). Auto-generated if omitted.' },
        name: { type: 'string', description: 'Display name (e.g. "Kitchen").' },
        rect: RECT_SCHEMA,
        vertices: {
          type: 'array',
          minItems: 3,
          items: VEC_SCHEMA,
          description: 'Polygon vertices in cm (use either rect or vertices).',
        },
        ceilingCm: { type: 'number', exclusiveMinimum: 0, description: 'Optional ceiling height in cm.' },
        outdoor: { type: 'boolean', description: 'True for balconies/terraces.' },
        walkOrder: { type: 'number', description: 'Optional survey walk order.' },
        dryRun: { type: 'boolean', default: false, description: 'Preview without saving.' },
        baseVersion: { type: 'integer', minimum: 0, description: 'Optional expected snapshot version.' },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'slice_room',
    description: 'Split a room along a line defined by two points (a, b) in cm, automatically re-parenting wall elements.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', minLength: 1, description: 'Project ID.' },
        roomCode: { type: 'string', description: 'Optional room code to slice (if omitted, slices the room crossed by the line).' },
        roomId: { type: 'string', description: 'Optional room ID to slice.' },
        a: VEC_SCHEMA,
        b: VEC_SCHEMA,
        newRoomCode: { type: 'string', description: 'Optional code for the newly created room piece.' },
        newRoomName: { type: 'string', description: 'Optional name for the newly created room piece.' },
        dryRun: { type: 'boolean', default: false, description: 'Preview without saving.' },
        baseVersion: { type: 'integer', minimum: 0, description: 'Optional expected snapshot version.' },
      },
      required: ['projectId', 'a', 'b'],
    },
  },
  {
    name: 'merge_rooms',
    description:
      'Merge two adjacent rooms by removing their shared wall. Refuses bearing walls unless allowBearingRemoval=true. Recommended: preview with dryRun=true first.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', minLength: 1, description: 'Project ID.' },
        roomCodes: {
          type: 'array',
          minItems: 2,
          maxItems: 2,
          items: { type: 'string' },
          description: 'Pair of room codes to merge, e.g. ["SE", "CU"].',
        },
        roomIds: {
          type: 'array',
          minItems: 2,
          maxItems: 2,
          items: { type: 'string' },
          description: 'Pair of room IDs to merge.',
        },
        keepCode: { type: 'string', description: 'Optional code for the merged room (defaults to first room).' },
        newName: { type: 'string', description: 'Optional name for the merged room.' },
        allowBearingRemoval: {
          type: 'boolean',
          default: false,
          description: 'Safety guard: must be true to remove a bearing wall (default false).',
        },
        dryRun: { type: 'boolean', default: false, description: 'Preview area delta and removed elements without saving.' },
        baseVersion: { type: 'integer', minimum: 0, description: 'Optional expected snapshot version.' },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'set_wall_props',
    description: 'Set structural properties of a wall: wallType (partition | bearing | exterior), thicknessCm, and locked flag.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', minLength: 1, description: 'Project ID.' },
        wall: WALL_REF_SCHEMA,
        wallType: { type: 'string', enum: ['partition', 'bearing', 'exterior'], description: 'Wall structural type.' },
        thicknessCm: { type: 'number', exclusiveMinimum: 0, description: 'Wall thickness in cm.' },
        locked: { type: 'boolean', description: 'Lock wall against automatic geometry adjustments.' },
        dryRun: { type: 'boolean', default: false, description: 'Preview without saving.' },
        baseVersion: { type: 'integer', minimum: 0, description: 'Optional expected snapshot version.' },
      },
      required: ['projectId', 'wall'],
    },
  },
  {
    name: 'apply_measurements',
    description:
      'Re-solve room polygons from verified on-site wall measurements and optionally lock verified walls. Use dryRun=true to preview area and residual changes.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', minLength: 1, description: 'Project ID.' },
        roomCode: { type: 'string', description: 'Optional single room code.' },
        roomId: { type: 'string', description: 'Optional single room ID.' },
        roomCodes: { type: 'array', items: { type: 'string' }, description: 'Optional list of room codes.' },
        roomIds: { type: 'array', items: { type: 'string' }, description: 'Optional list of room IDs.' },
        lockVerifiedWalls: { type: 'boolean', default: true, description: 'Lock walls that match verified measurements (default true).' },
        dryRun: { type: 'boolean', default: false, description: 'Preview without saving.' },
        baseVersion: { type: 'integer', minimum: 0, description: 'Optional expected snapshot version.' },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'render_svg',
    description:
      'Render a standalone SVG drawing of the floorplan for visual verification. Returns the SVG markup as text and an image/svg+xml resource link.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', minLength: 1, description: 'Project ID.' },
        background: { type: 'boolean', default: false, description: 'Embed the calibrated background image when available.' },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'get_events',
    description:
      'Read the append-only project event log (one event per write route, one per command in a batch, including commands executed via MCP tools). Returns events in chronological order.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', minLength: 1, description: 'Project ID.' },
        since: { type: 'string', description: 'Optional ISO 8601 timestamp; only events after this instant are returned.' },
        limit: { type: 'integer', minimum: 1, maximum: 1000, description: 'Maximum number of events (default 100, max 1000).' },
      },
      required: ['projectId'],
    },
  },
]

function errResult(code: string, message: string, extra?: Record<string, unknown>): McpToolResult {
  return {
    isError: true,
    content: [{ type: 'text', text: `${code}: ${message}` }],
    structuredContent: { ok: false, error: { code, message, ...extra } },
  }
}

function okResult(text: string, structuredContent: Record<string, unknown>): McpToolResult {
  return {
    content: [{ type: 'text', text }],
    structuredContent,
  }
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}

async function executeCommandsTool(
  store: McpStore,
  projectId: string,
  commands: unknown[],
  opts: { dryRun?: boolean; baseVersion?: number } = {},
  describe: (res: { version: number; dryRun: boolean; results: Record<string, unknown>[]; warnings: unknown[] }) => string,
  ctx?: McpCallContext,
): Promise<McpToolResult> {
  const parsedReq = CommandsBatchRequestSchema.safeParse({
    commands,
    dryRun: opts.dryRun ?? false,
    ...(opts.baseVersion !== undefined ? { baseVersion: opts.baseVersion } : {}),
  })
  if (!parsedReq.success) {
    return errResult('INVALID_COMMAND', parsedReq.error.issues.map((i) => i.message).join('; '), {
      issues: parsedReq.error.issues,
    })
  }

  const loaded = await store.loadProject(projectId)
  if (!loaded) return errResult('PROJECT_NOT_FOUND', `Project "${projectId}" not found.`)

  if (parsedReq.data.baseVersion !== undefined && parsedReq.data.baseVersion !== loaded.version) {
    return errResult(
      'VERSION_CONFLICT',
      `Expected version ${parsedReq.data.baseVersion}, but project is at version ${loaded.version}.`,
      { latestVersion: loaded.version },
    )
  }

  let applied: ReturnType<typeof applyBatch>
  try {
    applied = applyBatch(loaded.doc, parsedReq.data.commands)
  } catch (err) {
    if (err instanceof CommandError) {
      return errResult(err.code, err.message, {
        commandIndex: (err as Error & { commandIndex?: number }).commandIndex,
      })
    }
    if (err instanceof ZodError) {
      return errResult('INVALID_COMMAND', err.issues.map((i) => i.message).join('; '), {
        issues: err.issues,
        commandIndex: (err as Error & { commandIndex?: number }).commandIndex,
      })
    }
    throw err
  }

  const summary = querySummary(applied.doc)
  if (parsedReq.data.dryRun) {
    const payload = {
      ok: true,
      dryRun: true,
      version: loaded.version,
      results: applied.results,
      warnings: applied.warnings,
      summary,
    }
    return okResult(
      describe({ version: loaded.version, dryRun: true, results: applied.results, warnings: applied.warnings }),
      payload,
    )
  }

  const committed = await store.commitDoc(projectId, loaded, applied.doc)
  // Event log: one event per command, like the /commands route does.
  if (ctx?.logCommandEvents) {
    await ctx.logCommandEvents(projectId, parsedReq.data.commands, applied.results).catch(() => undefined)
  }
  const payload = {
    ok: true,
    dryRun: false,
    version: committed.version,
    results: applied.results,
    warnings: applied.warnings,
    summary,
  }
  return okResult(
    describe({ version: committed.version, dryRun: false, results: applied.results, warnings: applied.warnings }),
    payload,
  )
}

export async function callTool(
  store: McpStore,
  name: string,
  args: Record<string, unknown> = {},
  ctx?: McpCallContext,
): Promise<McpToolResult> {
  switch (name) {
    case 'list_projects': {
      const projects = await store.listProjects()
      const lines = projects.length
        ? projects.map((p) => `- ${p.id}: ${p.name}${p.title ? ` (${p.title})` : ''} [updated ${p.updatedAt}]`).join('\n')
        : 'No projects found.'
      return okResult(`Found ${projects.length} project(s).\n${lines}`, { projects })
    }

    case 'create_project': {
      const projName = asString(args.name)
      if (!projName) return errResult('INVALID_PARAMS', 'name is required and must be a non-empty string.')
      const title = typeof args.title === 'string' ? args.title : null
      const project = await store.createProject({ name: projName, title })
      if (ctx?.logEvent) {
        await ctx.logEvent(project.id, 'project_create', 'project created', { via: 'mcp', name: project.name }).catch(() => undefined)
      }
      return okResult(`Created project "${project.name}" (${project.id}).`, { project })
    }

    case 'get_plan': {
      const projectId = asString(args.projectId)
      if (!projectId) return errResult('INVALID_PARAMS', 'projectId is required.')
      const format = args.format === 'json' ? 'json' : 'summary'
      const loaded = await store.loadProject(projectId)
      if (!loaded) return errResult('PROJECT_NOT_FOUND', `Project "${projectId}" not found.`)

      if (format === 'json') {
        const docWithVersion = { ...loaded.doc, version: loaded.version }
        return okResult(
          `Loaded PlanDoc v${loaded.doc.schemaVersion} for "${loaded.project.name}" (${loaded.doc.rooms.length} rooms, version ${loaded.version}).`,
          docWithVersion,
        )
      }

      const summary = querySummary(loaded.doc)
      const roomList = summary.rooms
        .map((r) => `${r.code} (${r.name}): ${r.areaM2} m², ${r.measured.done}/${r.measured.total} measured`)
        .join('; ')
      return okResult(
        `${loaded.project.name} (v${loaded.version}): ${summary.roomCount} rooms, ${summary.totalIndoorAreaM2} m² indoor, ${summary.totalOutdoorAreaM2} m² outdoor, survey ${summary.progress.done}/${summary.progress.total}. ${roomList}`,
        { ...summary, version: loaded.version },
      )
    }

    case 'get_unmeasured': {
      const projectId = asString(args.projectId)
      if (!projectId) return errResult('INVALID_PARAMS', 'projectId is required.')
      const loaded = await store.loadProject(projectId)
      if (!loaded) return errResult('PROJECT_NOT_FOUND', `Project "${projectId}" not found.`)
      try {
        const res = runQuery(loaded.doc, {
          query: 'unmeasured',
          args: {
            ...(asString(args.roomCode) ? { roomCode: asString(args.roomCode) } : {}),
            ...(asString(args.roomId) ? { roomId: asString(args.roomId) } : {}),
          },
        }) as { done: number; total: number; remaining: { label: string; plannedCm: number | null }[] }
        const preview = res.remaining
          .slice(0, 10)
          .map((r) => (r.plannedCm != null ? `${r.label} (~${r.plannedCm} cm)` : r.label))
          .join(', ')
        const more = res.remaining.length > 10 ? ` (+${res.remaining.length - 10} more)` : ''
        return okResult(
          `Survey progress: ${res.done}/${res.total} done, ${res.remaining.length} remaining.${preview ? ` Next: ${preview}${more}` : ''}`,
          res,
        )
      } catch (err) {
        if (err instanceof QueryError) return errResult(err.code, err.message)
        throw err
      }
    }

    case 'validate_plan': {
      const projectId = asString(args.projectId)
      if (!projectId) return errResult('INVALID_PARAMS', 'projectId is required.')
      const loaded = await store.loadProject(projectId)
      if (!loaded) return errResult('PROJECT_NOT_FOUND', `Project "${projectId}" not found.`)
      try {
        const res = runQuery(loaded.doc, {
          query: 'validate',
          args: {
            ...(asString(args.roomCode) ? { roomCode: asString(args.roomCode) } : {}),
            ...(asString(args.roomId) ? { roomId: asString(args.roomId) } : {}),
          },
        }) as { valid: boolean; errors: { message: string }[]; warnings: { message: string }[] }
        const status = res.valid ? 'Plan is valid' : `Plan has ${res.errors.length} error(s)`
        return okResult(`${status} and ${res.warnings.length} warning(s).`, res)
      } catch (err) {
        if (err instanceof QueryError) return errResult(err.code, err.message)
        throw err
      }
    }

    case 'find_shared_walls': {
      const projectId = asString(args.projectId)
      if (!projectId) return errResult('INVALID_PARAMS', 'projectId is required.')
      const loaded = await store.loadProject(projectId)
      if (!loaded) return errResult('PROJECT_NOT_FOUND', `Project "${projectId}" not found.`)
      try {
        const res = runQuery(loaded.doc, {
          query: 'shared_walls',
          args: {
            ...(Array.isArray(args.roomCodes) ? { roomCodes: args.roomCodes } : {}),
            ...(Array.isArray(args.roomIds) ? { roomIds: args.roomIds } : {}),
            ...(typeof args.maxGapCm === 'number' ? { maxGapCm: args.maxGapCm } : {}),
            ...(typeof args.minOverlapCm === 'number' ? { minOverlapCm: args.minOverlapCm } : {}),
          },
        }) as { sharedWalls: { wallA: string; wallB: string; overlapCm: number; isBearing: boolean }[] }
        const desc = res.sharedWalls.length
          ? res.sharedWalls
              .map((w) => `${w.wallA} <-> ${w.wallB} (${w.overlapCm} cm, ${w.isBearing ? 'BEARING' : 'non-bearing'})`)
              .join('; ')
          : 'No shared walls found.'
        return okResult(`Found ${res.sharedWalls.length} shared wall(s): ${desc}`, res)
      } catch (err) {
        if (err instanceof QueryError) return errResult(err.code, err.message)
        if (err instanceof ZodError) return errResult('INVALID_QUERY', err.issues.map((i) => i.message).join('; '))
        throw err
      }
    }

    case 'run_commands': {
      const projectId = asString(args.projectId)
      if (!projectId) return errResult('INVALID_PARAMS', 'projectId is required.')
      if (!Array.isArray(args.commands) || args.commands.length === 0) {
        return errResult('INVALID_PARAMS', 'commands must be a non-empty array.')
      }
      return executeCommandsTool(
        store,
        projectId,
        args.commands,
        {
          dryRun: Boolean(args.dryRun),
          baseVersion: typeof args.baseVersion === 'number' ? args.baseVersion : undefined,
        },
        ({ version, dryRun, results, warnings }) =>
          `${dryRun ? '[dryRun] ' : ''}Applied ${results.length} command(s) (version ${version}, ${warnings.length} warning(s)).`,
        ctx,
      )
    }

    case 'set_measurement': {
      const projectId = asString(args.projectId)
      const label = asString(args.label)
      const cm = typeof args.cm === 'number' ? args.cm : typeof args.actualCm === 'number' ? args.actualCm : undefined
      if (!projectId || !label || cm === undefined) {
        return errResult('INVALID_PARAMS', 'projectId, label, and cm are required.')
      }
      return executeCommandsTool(
        store,
        projectId,
        [{ type: 'set_measurement', label, actualCm: cm }],
        {
          dryRun: Boolean(args.dryRun),
          baseVersion: typeof args.baseVersion === 'number' ? args.baseVersion : undefined,
        },
        ({ version, dryRun }) => `${dryRun ? '[dryRun] ' : ''}Set measurement ${label} = ${cm} cm (version ${version}).`,
        ctx,
      )
    }

    case 'place_element': {
      const projectId = asString(args.projectId)
      const wall = args.wall ?? args.wallLabel
      if (!projectId || !wall) return errResult('INVALID_PARAMS', 'projectId and wall are required.')
      const cmd: Record<string, unknown> = {
        type: 'place_element',
        wall,
        kind: args.kind,
        offsetCm: args.offsetCm,
      }
      for (const k of ['id', 'variant', 'widthCm', 'heightCm', 'sillCm', 'depthCm', 'hinge', 'swing', 'note'] as const) {
        if (args[k] !== undefined) cmd[k] = args[k]
      }
      return executeCommandsTool(
        store,
        projectId,
        [cmd],
        {
          dryRun: Boolean(args.dryRun),
          baseVersion: typeof args.baseVersion === 'number' ? args.baseVersion : undefined,
        },
        ({ version, dryRun }) =>
          `${dryRun ? '[dryRun] ' : ''}Placed ${String(args.kind)} on wall ${typeof wall === 'string' ? wall : JSON.stringify(wall)} (version ${version}).`,
        ctx,
      )
    }

    case 'add_room': {
      const projectId = asString(args.projectId)
      if (!projectId) return errResult('INVALID_PARAMS', 'projectId is required.')
      const cmd: Record<string, unknown> = { type: 'add_room' }
      for (const k of ['id', 'code', 'name', 'rect', 'vertices', 'ceilingCm', 'outdoor', 'walkOrder'] as const) {
        if (args[k] !== undefined) cmd[k] = args[k]
      }
      return executeCommandsTool(
        store,
        projectId,
        [cmd],
        {
          dryRun: Boolean(args.dryRun),
          baseVersion: typeof args.baseVersion === 'number' ? args.baseVersion : undefined,
        },
        ({ version, dryRun, results }) => {
          const room = results[0]?.room as { code?: string; name?: string; areaM2?: number } | undefined
          return `${dryRun ? '[dryRun] ' : ''}Added room ${room?.code ?? ''} (${room?.name ?? ''}, ${room?.areaM2 ?? '?'} m²) at version ${version}.`
        },
        ctx,
      )
    }

    case 'slice_room': {
      const projectId = asString(args.projectId)
      if (!projectId) return errResult('INVALID_PARAMS', 'projectId is required.')
      const cmd: Record<string, unknown> = { type: 'slice_room', a: args.a, b: args.b }
      for (const k of ['roomId', 'roomCode', 'newRoomCode', 'newRoomName'] as const) {
        if (args[k] !== undefined) cmd[k] = args[k]
      }
      return executeCommandsTool(
        store,
        projectId,
        [cmd],
        {
          dryRun: Boolean(args.dryRun),
          baseVersion: typeof args.baseVersion === 'number' ? args.baseVersion : undefined,
        },
        ({ version, dryRun, results }) => {
          const rooms = (results[0]?.rooms as { code?: string; areaM2?: number }[] | undefined) ?? []
          const desc = rooms.map((r) => `${r.code} (${r.areaM2} m²)`).join(', ')
          return `${dryRun ? '[dryRun] ' : ''}Sliced room into ${desc} (version ${version}).`
        },
        ctx,
      )
    }

    case 'merge_rooms': {
      const projectId = asString(args.projectId)
      if (!projectId) return errResult('INVALID_PARAMS', 'projectId is required.')
      const cmd: Record<string, unknown> = { type: 'merge_rooms' }
      for (const k of ['roomIds', 'roomCodes', 'keepCode', 'newName', 'allowBearingRemoval'] as const) {
        if (args[k] !== undefined) cmd[k] = args[k]
      }
      return executeCommandsTool(
        store,
        projectId,
        [cmd],
        {
          dryRun: Boolean(args.dryRun),
          baseVersion: typeof args.baseVersion === 'number' ? args.baseVersion : undefined,
        },
        ({ version, dryRun, results }) => {
          const r = results[0] as { afterAreaM2?: number; deltaAreaM2?: number } | undefined
          return `${dryRun ? '[dryRun] ' : ''}Merged rooms -> ${r?.afterAreaM2 ?? '?'} m² (delta ${r?.deltaAreaM2 ?? 0} m², version ${version}).`
        },
        ctx,
      )
    }

    case 'set_wall_props': {
      const projectId = asString(args.projectId)
      const wall = args.wall ?? args.wallLabel
      if (!projectId || !wall) return errResult('INVALID_PARAMS', 'projectId and wall are required.')
      const cmd: Record<string, unknown> = { type: 'set_wall_props', wall }
      const wallType = args.wallType ?? args.type
      if (wallType !== undefined) cmd.wallType = wallType
      if (args.thicknessCm !== undefined) cmd.thicknessCm = args.thicknessCm
      if (args.locked !== undefined) cmd.locked = args.locked
      return executeCommandsTool(
        store,
        projectId,
        [cmd],
        {
          dryRun: Boolean(args.dryRun),
          baseVersion: typeof args.baseVersion === 'number' ? args.baseVersion : undefined,
        },
        ({ version, dryRun }) =>
          `${dryRun ? '[dryRun] ' : ''}Updated wall ${typeof wall === 'string' ? wall : JSON.stringify(wall)} properties (version ${version}).`,
        ctx,
      )
    }

    case 'apply_measurements': {
      const projectId = asString(args.projectId)
      if (!projectId) return errResult('INVALID_PARAMS', 'projectId is required.')
      const cmd: Record<string, unknown> = { type: 'apply_measurements' }
      for (const k of ['roomId', 'roomCode', 'roomIds', 'roomCodes', 'lockVerifiedWalls'] as const) {
        if (args[k] !== undefined) cmd[k] = args[k]
      }
      return executeCommandsTool(
        store,
        projectId,
        [cmd],
        {
          dryRun: Boolean(args.dryRun),
          baseVersion: typeof args.baseVersion === 'number' ? args.baseVersion : undefined,
        },
        ({ version, dryRun }) => `${dryRun ? '[dryRun] ' : ''}Applied verified measurements (version ${version}).`,
        ctx,
      )
    }

    case 'render_svg': {
      const projectId = asString(args.projectId)
      if (!projectId) return errResult('INVALID_PARAMS', 'projectId is required.')
      const loaded = await store.loadProject(projectId)
      if (!loaded) return errResult('PROJECT_NOT_FOUND', `Project "${projectId}" not found.`)
      const includeBg = Boolean(args.background)
      const backgroundHref = includeBg ? await store.getBackgroundHref(loaded.doc) : undefined
      const rendered = renderPlanSvg(loaded.doc, { background: includeBg, backgroundHref })
      const resourceUri = `floorplan://projects/${encodeURIComponent(projectId)}/render.svg`
      const fileName = `${(loaded.project.name || projectId).replace(/[^a-zA-Z0-9_-]+/g, '-')}.svg`
      return {
        content: [
          { type: 'text', text: rendered.svg },
          {
            type: 'resource_link',
            uri: resourceUri,
            name: fileName,
            description: `Standalone SVG render of ${loaded.project.name} (${Math.round(rendered.width)}x${Math.round(rendered.height)} cm viewBox).`,
            mimeType: 'image/svg+xml',
          },
        ],
        structuredContent: {
          projectId,
          width: rendered.width,
          height: rendered.height,
          fontSize: rendered.fontSize,
          resourceUri,
          svg: rendered.svg,
        },
      }
    }

    case 'get_events': {
      const projectId = asString(args.projectId)
      if (!projectId) return errResult('INVALID_PARAMS', 'projectId is required.')
      const since = asString(args.since)
      if (since && Number.isNaN(Date.parse(since))) {
        return errResult('INVALID_PARAMS', 'since must be an ISO 8601 date.')
      }
      const limit = typeof args.limit === 'number' && Number.isInteger(args.limit) && args.limit > 0 ? args.limit : undefined
      const loaded = await store.loadProject(projectId)
      if (!loaded) return errResult('PROJECT_NOT_FOUND', `Project "${projectId}" not found.`)
      const events = await store.listEvents(projectId, since, limit)
      const lines = events.length
        ? events.map((e) => `- ${e.ts} [${e.actor}] ${e.kind}: ${e.summary}`).join('\n')
        : 'No events found.'
      return okResult(`Found ${events.length} event(s).\n${lines}`, { projectId, events })
    }

    default:
      throw new UnknownToolError(name)
  }
}
