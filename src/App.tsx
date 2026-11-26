// v2 shell: top bar (title, mode, undo/redo, JSON export/import, add image), left panel,
// SVG canvas (grid, reference images, artboard frames), right Inspect panel.
import { useEffect, useRef, useState } from 'react'
import { Download, Ellipsis, ImagePlus, Keyboard, PanelLeft, PanelRight, Pencil, Redo2, Undo2, Upload, X } from 'lucide-react'
import { useStore } from 'zustand'
import { Viewport } from './canvas/Viewport'
import { ArtboardContent, ArtboardInspect, ArtboardsLayer } from './features/artboards'
import { CalibrateOverlay } from './features/background/CalibrateOverlay'
import { RefImageInspect } from './features/background/RefImageInspect'
import { RefImagesLayer } from './features/background/RefImagesLayer'
import { loadRefImageFile } from './features/background/upload'
import { deleteFurniture, duplicateFurniture, reorderFurniture } from './features/furniture/actions'
import { DesignRoomInspect } from './features/furniture/DesignRoomInspect'
import { FurnitureInspect } from './features/furniture/FurnitureInspect'
import { FurnitureLayer } from './features/furniture/FurnitureLayer'
import { FurniturePanel } from './features/furniture/FurniturePanel'
import { deleteOpening } from './features/openings/actions'
import { ObjectsPanel } from './features/openings/ObjectsPanel'
import { OpeningInspect } from './features/openings/OpeningInspect'
import { OpeningsLayer } from './features/openings/OpeningsLayer'
import { PlaceOpeningOverlay } from './features/openings/PlaceOpeningOverlay'
import { CanvasSelectLayer, MarqueeOverlay } from './features/rooms/CanvasSelectLayer'
import { deleteRoomVertex, deleteRoomWall, deleteRooms } from './features/rooms/actions'
import { PlanToolbar } from './features/rooms/PlanToolbar'
import { RoomInspect } from './features/rooms/RoomInspect'
import { RoomsLayer, type EditWallRequest } from './features/rooms/RoomsLayer'
import { RoomToolsOverlay } from './features/rooms/RoomToolsOverlay'
import { WallInspect } from './features/rooms/WallInspect'
import { WallLengthEditor } from './features/rooms/WallLengthEditor'
import { TapeOverlay } from './features/tape/TapeOverlay'
import { toast, undoShortcut } from './features/toast'
import { ToastHost } from './features/toast/ToastHost'
import { selectRoom } from './features/artboards/selection'
import { useDoc } from './model/store'
import type { Selection } from './model/types'
import { CanvasGrid } from './shell/CanvasGrid'
import { IconButton, Segmented } from './shell/panel'
import { initTheme } from './shell/theme'
import { useUi, type Mode } from './shell/uiStore'
import { useMediaQuery } from './shell/useDesktop'
import { ZoomControls } from './shell/ZoomControls'
import { fitAll, zoomIn, zoomOut, zoomReset } from './shell/zoom'
import { CloudMenu } from './sync/CloudMenu'
import { exportProjectJson, importProjectJson } from './sync/jsonFile'

initTheme()

const MODES: { value: Mode; label: string; title: string }[] = [
  { value: 'plan', label: 'Plan', title: 'Plan (1)' },
  { value: 'design', label: 'Design', title: 'Design (2)' },
]

/** Text button of the top bar (Add image). 36 px high, 44 px on a coarse pointer. */
const BAR_BTN =
  'flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-md border border-white/10 bg-surface-2 px-2 text-xs text-slate-200 hover:bg-white/10 disabled:opacity-40 disabled:hover:bg-surface-2 pointer-coarse:h-11'

/** Thin divider between the groups of the top bar. */
const DIVIDER = <div className="mx-1 hidden h-5 w-px bg-white/15 md:block" aria-hidden="true" />

const isMac = undoShortcut() === '⌘Z'
const REDO_KEYS = isMac ? '⌘⇧Z' : 'Ctrl+Y'

const isEditable = (t: EventTarget | null) => {
  const el = t as HTMLElement | null
  return (
    !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
  )
}

const SHORTCUTS: { group: string; rows: [string, string][] }[] = [
  {
    group: 'General',
    rows: [
      ['Undo', undoShortcut()],
      ['Redo', REDO_KEYS],
      ['Plan / Design mode', '1 / 2'],
      ['Close panel or dialog', 'Esc'],
      ['This cheat sheet', '?'],
    ],
  },
  {
    group: 'Tools',
    rows: [
      ['Select', 'V'],
      ['Rectangle', 'R'],
      ['Pen', 'P'],
      ['Cutout', 'X'],
      ['Tape measure', 'M'],
    ],
  },
  {
    group: 'View',
    rows: [
      ['Zoom in', '+'],
      ['Zoom out', '-'],
      ['Zoom to 100%', '0'],
      ['Fit all', 'F or Shift+1'],
    ],
  },
  {
    group: 'Edit',
    rows: [
      ['Delete selection', 'Del'],
      ['Duplicate', isMac ? '⌘D' : 'Ctrl+D'],
      ['Furniture back / front', '[ / ]'],
    ],
  },
]

/** Cheat-sheet modal for the keyboard shortcuts. Closes with Esc (global handler), the button or the backdrop. */
function ShortcutsModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" data-testid="shortcuts-modal">
      <button type="button" aria-label="Close keyboard shortcuts" tabIndex={-1} className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        className="relative max-h-full w-full max-w-md overflow-y-auto rounded-xl border border-white/10 bg-surface-2 p-4 text-sm text-slate-200 shadow-2xl"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-100">Keyboard shortcuts</h2>
          <IconButton label="Close" icon={<X size={16} />} onClick={onClose} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {SHORTCUTS.map((g) => (
            <section key={g.group}>
              <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{g.group}</h3>
              <dl className="space-y-1">
                {g.rows.map(([what, keys]) => (
                  <div key={what} className="flex items-center justify-between gap-3">
                    <dt className="text-slate-300">{what}</dt>
                    <dd>
                      <kbd className="rounded border border-white/15 bg-white/5 px-1.5 py-0.5 font-mono text-xs text-slate-100">{keys}</kbd>
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}

/**
 * UI state of a mode switch, shared by the Mode control and the plain '1' / '2' shortcuts.
 * Design mode has none of the Plan-mode placement tools, so their state is dropped; Plan mode drops
 * a Design-mode furniture selection, because nothing in Plan mode can edit a furniture item (the
 * Inspect panel would keep an empty column and Delete would hit furniture from a locked plan).
 */
const modeUiPatch = (mode: Mode, selection: Selection) =>
  mode === 'design'
    ? {
        mode,
        tool: 'select' as const,
        selection: { kind: 'none' } as Selection,
        placingOpeningKind: null,
        calibratingImageId: null,
      }
    : { mode, ...(selection.kind === 'furniture' ? { selection: { kind: 'none' } as Selection } : {}) }

const key0 = (e: KeyboardEvent) => e.key.toLowerCase()

/** World point (cm) at the centre of the visible canvas. */
const canvasCenterWorld = () => {
  const svg = document.querySelector<SVGSVGElement>('svg[data-testid="floorplan-canvas"]')
  const v = useUi.getState().view
  const w = svg?.clientWidth || 800
  const h = svg?.clientHeight || 600
  return { x: v.x + w / 2 / v.zoom, y: v.y + h / 2 / v.zoom }
}

export default function App() {
  const mode = useUi((s) => s.mode)
  const tool = useUi((s) => s.tool)
  const setUi = useUi((s) => s.set)
  const selection = useUi((s) => s.selection)
  const activeArtboardId = useUi((s) => s.activeArtboardId)
  const calibratingImageId = useUi((s) => s.calibratingImageId)
  const refImages = useDoc((s) => s.doc.refImages)
  const title = useDoc((s) => s.doc.title)
  const artboards = useDoc((s) => s.doc.artboards)
  const canUndo = useStore(useDoc.temporal, (s) => s.pastStates.length > 0)
  const canRedo = useStore(useDoc.temporal, (s) => s.futureStates.length > 0)
  const fileRef = useRef<HTMLInputElement>(null)
  const imageRef = useRef<HTMLInputElement>(null)
  const [dropping, setDropping] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const moreRef = useRef<HTMLDivElement>(null)
  const drawer = useUi((s) => s.drawer)
  const leftCollapsed = useUi((s) => s.leftCollapsed)
  const inspectCollapsed = useUi((s) => s.inspectCollapsed)
  const shortcutsOpen = useUi((s) => s.shortcutsOpen)
  const isMd = useMediaQuery('(min-width: 768px)')
  const isLg = useMediaQuery('(min-width: 1024px)')
  // Wall-length editor request + the selection object that opened it (see `wallEditor` below).
  const [editWall, setEditWall] = useState<{ req: EditWallRequest; openedWith: Selection } | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isEditable(e.target)) return
      const plain = !e.metaKey && !e.ctrlKey && !e.altKey
      // Escape closes the cheat sheet first, then an open panel drawer / bottom sheet.
      if (e.key === 'Escape') {
        const ui = useUi.getState()
        if (ui.shortcutsOpen) {
          e.preventDefault()
          ui.set({ shortcutsOpen: false })
          return
        }
        if (ui.drawer) {
          e.preventDefault()
          ui.set({ drawer: null })
          return
        }
      }
      // '?' toggles the keyboard shortcuts cheat sheet.
      if (plain && e.key === '?') {
        e.preventDefault()
        useUi.getState().set({ shortcutsOpen: !useUi.getState().shortcutsOpen })
        return
      }
      // Zoom: + / = in, - out, 0 = 100%, F or Shift+1 = fit all.
      if (plain && (e.key === '+' || e.key === '=')) { e.preventDefault(); zoomIn(); return }
      if (plain && (e.key === '-' || e.key === '_')) { e.preventDefault(); zoomOut(); return }
      if (plain && e.key === '0') { e.preventDefault(); zoomReset(); return }
      if (plain && (key0(e) === 'f' || (e.shiftKey && e.code === 'Digit1'))) { e.preventDefault(); fitAll(); return }
      // Undo: Cmd/Ctrl+Z. Redo: Cmd/Ctrl+Shift+Z, or Ctrl+Y on Windows/Linux.
      const key = e.key.toLowerCase()
      if ((e.metaKey || e.ctrlKey) && !e.altKey && (key === 'z' || key === 'y')) {
        e.preventDefault()
        if (key === 'y' || e.shiftKey) useDoc.getState().redo()
        else useDoc.getState().undo()
        return
      }
      // Plain '1' / '2' switch the mode (same state reset as the Mode control).
      if ((key === '1' || key === '2') && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        const ui = useUi.getState()
        ui.set(modeUiPatch(key === '1' ? 'plan' : 'design', ui.selection))
        return
      }
      // Plain 'm' toggles the quick Tape measure in both modes; in Design mode 'v' leaves it.
      if (!e.metaKey && !e.ctrlKey && !e.altKey && (key === 'm' || key === 'v')) {
        const ui = useUi.getState()
        if (key === 'm') {
          e.preventDefault()
          ui.set({ tool: ui.tool === 'tape' ? 'select' : 'tape' })
          return
        }
        if (ui.mode === 'design' && ui.tool === 'tape') {
          e.preventDefault()
          ui.set({ tool: 'select' })
          return
        }
      }
      // Cmd/Ctrl+D duplicates the selected item: furniture in Design mode, the artboard in Plan mode.
      if ((e.metaKey || e.ctrlKey) && key === 'd' && !e.altKey && !e.shiftKey) {
        const ui = useUi.getState()
        if (ui.mode === 'design' && ui.selection.kind === 'furniture') {
          e.preventDefault()
          duplicateFurniture(ui.selection.artboardId, ui.selection.furnitureId)
        } else if (ui.mode === 'plan' && ui.selection.kind === 'artboard') {
          e.preventDefault()
          const copyId = useDoc.getState().duplicateArtboard(ui.selection.artboardId)
          if (copyId) {
            useUi.getState().set({
              activeArtboardId: copyId,
              selection: { kind: 'artboard', artboardId: copyId },
            })
          }
        }
        return
      }
      // Cmd/Ctrl+[ / ] send the selected furniture to the back / front; [ and ] step it once.
      if (!e.altKey && (e.key === '[' || e.key === ']')) {
        const ui = useUi.getState()
        if (ui.mode === 'design' && ui.selection.kind === 'furniture') {
          e.preventDefault()
          const op =
            e.key === '['
              ? e.metaKey || e.ctrlKey
                ? 'back'
                : 'backward'
              : e.metaKey || e.ctrlKey
                ? 'front'
                : 'forward'
          reorderFurniture(ui.selection.artboardId, ui.selection.furnitureId, op)
          return
        }
      }
      // Delete / Backspace removes the selected opening, reference image, furniture or rooms.
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const ui = useUi.getState()
      // Design mode: only furniture can be deleted (the room geometry is locked).
      if (ui.mode === 'design') {
        if (ui.selection.kind === 'furniture') {
          e.preventDefault()
          deleteFurniture(ui.selection.artboardId, ui.selection.furnitureId)
        }
        return
      }
      if (ui.tool === 'calibrate-image') return
      const sel = ui.selection
      if (sel.kind === 'refImage') {
        e.preventDefault()
        useDoc.getState().deleteRefImage(sel.imageId)
        useUi.getState().set({ selection: { kind: 'none' }, calibratingImageId: null })
        return
      }
      if (sel.kind === 'opening') {
        e.preventDefault()
        deleteOpening(sel.artboardId, sel.openingId)
        useUi.getState().set({ selection: { kind: 'none' } })
        return
      }
      if (sel.kind === 'vertex') {
        e.preventDefault()
        if (deleteRoomVertex(sel.artboardId, sel.roomId, sel.vertexIndex)) selectRoom(sel.artboardId, sel.roomId)
        else toast('A room needs at least 3 points')
        return
      }
      if (sel.kind === 'wall') {
        e.preventDefault()
        if (deleteRoomWall(sel.artboardId, sel.roomId, sel.edgeIndex)) selectRoom(sel.artboardId, sel.roomId)
        else toast('A room needs at least 3 walls')
        return
      }
      if (sel.kind === 'room' && sel.roomIds.length > 0) {
        e.preventDefault()
        deleteRooms(sel.artboardId, sel.roomIds)
        useUi.getState().set({ selection: { kind: 'none' } })
        return
      }
      // An artboard delete keeps at least one artboard; the first remaining one becomes active.
      if (sel.kind === 'artboard') {
        if (useDoc.getState().doc.artboards.length <= 1) return
        e.preventDefault()
        useDoc.getState().deleteArtboard(sel.artboardId)
        const next = useDoc.getState().doc.artboards[0]
        if (next) useUi.getState().set({ activeArtboardId: next.id, selection: { kind: 'artboard', artboardId: next.id } })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // B7: a "calibrating image" id that outlives its tool would re-open the overlay with the old
  // 2 points on the next calibration. Clear it as soon as the tool leaves 'calibrate-image'.
  useEffect(() => {
    if (tool !== 'calibrate-image' && calibratingImageId) useUi.getState().set({ calibratingImageId: null })
  }, [tool, calibratingImageId])

  // Close the overflow menu on Escape or a press outside it.
  useEffect(() => {
    if (!moreOpen) return
    const onDown = (e: PointerEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMoreOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [moreOpen])

  // A drawer / bottom sheet gets out of the way once the user picks a tool to work on the canvas.
  useEffect(() => {
    if (tool !== 'select' && useUi.getState().drawer === 'left') useUi.getState().set({ drawer: null })
  }, [tool])

  const onImport = async (file: File | undefined) => {
    if (!file) return
    const r = await importProjectJson(file)
    if (r.ok) {
      useDoc.getState().hydrate(r.doc)
      setUi({ activeArtboardId: null, selection: { kind: 'none' } })
      toast(`Imported "${r.doc.title}"`)
    } else toast(`Import failed: ${r.error}`)
  }

  /** Load every dropped/picked file as a reference image and select the last one. */
  const addRefImages = async (files: FileList | null) => {
    const list = files ? [...files] : []
    if (list.length === 0) return
    const center = canvasCenterWorld()
    for (const file of list) {
      try {
        const img = await loadRefImageFile(file, center)
        useDoc.getState().addRefImage(img)
        useUi.getState().set({ selection: { kind: 'refImage', imageId: img.id } })
        toast(`Added reference image "${img.name}"`)
      } catch (err) {
        toast(`Could not add "${file.name}": ${err instanceof Error ? err.message : 'unknown error'}`)
      }
    }
  }

  // Drop a PNG/JPG/WebP/SVG or a PDF page on the canvas (Plan mode only).
  const onDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return
    // Always swallow the file drag: otherwise the browser opens the file by itself.
    e.preventDefault()
    // 'copy' in both modes, so the drop event fires and Design mode can explain why nothing was added.
    e.dataTransfer.dropEffect = 'copy'
    setDropping(true)
  }
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDropping(false)
    if (mode !== 'plan') {
      toast('Reference images can only be added in Plan mode. Press 1 to switch.')
      return
    }
    void addRefImages(e.dataTransfer.files)
  }

  /**
   * True while the room, wall or opening of the selection still exists. A deleted item (or an undo
   * of its creation) leaves a stale selection: the Inspect panel then falls back to the artboard card
   * instead of showing an empty column.
   */
  const selectionExists =
    selection.kind === 'room'
      ? !!artboards
          .find((a) => a.id === selection.artboardId)
          ?.rooms.some((r) => selection.roomIds.includes(r.id))
      : selection.kind === 'wall'
        ? !!artboards
            .find((a) => a.id === selection.artboardId)
            ?.rooms.some((r) => r.id === selection.roomId && selection.edgeIndex < r.vertices.length)
        : selection.kind === 'vertex'
          ? !!artboards
              .find((a) => a.id === selection.artboardId)
              ?.rooms.some((r) => r.id === selection.roomId && selection.vertexIndex < r.vertices.length)
        : selection.kind === 'opening'
          ? !!artboards
              .find((a) => a.id === selection.artboardId)
              ?.openings.some((o) => o.id === selection.openingId)
          : selection.kind === 'refImage'
            ? refImages.some((i) => i.id === selection.imageId)
            : selection.kind === 'furniture'
              ? !!artboards
                  .find((a) => a.id === selection.artboardId)
                  ?.furniture.some((f) => f.id === selection.furnitureId)
              : true

  /**
   * The wall-length input only lives while the selection that opened it is still current, and only
   * in Plan mode with the select tool: any other mode, tool or selection closes it at once (no
   * stale input floats over the plan, and no setState-in-effect is needed to clear it).
   */
  const wallEditor =
    editWall && mode === 'plan' && tool === 'select' && editWall.openedWith === selection ? editWall.req : null

  const leftInline = isMd && !leftCollapsed
  const inspectInline = isLg && !inspectCollapsed
  const leftSheet = !isMd && drawer === 'left'
  const inspectSheet = !isLg && drawer === 'inspect'
  const closeDrawer = () => setUi({ drawer: null })
  const hasSelection = selection.kind !== 'none' && selectionExists
  const leftName = mode === 'plan' ? 'Objects panel' : 'Furniture panel'
  const leftShown = isMd ? !leftCollapsed : drawer === 'left'
  const inspectShown = isLg ? !inspectCollapsed : drawer === 'inspect'
  const toggleLeft = () => (isMd ? setUi({ leftCollapsed: !leftCollapsed }) : setUi({ drawer: drawer === 'left' ? null : 'left' }))
  const toggleInspect = () =>
    isLg ? setUi({ inspectCollapsed: !inspectCollapsed }) : setUi({ drawer: drawer === 'inspect' ? null : 'inspect' })

  /** Phone: bottom sheet. Tablet: Inspect slides over from the right. */
  const sheetClass = () =>
    isMd
      ? 'fixed bottom-0 right-0 top-12 z-50 w-72 max-w-[85vw] border-l border-white/10 shadow-2xl'
      : `fixed inset-x-0 bottom-0 z-50 max-h-[75dvh] rounded-t-xl border-t border-white/10 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-2xl`
  const asideBase = 'space-y-3 overflow-y-auto bg-surface-1 p-3 text-sm text-slate-400'
  const sheetHeader = (name: string) => (
    <div className="-mt-1 flex items-center justify-between">
      <h2 className="text-sm font-semibold text-slate-100">{name}</h2>
      <IconButton label={`Close ${name.toLowerCase()}`} icon={<X size={16} />} onClick={closeDrawer} />
    </div>
  )

  const moreItem =
    'flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-sm text-slate-200 hover:bg-white/10 disabled:opacity-40 disabled:hover:bg-transparent pointer-coarse:h-11'

  return (
    <div className="flex h-dvh flex-col bg-surface-0 text-zinc-100">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-white/10 bg-surface-1 px-3">
        <div className="group relative flex min-w-0 flex-1 basis-0 items-center">
          <input
            aria-label="Project title"
            data-testid="project-title"
            placeholder="Untitled plan"
            value={title}
            onChange={(e) => useDoc.getState().setTitle(e.target.value)}
            className="h-8 w-full max-w-64 min-w-0 truncate rounded-t-md border-b border-transparent bg-transparent px-2 text-sm font-semibold placeholder:font-normal placeholder:text-slate-500 hover:border-white/30 hover:bg-white/5 focus:border-orange-500 focus:bg-white/10 pointer-coarse:h-11"
          />
          <Pencil size={12} aria-hidden="true" className="pointer-events-none -ml-5 shrink-0 text-slate-400 opacity-0 transition-opacity group-hover:opacity-70 group-focus-within:opacity-0 max-md:hidden" />
        </div>
        <Segmented
          ariaLabel="Mode"
          value={mode}
          options={MODES}
          onChange={(m) => {
            // Design mode drops the Plan-mode placement tools; Plan mode drops a furniture selection.
            setUi(modeUiPatch(m as Mode, selection))
          }}
          className="w-44 shrink-0 max-md:w-32"
        />
        <div className="flex shrink-0 items-center justify-end gap-1 lg:flex-1 lg:basis-0">
          <button
            type="button"
            className={`${BAR_BTN} max-md:hidden`}
            aria-label="Add reference image"
            title={mode === 'plan' ? 'Add reference image (PNG, JPG, WebP, SVG, PDF)' : 'Switch to Plan mode (1) to add reference images'}
            disabled={mode !== 'plan'}
            onClick={() => imageRef.current?.click()}
          >
            <ImagePlus size={18} />
            <span className="hidden lg:inline">Add image</span>
          </button>
          {DIVIDER}
          <IconButton label={`Undo (${undoShortcut()})`} variant="bar" icon={<Undo2 size={18} />} disabled={!canUndo} onClick={() => useDoc.getState().undo()} />
          <IconButton label={`Redo (${REDO_KEYS})`} variant="bar" icon={<Redo2 size={18} />} disabled={!canRedo} onClick={() => useDoc.getState().redo()} />
          {DIVIDER}
          <div className="flex items-center gap-1 max-md:hidden">
            <IconButton label="Export JSON" variant="bar" icon={<Download size={18} />} onClick={() => exportProjectJson(useDoc.getState().doc)} />
            <IconButton label="Import JSON" variant="bar" icon={<Upload size={18} />} onClick={() => fileRef.current?.click()} />
          </div>
          {DIVIDER}
          <div className="max-md:hidden">
            <CloudMenu />
          </div>
          <div className="max-lg:hidden">
            <IconButton label="Keyboard shortcuts (?)" variant="bar" icon={<Keyboard size={18} />} onClick={() => setUi({ shortcutsOpen: true })} />
          </div>
          <div ref={moreRef} className="relative md:hidden">
            <IconButton label="More actions" variant="bar" icon={<Ellipsis size={18} />} pressed={moreOpen} onClick={() => setMoreOpen((o) => !o)} />
            {moreOpen && (
              <div
                role="menu"
                aria-label="More actions"
                className="absolute right-0 top-full z-50 mt-1 w-56 max-w-[calc(100vw-1rem)] rounded-lg border border-white/10 bg-surface-2 p-1 shadow-xl"
              >
                <button
                  type="button"
                  role="menuitem"
                  className={moreItem}
                  disabled={mode !== 'plan'}
                  title={mode === 'plan' ? undefined : 'Switch to Plan mode to add reference images'}
                  onClick={() => { setMoreOpen(false); imageRef.current?.click() }}
                >
                  <ImagePlus size={18} aria-hidden="true" /> Add image
                </button>
                <button type="button" role="menuitem" className={moreItem} onClick={() => { setMoreOpen(false); exportProjectJson(useDoc.getState().doc) }}>
                  <Download size={18} aria-hidden="true" /> Export JSON
                </button>
                <button type="button" role="menuitem" className={moreItem} onClick={() => { setMoreOpen(false); fileRef.current?.click() }}>
                  <Upload size={18} aria-hidden="true" /> Import JSON
                </button>
                <div className="my-1 border-t border-white/10" />
                <CloudMenu showLabel />
              </div>
            )}
          </div>
          <input
            ref={imageRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml,application/pdf,.png,.jpg,.jpeg,.webp,.svg,.pdf"
            multiple
            className="hidden"
            data-testid="add-ref-image"
            onChange={(e) => { void addRefImages(e.target.files); e.target.value = '' }}
          />
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            data-testid="import-json"
            onChange={(e) => { void onImport(e.target.files?.[0]); e.target.value = '' }}
          />
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        {(leftSheet || inspectSheet) && (
          <button type="button" aria-label="Close panel" tabIndex={-1} className="fixed inset-0 z-40 bg-black/50" onClick={closeDrawer} />
        )}
        <aside
          aria-label="Left panel"
          data-testid="left-panel"
          className={`${asideBase} ${leftInline ? 'w-60 shrink-0 border-r border-white/10' : leftSheet ? sheetClass() : 'hidden'}`}
        >
          {leftSheet && sheetHeader(leftName)}
          {mode === 'plan' ? (
            <ObjectsPanel onUploadImage={() => imageRef.current?.click()} />
          ) : (
            <FurniturePanel />
          )}
        </aside>
        <main
          data-testid="canvas-container"
          className={`relative min-w-0 flex-1 ${dropping ? 'ring-2 ring-orange-500/70 ring-inset' : ''}`}
          onDragOver={onDragOver}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropping(false)
          }}
          onDrop={onDrop}
        >
          <Viewport
            overlay={
              <>
                <CalibrateOverlay key={calibratingImageId ?? 'none'} />
                <RoomToolsOverlay />
                <PlaceOpeningOverlay />
                <TapeOverlay />
                <MarqueeOverlay />
              </>
            }
          >
            <CanvasSelectLayer />
            <CanvasGrid />
            <RefImagesLayer />
            <ArtboardsLayer />
            {artboards.map((a) => (
              <ArtboardContent key={a.id} artboard={a}>
                <RoomsLayer
                  artboard={a}
                  onEditWall={(req) => setEditWall({ req, openedWith: useUi.getState().selection })}
                />
                {/* Furniture sits above the floors; the 1 px opening arcs stay above both. */}
                <FurnitureLayer artboard={a} />
                <OpeningsLayer artboard={a} />
              </ArtboardContent>
            ))}
          </Viewport>
          <div className="pointer-events-none absolute left-2 top-2 z-30">
            <IconButton
              label={`${leftShown ? 'Hide' : 'Show'} ${leftName.toLowerCase()}`}
              variant="bar"
              icon={<PanelLeft size={18} />}
              pressed={leftShown}
              onClick={toggleLeft}
              className="pointer-events-auto"
            />
          </div>
          <div className="pointer-events-none absolute right-2 top-2 z-30">
            <IconButton
              label={`${inspectShown ? 'Hide' : 'Show'} inspect panel`}
              variant="bar"
              icon={
                <span className="relative flex">
                  <PanelRight size={18} />
                  {hasSelection && !inspectShown && (
                    <span data-testid="inspect-badge" className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-orange-500 ring-2 ring-surface-2" aria-hidden="true" />
                  )}
                </span>
              }
              pressed={inspectShown}
              onClick={toggleInspect}
              className="pointer-events-auto"
            />
          </div>
          <div className="pointer-events-none absolute bottom-3 left-3 max-md:bottom-[calc(4.75rem+env(safe-area-inset-bottom))]">
            <ZoomControls />
          </div>
          <PlanToolbar />
          {wallEditor && (
            <WallLengthEditor {...wallEditor} onClose={() => setEditWall(null)} />
          )}
          {dropping && (
            <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-black/40" data-testid="drop-overlay">
              <p className="rounded-xl border border-orange-500/60 bg-surface-2 px-5 py-3 text-center text-sm font-medium text-slate-100 shadow-xl">
                {mode === 'plan' ? 'Drop image to add as reference' : 'Reference images need Plan mode (press 1)'}
              </p>
            </div>
          )}
        </main>
        <aside
          aria-label="Inspect"
          data-testid="inspect-panel"
          className={`${asideBase} ${inspectInline ? 'w-70 shrink-0 border-l border-white/10' : inspectSheet ? sheetClass() : 'hidden'}`}
        >
          {inspectSheet && sheetHeader('Inspect')}
          {mode === 'design' ? (
            // Design mode edits no geometry: furniture and room floors only.
            selection.kind === 'furniture' && selectionExists ? (
              <FurnitureInspect artboardId={selection.artboardId} furnitureId={selection.furnitureId} />
            ) : selection.kind === 'room' && selectionExists && selection.roomIds.length > 0 ? (
              <DesignRoomInspect artboardId={selection.artboardId} roomId={selection.roomIds[0]} />
            ) : (
              <ArtboardInspect artboardId={selection.kind === 'artboard' ? selection.artboardId : activeArtboardId} readOnly />
            )
          ) : selection.kind === 'room' && selectionExists ? (
            <RoomInspect artboardId={selection.artboardId} roomIds={selection.roomIds} />
          ) : selection.kind === 'vertex' && selectionExists ? (
            <RoomInspect artboardId={selection.artboardId} roomIds={[selection.roomId]} />
          ) : selection.kind === 'wall' && selectionExists ? (
            <WallInspect artboardId={selection.artboardId} roomId={selection.roomId} edgeIndex={selection.edgeIndex} />
          ) : selection.kind === 'opening' && selectionExists ? (
            <OpeningInspect artboardId={selection.artboardId} openingId={selection.openingId} />
          ) : selection.kind === 'refImage' && selectionExists ? (
            <RefImageInspect imageId={selection.imageId} />
          ) : (
            <ArtboardInspect artboardId={selection.kind === 'artboard' ? selection.artboardId : activeArtboardId} />
          )}
        </aside>
      </div>
      {shortcutsOpen && <ShortcutsModal onClose={() => setUi({ shortcutsOpen: false })} />}
      <ToastHost />
    </div>
  )
}
