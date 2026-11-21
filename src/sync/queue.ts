// Offline-first outbox (plan.md 2.5.5).
// Every change is enqueued locally with a sequence number, persisted (IndexedDB,
// localStorage fallback), then flushed to the API. A job is removed only when the
// server confirms it AND its seq is unchanged locally. Retries: 15 s after a
// failure, every 20 s while jobs are pending, and on 'online', tab hide
// ('visibilitychange' -> hidden) and 'pagehide'.
import * as api from './api'

export type OutboxKind =
  | 'snapshot'
  | 'measurement'
  | 'delete-measurement'
  | 'item'
  | 'delete-item'
  | 'note'

export type OutboxJob = {
  seq: number
  kind: OutboxKind
  /** Measurement label / item id / room code / '' for snapshots. */
  key: string
  payload: unknown
  enqueuedAt: string
  /** Project the job belongs to (absent on old jobs and 'local' = the current project). */
  projectId?: string
}

export type OutboxState = {
  pending: number
  lastError: string | null
  lastSyncAt: string | null
}

export const REQUEST_TIMEOUT_MS = 15_000
export const RETRY_AFTER_FAILURE_MS = 15_000
export const PENDING_INTERVAL_MS = 20_000

// ---------- persistence: IndexedDB with localStorage fallback ----------

type JobStore = {
  all(): Promise<OutboxJob[]>
  put(job: OutboxJob): Promise<void>
  del(seq: number): Promise<void>
}

const IDB_NAME = 'simple-floorplan'
const IDB_STORE = 'outbox'
const LS_KEY = 'simple-floorplan:outbox'

function idbRequest<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
}

function idbTxDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1)
    req.onupgradeneeded = () => {
      req.result.createObjectStore(IDB_STORE, { keyPath: 'seq' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function idbStore(): Promise<JobStore> {
  const db = await openIdb()
  const wrap = async <T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>) => {
    const tx = db.transaction(IDB_STORE, mode)
    const result = await idbRequest(fn(tx.objectStore(IDB_STORE)))
    await idbTxDone(tx)
    return result
  }
  return {
    all: async () => (await wrap('readonly', (s) => s.getAll() as IDBRequest<OutboxJob[]>)) ?? [],
    put: (job) => wrap('readwrite', (s) => s.put(job)).then(() => undefined),
    del: (seq) => wrap('readwrite', (s) => s.delete(seq)).then(() => undefined),
  }
}

function localStorageStore(): JobStore {
  const read = (): OutboxJob[] => {
    try {
      const raw = localStorage.getItem(LS_KEY)
      const parsed: unknown = raw ? JSON.parse(raw) : []
      return Array.isArray(parsed) ? (parsed as OutboxJob[]) : []
    } catch {
      return []
    }
  }
  const write = (jobs: OutboxJob[]) => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(jobs))
    } catch {
      // storage full / unavailable — keep going in memory
    }
  }
  return {
    all: async () => read(),
    put: async (job) => {
      const jobs = read()
      const i = jobs.findIndex((j) => j.seq === job.seq)
      if (i >= 0) jobs[i] = job
      else jobs.push(job)
      write(jobs)
    },
    del: async (seq) => write(read().filter((j) => j.seq !== seq)),
  }
}

function memoryStore(): JobStore {
  let jobs: OutboxJob[] = []
  return {
    all: async () => [...jobs],
    put: async (job) => {
      const i = jobs.findIndex((j) => j.seq === job.seq)
      if (i >= 0) jobs[i] = job
      else jobs.push(job)
    },
    del: async (seq) => {
      jobs = jobs.filter((j) => j.seq !== seq)
    },
  }
}

let storePromise: Promise<JobStore> | null = null

async function store(): Promise<JobStore> {
  if (!storePromise) {
    storePromise = (async () => {
      if (typeof indexedDB !== 'undefined') {
        try {
          return await idbStore()
        } catch {
          // fall through to localStorage
        }
      }
      if (typeof localStorage !== 'undefined') {
        try {
          localStorage.getItem(LS_KEY)
          return localStorageStore()
        } catch {
          // fall through to memory
        }
      }
      return memoryStore()
    })()
  }
  return storePromise
}

// ---------- sending ----------

export type SendJob = (job: OutboxJob, projectId: string, signal: AbortSignal) => Promise<void>

const defaultSender: SendJob = async (job, projectId, signal) => {
  const opts = { signal }
  switch (job.kind) {
    case 'snapshot':
      await api.putSnapshot(projectId, job.payload as api.SnapshotPayload, opts)
      break
    case 'measurement':
      await api.putMeasurement(projectId, job.key, job.payload as api.MeasurementPut, opts)
      break
    case 'delete-measurement':
      await api.deleteMeasurement(projectId, job.key, opts)
      break
    case 'item':
      await api.putItem(projectId, job.key, job.payload as api.ItemData, opts)
      break
    case 'delete-item':
      await api.deleteItem(projectId, job.key, opts)
      break
    case 'note':
      await api.putNote(projectId, job.key, job.payload as api.NotePut, opts)
      break
  }
}

// ---------- queue state ----------

let projectId: string | null = null
let sender: SendJob = defaultSender
let listeners = new Set<(s: OutboxState) => void>()
let state: OutboxState = { pending: 0, lastError: null, lastSyncAt: null }
let flushing = false
let started = false
let retryTimer: ReturnType<typeof setTimeout> | null = null
let intervalTimer: ReturnType<typeof setInterval> | null = null

/** Active project used when flushing jobs. */
export const setProjectId = (id: string | null): void => {
  projectId = id
}

/** Override the sender (used by tests; pass nothing to restore the default). */
export const setSender = (s: SendJob | null): void => {
  sender = s ?? defaultSender
}

export const getState = (): OutboxState => state

/** Number of waiting jobs that belong to one project (jobs without projectId = current project). */
export async function countJobs(forProject: string): Promise<number> {
  try {
    const jobs = await (await store()).all()
    return jobs.filter((j) => (j.projectId ?? projectId) === forProject).length
  } catch {
    return 0
  }
}

/** Remove every waiting job of a project (used when the project is deleted). */
export async function dropJobs(forProject: string): Promise<void> {
  try {
    const s = await store()
    for (const j of await s.all()) if ((j.projectId ?? projectId) === forProject) await s.del(j.seq)
  } catch {
    // ignore
  }
  await refreshPending()
}

export function subscribe(cb: (s: OutboxState) => void): () => void {
  listeners.add(cb)
  cb(state)
  return () => {
    listeners.delete(cb)
  }
}

function notify(): void {
  for (const cb of listeners) cb(state)
}

async function refreshPending(): Promise<void> {
  try {
    const jobs = await (await store()).all()
    state = { ...state, pending: jobs.length }
  } catch {
    // storage unavailable — leave pending as-is
  }
  notify()
}

const sameJob = (a: OutboxJob, b: OutboxJob): boolean =>
  a.seq === b.seq &&
  a.kind === b.kind &&
  a.key === b.key &&
  a.enqueuedAt === b.enqueuedAt &&
  JSON.stringify(a.payload) === JSON.stringify(b.payload)

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e))

// ---------- enqueue ----------

/** Append a change to the outbox. Returns its sequence number. */
export async function enqueue(kind: OutboxKind, key: string, payload: unknown): Promise<number> {
  const s = await store()
  const jobs = await s.all()
  const seq = jobs.reduce((m, j) => Math.max(m, j.seq), 0) + 1
  const job: OutboxJob = { seq, kind, key, payload, enqueuedAt: new Date().toISOString(), ...(projectId && projectId !== 'local' ? { projectId } : {}) }
  await s.put(job)
  await refreshPending()
  scheduleFlush()
  return seq
}

// ---------- flush ----------

function withTimeout<T>(p: Promise<T>, ms: number, onTimeout: () => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => {
      onTimeout()
      reject(new Error(`request timed out after ${ms} ms`))
    }, ms)
    p.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      (e) => {
        clearTimeout(t)
        reject(e)
      },
    )
  })
}

/** Send pending jobs in seq order. Safe to call concurrently (single-flight). */
export async function flush(): Promise<void> {
  if (flushing) return
  flushing = true
  try {
    if (!projectId) return
    let failure = false
    for (;;) {
      const s = await store()
      const jobs = (await s.all()).sort((a, b) => a.seq - b.seq)
      const job = jobs[0]
      if (!job || !projectId) break
      const ctrl = new AbortController()
      try {
        const pid = job.projectId ?? projectId
        await withTimeout(sender(job, pid, ctrl.signal), REQUEST_TIMEOUT_MS, () => ctrl.abort())
        // Remove the job only if its seq is unchanged when the server confirms.
        const current = (await s.all()).find((j) => j.seq === job.seq)
        if (current && sameJob(current, job)) await s.del(job.seq)
        state = { ...state, lastError: null, lastSyncAt: new Date().toISOString() }
      } catch (e) {
        failure = true
        state = { ...state, lastError: errMsg(e) }
        break
      }
    }
    if (failure) scheduleRetry(RETRY_AFTER_FAILURE_MS)
  } finally {
    flushing = false
    await refreshPending()
    notify()
  }
}

// ---------- scheduling ----------

function scheduleFlush(): void {
  // Fire-and-forget; a flush already running picks new jobs up in its loop.
  void flush().catch(() => undefined)
}

function scheduleRetry(ms: number): void {
  if (retryTimer) clearTimeout(retryTimer)
  retryTimer = setTimeout(() => {
    retryTimer = null
    void flush().catch(() => undefined)
  }, ms)
}

const onWake = (): void => {
  void flush().catch(() => undefined)
}

const onVisibility = (): void => {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') onWake()
}

/** Install the retry interval and event listeners. Idempotent. */
export function start(): void {
  if (started || typeof window === 'undefined') return
  started = true
  window.addEventListener('online', onWake)
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('pagehide', onWake)
  intervalTimer = setInterval(() => {
    void refreshPending().then(() => {
      if (state.pending > 0) void flush().catch(() => undefined)
    })
  }, PENDING_INTERVAL_MS)
  void refreshPending()
}

/** Remove listeners and timers (mainly for tests). */
export function stop(): void {
  if (!started) return
  started = false
  if (typeof window !== 'undefined') {
    window.removeEventListener('online', onWake)
    window.removeEventListener('pagehide', onWake)
  }
  if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility)
  if (retryTimer) {
    clearTimeout(retryTimer)
    retryTimer = null
  }
  if (intervalTimer) {
    clearInterval(intervalTimer)
    intervalTimer = null
  }
}

// ---------- test hooks (not used by the app) ----------

export const __test = {
  setStore(s: JobStore | null): void {
    storePromise = s ? Promise.resolve(s) : null
  },
  memoryStore,
  /** Reset in-memory queue state between tests. */
  reset(): void {
    flushing = false
    state = { pending: 0, lastError: null, lastSyncAt: null }
    if (retryTimer) {
      clearTimeout(retryTimer)
      retryTimer = null
    }
  },
}
