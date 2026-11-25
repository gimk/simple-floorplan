// App shell. OWNER: lead (integration). Feature agents: do not edit; ask for changes in your result file.
import { useEffect, useRef, useState } from 'react'
import { useStore } from 'zustand'
import {
  Keyboard, MoreVertical, PanelRightClose, PanelRightOpen, Search,
  Undo2, Redo2, Smartphone, Monitor, Cloud, CloudOff, KeyRound,
} from 'lucide-react'
import { getSyncState, setPasscode, startSync, useSyncState, useSyncStatusText } from './sync/sync'
import { Viewport } from './canvas/Viewport'
import { useDoc, useUi } from './model/store'
import { BackgroundLayer, CalibrateTool } from './features/background'
import { MakeRoomTool, RoomsLayer, RoomTools, TracesLayer, WallTool } from './features/rooms'
import { WallsLayer } from './features/rooms/WallsLayer'
import { RoomsOverlay } from './features/rooms/RoomsOverlay'
import { OutsideDimsLayer } from './features/rooms/outside/OutsideDimsLayer'
import { ElementsLayer, PlaceElementTool } from './features/elements'
import { PlaceStorageTool } from './features/storage/PlaceStorageTool'
import { MeasureMode, MeasurePanel } from './features/measure'
import { ProjectTitleButton, UpdateToast } from './features/projects'
import { AnnotationsLayer, PinTool, TapeTool } from './features/annotations'
import { selectAnnot, useAnnotSel } from './features/annotations/selection'
import { ClashLayer } from './features/clearance'
import { ToastHost } from './features/toast'
import { ConversionNotice } from './features/apartment'
import { CanvasGrid } from './shell/CanvasGrid'
import { EmptyState } from './shell/EmptyState'
import { ZoomControls } from './shell/ZoomControls'
import { ViewMenu } from './shell/view/ViewMenu'
import { ToolHints } from './shell/ToolHints'
import { SnapPopover } from './shell/SnapPopover'
import { ShortcutsDialog } from './shell/ShortcutsDialog'
import { CommandPalette } from './shell/CommandPalette'
import { toggleAllSnap } from './shell/commands'
import { TOOLS } from './shell/tools'
import { Sidebar } from './shell/sidebar/Sidebar'
import { parentSelection } from './shell/sidebar/trail'
import { installBridge } from './shell/bridge'
import { fitToDoc } from './shell/fit'
import { initTheme } from './shell/theme'
import { useIsDesktop } from './shell/useDesktop'

initTheme()

function ToolOverlay() {
  const tool = useUi((s) => s.tool)
  switch (tool) {
    case 'select': case 'rect': case 'polygon': case 'slice': case 'cutout': {
      const T = RoomTools[tool]; return <T />
    }
    case 'wall': return <WallTool />
    case 'make-room': return <MakeRoomTool />
    case 'place-element': return <PlaceElementTool />
    case 'place-storage': return <PlaceStorageTool />
    case 'calibrate': return <CalibrateTool />
    case 'tape': return <TapeTool />
    case 'pin': return <PinTool />
    default: return null
  }
}

function useShortcuts(onHelp: () => void, onPalette: () => void) {
  const helpRef = useRef(onHelp)
  const paletteRef = useRef(onPalette)
  useEffect(() => { helpRef.current = onHelp; paletteRef.current = onPalette }, [onHelp, onPalette])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      // Cmd/Ctrl+K opens the command palette from anywhere, like in other editors (the field of
      // the palette is a text field, so this check is before the one below).
      if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); paletteRef.current(); return }
      const t = e.target as HTMLElement
      // Text controls keep native Cmd/Ctrl+Z and keystrokes; checkboxes and switches do not.
      if (t.closest('textarea, select, [contenteditable], input:not([type="checkbox"]):not([type="radio"])')) return
      if (e.key === '?') { e.preventDefault(); helpRef.current(); return }
      const ui = useUi.getState()
      if (ui.mode !== 'edit') return
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        const tmp = useDoc.temporal.getState()
        if (e.shiftKey) tmp.redo(); else tmp.undo()
        return
      }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); useDoc.temporal.getState().redo(); return }
      // #13: a tool that cancelled in-progress points preventDefault()s Escape — leave it alone.
      if (e.key === 'Escape') {
        if (e.defaultPrevented) return
        // A drawing tool goes back to Select first, and keeps the selection.
        if (ui.tool !== 'select') { ui.setTool('select'); return }
        // Esc goes up one level (wall / vertex / element -> room, room -> nothing, tape / pin -> room).
        // `ui.select` also clears a Shift + click group.
        const step = parentSelection(useDoc.getState().doc, ui.selection, useAnnotSel.getState().sel)
        if (step.kind === 'none') return
        if (step.clearAnnot) selectAnnot(null)
        ui.select(step.selection)
        return
      }
      // Shift+P: every snapping off, or back to the set before (docs/measurements-plan.md 7).
      if (!mod && !e.altKey && e.shiftKey && e.key.toLowerCase() === 'p') { e.preventDefault(); toggleAllSnap(); return }
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

function SyncBadge() {
  const s = useSyncState()
  const { text, warn } = useSyncStatusText()
  const [checking, setChecking] = useState(false)
  const [err, setErr] = useState('')
  const [showStatus, setShowStatus] = useState(false)
  const badgeRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (s.conn !== 'locked') { setErr(''); setChecking(false) }
  }, [s.conn])

  useEffect(() => {
    if (!showStatus) return
    const onDown = (e: MouseEvent) => {
      if (badgeRef.current && !badgeRef.current.contains(e.target as Node)) setShowStatus(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [showStatus])

  if (s.conn === 'locked') {
    return (
      <div className="relative">
        <form
          className="flex items-center gap-1"
          onSubmit={async (e) => {
            e.preventDefault()
            const v = new FormData(e.currentTarget).get('p')
            if (!v || checking) return
            setErr('')
            setChecking(true)
            await setPasscode(String(v))
            setChecking(false)
            // If still locked after connect() resolved, the passcode was rejected.
            if (getSyncState().conn === 'locked') setErr('Passcode rejected — still locked.')
          }}
        >
          <KeyRound size={16} className="shrink-0 text-orange-700 dark:text-orange-400" />
          <input
            name="p" type="password" placeholder="Passcode" autoComplete="current-password" aria-label="Sync passcode"
            className="h-8 w-24 rounded-md border border-black/15 bg-transparent px-2 text-sm sm:w-28 dark:border-white/20"
          />
          <button type="submit" disabled={checking} className="h-8 rounded-md bg-orange-700 px-2 text-xs text-white hover:bg-orange-800 disabled:opacity-50" aria-label="Submit passcode">
            {checking ? '…' : 'Unlock'}
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
    <div className="relative" ref={badgeRef}>
      <button
        type="button"
        title={text}
        aria-label={text}
        onClick={() => setShowStatus((v) => !v)}
        className={`flex h-9 items-center gap-1 rounded-md px-1.5 text-xs hover:bg-black/5 dark:hover:bg-white/10 ${warn ? 'text-orange-700 dark:text-orange-400' : 'text-emerald-700 dark:text-emerald-400'}`}
      >
        {warn ? <CloudOff size={16} /> : <Cloud size={16} />}
        <span className="hidden max-w-56 truncate md:inline">{text}</span>
      </button>
      {showStatus && (
        <div role="status" className="absolute right-0 top-full z-50 mt-1 whitespace-nowrap rounded-md border border-black/10 bg-white px-2.5 py-1.5 text-xs shadow-lg md:hidden dark:border-white/15 dark:bg-[#1b2128]">
          {text}
        </div>
      )}
    </div>
  )
}

export default function App() {
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const moreRef = useRef<HTMLDivElement>(null)
  const shortcutsBtnRef = useRef<HTMLButtonElement>(null)
  const moreBtnRef = useRef<HTMLButtonElement>(null)
  const shortcutsReturnFocusRef = useRef<HTMLElement | null>(null)
  useShortcuts(
    () => {
      const active = document.activeElement
      const headerOpener = shortcutsBtnRef.current?.offsetParent ? shortcutsBtnRef.current : moreBtnRef.current
      shortcutsReturnFocusRef.current =
        active instanceof HTMLElement && active !== document.body ? active : headerOpener
      setShortcutsOpen(true)
    },
    // Cmd/Ctrl+K. The palette keeps the element to focus when it closes.
    () => setPaletteOpen(true),
  )
  useUrlModeSync()
  useEffect(() => startSync(), [])
  useEffect(() => { installBridge() }, [])
  const mode = useUi((s) => s.mode)
  // Desktop: Measuring Mode keeps the editor layout and only the right panel changes.
  const isDesktop = useIsDesktop()
  const measureDesktop = mode === 'measure' && isDesktop
  const setMode = useUi((s) => s.setMode)
  const tool = useUi((s) => s.tool)
  const setTool = useUi((s) => s.setTool)
  const layers = useUi((s) => s.layers)
  const canUndo = useStore(useDoc.temporal, (s) => s.pastStates.length > 0)
  const canRedo = useStore(useDoc.temporal, (s) => s.futureStates.length > 0)
  // #11: sidebar open by default on wide screens; an overlay drawer below 768 px.
  const [sidebarOpen, setSidebarOpen] = useState(() => typeof window === 'undefined' || window.innerWidth >= 768)
  const inspectorOpenTick = useUi((s) => s.inspectorOpenTick)
  useEffect(() => {
    if (inspectorOpenTick > 0 && !isDesktop && mode === 'edit') setSidebarOpen(true)
  }, [inspectorOpenTick, isDesktop, mode])
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(min-width: 768px)')
    const onChange = (e: MediaQueryListEvent) => setSidebarOpen(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  useEffect(() => {
    if (!moreOpen) return
    const onDown = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setMoreOpen(false) }
    }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey, true)
    return () => { document.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey, true) }
  }, [moreOpen])

  const btn = 'flex h-9 items-center gap-1 rounded-md px-2 text-sm hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-40 disabled:hover:bg-transparent'

  return (
    <div className="flex h-full flex-col">
      {(mode === 'edit' || measureDesktop) && (
        <header className="flex h-12 shrink-0 items-center gap-1 border-b border-black/10 bg-white px-2 sm:gap-2 sm:px-3 dark:border-white/10 dark:bg-[#1b2128]">
          <div className="min-w-0 flex-1">
            <ProjectTitleButton />
          </div>
          <SyncBadge />
          <button
            className={btn} title="Undo (Ctrl/Cmd+Z)" aria-label="Undo"
            disabled={!canUndo} onClick={() => useDoc.temporal.getState().undo()}
          >
            <Undo2 size={16} />
          </button>
          <button
            className={btn} title="Redo (Ctrl/Cmd+Shift+Z)" aria-label="Redo"
            disabled={!canRedo} onClick={() => useDoc.temporal.getState().redo()}
          >
            <Redo2 size={16} />
          </button>
          <SnapPopover />
          <div className="hidden items-center gap-1 sm:flex">
            <button
              ref={shortcutsBtnRef}
              className={btn} title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts"
              aria-haspopup="dialog" onClick={() => { shortcutsReturnFocusRef.current = shortcutsBtnRef.current; setShortcutsOpen(true) }}
            >
              <Keyboard size={16} />
            </button>
          </div>
          <div className="relative sm:hidden" ref={moreRef}>
            <button
              ref={moreBtnRef}
              type="button"
              className={btn}
              aria-label="More options"
              aria-expanded={moreOpen}
              aria-haspopup="menu"
              onClick={() => setMoreOpen((o) => !o)}
            >
              <MoreVertical size={16} />
            </button>
            {moreOpen && (
              <div className="absolute right-0 top-full z-50 mt-1 flex flex-col gap-1 rounded-lg border border-black/10 bg-white p-1.5 shadow-lg dark:border-white/15 dark:bg-[#1b2128]">
                <button
                  type="button"
                  className={btn}
                  onClick={() => { setMoreOpen(false); setPaletteOpen(true) }}
                >
                  <Search size={16} /> <span>Commands</span>
                </button>
                <button
                  type="button"
                  className={btn}
                  onClick={() => { shortcutsReturnFocusRef.current = moreBtnRef.current; setMoreOpen(false); setShortcutsOpen(true) }}
                >
                  <Keyboard size={16} /> <span>Shortcuts</span>
                </button>
              </div>
            )}
          </div>
          <button
            className={btn} title="Toggle sidebar" aria-label="Toggle sidebar" aria-pressed={sidebarOpen}
            onClick={() => setSidebarOpen((o) => !o)}
          >
            {sidebarOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
          </button>
          <button
            className={`${btn} border border-black/10 dark:border-white/10`}
            aria-label={measureDesktop ? 'Exit Measuring Mode' : 'Switch to Measuring Mode'}
            onClick={() => setMode(mode === 'edit' ? 'measure' : 'edit')}
          >
            {measureDesktop ? <Monitor size={16} /> : <Smartphone size={16} />}{' '}
            <span className="hidden lg:inline">{measureDesktop ? 'Exit Measuring Mode' : 'Measuring Mode'}</span>
          </button>
        </header>
      )}

      {mode === 'measure' && !isDesktop ? (
        // Phones: no app header in Measuring Mode, the measure feature renders its own.
        <div className="min-h-0 flex-1 overflow-auto"><MeasureMode /></div>
      ) : (
        <div className="flex min-h-0 flex-1">
          {!measureDesktop && (
          <nav className="flex w-12 shrink-0 flex-col items-center gap-1 overflow-y-auto border-r border-black/10 bg-white py-2 max-md:w-13 dark:border-white/10 dark:bg-[#1b2128]" aria-label="Tools">
            {TOOLS.map(({ id, label, key, icon: Icon }) => (
              <button
                key={id}
                title={`${label} (${key.toUpperCase()})`}
                aria-label={label}
                aria-pressed={tool === id}
                data-tool={id}
                onClick={() => setTool(id)}
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md max-md:h-11 max-md:w-11 ${tool === id ? 'bg-orange-700 text-white' : 'hover:bg-black/5 dark:hover:bg-white/10'}`}
              >
                <Icon size={18} />
              </button>
            ))}
          </nav>
          )}
          <main className="relative min-w-0 flex-1">
            <Viewport overlay={measureDesktop ? null : <ToolOverlay />}>
              <CanvasGrid />
              {layers.background && <BackgroundLayer />}
              <RoomsLayer />
              {/* Walls drawn once from the wall graph (v2 documents), above the room floors. */}
              <WallsLayer />
              {/* Room labels, dimensions, wall numbers, hover highlights, the side lines of the
                  selected wall and the inline name editor: ABOVE the walls, so an opaque wall band
                  never hides them (UI review F1). */}
              <RoomsOverlay />
              {layers.outsideDims && <OutsideDimsLayer />}
              {/* Traced walls of the Wall tool: always shown, above the rooms (phase 6). */}
              <TracesLayer />
              {layers.clashes && <ClashLayer />}
              <ElementsLayer />
              {layers.notes && <AnnotationsLayer />}
            </Viewport>
            <EmptyState />
            <div className="pointer-events-none absolute inset-x-3 bottom-3 z-10 flex flex-wrap-reverse items-end gap-2 max-md:inset-x-2">
              <ZoomControls />
              <ViewMenu />
              <ToolHints />
            </div>
          </main>
          {sidebarOpen && !measureDesktop && (
            <div className="fixed inset-0 z-30 bg-black/40 md:hidden" aria-hidden="true" onClick={() => setSidebarOpen(false)} />
          )}
          <aside
            className={`${sidebarOpen || measureDesktop ? 'flex' : 'hidden'} ${measureDesktop ? 'w-[400px]' : 'w-80'} shrink-0 flex-col gap-3 overflow-y-auto border-l border-black/10 bg-white p-3 dark:border-white/10 dark:bg-[#1b2128] max-md:fixed max-md:inset-y-0 max-md:right-0 max-md:z-40 max-md:shadow-2xl`}
            aria-label="Side panel"
          >
            {measureDesktop ? <MeasurePanel /> : <Sidebar />}
          </aside>
        </div>
      )}
      <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} returnFocusTo={shortcutsReturnFocusRef} />
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onOpenShortcuts={() => setShortcutsOpen(true)}
      />
      <ToastHost />
      {/* Conversion report toast in every mode (phones open in Measuring Mode). */}
      <ConversionNotice />
      <UpdateToast />
    </div>
  )
}
