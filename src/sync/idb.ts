// IndexedDB persistence for the v2 ProjectDoc: one record per project id, plus debounced autosave.
// If IndexedDB fails, the current doc is kept in localStorage instead.
import { parseProjectDoc } from '../model/schema'
import type { ProjectDoc } from '../model/types'

const LAST_PROJECT_KEY = 'simple-floorplan2:last-project'
export const FALLBACK_DOC_KEY = 'simple-floorplan2:doc'

const DB_NAME = 'simple-floorplan2-docs'
const STORE = 'docs'

export type DocRecord = { id: string; doc: ProjectDoc; savedAt: string }

const req = <T>(r: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })

let dbPromise: Promise<IDBDatabase> | null = null
function db(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') return reject(new Error('no indexedDB'))
      const open = indexedDB.open(DB_NAME, 1)
      open.onupgradeneeded = () => { open.result.createObjectStore(STORE, { keyPath: 'id' }) }
      open.onsuccess = () => resolve(open.result)
      open.onerror = () => reject(open.error)
      open.onblocked = () => reject(new Error('indexedDB blocked'))
    })
    dbPromise.catch(() => { dbPromise = null })
  }
  return dbPromise
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db()
  const t = d.transaction(STORE, mode)
  const result = await req(fn(t.objectStore(STORE)))
  await new Promise<void>((resolve, reject) => { t.oncomplete = () => resolve(); t.onerror = () => reject(t.error); t.onabort = () => reject(t.error) })
  return result
}

const lsGet = (k: string): string | null => { try { return localStorage.getItem(k) } catch { return null } }
const lsSet = (k: string, v: string | null) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v) } catch { /* ignore */ } }

export const getLastProjectId = (): string | null => lsGet(LAST_PROJECT_KEY)
export const setLastProjectId = (id: string): void => lsSet(LAST_PROJECT_KEY, id)

function readFallback(): ProjectDoc | null {
  const raw = lsGet(FALLBACK_DOC_KEY)
  if (!raw) return null
  try {
    const r = parseProjectDoc(JSON.parse(raw))
    return r.ok ? r.doc : null
  } catch { return null }
}

/** Load one doc by id. Invalid stored data gives null. */
export async function getDoc(id: string): Promise<ProjectDoc | null> {
  try {
    const r = await tx<DocRecord | undefined>('readonly', (s) => s.get(id))
    if (r) {
      const p = parseProjectDoc(r.doc)
      return p.ok ? p.doc : null
    }
  } catch { /* fall through to the localStorage fallback */ }
  const fb = readFallback()
  return fb && fb.id === id ? fb : null
}

/** Save one doc. Falls back to localStorage if IndexedDB is not usable. */
export async function saveDoc(doc: ProjectDoc): Promise<void> {
  try {
    await tx('readwrite', (s) => s.put({ id: doc.id, doc, savedAt: new Date().toISOString() } satisfies DocRecord))
    setLastProjectId(doc.id)
  } catch {
    try { localStorage.setItem(FALLBACK_DOC_KEY, JSON.stringify(doc)) } catch { /* storage full: nothing more to do */ }
  }
}

export async function deleteDoc(id: string): Promise<void> {
  try { await tx('readwrite', (s) => s.delete(id)) } catch { /* ignore */ }
  const fb = readFallback()
  if (fb && fb.id === id) lsSet(FALLBACK_DOC_KEY, null)
}

/** Startup load: the last opened doc, or the most recent one, or null. */
export async function loadInitialDoc(): Promise<ProjectDoc | null> {
  try {
    await db()
  } catch {
    return readFallback()
  }
  try {
    const last = getLastProjectId()
    if (last) {
      const d = await getDoc(last)
      if (d) return d
    }
    const all = (await tx<DocRecord[]>('readonly', (s) => s.getAll())).sort((a, b) => b.savedAt.localeCompare(a.savedAt))
    for (const rec of all) {
      const p = parseProjectDoc(rec.doc)
      if (p.ok) return p.doc
    }
  } catch { /* ignore */ }
  return readFallback()
}

// ---------- debounced autosave ----------

const SAVE_DELAY_MS = 300
let timer: ReturnType<typeof setTimeout> | null = null
let queued: ProjectDoc | null = null

/** Save `doc` after 300 ms of quiet (last call wins). */
export function scheduleSave(doc: ProjectDoc): void {
  queued = doc
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => { void flushSave() }, SAVE_DELAY_MS)
}

/** Write the queued doc now. Call before switching projects and on page hide. */
export async function flushSave(): Promise<void> {
  if (timer) { clearTimeout(timer); timer = null }
  const d = queued
  queued = null
  if (d) await saveDoc(d)
}

/** Subscribe to the doc store: every change is autosaved. Returns an unsubscribe function. */
export function startAutosave(
  store: { subscribe: (fn: (s: { doc: ProjectDoc }, prev: { doc: ProjectDoc }) => void) => () => void },
): () => void {
  return store.subscribe((s, prev) => { if (s.doc !== prev.doc) scheduleSave(s.doc) })
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => { void flushSave() })
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') void flushSave() })
}
