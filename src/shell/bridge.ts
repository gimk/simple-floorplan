// Browser-agent bridge (docs/agent-ready.md 3.9): a stable window.__floorplan API so an
// agent in the browser (Claude in Chrome / Playwright) can read state and drive the
// app without guessing pointer pixels. Installed once from App.
import { useDoc, useUi } from '../model/store'
import type { Mode, PlanDoc, Selection, ToolId } from '../model/types'
import { fitToDoc } from './fit'
import type { View } from './viewMath'

export type UiSnapshot = {
  mode: Mode
  tool: ToolId
  selection: Selection
  placeKind: string
  snap: { grid: boolean; gridCm: number; angles: boolean; vertices: boolean }
  /** Plain layers are booleans; the room codes and the wall labels are 'auto' | 'on' | 'off'. */
  layers: Record<string, boolean | string>
  view: View
}

export type FloorplanBridge = {
  version: 1
  getDoc: () => PlanDoc
  getUi: () => UiSnapshot
  setMode: (m: Mode) => void
  setTool: (t: ToolId) => void
  setView: (v: View | 'fit') => void
  fit: () => void
  undo: () => void
  redo: () => void
  select: (s: Selection) => void
  exportSvg: (opts?: { background?: boolean }) => Promise<string>
}

declare global {
  interface Window {
    __floorplan?: FloorplanBridge
  }
}

export function installBridge(): FloorplanBridge {
  const api: FloorplanBridge = {
    version: 1,
    getDoc: () => useDoc.getState().doc,
    getUi: () => {
      const s = useUi.getState()
      return {
        mode: s.mode,
        tool: s.tool,
        selection: s.selection,
        placeKind: s.placeKind,
        snap: { ...s.snap },
        layers: { ...s.layers },
        view: { ...s.view },
      }
    },
    setMode: (m) => useUi.getState().setMode(m),
    setTool: (t) => useUi.getState().setTool(t),
    setView: (v) => {
      if (v === 'fit') fitToDoc()
      else useUi.getState().set({ view: { x: v.x, y: v.y, zoom: v.zoom } })
    },
    fit: () => fitToDoc(),
    undo: () => useDoc.temporal.getState().undo(),
    redo: () => useDoc.temporal.getState().redo(),
    select: (s) => useUi.getState().select(s),
    // svgExport.ts exports buildPlanSvg(doc, opts) -> SvgResult; return the SVG string.
    exportSvg: async (opts) => {
      const m = await import('../features/export/svgExport')
      return m.buildPlanSvg(useDoc.getState().doc, opts).svg
    },
  }
  window.__floorplan = api
  return api
}
