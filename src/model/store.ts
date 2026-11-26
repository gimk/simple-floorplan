// Document store: the ProjectDoc with undo/redo (zundo). One `update` = one undo step.
// Drags: beginDrag(), many updateSilent(), endDrag() = one undo step.
import { create, type StoreApi } from 'zustand'
import { temporal, type TemporalState } from 'zundo'
import { artboardFrame } from '../features/artboards/frame'
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

/**
 * Fast copy of a doc. Reference images are shallow-copied (their `src` strings are immutable and
 * can be many MB, so they are shared); artboards, rooms, openings and furniture are deep-copied.
 */
export function cloneDoc(doc: ProjectDoc): ProjectDoc {
  return {
    ...doc,
    refImages: doc.refImages.map((i) => ({ ...i })),
    artboards: doc.artboards.map(cloneArtboardDeep),
  }
}

const cloneArtboardDeep = (a: Artboard): Artboard => ({
  ...a,
  rooms: a.rooms.map((r) => ({ ...r, vertices: r.vertices.map((v) => ({ ...v })) })),
  openings: a.openings.map((o) => ({ ...o })),
  furniture: a.furniture.map((f) => ({ ...f })),
})

/** Apply fn to a deep copy; fn may mutate it or return a replacement. */
const apply = (doc: ProjectDoc, fn: (d: ProjectDoc) => ProjectDoc | void): ProjectDoc => {
  const copy = cloneDoc(doc)
  return fn(copy) ?? copy
}

/** World bounds of an artboard: exactly its frame (see `artboardFrame`). */
export function artboardBounds(a: Artboard) {
  const f = artboardFrame(a)
  return { minX: f.minX, minY: f.minY, maxX: f.maxX, maxY: f.maxY }
}

/** Space above a frame for the artboard header (cm, for Fit). */
const HEADER_CM = 40

/** Bounds of everything on the canvas: artboards (with rooms) and reference images. */
export function docBounds(doc: ProjectDoc) {
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  const grow = (x0: number, y0: number, x1: number, y1: number) => {
    b.minX = Math.min(b.minX, x0); b.minY = Math.min(b.minY, y0); b.maxX = Math.max(b.maxX, x1); b.maxY = Math.max(b.maxY, y1)
  }
  for (const a of doc.artboards) { const ab = artboardBounds(a); grow(ab.minX, ab.minY - HEADER_CM, ab.maxX, ab.maxY) }
  for (const i of doc.refImages) if (i.visible) grow(i.xCm, i.yCm, i.xCm + i.naturalWidth * i.cmPerPx, i.yCm + i.naturalHeight * i.cmPerPx)
  return b
}

export const ARTBOARD_GAP_CM = 150

/** Shift an artboard so its frame starts ARTBOARD_GAP_CM right of every artboard in `others`. */
const placeRightOf = (a: Artboard, others: Artboard[]): void => {
  if (others.length === 0) return
  const right = Math.max(...others.map((o) => artboardBounds(o).maxX))
  const frameX = artboardBounds(a).minX
  a.xCm += right + ARTBOARD_GAP_CM - frameX
}

const cloneArtboard = (src: Artboard, xCm: number, yCm: number): Artboard => {
  const c = cloneArtboardDeep(src)
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
        // Push the pre-drag state as one undo step (history is capped at 100).
        const t = hist
        t.setState((s) => ({ pastStates: [...s.pastStates, { doc: before }].slice(-100), futureStates: [] }))
      },
      setTitle: (title) => get().update((d) => { d.title = title }),
      addArtboard: () => {
        const id = newId()
        get().update((d) => {
          // An empty document has no right edge: the first artboard sits at the origin.
          const a = createArtboard(`Plan ${String.fromCharCode(65 + (d.artboards.length % 26))}`, 0, 0)
          a.id = id
          placeRightOf(a, d.artboards)
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
          const c = cloneArtboard(s, s.xCm, s.yCm)
          placeRightOf(c, d.artboards)
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
      undo: () => { if (dragSnapshot === null) hist.getState().undo() },
      redo: () => { if (dragSnapshot === null) hist.getState().redo() },
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
