// WebMCP registration: exposes the agent bridge as tools on `navigator.modelContext` when the browser has it.
// Without `modelContext.registerTool` this module does nothing.
import type { SfpAgentBridge } from './bridge'

type ToolContent = { content: { type: 'text'; text: string }[]; isError?: boolean }

export type WebMcpTool = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  execute: (input: Record<string, unknown>) => ToolContent | Promise<ToolContent>
}

type ModelContext = {
  registerTool?: (tool: WebMcpTool) => unknown
  unregisterTool?: (name: string) => unknown
}

const json = (value: unknown, isError = false): ToolContent => ({
  content: [{ type: 'text', text: JSON.stringify(value) }],
  ...(isError ? { isError: true } : {}),
})

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
})

const COMMAND_SCHEMA = {
  type: 'object',
  description: 'One command. "type" is one of: set_title, add_artboard, update_artboard, duplicate_artboard, delete_artboard, add_room_rect, add_room_polygon, rename_room, move_room, set_wall_length, move_vertex, insert_vertex, delete_vertex, delete_rooms, cutout_rooms, merge_rooms, set_room_style, add_opening_on_wall, update_opening, delete_opening, add_furniture, update_furniture, reorder_furniture, duplicate_furniture, delete_furniture. Other fields depend on the type (see /llms.txt). Units: cm and degrees.',
  properties: { type: { type: 'string' } },
  required: ['type'],
  additionalProperties: true,
}

const SELECTION_SCHEMA = {
  type: 'object',
  description: 'Selection: {"kind":"none"} or {"kind":"room"|"wall"|"vertex"|"opening"|"furniture"|"artboard"|"refImage", ...ids}.',
  properties: { kind: { type: 'string' } },
  required: ['kind'],
  additionalProperties: true,
}

export function createWebMcpTools(bridge: SfpAgentBridge): WebMcpTool[] {
  return [
    {
      name: 'sfp_get_project',
      description: 'Get a compact summary of the open project (artboards, rooms, openings, furniture, areas) and the UI state.',
      inputSchema: obj({}),
      execute: () => json({ summary: bridge.summarize(), ui: bridge.getUi() }),
    },
    {
      name: 'sfp_get_doc',
      description: 'Get the full ProjectDoc (schemaVersion 3) as JSON. Large: prefer sfp_get_project.',
      inputSchema: obj({}),
      execute: () => json(bridge.getDoc()),
    },
    {
      name: 'sfp_validate',
      description: 'Validate the open project. Returns { ok, issues[] }.',
      inputSchema: obj({}),
      execute: () => json(bridge.validate()),
    },
    {
      name: 'sfp_exec',
      description: 'Run one command or an array of commands on the open project. A batch is all-or-nothing and is one undo step. Set dryRun to check without changing anything.',
      inputSchema: obj({
        commands: { oneOf: [COMMAND_SCHEMA, { type: 'array', items: COMMAND_SCHEMA }], description: 'One command or an array of commands.' },
        dryRun: { type: 'boolean', description: 'When true, compute the result but do not change the project.' },
      }, ['commands']),
      execute: (input) => {
        const cmds = input.commands as Parameters<SfpAgentBridge['exec']>[0] | undefined
        if (cmds === undefined || cmds === null) return json({ ok: false, error: '"commands" is required.' }, true)
        const r = bridge.exec(cmds, { dryRun: input.dryRun === true })
        return json(r, !r.ok)
      },
    },
    {
      name: 'sfp_undo',
      description: 'Undo the last change. Returns { changed }.',
      inputSchema: obj({}),
      execute: () => json({ changed: bridge.undo() }),
    },
    {
      name: 'sfp_redo',
      description: 'Redo the last undone change. Returns { changed }.',
      inputSchema: obj({}),
      execute: () => json({ changed: bridge.redo() }),
    },
    {
      name: 'sfp_set_ui',
      description: 'Set UI state: mode, tool, active artboard, selection and view. All fields are optional. "fit" fits the view to an artboard (or all when true).',
      inputSchema: obj({
        mode: { type: 'string', enum: ['plan', 'design'] },
        tool: { type: 'string', enum: ['select', 'rect', 'pen', 'cutout', 'place-opening', 'calibrate-image', 'tape', 'artboard'] },
        activeArtboardId: { type: 'string' },
        selection: SELECTION_SCHEMA,
        view: obj({ x: { type: 'number' }, y: { type: 'number' }, zoom: { type: 'number' } }, ['x', 'y', 'zoom']),
        fit: { oneOf: [{ type: 'boolean' }, { type: 'string' }], description: 'true = fit all; a string = fit that artboard id.' },
      }),
      execute: (input) => {
        if (input.mode === 'plan' || input.mode === 'design') bridge.setMode(input.mode)
        if (typeof input.tool === 'string') bridge.setTool(input.tool as Parameters<SfpAgentBridge['setTool']>[0])
        if (typeof input.activeArtboardId === 'string' && !bridge.setActiveArtboard(input.activeArtboardId)) {
          return json({ ok: false, error: `Artboard "${input.activeArtboardId}" not found.` }, true)
        }
        if (input.selection && typeof input.selection === 'object') bridge.select(input.selection as Parameters<SfpAgentBridge['select']>[0])
        if (input.view && typeof input.view === 'object') bridge.setView(input.view as Parameters<SfpAgentBridge['setView']>[0])
        if (input.fit === true) bridge.fitView()
        else if (typeof input.fit === 'string' && !bridge.fitView(input.fit)) return json({ ok: false, error: `Artboard "${input.fit}" not found.` }, true)
        return json({ ok: true, ui: bridge.getUi() })
      },
    },
    {
      name: 'sfp_load_project',
      description: 'Replace the open project with a validated ProjectDoc (schemaVersion 3) or a v1 export. Clears undo history.',
      inputSchema: obj({ project: { type: 'object', description: 'ProjectDoc JSON.' } }, ['project']),
      execute: (input) => {
        const r = bridge.loadProject(input.project)
        return json(r, !r.ok)
      },
    },
    {
      name: 'sfp_export_svg',
      description: 'Render one artboard as a standalone SVG string. Default: the active artboard, or the first.',
      inputSchema: obj({ artboardId: { type: 'string' } }),
      execute: (input) => {
        const r = bridge.exportSvg(typeof input.artboardId === 'string' ? input.artboardId : undefined)
        return json(r, !r.ok)
      },
    },
  ]
}

/** Register the tools when `navigator.modelContext.registerTool` exists. Returns a cleanup function (never throws). */
export function registerWebMcpTools(bridge: SfpAgentBridge): () => void {
  try {
    const mc = (typeof navigator !== 'undefined' ? (navigator as unknown as { modelContext?: ModelContext }).modelContext : undefined)
    if (!mc || typeof mc.registerTool !== 'function') return () => {}
    const names: string[] = []
    const handles: unknown[] = []
    for (const tool of createWebMcpTools(bridge)) {
      try {
        handles.push(mc.registerTool(tool))
        names.push(tool.name)
      } catch { /* one failing tool must not block the rest */ }
    }
    return () => {
      names.forEach((name, i) => {
        try {
          const h = handles[i] as { unregister?: () => void } | undefined
          if (h && typeof h.unregister === 'function') h.unregister()
          else mc.unregisterTool?.(name)
        } catch { /* ignore */ }
      })
    }
  } catch {
    return () => {}
  }
}
