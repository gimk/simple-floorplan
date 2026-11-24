// Command palette entries (docs/measurements-plan.md section 7): tools, undo / redo, layers,
// snapping, units, measured display, select-similar and export.
// The list is plain data plus a `run` function; `commandList()` reads the stores, so it knows what
// is available now (a greyed out row is not runnable). The filter and the arrow-key index are pure.
import { useDoc, useUi } from '../model/store'
import type { SelItem } from '../model/selection'
import type { StoredWall, WallType } from '../model/types'
import { TOOLS } from './tools'
import { LAYER_LABELS } from './sidebar/layerLabels'
import {
  BOOLEAN_LAYER_KEYS, MODE_LAYER_KEYS, layerModeOf, setLayerMode, toggleLayer,
} from './view/layers'
import { fitToDoc } from './fit'
import { toast } from '../features/toast'

export type CommandGroup = 'Tools' | 'Edit' | 'View' | 'Layers' | 'Selection' | 'Export' | 'Help'

export type Command = {
  /** Stable id (tests, data attributes). */
  id: string
  /** What the palette shows. */
  title: string
  group: CommandGroup
  /** Extra search words, when the title alone is not enough. */
  keywords?: string
  /** Shortcut shown on the right side of the row. */
  shortcut?: string
  /** false: the row is greyed out and does nothing. */
  enabled: boolean
  run: () => void
}

/** What the palette gives to the list: shell actions that it owns. */
export type CommandCtx = {
  /** Open the shortcuts dialog (the App owns it). */
  openShortcuts?: () => void
}

// ---------- snapping (Shift+P) ----------

type SnapSet = { grid: boolean; angles: boolean; vertices: boolean }

/** The set before the last "all off", so Shift+P can put it back. Memory only. */
let previousSnap: SnapSet | null = null

/** Forget the remembered snap set (tests). */
export function resetSnapMemory(): void {
  previousSnap = null
}

/**
 * Shift+P: every snapping off, or back to the set before (docs/measurements-plan.md section 7).
 * Returns true when snapping is now on.
 */
export function toggleAllSnap(): boolean {
  const ui = useUi.getState()
  const s = ui.snap
  if (s.grid || s.angles || s.vertices) {
    previousSnap = { grid: s.grid, angles: s.angles, vertices: s.vertices }
    ui.set({ snap: { ...s, grid: false, angles: false, vertices: false } })
    return false
  }
  const back = previousSnap ?? { grid: true, angles: true, vertices: true }
  ui.set({ snap: { ...s, ...back } })
  previousSnap = null
  return true
}

// ---------- the filter (pure) ----------

/** Lower case, no accents: 'Séjour' also matches 'sejour'. */
export const fold = (s: string): string =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

/** The text a query is matched against: title, group and extra words. */
export const searchText = (c: Command): string =>
  fold([c.title, c.group, c.keywords ?? ''].join(' ')).replace(/\s+/g, ' ').trim()

/** Every word of the query must be in the command text (substring, any order). */
export function matches(c: Command, query: string): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const text = searchText(c)
  return words.every((w) => text.includes(w))
}

/** The commands that match the query, in their list order. An empty query keeps every row. */
export function filterCommands(list: Command[], query: string): Command[] {
  return list.filter((c) => matches(c, query))
}

/** One row of the palette: a command and its place in the filtered list. */
export type CommandRow = { command: Command; index: number }

/** Rows grouped by `group`, in the order of the list (the palette writes one heading per group). */
export function groupRows(list: Command[]): { group: CommandGroup; rows: CommandRow[] }[] {
  const out: { group: CommandGroup; rows: CommandRow[] }[] = []
  list.forEach((command, index) => {
    const last = out[out.length - 1]
    if (last && last.group === command.group) last.rows.push({ command, index })
    else out.push({ group: command.group, rows: [{ command, index }] })
  })
  return out
}

/** Next active row for the arrow keys: wraps around; an empty list stays at 0. */
/** The row to show as active: `index` kept inside the list, moved to an enabled row if needed. */
export function activeIndex(list: readonly { enabled: boolean }[], index: number): number {
  if (list.length === 0) return 0
  const i = Math.max(0, Math.min(index, list.length - 1))
  if (list[i].enabled) return i
  const after = list.findIndex((c, k) => k > i && c.enabled)
  if (after >= 0) return after
  const first = list.findIndex((c) => c.enabled)
  return first >= 0 ? first : i
}

/** Next enabled row in the direction `delta` (wraps); the same row when no other is enabled. */
export function nextEnabled(list: readonly { enabled: boolean }[], index: number, delta: number): number {
  const n = list.length
  if (n === 0) return 0
  for (let k = 1; k <= n; k++) {
    const j = moveIndex(index, delta * k, n)
    if (list[j].enabled) return j
  }
  return Math.max(0, Math.min(index, n - 1))
}

export function moveIndex(index: number, delta: number, length: number): number {
  if (length <= 0) return 0
  return ((index + delta) % length + length) % length
}

// ---------- selection helpers ----------

const storedWalls = (): StoredWall[] => useDoc.getState().doc.walls ?? []

/** Wall type of a stored wall. A wall without a type is a partition (the app default). */
export const wallTypeOf = (w: StoredWall): WallType => w.type ?? 'partition'

/** Stored walls of one type, in document order. */
export const storedWallsOfType = (walls: StoredWall[], type: WallType): StoredWall[] =>
  walls.filter((w) => wallTypeOf(w) === type)

/** The stored wall under the selection, when the primary selected item is a stored wall. */
export function selectedStoredWall(): StoredWall | null {
  const sel = useUi.getState().selection
  if (!sel || sel.kind !== 'storedWall') return null
  return storedWalls().find((w) => w.id === sel.wallId) ?? null
}

/**
 * Select a group of items: the first one, then Shift + click on the others — the same group API
 * that a Shift + click uses (see model/selection.ts). An empty list clears the selection.
 */
export function selectGroup(items: SelItem[]): void {
  const ui = useUi.getState()
  if (!items.length) { ui.select(null); return }
  ui.select(items[0])
  for (const item of items.slice(1)) useUi.getState().toggleSelect(item)
}

const wallItem = (w: StoredWall): SelItem => ({ kind: 'storedWall', wallId: w.id })

const TYPE_LABEL: Record<WallType, string> = {
  bearing: 'bearing walls',
  partition: 'partitions',
  exterior: 'exterior walls',
}

// ---------- export ----------

/**
 * Export the plan with the measurement settings of the View menu, as the Export panel does.
 * The export code is loaded on demand, so the palette stays light.
 */
async function exportPlan(kind: 'svg' | 'pdf'): Promise<void> {
  const doc = useDoc.getState().doc
  const ui = useUi.getState()
  const [{ download, slug }, svgMod] = await Promise.all([
    import('../features/export/csv'),
    import('../features/export/svgExport'),
  ])
  const opts = {
    dimStyle: ui.dimStyle,
    roomTag: ui.roomTag,
    units: ui.canvasUnits,
    outside: ui.layers.outsideDims,
    surveyLabels: true,
    schedule: false,
  }
  const name = slug(doc.title)
  if (kind === 'svg') {
    download(`${name}.svg`, new Blob([svgMod.buildPlanSvg(doc, opts).svg], { type: 'image/svg+xml' }))
    return
  }
  const { exportPlanPdf } = await import('../features/export/pdfExport')
  download(`${name}.pdf`, await exportPlanPdf(doc, { ...opts, size: 'a4' }))
}

const runExport = (kind: 'svg' | 'pdf') => () => {
  void exportPlan(kind).catch((e: unknown) => {
    toast(`Export failed: ${e instanceof Error ? e.message : String(e)}`)
  })
}

const MODE_LABEL: Record<'auto' | 'on' | 'off', string> = { auto: 'Auto', on: 'On', off: 'Off' }

// ---------- the list ----------

/**
 * Every command, with what is available now. The palette calls this each time it opens, so the
 * enabled flags and the labels follow the app state.
 */
export function commandList(ctx: CommandCtx = {}): Command[] {
  const ui = useUi.getState()
  const doc = useDoc.getState().doc
  const walls = doc.walls ?? []
  const temporal = useDoc.temporal.getState()
  const selWall = selectedStoredWall()
  const out: Command[] = []

  // --- tools ---
  for (const t of TOOLS) {
    out.push({
      id: `tool:${t.id}`,
      title: `${t.label} tool`,
      group: 'Tools',
      keywords: `tool ${t.id} ${t.key}`,
      shortcut: t.key.toUpperCase(),
      enabled: true,
      run: () => useUi.getState().setTool(t.id),
    })
  }

  // --- undo / redo / view ---
  out.push({
    id: 'edit:undo',
    title: 'Undo',
    group: 'Edit',
    shortcut: 'Ctrl/Cmd+Z',
    enabled: temporal.pastStates.length > 0,
    run: () => useDoc.temporal.getState().undo(),
  })
  out.push({
    id: 'edit:redo',
    title: 'Redo',
    group: 'Edit',
    shortcut: 'Ctrl/Cmd+Shift+Z',
    enabled: temporal.futureStates.length > 0,
    run: () => useDoc.temporal.getState().redo(),
  })
  out.push({
    id: 'view:fit',
    title: 'Fit to view',
    group: 'View',
    keywords: 'zoom fit plan',
    shortcut: '0',
    enabled: true,
    run: () => fitToDoc(),
  })
  out.push({
    id: 'view:measure-mode',
    title: ui.mode === 'measure' ? 'Exit Measuring Mode' : 'Measuring Mode',
    group: 'View',
    keywords: 'measure survey mode',
    enabled: true,
    run: () => useUi.getState().setMode(useUi.getState().mode === 'measure' ? 'edit' : 'measure'),
  })

  // --- wall lengths style and units ---
  out.push({
    id: 'view:dims-lines',
    title: 'Wall lengths: Lines',
    group: 'View',
    keywords: 'dimension dims ticks style',
    enabled: ui.dimStyle !== 'lines',
    run: () => useUi.getState().set({ dimStyle: 'lines' }),
  })
  out.push({
    id: 'view:dims-text',
    title: 'Wall lengths: Text',
    group: 'View',
    keywords: 'dimension dims text only style',
    enabled: ui.dimStyle !== 'text',
    run: () => useUi.getState().set({ dimStyle: 'text' }),
  })
  for (const unit of ['cm', 'm', 'mm'] as const) {
    out.push({
      id: `view:units-${unit}`,
      title: `Units: ${unit}`,
      group: 'View',
      keywords: 'length units measurements',
      enabled: ui.canvasUnits.unit !== unit,
      run: () => useUi.getState().set({ canvasUnits: { ...useUi.getState().canvasUnits, unit } }),
    })
  }

  // --- snapping ---
  out.push({
    id: 'view:snap-off',
    title: 'Toggle snapping',
    group: 'View',
    keywords: 'snap grid angles vertices all off shift p magnet',
    shortcut: 'Shift+P',
    enabled: true,
    run: () => { toggleAllSnap() },
  })

  // --- layers ---
  for (const key of BOOLEAN_LAYER_KEYS) {
    out.push({
      id: `layer:${key}`,
      title: `Layer: ${LAYER_LABELS[key]}`,
      group: 'Layers',
      keywords: `show hide toggle layer ${key}`,
      enabled: true,
      run: () => {
        const cur = useUi.getState()
        useUi.getState().set({ layers: toggleLayer(cur.layers, key) })
      },
    })
  }
  for (const key of MODE_LAYER_KEYS) {
    const mode = layerModeOf(ui.layers[key])
    const next: 'auto' | 'on' | 'off' = mode === 'auto' ? 'on' : mode === 'on' ? 'off' : 'auto'
    out.push({
      id: `layer-mode:${key}`,
      title: `Layer: ${LAYER_LABELS[key]}`,
      group: 'Layers',
      keywords: `cycle show hide auto on off toggle layer ${key}`,
      shortcut: `${MODE_LABEL[mode]} → ${MODE_LABEL[next]}`,
      enabled: true,
      run: () => {
        const cur = useUi.getState()
        useUi.getState().set({ layers: setLayerMode(cur.layers, key, next) })
      },
    })
  }

  // --- select similar ---
  out.push({
    id: 'select:rooms',
    title: 'Select all rooms',
    group: 'Selection',
    keywords: 'select every room all',
    enabled: doc.rooms.length > 0,
    run: () => selectGroup(doc.rooms.map((r) => ({ kind: 'room', roomId: r.id }))),
  })
  out.push({
    id: 'select:same-type',
    title: selWall ? `Select all walls of this type (${TYPE_LABEL[wallTypeOf(selWall)]})` : 'Select all walls of this type',
    group: 'Selection',
    keywords: 'select similar walls type bearing partition',
    enabled: !!selWall && walls.length > 0,
    run: () => {
      const w = selectedStoredWall()
      if (!w) return
      selectGroup(storedWallsOfType(storedWalls(), wallTypeOf(w)).map(wallItem))
    },
  })
  out.push({
    id: 'select:bearing',
    title: 'Select all bearing walls',
    group: 'Selection',
    keywords: 'select every bearing load bearing wall',
    enabled: walls.length > 0,
    run: () => selectGroup(storedWallsOfType(storedWalls(), 'bearing').map(wallItem)),
  })
  out.push({
    id: 'select:partitions',
    title: 'Select all partitions',
    group: 'Selection',
    keywords: 'select every partition wall',
    enabled: walls.length > 0,
    run: () => selectGroup(storedWallsOfType(storedWalls(), 'partition').map(wallItem)),
  })

  // --- export ---
  out.push({
    id: 'export:svg',
    title: 'Export plan as SVG',
    group: 'Export',
    keywords: 'export save download svg vector',
    enabled: doc.rooms.length > 0,
    run: runExport('svg'),
  })
  out.push({
    id: 'export:pdf',
    title: 'Export plan as PDF',
    group: 'Export',
    keywords: 'export save download pdf print',
    enabled: doc.rooms.length > 0,
    run: runExport('pdf'),
  })

  // --- help ---
  out.push({
    id: 'help:shortcuts',
    title: 'Open keyboard shortcuts',
    group: 'Help',
    keywords: 'help keys shortcuts list',
    shortcut: '?',
    enabled: !!ctx.openShortcuts,
    run: () => ctx.openShortcuts?.(),
  })

  return out
}
