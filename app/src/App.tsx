// App shell. OWNER: lead (integration). Feature agents: do not edit; ask for changes in your result file.
import { useEffect } from 'react'
import {
  DoorOpen, Hand, Layers as LayersIcon, MousePointer2, PenTool, Ruler, Scissors, Square, SquareDashed,
  Undo2, Redo2, Smartphone, Monitor, Crosshair, Cloud, CloudOff, KeyRound,
} from 'lucide-react'
import { setPasscode, startSync, useSyncState, useSyncStatusText } from './sync/sync'
import { Viewport } from './canvas/Viewport'
import { useDoc, useUi, type Layers } from './model/store'
import type { ToolId } from './model/types'
import { BackgroundLayer, BackgroundPanel, CalibrateTool } from './features/background'
import { RoomsLayer, RoomsPanel, RoomTools } from './features/rooms'
import { ElementsLayer, ElementsPanel, PlaceElementTool } from './features/elements'
import { MeasureMode } from './features/measure'

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
]

function ToolOverlay() {
  const tool = useUi((s) => s.tool)
  switch (tool) {
    case 'select': case 'rect': case 'polygon': case 'slice': case 'cutout': {
      const T = RoomTools[tool]; return <T />
    }
    case 'place-element': return <PlaceElementTool />
    case 'calibrate': return <CalibrateTool />
    default: return null
  }
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, select, [contenteditable]')) return
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
      if (e.key === 'Escape') { ui.setTool('select'); ui.select(null); return }
      if (mod || e.altKey) return
      const tool = TOOLS.find((x) => x.key === e.key.toLowerCase())
      if (tool) ui.setTool(tool.id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
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
  if (s.conn === 'locked') {
    return (
      <form className="flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); const v = new FormData(e.currentTarget).get('p'); if (v) setPasscode(String(v)) }}>
        <KeyRound size={16} className="text-orange-600" />
        <input name="p" type="password" placeholder="Passcode" autoComplete="current-password" className="h-8 w-28 rounded-md border border-black/15 bg-transparent px-2 text-sm dark:border-white/20" />
      </form>
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
  useShortcuts()
  useEffect(() => startSync(), [])
  const mode = useUi((s) => s.mode)
  const setMode = useUi((s) => s.setMode)
  const tool = useUi((s) => s.tool)
  const setTool = useUi((s) => s.setTool)
  const title = useDoc((s) => s.doc.title)
  const layers = useUi((s) => s.layers)

  const btn = 'flex h-9 items-center gap-1 rounded-md px-2 text-sm hover:bg-black/5 dark:hover:bg-white/10'

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-black/10 bg-white px-3 dark:border-white/10 dark:bg-[#1b2128]">
        <h1 className="truncate font-semibold">{title}</h1>
        <div className="flex-1" />
        <SyncBadge />
        {mode === 'edit' && (
          <>
            <button className={btn} title="Undo (Ctrl+Z)" onClick={() => useDoc.temporal.getState().undo()}><Undo2 size={16} /></button>
            <button className={btn} title="Redo (Ctrl+Shift+Z)" onClick={() => useDoc.temporal.getState().redo()}><Redo2 size={16} /></button>
          </>
        )}
        <button className={`${btn} border border-black/10 dark:border-white/10`} onClick={() => setMode(mode === 'edit' ? 'measure' : 'edit')}>
          {mode === 'edit' ? <><Smartphone size={16} /> Measuring Mode</> : <><Monitor size={16} /> Edit Mode</>}
        </button>
      </header>

      {mode === 'measure' ? (
        <div className="min-h-0 flex-1 overflow-auto"><MeasureMode /></div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <nav className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-black/10 bg-white py-2 dark:border-white/10 dark:bg-[#1b2128]">
            {TOOLS.map(({ id, label, key, icon: Icon }) => (
              <button
                key={id}
                title={`${label} (${key.toUpperCase()})`}
                onClick={() => setTool(id)}
                className={`flex h-9 w-9 items-center justify-center rounded-md ${tool === id ? 'bg-orange-600 text-white' : 'hover:bg-black/5 dark:hover:bg-white/10'}`}
              >
                <Icon size={18} />
              </button>
            ))}
          </nav>
          <main className="relative min-w-0 flex-1">
            <Viewport overlay={<ToolOverlay />}>
              {layers.background && <BackgroundLayer />}
              <RoomsLayer />
              {layers.openings && <ElementsLayer />}
            </Viewport>
          </main>
          <aside className="flex w-72 shrink-0 flex-col gap-3 overflow-y-auto border-l border-black/10 bg-white p-3 dark:border-white/10 dark:bg-[#1b2128]">
            <BackgroundPanel />
            <RoomsPanel />
            <ElementsPanel />
            <LayerToggles />
          </aside>
        </div>
      )}
    </div>
  )
}
