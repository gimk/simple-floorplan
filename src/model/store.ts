// Document store: the ProjectDoc with undo/redo (zundo). One `update` = one undo step.
// Drags: beginDrag(), many updateSilent(), endDrag() = one undo step.
import { create, type StoreApi } from 'zustand'
import { temporal, type TemporalState } from 'zundo'
import { createArtboard, createDefaultProject, newId } from './schema'
import type { Artboard, ProjectDoc, RefImage } from './types'

type DocState = {
  doc: ProjectDoc
  /** Replace the doc and clear history (load / import). */
  hydrate: (doc: ProjectDoc) => void
  /** New empty project and clear history. */
  resetDoc: () => void
  /** Mutate a draft copy of the doc: one undo step. */
  update: (fn: (doc: ProjectDoc) => ProjectDoc | void) => void
  /** Same as update, but not recorded in history (use inside a drag). */
  updateSilent: (fn: (doc: ProjectDoc) => ProjectDoc | void) => void
  beginDrag: () => void
  endDrag: () => void
  setTitle: (title: string) => void
  addArtboard: () => string
  duplicateArtboard: (artboardId: string) => string | null
  deleteArtboard: (artboardId: string) => void
  addRefImage: (img: RefImage) => void
  updateRefImage: (id: string, patch: Partial<Omit<RefImage, 'id'>>) => void
  deleteRefImage: (id: string) => void
  undo: () => void
  redo: () => void
}

const clone = <T,>(v: T): T => structuredClone(v)

/** Apply fn to a deep copy; fn may mutate it or return a replacement. */
const apply = (doc: ProjectDoc, fn: (d: ProjectDoc) => ProjectDoc | void): ProjectDoc => {
  const copy = clone(doc)
  return fn(copy) ?? copy
}

/** Right edge of an artboard: its x plus the widest content (rooms), min 400 cm. */
export function artboardBounds(a: Artboard) {
  let maxX = 0, maxY = 0
  for (const r of a.rooms) for (const v of r.vertices) { maxX = Math.max(maxX, v.x); maxY = Math.max(maxY, v.y) }
  for (const o of a.openings) { maxX = Math.max(maxX, o.xCm); maxY = Math.max(maxY, o.yCm) }
  for (const f of a.furniture) { maxX = Math.max(maxX, f.xCm + f.widthCm / 2); maxY = Math.max(maxY, f.yCm + f.depthCm / 2) }
  return { minX: a.xCm, minY: a.yCm, maxX: a.xCm + Math.max(maxX, 400), maxY: a.yCm + Math.max(maxY, 300) }
}

/** Bounds of everything on the canvas: artboards (with rooms) and reference images. */
export function docBounds(doc: ProjectDoc) {
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  const grow = (x0: number, y0: number, x1: number, y1: number) => {
    b.minX = Math.min(b.minX, x0); b.minY = Math.min(b.minY, y0); b.maxX = Math.max(b.maxX, x1); b.maxY = Math.max(b.maxY, y1)
  }
  for (const a of doc.artboards) { const ab = artboardBounds(a); grow(ab.minX, ab.minY, ab.maxX, ab.maxY) }
  for (const i of doc.refImages) if (i.visible) grow(i.xCm, i.yCm, i.xCm + i.naturalWidth * i.cmPerPx, i.yCm + i.naturalHeight * i.cmPerPx)
  return b
}

export const ARTBOARD_GAP_CM = 150

const cloneArtboard = (src: Artboard, xCm: number, yCm: number): Artboard => {
  const c = clone(src)
  c.id = newId()
  c.name = `${src.name} (copy)`
  c.xCm = xCm
  c.yCm = yCm
  c.rooms.forEach((r) => { r.id = newId() })
  c.openings.forEach((o) => { o.id = newId() })
  c.furniture.forEach((f) => { f.id = newId() })
  return c
}

let dragSnapshot: ProjectDoc | null = null
// Set right after the store is created (avoids a circular type inside the initializer).
let hist: StoreApi<TemporalState<{ doc: ProjectDoc }>>

export const useDoc = create<DocState>()(
  temporal(
    (set, get) => ({
      doc: createDefaultProject(),
      hydrate: (doc) => {
        set({ doc })
        hist.getState().clear()
        dragSnapshot = null
      },
      resetDoc: () => get().hydrate(createDefaultProject()),
      update: (fn) => set((s) => ({ doc: apply(s.doc, fn) })),
      updateSilent: (fn) => {
        const t = hist.getState()
        const was = t.isTracking
        t.pause()
        set((s) => ({ doc: apply(s.doc, fn) }))
        if (was) t.resume()
      },
      beginDrag: () => {
        if (dragSnapshot) return
        dragSnapshot = get().doc
      },
      endDrag: () => {
        const before = dragSnapshot
        dragSnapshot = null
        if (!before || before === get().doc) return
        // Push the pre-drag state as one undo step.
        const t = hist
        t.setState((s) => ({ pastStates: [...s.pastStates, { doc: before }], futureStates: [] }))
      },
      setTitle: (title) => get().update((d) => { d.title = title }),
      addArtboard: () => {
        const id = newId()
        get().update((d) => {
          // An empty document has no right edge: put the first artboard at the origin.
          const right = d.artboards.length > 0
            ? Math.max(...d.artboards.map((a) => artboardBounds(a).maxX))
            : -ARTBOARD_GAP_CM
          const a = createArtboard(`Plan ${String.fromCharCode(65 + (d.artboards.length % 26))}`, right + ARTBOARD_GAP_CM, 0)
          a.id = id
          d.artboards.push(a)
        })
        return id
      },
      duplicateArtboard: (artboardId) => {
        const src = get().doc.artboards.find((a) => a.id === artboardId)
        if (!src) return null
        let newArtboardId = ''
        get().update((d) => {
          const s = d.artboards.find((a) => a.id === artboardId)!
          const c = cloneArtboard(s, artboardBounds(s).maxX + ARTBOARD_GAP_CM, s.yCm)
          newArtboardId = c.id
          d.artboards.push(c)
        })
        return newArtboardId
      },
      deleteArtboard: (artboardId) => {
        const d = get().doc
        if (d.artboards.length <= 1 || !d.artboards.some((a) => a.id === artboardId)) return
        get().update((doc) => { doc.artboards = doc.artboards.filter((a) => a.id !== artboardId) })
      },
      addRefImage: (img) => get().update((d) => { d.refImages.push(img) }),
      updateRefImage: (id, patch) => get().update((d) => {
        const i = d.refImages.find((r) => r.id === id)
        if (i) Object.assign(i, patch)
      }),
      deleteRefImage: (id) => get().update((d) => { d.refImages = d.refImages.filter((r) => r.id !== id) }),
      undo: () => hist.getState().undo(),
      redo: () => hist.getState().redo(),
    }),
    {
      limit: 100,
      // Only the doc is history; actions are not.
      partialize: (s) => ({ doc: s.doc }),
      equality: (a, b) => a.doc === b.doc,
    },
  ),
)

hist = useDoc.temporal
