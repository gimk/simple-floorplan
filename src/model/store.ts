import { create } from 'zustand'
import { temporal } from 'zundo'
import type { ElementKind, MeasureSource, Mode, PlanDoc, Selection, ToolId, WallType } from './types'
import type { RenovationView } from '../features/renovation/logic'
import { ensureStoredGraph } from './graphRule'
import { ensureV2 } from './v2/ensure'
import { toggleItem, type SelItem } from './selection'
import { loadInitialDoc, scheduleSave, setLastProjectId } from '../sync/idb'
import { addStorage as addStorageDoc, deleteStorage as deleteStorageDoc, updateStorage as updateStorageDoc, type StorageDoor, type StorageParams } from '../features/storage/actions'

// ---------- Document store (undoable) ----------
// All plan data lives here. Mutate ONLY via `update(fn)` (immer-like draft is NOT used:
// return a new PlanDoc). Undo/redo: useDoc.temporal.getState().undo() / redo().

export const emptyDoc = (): PlanDoc => ({
  projectId: 'local',
  title: 'New apartment',
  rooms: [],
  elements: [],
  measurements: {},
  roomNotes: {},
  tapes: [],
  pins: [],
})

type DocState = {
  doc: PlanDoc
  /** Replace the doc with the result of fn. Creates one undo step. */
  update: (fn: (d: PlanDoc) => PlanDoc) => void
  /**
   * Same as update but does not create an undo step (drag previews, measurements).
   * `remote`: the change comes from the server; the local edit rules (doc rules) do not run.
   */
  updateSilent: (fn: (d: PlanDoc) => PlanDoc, opts?: { remote?: boolean }) => void
  replace: (d: PlanDoc) => void
  addStorage: (parentRoomId: string, hostWall: string, params: StorageParams, door: StorageDoor) => { storageRoomId: string } | { error: string }
  updateStorage: (storageRoomId: string, params: StorageParams, door?: StorageDoor) => { error?: string }
  deleteStorage: (storageRoomId: string) => void
}

let silent = false

/**
 * True inside `updateSilent`: the change is a preview (a drag move), and the rules must not do what
 * a finished edit does (a value that leaves the plan, a toast). The settle rules run at the end.
 */
export const isSilentEdit = () => silent

/**
 * Rules run after every local edit (update / updateSilent), in the same step, so undo and sync
 * see one change. `prev` is the doc before the edit, `next` the edited doc. Registered by features
 * (see features/rooms/measureRules.ts), so this store does not import them.
 */
export type DocRule = (prev: PlanDoc, next: PlanDoc) => PlanDoc
const rules: DocRule[] = []
export const addDocRule = (rule: DocRule) => { if (!rules.includes(rule)) rules.push(rule) }

/**
 * Settle rules run after a finished edit: every `update`, and the end of a drag (`endDrag`),
 * but not on each pointermove of a drag, so a drag never works in a moving frame.
 */
export type SettleRule = (doc: PlanDoc) => PlanDoc
const settleRules: SettleRule[] = []
export const addSettleRule = (rule: SettleRule) => { if (!settleRules.includes(rule)) settleRules.push(rule) }
const settle = (d: PlanDoc) => settleRules.reduce((acc, rule) => rule(acc), d)

const local = (fn: (d: PlanDoc) => PlanDoc) => (d: PlanDoc) => {
  const next = fn(d)
  if (next === d) return next
  const ruled = rules.reduce((acc, rule) => rule(d, acc), next)
  return silent ? ruled : settle(ruled)
}

export const useDoc = create<DocState>()(
  temporal(
    (set, get) => ({
      doc: emptyDoc(),
      update: (fn) => set((s) => ({ doc: local(fn)(s.doc) })),
      updateSilent: (fn, opts) => {
        silent = true
        set((s) => ({ doc: (opts?.remote ? fn : local(fn))(s.doc) }))
        silent = false
      },
      // A doc without walls gets them here (migration); rooms and values are not touched.
      // The v2 load step (`ensureV2`: a v1 doc becomes v2, a v2 doc gets its rooms calculated from
      // its walls again) runs BEFORE this call, at every load point: hydrate, openDoc, the server
      // snapshot that connect adopts, the .sfp import and the demo apartment.
      replace: (d) => set({ doc: ensureStoredGraph(d) }),
      addStorage: (parentRoomId, hostWall, params, door) => {
        const res = addStorageDoc(get().doc, parentRoomId, hostWall, params, door)
        if ('error' in res) return res
        get().update(() => res.doc)
        return { storageRoomId: res.storageRoomId }
      },
      updateStorage: (storageRoomId, params, door) => {
        const res = updateStorageDoc(get().doc, storageRoomId, params, door)
        if ('error' in res) return res
        get().update(() => res.doc)
        return {}
      },
      deleteStorage: (storageRoomId) => {
        const next = deleteStorageDoc(get().doc, storageRoomId)
        if (next !== get().doc) get().update(() => next)
      },
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
  // The drag is one undo step from `start`; settle its result in that same step.
  const cur = useDoc.getState().doc
  const settled = settle(cur)
  if (settled !== cur) { silent = true; useDoc.setState({ doc: settled }); silent = false }
}

// ---------- persistence (IndexedDB, one record per projectId, debounced 300 ms) ----------
// main.tsx awaits `hydrate()` before the first render, so the first paint already
// shows the saved doc. Saving only starts after hydrate (the empty initial doc must
// never overwrite a saved one).

let hydrated = false

export async function hydrate(): Promise<void> {
  if (hydrated) return
  hydrated = true
  try {
    const saved = await loadInitialDoc()
    if (saved) {
      useDoc.setState({ doc: ensureV2({ ...emptyDoc(), ...saved }) })
      useDoc.temporal.getState().clear()
    }
  } catch { /* start with the empty doc */ }
  setLastProjectId(useDoc.getState().doc.projectId)
  useDoc.subscribe((s, prev) => {
    if (s.doc !== prev.doc) scheduleSave(s.doc)
  })
  scheduleSave(useDoc.getState().doc)
}

// ---------- UI store (not undoable) ----------

/**
 * Three states of a layer that is useful in the survey only: 'auto' shows it in the
 * Solve tab and in Measuring Mode (see shell/view/layers.ts).
 */
export type LayerMode = 'auto' | 'on' | 'off'

export type Layers = {
  background: boolean
  dimensions: boolean
  bearingHighlight: boolean
  openings: boolean
  notes: boolean
  /** Red highlight of door swings and fixtures that clash (features/clearance). */
  clashes: boolean
  /** Room code before the room name ('CU  Cuisine'), to find the survey IDs on the plan. */
  roomCodes: LayerMode
  /** Small wall number badges ('6' = wall CU-6), to find the survey IDs on the plan. */
  wallLabels: LayerMode
  /** Outside (facade) dimension chains and overall lengths (docs/measurements-plan.md section 3). */
  outsideDims: boolean
}

/** Rows of the room tag on the plan (docs/measurements-plan.md section 2). */
export type RoomTagFields = {
  /** Room code before the name. The layer `roomCodes` still decides when codes are shown. */
  code: boolean
  name: boolean
  area: boolean
  perimeter: boolean
  ceiling: boolean
  /** Survey progress: measured walls / walls ('4/6 walls'). */
  progress: boolean
  /** Decimals of the area (0, 1 or 2). */
  areaDecimals: 0 | 1 | 2
}

/** How wall lengths are drawn: dimension lines with ticks, or the old text only. */
export type DimStyle = 'lines' | 'text'

/**
 * Units of the lengths written on the plan (dimensions, outside rows, single walls, room tag
 * perimeter and height). Panel fields stay in cm. `decimals` = digits after the comma.
 */
export type CanvasUnits = { unit: 'cm' | 'm' | 'mm'; decimals: 0 | 1 | 2 | 3 }

type UiState = {
  mode: Mode
  tool: ToolId
  /** Primary selected item (the last one clicked). */
  selection: Selection
  /** Shift + click group: every selected item, the primary included (see model/selection.ts). */
  multi: SelItem[]
  /** Element kind to place with the 'place-element' tool. */
  placeKind: ElementKind
  snap: { grid: boolean; gridCm: number; angles: boolean; vertices: boolean }
  /** "Solve whole plan" keeps locked walls. */
  solveKeepLocked: boolean
  /** "Solve whole plan": walls not found by the data snap to usual thicknesses. */
  solveSnapThickness: boolean
  /** "Solve whole plan" and doc.apartment.references: off, guide (one-sided) or match. */
  solveSurfaceMode: 'off' | 'guide' | 'match'
  /**
   * "Solve whole plan": 'square' (default) keeps walls drawn horizontal or vertical at their drawn
   * angle; 'free' lets every wall turn, so a measured diagonal can show a room that is out of square
   * (docs/walls-plan.md phase 4b).
   */
  solveAngles: 'square' | 'free'
  /** Report of the last run of the Solve tab (whole plan, not per room). */
  solveReport: string | null
  layers: Layers
  /** Wall lengths on the plan: dimension lines (default) or text only (docs/measurements-plan.md). */
  dimStyle: DimStyle
  /** Rows of the room tag (docs/measurements-plan.md section 2). */
  roomTag: RoomTagFields
  /** Units of the lengths written on the plan (docs/measurements-plan.md section 5). */
  canvasUnits: CanvasUnits
  /** Before / After / Both renovation display (see features/renovation, 7.4). */
  renovationView: RenovationView
  /**
   * Source saved with every value typed in Measuring Mode (docs/walls-plan.md phase 3a).
   * It sets the weight of the value in the solver. Memory only: no other UI setting persists.
   */
  measureSource: MeasureSource
  /**
   * Thickness and type of the walls that the Wall tool draws (docs/walls-plan.md phase 6).
   * Edited in the Inspect tab while the tool is active; the last used values are kept in memory.
   */
  wallToolThicknessCm: number
  wallToolType: WallType
  /**
   * Room whose inline name editor must open (the Make room tool asks for the name of the new
   * room). RoomsLayer opens the editor and clears the field. null = nothing to open.
   */
  nameEditRoom: string | null
  /**
   * Survey label under the pointer, e.g. 'CU-6' (wall), 'CU-D' (diagonal), 'SE-1-T' (thickness).
   * The plan highlights that element (see features/rooms/hoverTarget.ts). null = nothing hovered.
   * Generic on purpose: the Solve tab sets it now, Measuring Mode uses it later.
   */
  hoverLabel: string | null
  /**
   * Diagonal of a suggestion whose room has no `diagonal` pair yet: the label alone cannot give
   * the two corners. RoomsLayer uses it when `hoverLabel` ends with '-D'. null = none.
   */
  hoverDiagonal: { roomId: string; pair: [number, number] } | null
  /** Viewport: world point at screen origin + zoom (screen px per cm). */
  view: { x: number; y: number; zoom: number }
  /** Incremented when a canvas tap selects an item, so phone layout opens the inspector. */
  inspectorOpenTick: number
  setMode: (m: Mode) => void
  setTool: (t: ToolId) => void
  /** Select one item only (or nothing). Clears the group. */
  select: (s: Selection) => void
  /** Shift + click: add the item to the group, or remove it. */
  toggleSelect: (s: SelItem) => void
  /** Write the report of the Solve tab (null clears it). */
  setSolveReport: (text: string | null) => void
  /** Source saved with the next values typed in Measuring Mode. */
  setMeasureSource: (s: MeasureSource) => void
  /** Request opening the inspector drawer on phone after a canvas tap selection. */
  openInspector: () => void
  set: (
    p: Partial<
      Omit<UiState, 'set' | 'setMode' | 'setTool' | 'select' | 'toggleSelect' | 'setSolveReport' | 'setMeasureSource' | 'openInspector'>
    >,
  ) => void
}

export const useUi = create<UiState>()((set) => ({
  mode: typeof window !== 'undefined' && window.innerWidth < 700 ? 'measure' : 'edit',
  tool: 'select',
  selection: null,
  multi: [],
  placeKind: 'door',
  snap: { grid: true, gridCm: 5, angles: true, vertices: true },
  solveKeepLocked: true,
  solveSnapThickness: false,
  solveSurfaceMode: 'off',
  solveAngles: 'square',
  solveReport: null,
  layers: {
    background: true, dimensions: true, bearingHighlight: true, openings: true, notes: true, clashes: true,
    roomCodes: 'auto', wallLabels: 'auto', outsideDims: true,
  },
  dimStyle: 'lines',
  canvasUnits: { unit: 'cm', decimals: 1 },
  roomTag: { code: true, name: true, area: true, perimeter: false, ceiling: false, progress: false, areaDecimals: 2 },
  renovationView: 'both',
  measureSource: 'tape',
  wallToolThicknessCm: 10,
  wallToolType: 'partition',
  nameEditRoom: null,
  hoverLabel: null,
  hoverDiagonal: null,
  view: { x: -100, y: -100, zoom: 1 },
  inspectorOpenTick: 0,
  setMode: (mode) => set({ mode, tool: 'select', selection: null, multi: [] }),
  setTool: (tool) => set({ tool }),
  select: (selection) => set({ selection, multi: [] }),
  toggleSelect: (item) => set((s) => toggleItem(s, item)),
  setSolveReport: (solveReport) => set({ solveReport }),
  setMeasureSource: (measureSource) => set({ measureSource }),
  openInspector: () => set((s) => ({ inspectorOpenTick: s.inspectorOpenTick + 1 })),
  set: (p) => set(p),
}))

export const uid = (prefix = '') => prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
export const nowIso = () => new Date().toISOString()
