// IndexedDB persistence for plan documents: one record per projectId.
// If IndexedDB fails, the current doc is kept in localStorage (legacy key) instead.
import type { PlanDoc } from '../model/types'
import { LAST_PROJECT_KEY } from './projects'

const DB_NAME = 'simple-floorplan-docs'
const STORE = 'docs'
export const LEGACY_DOC_KEY = 'simple-floorplan:doc'

export type DocRecord = { projectId: string; doc: PlanDoc; savedAt: string }

const req = <T>(r: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })

let dbPromise: Promise<IDBDatabase> | null = null
function db(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') return reject(new Error('no indexedDB'))
      const open = indexedDB.open(DB_NAME, 1)
      open.onupgradeneeded = () => { open.result.createObjectStore(STORE, { keyPath: 'projectId' }) }
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

export async function getDoc(projectId: string): Promise<PlanDoc | null> {
  try {
    const r = await tx<DocRecord | undefined>('readonly', (s) => s.get(projectId))
    if (r) return r.doc
  } catch { /* fall through to the localStorage fallback */ }
  const fb = readFallback()
  return fb && fb.projectId === projectId ? fb : null
}

export async function listDocs(): Promise<DocRecord[]> {
  try {
    const all = await tx<DocRecord[]>('readonly', (s) => s.getAll())
    return all
  } catch {
    const fb = readFallback()
    return fb ? [{ projectId: fb.projectId, doc: fb, savedAt: new Date(0).toISOString() }] : []
  }
}

/** Save one doc. Falls back to localStorage if IndexedDB is not usable. */
export async function saveDoc(doc: PlanDoc): Promise<void> {
  try {
    await tx('readwrite', (s) => s.put({ projectId: doc.projectId, doc, savedAt: new Date().toISOString() } satisfies DocRecord))
  } catch {
    try { localStorage.setItem(LEGACY_DOC_KEY, JSON.stringify(doc)) } catch { /* storage full: nothing more to do */ }
  }
}

export async function deleteDoc(projectId: string): Promise<void> {
  try { await tx('readwrite', (s) => s.delete(projectId)) } catch { /* ignore */ }
  const fb = readFallback()
  if (fb && fb.projectId === projectId) lsSet(LEGACY_DOC_KEY, null)
}

function readFallback(): PlanDoc | null {
  const raw = lsGet(LEGACY_DOC_KEY)
  if (!raw) return null
  try { return JSON.parse(raw) as PlanDoc } catch { return null }
}

/**
 * Startup load. Returns the last opened doc (or the only/most recent one).
 * Moves the old localStorage doc into IndexedDB once.
 */
export async function loadInitialDoc(): Promise<PlanDoc | null> {
  let idbOk = true
  try { await db() } catch { idbOk = false }
  if (idbOk) {
    const legacy = readFallback()
    if (legacy) {
      // Migrate once: do not overwrite a newer record that already exists.
      const existing = await getDoc(legacy.projectId)
      if (!existing) await saveDoc(legacy)
      lsSet(LEGACY_DOC_KEY, null)
      if (!getLastProjectId()) setLastProjectId(legacy.projectId)
    }
    const last = getLastProjectId()
    if (last) {
      const d = await getDoc(last)
      if (d) return d
    }
    const all = (await listDocs()).sort((a, b) => b.savedAt.localeCompare(a.savedAt))
    return all[0]?.doc ?? null
  }
  return readFallback()
}

// ---------- debounced autosave ----------

const SAVE_DELAY_MS = 300
let timer: ReturnType<typeof setTimeout> | null = null
let queued: PlanDoc | null = null

/** Save `doc` after 300 ms of quiet (last call wins). */
export function scheduleSave(doc: PlanDoc): void {
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

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => { void flushSave() })
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') void flushSave() })
}
