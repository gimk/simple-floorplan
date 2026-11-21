// App shell. OWNER: lead (integration). Feature agents: do not edit; ask for changes in your result file.
import { useEffect, useRef, useState } from 'react'
import { useStore } from 'zustand'
import {
  DoorOpen, Hand, Keyboard, Layers as LayersIcon, MousePointer2, MapPin, PanelRightClose, PanelRightOpen,
  PenTool, Ruler, Scissors, Square, SquareDashed, Undo2, Redo2, Smartphone, Crosshair, Cloud, CloudOff, KeyRound,
} from 'lucide-react'
import { setPasscode, startSync, useSyncState, useSyncStatusText } from './sync/sync'
import { Viewport } from './canvas/Viewport'
import { useDoc, useUi, type Layers } from './model/store'
import type { ToolId } from './model/types'
import { BackgroundLayer, BackgroundPanel, CalibrateTool } from './features/background'
import { RoomsLayer, RoomsPanel, RoomTools } from './features/rooms'
import { ElementsLayer, ElementsPanel, PlaceElementTool } from './features/elements'
import { MeasureMode } from './features/measure'
import { ProjectTitleButton } from './features/projects'
import { CalculatorsPanel, ExportPanel } from './features/export'
import { AnnotationsLayer, PinPanel, PinTool, TapePanel, TapeTool } from './features/annotations'
import { CanvasGrid } from './shell/CanvasGrid'
import { EmptyState } from './shell/EmptyState'
import { ZoomControls } from './shell/ZoomControls'
import { ToolHints } from './shell/ToolHints'
import { SnapPopover } from './shell/SnapPopover'
import { ShortcutsDialog } from './shell/ShortcutsDialog'
import { ThemeToggle } from './shell/ThemeToggle'
import { installBridge } from './shell/bridge'
import { fitToDoc } from './shell/fit'
import { initTheme } from './shell/theme'

initTheme()

const TOOLS: { id: ToolId; label: string; key: string; icon: typeof Square }[] = [
  { id: 'select', label: 'Select', key: 'v', icon: MousePointer2 },
  { id: 'pan', label: 'Pan', key: 'h', icon: Hand },
  { id: 'rect', label: 'Rectangle room', key: 'r', icon: Square },
  { id: 'polygon', label: 'Polygon room', key: 'p', icon: PenTool },
  { id: 'slice', label: 'Slice room', key: 's', icon: Scissors },
  { id: 'cutout', label: 'Cutout', key: 'x', icon: SquareDashed },
  { id: 'place-element', label: 'Door / window / storage', key: 'd', icon: DoorOpen },
  { id: 'calibrate', label: 'Calibrate scale', key: 'c', icon: Crosshair },
  { id: 'tape', label: 'Tape measure', key: 't', icon: Ruler },
  { id: 'pin', label: 'Note / photo pin', key: 'n', icon: MapPin },
]

function ToolOverlay() {
  const tool = useUi((s) => s.tool)
  switch (tool) {
    case 'select': case 'rect': case 'polygon': case 'slice': case 'cutout': {
      const T = RoomTools[tool]; return <T />
    }
    case 'place-element': return <PlaceElementTool />
    case 'calibrate': return <CalibrateTool />
    case 'tape': return <TapeTool />
    case 'pin': return <PinTool />
    default: return null
  }
}

function useShortcuts(onHelp: () => void) {
  const helpRef = useRef(onHelp)
  useEffect(() => { helpRef.current = onHelp }, [onHelp])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, select, [contenteditable]')) return
      if (e.key === '?') { e.preventDefault(); helpRef.current(); return }
      const ui = useUi.getState()
      if (ui.mode !== 'edit') return
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        const tmp = useDoc.temporal.getState()
        if (e.shiftKey) tmp.redo(); else tmp.undo()
        return
      }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); useDoc.temporal.getState().redo(); return }
      // #13: a tool that cancelled in-progress points preventDefault()s Escape — leave it alone.
      if (e.key === 'Escape') { if (e.defaultPrevented) return; ui.setTool('select'); ui.select(null); return }
      if (e.key === '0') { e.preventDefault(); fitToDoc(); return }
      if (mod || e.altKey) return
      const tool = TOOLS.find((x) => x.key === e.key.toLowerCase())
      if (tool) ui.setTool(tool.id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

/** Read ?mode=edit|measure on load; write it back on every change (agent-ready 3.9.3). */
function useUrlModeSync() {
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get('mode')
    if (p === 'edit' || p === 'measure') useUi.getState().setMode(p)
    const un = useUi.subscribe((s, prev) => {
      if (s.mode !== prev.mode) {
        const u = new URL(window.location.href)
        u.searchParams.set('mode', s.mode)
        window.history.replaceState(null, '', u)
      }
    })
    return un
  }, [])
}

const LAYER_LABELS: Record<keyof Layers, string> = {
  background: 'Background image', dimensions: 'Dimensions', bearingHighlight: 'Bearing walls highlight', openings: 'Openings', notes: 'Notes',
}

function LayerToggles() {
  const layers = useUi((s) => s.layers)
  const set = useUi((s) => s.set)
  return (
    <details className="rounded-lg border border-black/10 p-2 text-sm dark:border-white/10">
      <summary className="flex cursor-pointer items-center gap-2 font-semibold"><LayersIcon size={16} /> Layers</summary>
      <div className="mt-2 flex flex-col gap-1">
        {(Object.keys(LAYER_LABELS) as (keyof Layers)[]).map((k) => (
          <label key={k} className="flex items-center gap-2">
            <input type="checkbox" checked={layers[k]} onChange={(e) => set({ layers: { ...layers, [k]: e.target.checked } })} />
            {LAYER_LABELS[k]}
          </label>
        ))}
      </div>
    </details>
  )
}

function SyncBadge() {
  const s = useSyncState()
  const { text, warn } = useSyncStatusText()
  const [attempted, setAttempted] = useState(false)
  const [err, setErr] = useState('')
  // #16: after a submit, a still-locked state means the passcode was rejected.
  useEffect(() => {
    if (s.conn === 'locked') { if (attempted) setErr('Passcode rejected — still locked.') }
    else { setErr(''); setAttempted(false) }
  }, [s.conn, attempted])
  if (s.conn === 'locked') {
    return (
      <div className="relative">
        <form
          className="flex items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault()
            const v = new FormData(e.currentTarget).get('p')
            if (v) { setErr(''); setAttempted(true); setPasscode(String(v)) }
          }}
        >
          <KeyRound size={16} className="text-orange-600" />
          <input
            name="p" type="password" placeholder="Passcode" autoComplete="current-password" aria-label="Sync passcode"
            className="h-8 w-28 rounded-md border border-black/15 bg-transparent px-2 text-sm dark:border-white/20"
          />
          <button type="submit" className="h-8 rounded-md bg-orange-600 px-2 text-xs text-white hover:bg-orange-700" aria-label="Submit passcode">
            Unlock
          </button>
        </form>
        {err && (
          <span role="alert" className="absolute right-0 top-full z-50 mt-1 whitespace-nowrap rounded-md bg-red-100 px-2 py-1 text-xs text-red-800 shadow dark:bg-red-900/60 dark:text-red-200">
            {err}
          </span>
        )}
      </div>
    )
  }
  return (
    <span title={text} className={`flex items-center gap-1 text-xs ${warn ? 'text-orange-600' : 'text-emerald-700 dark:text-emerald-400'}`}>
      {warn ? <CloudOff size={16} /> : <Cloud size={16} />}
      <span className="hidden max-w-56 truncate md:inline">{text}</span>
    </span>
  )
}

export default function App() {
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  useShortcuts(() => setShortcutsOpen(true))
  useUrlModeSync()
  useEffect(() => startSync(), [])
  useEffect(() => { installBridge() }, [])
  const mode = useUi((s) => s.mode)
  const setMode = useUi((s) => s.setMode)
  const tool = useUi((s) => s.tool)
  const setTool = useUi((s) => s.setTool)
  const layers = useUi((s) => s.layers)
  const canUndo = useStore(useDoc.temporal, (s) => s.pastStates.length > 0)
  const canRedo = useStore(useDoc.temporal, (s) => s.futureStates.length > 0)
  // #11: sidebar open by default on wide screens; an overlay drawer below 768 px.
  const [sidebarOpen, setSidebarOpen] = useState(() => typeof window === 'undefined' || window.innerWidth >= 768)

  const btn = 'flex h-9 items-center gap-1 rounded-md px-2 text-sm hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-40 disabled:hover:bg-transparent'

  return (
    <div className="flex h-full flex-col">
      {mode === 'edit' && (
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-black/10 bg-white px-3 dark:border-white/10 dark:bg-[#1b2128]">
          <ProjectTitleButton />
          <div className="flex-1" />
          <SyncBadge />
          <button
            className={btn} title="Undo (Ctrl+Z)" aria-label="Undo"
            disabled={!canUndo} onClick={() => useDoc.temporal.getState().undo()}
          >
            <Undo2 size={16} />
          </button>
          <button
            className={btn} title="Redo (Ctrl+Shift+Z)" aria-label="Redo"
            disabled={!canRedo} onClick={() => useDoc.temporal.getState().redo()}
          >
            <Redo2 size={16} />
          </button>
          <SnapPopover />
          <ThemeToggle />
          <button
            className={btn} title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts"
            aria-haspopup="dialog" onClick={() => setShortcutsOpen(true)}
          >
            <Keyboard size={16} />
          </button>
          <button
            className={btn} title="Toggle sidebar" aria-label="Toggle sidebar" aria-pressed={sidebarOpen}
            onClick={() => setSidebarOpen((o) => !o)}
          >
            {sidebarOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
          </button>
          <button
            className={`${btn} border border-black/10 dark:border-white/10`}
            aria-label="Switch to Measuring Mode"
            onClick={() => setMode(mode === 'edit' ? 'measure' : 'edit')}
          >
            <Smartphone size={16} /> <span className="hidden lg:inline">Measuring Mode</span>
          </button>
        </header>
      )}

      {mode === 'measure' ? (
        // #8: no app header in Measuring Mode — the measure feature renders its own.
        <div className="min-h-0 flex-1 overflow-auto"><MeasureMode /></div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <nav className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-black/10 bg-white py-2 dark:border-white/10 dark:bg-[#1b2128]" aria-label="Tools">
            {TOOLS.map(({ id, label, key, icon: Icon }) => (
              <button
                key={id}
                title={`${label} (${key.toUpperCase()})`}
                aria-label={label}
                aria-pressed={tool === id}
                data-tool={id}
                onClick={() => setTool(id)}
                className={`flex h-9 w-9 items-center justify-center rounded-md ${tool === id ? 'bg-orange-600 text-white' : 'hover:bg-black/5 dark:hover:bg-white/10'}`}
              >
                <Icon size={18} />
              </button>
            ))}
          </nav>
          <main className="relative min-w-0 flex-1">
            <Viewport overlay={<ToolOverlay />}>
              <CanvasGrid />
              {layers.background && <BackgroundLayer />}
              <RoomsLayer />
              {layers.openings && <ElementsLayer />}
              {layers.notes && <AnnotationsLayer />}
            </Viewport>
            <EmptyState />
            <ZoomControls />
            <ToolHints />
          </main>
          {sidebarOpen && (
            <div className="fixed inset-0 z-30 bg-black/40 md:hidden" aria-hidden="true" onClick={() => setSidebarOpen(false)} />
          )}
          <aside
            className={`${sidebarOpen ? 'flex' : 'hidden'} w-72 shrink-0 flex-col gap-3 overflow-y-auto border-l border-black/10 bg-white p-3 dark:border-white/10 dark:bg-[#1b2128] max-md:fixed max-md:inset-y-0 max-md:right-0 max-md:z-40 max-md:shadow-2xl`}
            aria-label="Side panel"
          >
            <BackgroundPanel />
            <RoomsPanel />
            <ElementsPanel />
            <TapePanel />
            <PinPanel />
            <LayerToggles />
            <CalculatorsPanel />
            <ExportPanel />
          </aside>
        </div>
      )}
      <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  )
}
