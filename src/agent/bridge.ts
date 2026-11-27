// In-page agent bridge: `window.sfp`. Lets a script or an AI agent read and edit the open project
// through the pure command layer in `src/core`. Every successful `exec` is one undo step.
// Units: cm and degrees. All return values are JSON-serializable.
import { applyCommand, applyCommands, summarizeProject, validateProject } from '../core'
import type { AgentCommand, ProjectSummary, ValidationIssue } from '../core'
import { renderArtboardSvg } from '../features/export/artboardSvg'
import { cloneDoc, docBounds, artboardBounds, useDoc } from '../model/store'
import type { ProjectDoc, Selection } from '../model/types'
import { fitView } from '../shell/viewMath'
import { useUi } from '../shell/uiStore'
import type { Mode, Tool, View } from '../shell/uiStore'
import { parseProjectJson } from '../sync/jsonFile'
import { convertV1ToV2, isV1Export } from '../sync/convertV1'
import { registerWebMcpTools } from './webmcp'

export type AgentUiState = {
  mode: Mode
  tool: Tool
  activeArtboardId: string | null
  selection: Selection
  view: View
}

export type ExecResult =
  | { ok: true; result: Record<string, unknown>; dryRun: boolean }
  | { ok: false; error: string; issues?: ValidationIssue[] }

export type LoadResult = { ok: boolean; error?: string; issues?: ValidationIssue[] }

export type ExportSvgResult = { ok: true; svg: string; artboardId: string } | { ok: false; error: string }

export type ChangeEvent = { rev: number; doc: ProjectDoc }

export interface SfpAgentBridge {
  version: '3'
  getDoc(): ProjectDoc
  getUi(): AgentUiState
  summarize(): ProjectSummary
  validate(): ReturnType<typeof validateProject>
  exec(cmdOrCmds: AgentCommand | AgentCommand[], opts?: { dryRun?: boolean }): ExecResult
  dryRun(cmdOrCmds: AgentCommand | AgentCommand[]): ExecResult
  undo(): boolean
  redo(): boolean
  setMode(mode: Mode): void
  setTool(tool: Tool): void
  select(selection: Selection): void
  setActiveArtboard(artboardId: string): boolean
  setView(view: View): void
  fitView(artboardId?: string): boolean
  loadProject(input: unknown): LoadResult
  exportProject(): string
  exportSvg(artboardId?: string): ExportSvgResult
  worldToScreen(xCm: number, yCm: number): { x: number; y: number } | null
  screenToWorld(clientX: number, clientY: number): { xCm: number; yCm: number } | null
  subscribe(listener: (event: ChangeEvent) => void): () => void
}

declare global {
  interface Window {
    sfp?: SfpAgentBridge
  }
}

const CANVAS_SELECTOR = '[data-testid="floorplan-canvas"]'

const canvasRect = (): DOMRect | null => {
  if (typeof document === 'undefined') return null
  return document.querySelector(CANVAS_SELECTOR)?.getBoundingClientRect() ?? null
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)

export function createAgentBridge(): SfpAgentBridge {
  let rev = 0
  const listeners = new Set<(event: ChangeEvent) => void>()
  let unsubDoc: (() => void) | null = null

  const ensureDocSubscription = () => {
    if (unsubDoc) return
    unsubDoc = useDoc.subscribe((s, prev) => {
      if (s.doc === prev.doc) return
      rev += 1
      const event: ChangeEvent = { rev, doc: cloneDoc(s.doc) }
      for (const l of [...listeners]) {
        try { l(event) } catch { /* a bad listener must not break the others */ }
      }
      if (typeof window !== 'undefined' && typeof CustomEvent !== 'undefined') {
        window.dispatchEvent(new CustomEvent('sfp:change', { detail: { rev } }))
      }
    })
  }
  // Count changes from creation, even when nobody has subscribed yet.
  ensureDocSubscription()

  const exec = (cmdOrCmds: AgentCommand | AgentCommand[], opts?: { dryRun?: boolean }): ExecResult => {
    const dryRun = opts?.dryRun === true
    const doc = useDoc.getState().doc
    const res = Array.isArray(cmdOrCmds) ? applyCommands(doc, cmdOrCmds, { dryRun }) : applyCommand(doc, cmdOrCmds, { dryRun })
    if (!res.ok) return { ok: false, error: res.error, ...(res.issues ? { issues: res.issues } : {}) }
    if (!dryRun) {
      const next = res.doc
      useDoc.getState().update(() => next) // one undo step
    }
    return { ok: true, result: res.result, dryRun }
  }

  const stateChanged = (fn: () => void): boolean => {
    const before = useDoc.getState().doc
    fn()
    return useDoc.getState().doc !== before
  }

  const targetArtboard = (artboardId?: string) => {
    const doc = useDoc.getState().doc
    const id = artboardId ?? useUi.getState().activeArtboardId ?? undefined
    return (id ? doc.artboards.find((a) => a.id === id) : undefined) ?? (artboardId ? undefined : doc.artboards[0])
  }

  return {
    version: '3',
    getDoc: () => JSON.parse(JSON.stringify(useDoc.getState().doc)) as ProjectDoc,
    getUi: () => {
      const { mode, tool, activeArtboardId, selection, view } = useUi.getState()
      return JSON.parse(JSON.stringify({ mode, tool, activeArtboardId, selection, view })) as AgentUiState
    },
    summarize: () => summarizeProject(useDoc.getState().doc),
    validate: () => {
      const r = validateProject(useDoc.getState().doc)
      return { ok: r.ok, issues: r.issues }
    },
    exec,
    dryRun: (cmdOrCmds) => exec(cmdOrCmds, { dryRun: true }),
    undo: () => stateChanged(() => useDoc.getState().undo()),
    redo: () => stateChanged(() => useDoc.getState().redo()),
    setMode: (mode) => useUi.getState().set({ mode }),
    setTool: (tool) => useUi.getState().set({ tool }),
    select: (selection) => useUi.getState().set({ selection }),
    setActiveArtboard: (artboardId) => {
      if (!useDoc.getState().doc.artboards.some((a) => a.id === artboardId)) return false
      useUi.getState().set({ activeArtboardId: artboardId })
      return true
    },
    setView: (view) => {
      if (!view || !finite(view.x) || !finite(view.y) || !finite(view.zoom) || view.zoom <= 0) return
      useUi.getState().set({ view: { x: view.x, y: view.y, zoom: view.zoom } })
    },
    fitView: (artboardId) => {
      const doc = useDoc.getState().doc
      const ab = artboardId ? doc.artboards.find((a) => a.id === artboardId) : undefined
      if (artboardId && !ab) return false
      const r = canvasRect()
      const w = r?.width || (typeof window !== 'undefined' ? window.innerWidth : 0) || 1000
      const h = r?.height || (typeof window !== 'undefined' ? window.innerHeight : 0) || 700
      const b = ab ? artboardBounds(ab) : docBounds(doc)
      useUi.getState().set({ view: fitView(b, w, h) })
      return true
    },
    loadProject: (input) => {
      let data = input
      if (typeof input === 'string') {
        const p = parseProjectJson(input)
        if (!p.ok) return { ok: false, error: p.error }
        data = p.doc
      } else if (isV1Export(input)) {
        try { data = convertV1ToV2(input) } catch (e) {
          return { ok: false, error: e instanceof Error ? e.message : 'Could not convert v1 file' }
        }
      }
      const v = validateProject(data)
      if (!v.doc) return { ok: false, error: v.issues[0] ? `${v.issues[0].path}: ${v.issues[0].message}` : 'Invalid project', issues: v.issues }
      if (!v.ok) return { ok: false, error: 'The project has validation errors.', issues: v.issues }
      useDoc.getState().hydrate(v.doc)
      useUi.getState().set({ activeArtboardId: null, selection: { kind: 'none' } })
      return { ok: true, ...(v.issues.length ? { issues: v.issues } : {}) }
    },
    exportProject: () => JSON.stringify(useDoc.getState().doc, null, 2),
    exportSvg: (artboardId) => {
      const ab = targetArtboard(artboardId)
      if (!ab) return { ok: false, error: artboardId ? `Artboard "${artboardId}" not found.` : 'The project has no artboard.' }
      const { svg } = renderArtboardSvg(ab, { projectTitle: useDoc.getState().doc.title })
      return { ok: true, svg, artboardId: ab.id }
    },
    worldToScreen: (xCm, yCm) => {
      const r = canvasRect()
      if (!r) return null
      const v = useUi.getState().view
      // Canvas transform: scale(zoom) translate(-x -y) => screen = (world - view) * zoom + rect origin.
      return { x: r.left + (xCm - v.x) * v.zoom, y: r.top + (yCm - v.y) * v.zoom }
    },
    screenToWorld: (clientX, clientY) => {
      const r = canvasRect()
      if (!r) return null
      const v = useUi.getState().view
      return { xCm: v.x + (clientX - r.left) / v.zoom, yCm: v.y + (clientY - r.top) / v.zoom }
    },
    subscribe: (listener) => {
      ensureDocSubscription()
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}

/** Create the bridge, expose it as `window.sfp`, and register the WebMCP tools when the browser has them. */
export function installAgentBridge(): SfpAgentBridge {
  const bridge = createAgentBridge()
  if (typeof window !== 'undefined') window.sfp = bridge
  registerWebMcpTools(bridge)
  return bridge
}
