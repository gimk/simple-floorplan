// Left panel of Views mode: camera presets, live PNG export and the saved views of the active artboard.
// No Three.js import: the 3D work goes through the View3DHandle, so the lazy 3D chunk stays separate.
import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { Camera, ClipboardCopy, Download, ImageDown, Pencil, RefreshCw, Trash2 } from 'lucide-react'
import { newId } from '../../model/schema'
import { useDoc } from '../../model/store'
import type { Artboard, SavedView, WallViewMode } from '../../model/types'
import { BTN, BTN_PRIMARY, EmptyHint, IconButton, INPUT, PanelSection, SelectField } from '../../shell/panel'
import { useUi } from '../../shell/uiStore'
import { toast, undoToast } from '../toast'
import type { CameraPreset, CameraSnapshot, View3DHandle } from './cameraPresets'
import { copyView3DPng, downloadView3DPng } from './exportPng'

const PRESETS: { preset: CameraPreset; label: string; title: string }[] = [
  { preset: 'fit', label: 'Fit', title: 'Fit the whole plan (R)' },
  { preset: 'top', label: 'Top', title: 'Top view' },
  { preset: 'iso-ne', label: 'NE', title: 'Isometric from the north-east' },
  { preset: 'iso-nw', label: 'NW', title: 'Isometric from the north-west' },
  { preset: 'iso-se', label: 'SE', title: 'Isometric from the south-east' },
  { preset: 'iso-sw', label: 'SW', title: 'Isometric from the south-west' },
]

const WALL_BADGE: Record<WallViewMode, string> = { off: 'Off', cutaway: 'Back', on: 'On' }

type Props = { handleRef: RefObject<View3DHandle | null> }

const THUMB_DEBOUNCE_MS = 300
const THUMB_RETRY_MS = 400
const THUMB_MAX_RETRIES = 25

/** Everything that changes how a saved view looks from its own data. */
const cameraKey = (v: SavedView) => JSON.stringify([v.position, v.target, v.fov, v.projection, v.wallMode])

/**
 * In-memory preview of each saved view (blob URLs, never stored in the document).
 * Renders one at a time through the 3D handle, debounced when the scene changes, and revokes every URL it replaces.
 */
function useViewThumbnails(handleRef: RefObject<View3DHandle | null>, artboard: Artboard | undefined, views: SavedView[]) {
  const backdrop = useUi((s) => s.viewBackdrop)
  const shadows = useUi((s) => s.viewShadows)
  const [urls, setUrls] = useState<Record<string, string>>({})
  const cache = useRef(new Map<string, { key: string; url: string }>())
  const [sceneVersion, setSceneVersion] = useState(0)
  const [retry, setRetry] = useState(0)

  // Scene change = any artboard field other than `views` has a new identity (structural sharing keeps the rest equal).
  const prevArtboard = useRef<Artboard | undefined>(undefined)
  useEffect(() => {
    const prev = prevArtboard.current
    prevArtboard.current = artboard
    if (!prev || !artboard) return
    const keys = new Set([...Object.keys(prev), ...Object.keys(artboard)])
    for (const k of keys) {
      if (k === 'views') continue
      if ((prev as Record<string, unknown>)[k] !== (artboard as Record<string, unknown>)[k]) { setSceneVersion((n) => n + 1); return }
    }
  }, [artboard])

  const signature = views.map((v) => `${v.id}:${cameraKey(v)}`).join('|')
  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const store = cache.current
    const sceneKey = `${sceneVersion}|${backdrop}|${shadows}`

    // Drop thumbnails of deleted views.
    const live = new Set(views.map((v) => v.id))
    let removed = false
    for (const [id, entry] of store) {
      if (!live.has(id)) { URL.revokeObjectURL(entry.url); store.delete(id); removed = true }
    }
    if (removed) setUrls(Object.fromEntries([...store].map(([id, e]) => [id, e.url])))

    const pending = views.filter((v) => store.get(v.id)?.key !== `${cameraKey(v)}|${sceneKey}`)
    if (pending.length === 0) return
    const run = async () => {
      const handle = handleRef.current
      if (!handle) {
        // The lazy 3D chunk is not mounted yet: try again shortly.
        if (retry < THUMB_MAX_RETRIES) timer = setTimeout(() => { if (!cancelled) setRetry((n) => n + 1) }, THUMB_RETRY_MS)
        return
      }
      for (const v of pending) {
        if (cancelled) return
        const snap: CameraSnapshot = { position: v.position, target: v.target, fov: v.fov ?? 45, projection: v.projection ?? 'perspective', wallMode: v.wallMode }
        let url: string | null = null
        try { url = await handle.captureThumbnail(snap) } catch { url = null }
        if (!url) continue
        if (cancelled) { URL.revokeObjectURL(url); return }
        const old = store.get(v.id)
        if (old) URL.revokeObjectURL(old.url)
        store.set(v.id, { key: `${cameraKey(v)}|${sceneKey}`, url })
        setUrls(Object.fromEntries([...store].map(([id, e]) => [id, e.url])))
      }
    }
    timer = setTimeout(() => { void run() }, THUMB_DEBOUNCE_MS)
    return () => { cancelled = true; if (timer) clearTimeout(timer) }
    // `views` is covered by `signature` (and the ids it lists).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, sceneVersion, backdrop, shadows, retry, handleRef])

  useEffect(() => {
    const store = cache.current
    return () => { for (const e of store.values()) URL.revokeObjectURL(e.url); store.clear() }
  }, [])

  return urls
}

export function ViewsPanel({ handleRef }: Props) {
  const activeId = useUi((s) => s.activeArtboardId)
  const setUi = useUi((s) => s.set)
  const artboards = useDoc((s) => s.doc.artboards)
  const artboard = artboards.find((a) => a.id === activeId) ?? artboards[0]
  const views = artboard?.views ?? []
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const thumbs = useViewThumbnails(handleRef, artboard, views)
  // Set when Enter or Escape ends a rename, so the blur caused by the input unmounting does not run it a second time.
  const renameDoneRef = useRef(false)

  const patchViews = (fn: (views: SavedView[]) => SavedView[]) => {
    if (!artboard) return
    const id = artboard.id
    useDoc.getState().update((d) => {
      const a = d.artboards.find((x) => x.id === id)
      if (a) a.views = fn(a.views ?? [])
    })
  }

  const liveName = `${artboard?.name || 'Plan'} 3D view`

  /** Run one PNG export at a time; a second click during the async work is ignored. */
  const runExport = async (view: SavedView | undefined, copy: boolean, name: string) => {
    if (busy) return
    setBusy(true)
    try {
      const blob = await handleRef.current?.capturePngBlob(view ? { view } : undefined)
      if (!blob) { toast('The 3D view is not ready', { kind: 'error' }); return }
      if (copy) await copyView3DPng(blob)
      else downloadView3DPng(blob, name)
    } catch (err) {
      toast(`Export failed: ${err instanceof Error ? err.message : String(err)}`, { kind: 'error' })
    } finally {
      setBusy(false)
    }
  }
  const exportLive = (copy: boolean) => runExport(undefined, copy, liveName)
  const exportSaved = (view: SavedView, copy: boolean) => runExport(view, copy, `${artboard?.name ?? ''} ${view.name}`)

  const saveCurrent = () => {
    const snap = handleRef.current?.getSnapshot()
    if (!snap) { toast('The 3D view is not ready', { kind: 'error' }); return }
    const name = `View ${views.length + 1}`
    patchViews((list) => [...list, { id: newId(), name, ...snap }])
    toast(`Saved "${name}"`, { kind: 'success' })
  }

  const updateCamera = (view: SavedView) => {
    const snap = handleRef.current?.getSnapshot()
    if (!snap) return
    patchViews((list) => list.map((v) => (v.id === view.id ? { ...v, ...snap } : v)))
    toast(`Updated "${view.name}"`, { kind: 'success' })
  }

  const remove = (view: SavedView) => {
    patchViews((list) => list.filter((v) => v.id !== view.id))
    undoToast(`Deleted "${view.name}"`, () => useDoc.getState().undo())
  }

  const commitRename = (view: SavedView) => {
    if (renameDoneRef.current) return
    renameDoneRef.current = true
    const name = draft.trim()
    setEditingId(null)
    if (name && name !== view.name) patchViews((list) => list.map((v) => (v.id === view.id ? { ...v, name } : v)))
  }

  return (
    <>
      {artboards.length > 1 && artboard && (
        <PanelSection title="Artboard" icon={<Camera size={14} aria-hidden="true" />}>
          <SelectField
            ariaLabel="Artboard"
            value={artboard.id}
            options={artboards.map((a) => ({ value: a.id, label: a.name || 'Artboard' }))}
            onChange={(id) => { setEditingId(null); setUi({ activeArtboardId: id }) }}
          />
        </PanelSection>
      )}
      <PanelSection title="Camera" icon={<Camera size={14} aria-hidden="true" />} description="Fly to a standard angle">
        <div className="grid grid-cols-3 gap-1.5" data-testid="camera-presets">
          {PRESETS.map((p) => (
            <button
              key={p.preset}
              type="button"
              title={p.title}
              aria-label={p.title}
              data-testid={`camera-preset-${p.preset}`}
              className={BTN}
              onClick={() => handleRef.current?.applyPreset(p.preset)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <button type="button" className={BTN} data-testid="export-png-live" disabled={busy} aria-busy={busy} onClick={() => void exportLive(false)}>
            <Download size={14} aria-hidden="true" /> Export PNG
          </button>
          <button type="button" className={BTN} data-testid="copy-png-live" disabled={busy} aria-busy={busy} onClick={() => void exportLive(true)}>
            <ClipboardCopy size={14} aria-hidden="true" /> Copy PNG
          </button>
        </div>
      </PanelSection>
      <PanelSection title="Saved Views" icon={<ImageDown size={14} aria-hidden="true" />} description="Camera angles of this artboard">
        <button type="button" className={BTN_PRIMARY} data-testid="save-view" onClick={saveCurrent}>
          <Camera size={14} aria-hidden="true" /> Save current view
        </button>
        {views.length === 0 ? (
          <EmptyHint>No saved view yet. Move the camera, then save it.</EmptyHint>
        ) : (
          <ul className="flex flex-col gap-2" data-testid="saved-views">
            {views.map((v) => (
              <li key={v.id} data-testid="saved-view" className="rounded-md border border-white/10 bg-white/5 p-2">
                <div className="flex items-center gap-1">
                  {editingId === v.id ? (
                    <input
                      autoFocus
                      aria-label={`Rename ${v.name}`}
                      value={draft}
                      maxLength={60}
                      className={`${INPUT} min-w-0 flex-1`}
                      onChange={(e) => setDraft(e.target.value)}
                      onBlur={() => commitRename(v)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); commitRename(v) }
                        else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); renameDoneRef.current = true; setEditingId(null) }
                      }}
                    />
                  ) : (
                    <>
                      <button
                        type="button"
                        title={`Go to ${v.name}`}
                        aria-label={`Go to ${v.name}`}
                        className="min-w-0 flex-1 truncate rounded px-1 py-1.5 text-left text-sm text-slate-100 hover:bg-white/10"
                        onClick={() => handleRef.current?.flyTo(v)}
                      >
                        {v.name}
                      </button>
                      <span
                        className="shrink-0 rounded bg-white/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-300"
                        title={`Walls: ${WALL_BADGE[v.wallMode]}`}
                        data-testid="saved-view-walls"
                      >
                        {WALL_BADGE[v.wallMode]}
                      </span>
                      <IconButton
                        label={`Rename ${v.name}`}
                        icon={<Pencil size={14} aria-hidden="true" />}
                        onClick={() => { setDraft(v.name); renameDoneRef.current = false; setEditingId(v.id) }}
                      />
                    </>
                  )}
                </div>
                <div
                  className="mt-1.5 aspect-video w-full overflow-hidden rounded bg-white/5"
                  data-testid="saved-view-thumb"
                  aria-hidden="true"
                >
                  {thumbs[v.id] ? (
                    <img src={thumbs[v.id]} alt="" draggable={false} className="h-full w-full object-cover" />
                  ) : (
                    <div className="h-full w-full animate-pulse bg-white/5" />
                  )}
                </div>
                <div className="mt-1 flex items-center justify-end gap-0.5">
                  <IconButton label={`Update camera of ${v.name}`} icon={<RefreshCw size={14} aria-hidden="true" />} onClick={() => updateCamera(v)} />
                  <IconButton label={`Download PNG of ${v.name}`} icon={<Download size={14} aria-hidden="true" />} onClick={() => void exportSaved(v, false)} />
                  <IconButton label={`Copy PNG of ${v.name}`} icon={<ClipboardCopy size={14} aria-hidden="true" />} onClick={() => void exportSaved(v, true)} />
                  <IconButton label={`Delete ${v.name}`} variant="danger" icon={<Trash2 size={14} aria-hidden="true" />} onClick={() => remove(v)} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </PanelSection>
    </>
  )
}
