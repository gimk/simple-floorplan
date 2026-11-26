// v2 shell: top bar (title, mode, undo/redo, JSON export/import, add image), left panel,
// SVG canvas (grid, reference images, artboard frames), right Inspect panel.
import { useEffect, useRef, useState } from 'react'
import { Download, ImagePlus, Redo2, Undo2, Upload } from 'lucide-react'
import { useStore } from 'zustand'
import { Viewport } from './canvas/Viewport'
import { ArtboardInspect, ArtboardsLayer } from './features/artboards'
import { CalibrateOverlay } from './features/background/CalibrateOverlay'
import { RefImageInspect } from './features/background/RefImageInspect'
import { RefImagesLayer } from './features/background/RefImagesLayer'
import { loadRefImageFile } from './features/background/upload'
import { ToastHost, toast } from './features/toast'
import { useDoc } from './model/store'
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
  const title = useDoc((s) => s.doc.title)
  const canUndo = useStore(useDoc.temporal, (s) => s.pastStates.length > 0)
  const canRedo = useStore(useDoc.temporal, (s) => s.futureStates.length > 0)
  const fileRef = useRef<HTMLInputElement>(null)
  const imageRef = useRef<HTMLInputElement>(null)
  const [dropping, setDropping] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isEditable(e.target)) return
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) useDoc.getState().redo()
        else useDoc.getState().undo()
        return
      }
      // Delete / Backspace removes the selected reference image in Plan mode.
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const ui = useUi.getState()
      if (ui.mode !== 'plan' || ui.tool === 'calibrate-image' || ui.selection.kind !== 'refImage') return
      e.preventDefault()
      useDoc.getState().deleteRefImage(ui.selection.imageId)
      useUi.getState().set({ selection: { kind: 'none' }, calibratingImageId: null })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

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
          onChange={(m) => setUi({ mode: m as Mode })}
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
          <button type="button" className={BAR_BTN} aria-label="Redo" title="Redo (Cmd/Ctrl+Shift+Z)" disabled={!canRedo} onClick={() => useDoc.getState().redo()}><Redo2 size={18} /></button>
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
        <aside aria-label="Left panel" data-testid="left-panel" className="hidden w-60 shrink-0 border-r border-white/10 bg-[#161b21] p-3 text-sm text-zinc-400 md:block">
          {mode === 'plan' ? 'Rooms and artboards' : 'Furniture'}
        </aside>
        <main
          data-testid="canvas-container"
          className={`relative min-w-0 flex-1 ${dropping ? 'ring-2 ring-orange-500/70 ring-inset' : ''}`}
          onDragOver={onDragOver}
          onDragLeave={() => setDropping(false)}
          onDrop={onDrop}
        >
          <Viewport overlay={<CalibrateOverlay />}>
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
          </Viewport>
          <div className="pointer-events-none absolute bottom-3 left-3">
            <ZoomControls />
          </div>
        </main>
        <aside aria-label="Inspect" data-testid="inspect-panel" className="hidden w-70 shrink-0 border-l border-white/10 bg-[#161b21] p-3 text-sm text-zinc-400 lg:block">
          {selection.kind === 'refImage' ? (
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
