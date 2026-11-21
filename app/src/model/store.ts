import { create } from 'zustand'
import { temporal } from 'zundo'
import type { ElementKind, Mode, PlanDoc, Selection, ToolId } from './types'

// ---------- Document store (undoable) ----------
// All plan data lives here. Mutate ONLY via `update(fn)` (immer-like draft is NOT used:
// return a new PlanDoc). Undo/redo: useDoc.temporal.getState().undo() / redo().

const STORAGE_KEY = 'simple-floorplan:doc'

export const emptyDoc = (): PlanDoc => ({
  projectId: 'local',
  title: 'New apartment',
  rooms: [],
  elements: [],
  measurements: {},
  roomNotes: {},
  tapes: [],
})

function loadDoc(): PlanDoc {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return { ...emptyDoc(), ...JSON.parse(raw) }
  } catch { /* ignore */ }
  return emptyDoc()
}

type DocState = {
  doc: PlanDoc
  /** Replace the doc with the result of fn. Creates one undo step. */
  update: (fn: (d: PlanDoc) => PlanDoc) => void
  /** Same as update but does not create an undo step (drag previews, measurements). */
  updateSilent: (fn: (d: PlanDoc) => PlanDoc) => void
  replace: (d: PlanDoc) => void
}

let silent = false

export const useDoc = create<DocState>()(
  temporal(
    (set) => ({
      doc: loadDoc(),
      update: (fn) => set((s) => ({ doc: fn(s.doc) })),
      updateSilent: (fn) => {
        silent = true
        set((s) => ({ doc: fn(s.doc) }))
        silent = false
      },
      replace: (d) => set({ doc: d }),
    }),
    {
      partialize: (s) => ({ doc: s.doc }),
      limit: 200,
      handleSet: (handleSet) => (state) => { if (!silent) handleSet(state) },
    },
  ),
)

/**
 * Drags as ONE undo step:
 *   const start = beginDrag()          // on pointerdown
 *   updateSilent(...)                  // on every pointermove
 *   endDrag(start)                     // on pointerup
 */
export const beginDrag = (): PlanDoc => useDoc.getState().doc
export const endDrag = (start: PlanDoc) => {
  if (useDoc.getState().doc === start) return
  const t = useDoc.temporal
  t.setState({ pastStates: [...t.getState().pastStates, { doc: start }].slice(-200), futureStates: [] })
}

useDoc.subscribe((s) => {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s.doc)) } catch { /* ignore */ }
})

// ---------- UI store (not undoable) ----------

export type Layers = {
  background: boolean
  dimensions: boolean
  bearingHighlight: boolean
  openings: boolean
  notes: boolean
}

type UiState = {
  mode: Mode
  tool: ToolId
  selection: Selection
  /** Element kind to place with the 'place-element' tool. */
  placeKind: ElementKind
  snap: { grid: boolean; gridCm: number; angles: boolean; vertices: boolean }
  layers: Layers
  /** Viewport: world point at screen origin + zoom (screen px per cm). */
  view: { x: number; y: number; zoom: number }
  setMode: (m: Mode) => void
  setTool: (t: ToolId) => void
  select: (s: Selection) => void
  set: (p: Partial<Omit<UiState, 'set' | 'setMode' | 'setTool' | 'select'>>) => void
}

export const useUi = create<UiState>()((set) => ({
  mode: typeof window !== 'undefined' && window.innerWidth < 700 ? 'measure' : 'edit',
  tool: 'select',
  selection: null,
  placeKind: 'door',
  snap: { grid: true, gridCm: 5, angles: true, vertices: true },
  layers: { background: true, dimensions: true, bearingHighlight: true, openings: true, notes: true },
  view: { x: -100, y: -100, zoom: 1 },
  setMode: (mode) => set({ mode, tool: 'select', selection: null }),
  setTool: (tool) => set({ tool }),
  select: (selection) => set({ selection }),
  set: (p) => set(p),
}))

export const uid = (prefix = '') => prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
export const nowIso = () => new Date().toISOString()
