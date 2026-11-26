// v2 shell: top bar (title, mode, undo/redo, JSON export/import, add image), left panel,
// SVG canvas (grid, reference images, artboard frames), right Inspect panel.
import { useEffect, useRef, useState } from 'react'
import { Download, ImagePlus, Redo2, Undo2, Upload } from 'lucide-react'
import { useStore } from 'zustand'
import { Viewport } from './canvas/Viewport'
import { ArtboardContent, ArtboardInspect, ArtboardsLayer } from './features/artboards'
import { CalibrateOverlay } from './features/background/CalibrateOverlay'
import { RefImageInspect } from './features/background/RefImageInspect'
import { RefImagesLayer } from './features/background/RefImagesLayer'
import { loadRefImageFile } from './features/background/upload'
import { deleteOpening } from './features/openings/actions'
import { ObjectsPanel } from './features/openings/ObjectsPanel'
import { OpeningInspect } from './features/openings/OpeningInspect'
import { OpeningsLayer } from './features/openings/OpeningsLayer'
import { PlaceOpeningOverlay } from './features/openings/PlaceOpeningOverlay'
import { deleteRooms } from './features/rooms/actions'
import { PlanToolbar } from './features/rooms/PlanToolbar'
import { RoomInspect } from './features/rooms/RoomInspect'
import { RoomsLayer, type EditWallRequest } from './features/rooms/RoomsLayer'
import { RoomToolsOverlay } from './features/rooms/RoomToolsOverlay'
import { WallInspect } from './features/rooms/WallInspect'
import { WallLengthEditor } from './features/rooms/WallLengthEditor'
import { ToastHost, toast } from './features/toast'
import { useDoc } from './model/store'
import type { Selection } from './model/types'
import { CanvasGrid } from './shell/CanvasGrid'
import { Segmented } from './shell/panel'
import { initTheme } from './shell/theme'
import { useUi, type Mode } from './shell/uiStore'
import { ZoomControls } from './shell/ZoomControls'
import { exportProjectJson, importProjectJson } from './sync/jsonFile'

initTheme()

const MODES: { value: Mode; label: string }[] = [
  { value: 'plan', label: 'Plan' },
  { value: 'design', label: 'Design' },
]

const BAR_BTN = 'flex h-9 items-center justify-center rounded-md text-zinc-300 hover:bg-white/10 disabled:opacity-40'

const isEditable = (t: EventTarget | null) => {
  const el = t as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
}

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
  // Wall-length editor request + the selection object that opened it (see `wallEditor` below).
  const [editWall, setEditWall] = useState<{ req: EditWallRequest; openedWith: Selection } | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isEditable(e.target)) return
      // Undo: Cmd/Ctrl+Z. Redo: Cmd/Ctrl+Shift+Z, or Ctrl+Y on Windows/Linux.
      const key = e.key.toLowerCase()
      if ((e.metaKey || e.ctrlKey) && !e.altKey && (key === 'z' || key === 'y')) {
        e.preventDefault()
        if (key === 'y' || e.shiftKey) useDoc.getState().redo()
        else useDoc.getState().undo()
        return
      }
      // Delete / Backspace removes the selected opening, reference image or rooms in Plan mode.
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const ui = useUi.getState()
      if (ui.mode !== 'plan' || ui.tool === 'calibrate-image') return
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
      if (sel.kind === 'room' && sel.roomIds.length > 0) {
        e.preventDefault()
        deleteRooms(sel.artboardId, sel.roomIds)
        useUi.getState().set({ selection: { kind: 'none' } })
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
    if (mode !== 'plan') return
    e.dataTransfer.dropEffect = 'copy'
    setDropping(true)
  }
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDropping(false)
    if (mode !== 'plan') return
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
        : selection.kind === 'opening'
          ? !!artboards
              .find((a) => a.id === selection.artboardId)
              ?.openings.some((o) => o.id === selection.openingId)
          : selection.kind === 'refImage'
            ? refImages.some((i) => i.id === selection.imageId)
            : true

  /**
   * The wall-length input only lives while the selection that opened it is still current, and only
   * in Plan mode with the select tool: any other mode, tool or selection closes it at once (no
   * stale input floats over the plan, and no setState-in-effect is needed to clear it).
   */
  const wallEditor =
    editWall && mode === 'plan' && tool === 'select' && editWall.openedWith === selection ? editWall.req : null

  return (
    <div className="flex h-full flex-col bg-[#12161b] text-zinc-100">
      <header className="grid h-12 shrink-0 grid-cols-[1fr_auto_1fr] items-center border-b border-white/10 bg-[#161b21] px-3">
        <input
          aria-label="Project title"
          data-testid="project-title"
          value={title}
          onChange={(e) => useDoc.getState().setTitle(e.target.value)}
          className="h-8 w-full max-w-64 rounded-md bg-transparent px-2 text-sm font-semibold hover:bg-white/5 focus:bg-white/10 focus:outline-none"
        />
        <Segmented
          ariaLabel="Mode"
          value={mode}
          options={MODES}
          onChange={(m) => {
            const next = m as Mode
            // Design mode has none of the Plan-mode placement tools: drop their state.
            setUi(
              next === 'design'
                ? {
                    mode: next,
                    tool: 'select',
                    selection: { kind: 'none' },
                    placingOpeningKind: null,
                    calibratingImageId: null,
                  }
                : { mode: next },
            )
          }}
          className="w-44"
        />
        <div className="flex justify-end gap-1">
          {mode === 'plan' && (
            <button
              type="button"
              className={`${BAR_BTN} gap-1.5 px-2 text-xs`}
              aria-label="Add reference image"
              title="Add reference image (PNG, JPG, WebP, SVG, PDF)"
              onClick={() => imageRef.current?.click()}
            >
              <ImagePlus size={18} />
              <span className="hidden sm:inline">Add image</span>
            </button>
          )}
          <input
            ref={imageRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml,application/pdf,.png,.jpg,.jpeg,.webp,.svg,.pdf"
            multiple
            className="hidden"
            data-testid="add-ref-image"
            onChange={(e) => { void addRefImages(e.target.files); e.target.value = '' }}
          />
          <button type="button" className={BAR_BTN} aria-label="Undo" title="Undo (Cmd/Ctrl+Z)" disabled={!canUndo} onClick={() => useDoc.getState().undo()}><Undo2 size={18} /></button>
          <button type="button" className={BAR_BTN} aria-label="Redo" title="Redo (Cmd/Ctrl+Shift+Z or Ctrl+Y)" disabled={!canRedo} onClick={() => useDoc.getState().redo()}><Redo2 size={18} /></button>
          <button type="button" className={BAR_BTN} aria-label="Export JSON" title="Export JSON" onClick={() => exportProjectJson(useDoc.getState().doc)}><Download size={18} /></button>
          <button type="button" className={BAR_BTN} aria-label="Import JSON" title="Import JSON" onClick={() => fileRef.current?.click()}><Upload size={18} /></button>
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
        <aside aria-label="Left panel" data-testid="left-panel" className="hidden w-60 shrink-0 overflow-y-auto border-r border-white/10 bg-[#161b21] p-3 text-sm text-zinc-400 md:block">
          {mode === 'plan' ? (
            <ObjectsPanel onUploadImage={() => imageRef.current?.click()} />
          ) : (
            <p>Furniture — Phase 4</p>
          )}
        </aside>
        <main
          data-testid="canvas-container"
          className={`relative min-w-0 flex-1 ${dropping ? 'ring-2 ring-orange-500/70 ring-inset' : ''}`}
          onDragOver={onDragOver}
          onDragLeave={() => setDropping(false)}
          onDrop={onDrop}
        >
          <Viewport
            overlay={
              <>
                <CalibrateOverlay key={calibratingImageId ?? 'none'} />
                <RoomToolsOverlay />
                <PlaceOpeningOverlay />
              </>
            }
          >
            {tool === 'select' && (
              <rect
                data-testid="canvas-background"
                x={-1e6}
                y={-1e6}
                width={2e6}
                height={2e6}
                fill="transparent"
                onPointerDown={() => useUi.getState().set({ selection: { kind: 'none' } })}
              />
            )}
            <CanvasGrid />
            <RefImagesLayer />
            <ArtboardsLayer />
            {artboards.map((a) => (
              <ArtboardContent key={a.id} artboard={a}>
                <RoomsLayer
                  artboard={a}
                  onEditWall={(req) => setEditWall({ req, openedWith: useUi.getState().selection })}
                />
                <OpeningsLayer artboard={a} />
              </ArtboardContent>
            ))}
          </Viewport>
          <div className="pointer-events-none absolute bottom-3 left-3">
            <ZoomControls />
          </div>
          <PlanToolbar />
          {wallEditor && (
            <WallLengthEditor {...wallEditor} onClose={() => setEditWall(null)} />
          )}
        </main>
        <aside aria-label="Inspect" data-testid="inspect-panel" className="hidden w-70 shrink-0 border-l border-white/10 bg-[#161b21] p-3 text-sm text-zinc-400 lg:block">
          {mode === 'design' ? (
            // Design mode edits nothing geometric: the artboard card is read-only here.
            <ArtboardInspect artboardId={activeArtboardId} readOnly />
          ) : selection.kind === 'room' && selectionExists ? (
            <RoomInspect artboardId={selection.artboardId} roomIds={selection.roomIds} />
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
      <ToastHost />
    </div>
  )
}
