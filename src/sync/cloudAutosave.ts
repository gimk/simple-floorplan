// Debounced cloud autosave and live cloud polling:
// - CLOUD_AUTOSAVE_DELAY_MS after the last document change, the doc is uploaded with baseVersion.
// - Every CLOUD_POLL_INTERVAL_MS while visible with a cloud project & token, polls for remote updates.
// - Pulls remote changes when clean; enters 'conflict' when local unsynced changes exist or on 409.
import { create, type StoreApi, type UseBoundStore } from 'zustand'
import { toast } from '../features/toast'
import { useDoc } from '../model/store'
import type { ProjectDoc } from '../model/types'
import { useUi } from '../shell/uiStore'
import {
  CloudConflictError,
  CloudUnauthorizedError,
  getCloudToken,
  listCloudProjects,
  loadProjectFromCloud,
  saveProjectToCloud,
} from './cloud'

export type CloudAutosaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error' | 'paused' | 'conflict'

/** localStorage key: '0' = off, anything else (or missing) = on. */
export const CLOUD_AUTOSAVE_KEY = 'sfp-cloud-autosave'
/** localStorage key storing `{ projectId, version, docHash }` of the last known cloud sync. */
export const CLOUD_SYNCED_KEY = 'sfp-cloud-synced'
export const CLOUD_AUTOSAVE_DELAY_MS = 3000
export const CLOUD_POLL_INTERVAL_MS = 5000
/** A failed upload is tried again after this delay (the status stays 'error' meanwhile). */
const RETRY_DELAY_MS = 30_000

export type CloudAutosaveState = {
  status: CloudAutosaveStatus
  lastSavedAt: number | null
  lastError: string | null
  conflictVersion: number | null
}

export const useCloudAutosave: UseBoundStore<StoreApi<CloudAutosaveState>> = create<CloudAutosaveState>()(() => ({
  status: 'idle',
  lastSavedAt: null,
  lastError: null,
  conflictVersion: null,
}))

/** Store shape needed by `startCloudAutosave` (the real one is `useDoc`). */
export type DocStore = {
  subscribe: (fn: (s: { doc: ProjectDoc }, prev: { doc: ProjectDoc }) => void) => () => void
  getState?: () => { doc: ProjectDoc; hydrate?: (doc: ProjectDoc) => void }
  temporal?: { getState: () => { pastStates: unknown[] } }
}

export type CloudAutosaveOptions = {
  fetchFn?: typeof fetch
}

/** The document the cloud has, by identity ("unsynced changes" = `doc !== syncedDoc`). */
let syncedDoc: ProjectDoc | null = null
let syncedProjectId: string | null = null
let syncedVersion: number | null = null
let timer: ReturnType<typeof setTimeout> | null = null
/** Set by a 401: no upload or poll until the user unlocks again (see `resumeCloudAutosave`). */
let paused = false
let inFlight: Promise<unknown> | null = null
/** A change arrived while an upload was running: schedule one more pass after it. */
let dirtyAgain = false
let pollTimer: ReturnType<typeof setInterval> | null = null
let pollInFlight = false
/** True when `restoreCloudSync` found local edits that differ from the last cloud sync. */
let restoredDirty = false
/** Set while `restoreCloudSync` is checking the cloud, so autosave waits for a baseVersion. */
let restoreInFlight: Promise<void> | null = null
let activeStore: DocStore = useDoc
let activeFetchFn: typeof fetch | undefined

type SyncedRecord = {
  projectId: string
  version: number
  docHash: string
}

/** Fast deterministic hash of `doc` excluding `refImages[].src` (which differs between local data URLs and cloud URLs). */
export function hashDoc(doc: ProjectDoc): string {
  const refImages = Array.isArray(doc.refImages)
    ? doc.refImages.map(({ src: _src, ...rest }) => rest)
    : doc.refImages
  const str = JSON.stringify({ ...doc, refImages })
  let h = 0x811c9cd5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

function readSyncedRecord(): SyncedRecord | null {
  try {
    const raw = localStorage.getItem(CLOUD_SYNCED_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof (parsed as SyncedRecord).projectId === 'string' &&
      typeof (parsed as SyncedRecord).version === 'number' &&
      typeof (parsed as SyncedRecord).docHash === 'string'
    ) {
      return parsed as SyncedRecord
    }
    return null
  } catch {
    return null
  }
}

function writeSyncedRecord(doc: ProjectDoc, version: number): void {
  try {
    const record: SyncedRecord = { projectId: doc.id, version, docHash: hashDoc(doc) }
    localStorage.setItem(CLOUD_SYNCED_KEY, JSON.stringify(record))
  } catch {
    // Storage unavailable: in-memory sync state still works.
  }
}

function getCurrentDoc(): ProjectDoc {
  return activeStore.getState ? activeStore.getState().doc : useDoc.getState().doc
}

function hydrateDoc(doc: ProjectDoc): void {
  const state = activeStore.getState?.()
  if (state?.hydrate) state.hydrate(doc)
  else useDoc.getState().hydrate(doc)
}

function hasPastStates(): boolean {
  const temporal = activeStore.temporal ?? useDoc.temporal
  return temporal.getState().pastStates.length > 0
}

function clearTimer(): void {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
}

function clearPollTimer(): void {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

function isConflict(): boolean {
  return useCloudAutosave.getState().status === 'conflict'
}

/** Default on: a blocked or missing localStorage must not disable autosave. */
export function isCloudAutosaveEnabled(): boolean {
  try {
    return localStorage.getItem(CLOUD_AUTOSAVE_KEY) !== '0'
  } catch {
    return true
  }
}

export function setCloudAutosaveEnabled(on: boolean): void {
  try {
    localStorage.setItem(CLOUD_AUTOSAVE_KEY, on ? '1' : '0')
  } catch {
    // Storage unavailable: the in-memory behaviour still changes.
  }
  if (!on) {
    clearTimer()
    if (!isConflict()) useCloudAutosave.setState({ status: 'idle' })
    return
  }
  if (hasUnsyncedChanges()) scheduleCloudSave(getCurrentDoc())
}

/** The last document the cloud has (null when nothing was synced since the page loaded). */
export function getSyncedDoc(): ProjectDoc | null {
  return syncedDoc
}

/** Known cloud version for `projectId` (or the current synced project if omitted). */
export function getSyncedVersion(projectId?: string): number | null {
  if (projectId !== undefined && projectId !== syncedProjectId) return null
  return syncedVersion
}

/** The cloud and the store agree on `doc`: drop any pending upload and show "saved". */
export function markCloudSynced(doc: ProjectDoc, version?: number): void {
  const sameProject = doc.id === syncedProjectId
  syncedDoc = doc
  syncedProjectId = doc.id
  if (typeof version === 'number') syncedVersion = version
  else if (!sameProject) syncedVersion = null
  restoredDirty = false
  clearTimer()
  paused = false
  dirtyAgain = false
  if (syncedVersion !== null) writeSyncedRecord(doc, syncedVersion)
  useCloudAutosave.setState({ status: 'saved', lastSavedAt: Date.now(), lastError: null, conflictVersion: null })
}

/** Enter the conflict state: stop uploading and let the user choose Cloud vs Local. */
export function markCloudConflict(currentVersion: number): void {
  clearTimer()
  dirtyAgain = false
  useCloudAutosave.setState({ status: 'conflict', lastError: null, conflictVersion: currentVersion })
}

/** True when the open plan differs from the last cloud sync (or was edited and never synced). */
export function hasUnsyncedChanges(): boolean {
  const doc = getCurrentDoc()
  if (syncedDoc) return doc !== syncedDoc
  return restoredDirty || hasPastStates()
}

/** Upload the current doc after a quiet period. Later calls restart the countdown. */
export function scheduleCloudSave(doc: ProjectDoc): void {
  if (!isCloudAutosaveEnabled() || paused || isConflict()) return
  // `doc` is the state the change listener saw. zundo records the undo step just after the store
  // notifies, so `pastStates` can still be empty on the first edit after a load: a doc that is not
  // the synced doc is dirty on its own. The timer re-reads the store, so the newest edit wins.
  if (!hasUnsyncedChanges() && doc === syncedDoc) return
  clearTimer()
  useCloudAutosave.setState({ status: 'pending' })
  timer = setTimeout(() => {
    void flushCloudSave()
  }, CLOUD_AUTOSAVE_DELAY_MS)
}

/** Upload now (timer cancelled). Concurrent calls coalesce into one extra pass. */
export async function flushCloudSave(): Promise<void> {
  clearTimer()
  if (!isCloudAutosaveEnabled() || paused || isConflict() || !hasUnsyncedChanges()) return
  if (inFlight) {
    dirtyAgain = true
    return
  }
  if (restoreInFlight) {
    await restoreInFlight
    if (!isCloudAutosaveEnabled() || paused || isConflict() || !hasUnsyncedChanges()) return
    if (inFlight) {
      dirtyAgain = true
      return
    }
  }
  const doc = getCurrentDoc()
  const baseVersion = doc.id === syncedProjectId ? syncedVersion : null
  // Status before this attempt: a retry that fails again must not toast again.
  const wasError = useCloudAutosave.getState().status === 'error'
  useCloudAutosave.setState({ status: 'saving' })
  const req = saveProjectToCloud(doc, activeFetchFn, baseVersion !== null ? { baseVersion } : undefined)
  inFlight = req
  try {
    const res = await req
    syncedDoc = doc
    syncedProjectId = doc.id
    if (typeof res?.version === 'number') syncedVersion = res.version
    restoredDirty = false
    if (syncedVersion !== null) writeSyncedRecord(doc, syncedVersion)
    useCloudAutosave.setState({ status: 'saved', lastSavedAt: Date.now(), lastError: null, conflictVersion: null })
  } catch (err) {
    if (err instanceof CloudUnauthorizedError) {
      // A lock is not an error the user must see twice: wait for the passcode form.
      paused = true
      useCloudAutosave.setState({ status: 'paused', lastError: 'Passcode required' })
    } else if (err instanceof CloudConflictError) {
      dirtyAgain = false
      useCloudAutosave.setState({ status: 'conflict', lastError: err.message, conflictVersion: err.currentVersion })
    } else {
      const message = err instanceof Error ? err.message : 'unknown error'
      useCloudAutosave.setState({ status: 'error', lastError: message })
      // One toast per failure streak, not one every retry.
      if (!wasError) toast(`Cloud autosave failed: ${message}`, { kind: 'error' })
      clearTimer()
      timer = setTimeout(() => {
        void flushCloudSave()
      }, RETRY_DELAY_MS)
    }
  } finally {
    inFlight = null
    if (dirtyAgain && !isConflict() && !paused) {
      dirtyAgain = false
      scheduleCloudSave(getCurrentDoc())
    } else {
      dirtyAgain = false
    }
  }
}

/** Replace the open doc with a freshly pulled cloud doc, keeping viewport, tool, and valid artboard. */
function applyPulledDoc(doc: ProjectDoc, version: number): void {
  const { activeArtboardId } = useUi.getState()
  const keepArtboard = activeArtboardId !== null && doc.artboards.some((a) => a.id === activeArtboardId)
  hydrateDoc(doc)
  markCloudSynced(getCurrentDoc(), version)
  useUi.getState().set({
    selection: { kind: 'none' },
    ...(keepArtboard ? {} : { activeArtboardId: null }),
  })
  toast('Updated from cloud', { kind: 'info' })
}

/** Poll the cloud for a newer version of the open cloud project. */
export async function pollCloudVersion(): Promise<void> {
  if (pollInFlight) return
  if (paused || isConflict()) return
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
  if (getCloudToken() === null) return
  const currentDoc = getCurrentDoc()
  if (syncedProjectId === null || currentDoc.id !== syncedProjectId || syncedVersion === null) return

  const projectId = syncedProjectId
  pollInFlight = true
  try {
    const projects = await listCloudProjects(activeFetchFn)
    const remote = projects.find((p) => p.id === projectId)
    if (!remote || typeof remote.version !== 'number') return
    if (remote.version <= syncedVersion) return

    if (hasUnsyncedChanges()) {
      markCloudConflict(remote.version)
      return
    }
    if (inFlight) return

    const loaded = await loadProjectFromCloud(projectId, activeFetchFn)
    if (getCurrentDoc().id !== projectId) return
    if (hasUnsyncedChanges()) {
      markCloudConflict(loaded.version)
      return
    }
    if (inFlight) return
    applyPulledDoc(loaded.doc, loaded.version)
  } catch (err) {
    if (err instanceof CloudUnauthorizedError) {
      paused = true
      useCloudAutosave.setState({ status: 'paused', lastError: 'Passcode required' })
    }
    // Transient network/server errors are ignored; the next poll will retry.
  } finally {
    pollInFlight = false
  }
}

/** Pull the cloud version for `projectId`, discarding local changes and clearing conflict. */
export async function pullCloudProject(projectId: string, fetchFn: typeof fetch | undefined = activeFetchFn): Promise<void> {
  const { doc, version } = await loadProjectFromCloud(projectId, fetchFn)
  applyPulledDoc(doc, version)
}

/** Autosave every document change and poll for remote cloud updates. Returns the unsubscribe function. */
export function startCloudAutosave(store: DocStore = useDoc, options?: CloudAutosaveOptions): () => void {
  activeStore = store
  activeFetchFn = options?.fetchFn
  const unsubStore = store.subscribe((s, prev) => {
    if (s.doc !== prev.doc) scheduleCloudSave(s.doc)
  })

  clearPollTimer()
  pollTimer = setInterval(() => {
    void pollCloudVersion()
  }, CLOUD_POLL_INTERVAL_MS)

  const onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') {
      if (timer) void flushCloudSave()
    } else if (document.visibilityState === 'visible') {
      void pollCloudVersion()
    }
  }
  const onOnline = () => {
    void pollCloudVersion()
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibilityChange)
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('online', onOnline)
  }

  return () => {
    unsubStore()
    clearPollTimer()
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', onOnline)
    }
    activeStore = useDoc
    activeFetchFn = undefined
  }
}

/** Restore cloud sync version after a page reload so polling and baseVersion checks resume. */
export function restoreCloudSync(doc: ProjectDoc, options?: CloudAutosaveOptions): Promise<void> {
  const record = readSyncedRecord()
  if (record && record.projectId === doc.id) {
    if (record.docHash === hashDoc(doc)) {
      markCloudSynced(doc, record.version)
    } else {
      syncedDoc = null
      syncedProjectId = record.projectId
      syncedVersion = record.version
      restoredDirty = true
    }
    return Promise.resolve()
  }

  if (getCloudToken() === null) return Promise.resolve()

  const fetchFn = options?.fetchFn ?? activeFetchFn
  let run!: Promise<void>
  run = (async () => {
    try {
      const projects = await listCloudProjects(fetchFn)
      if (!projects.some((p) => p.id === doc.id)) return
      const loaded = await loadProjectFromCloud(doc.id, fetchFn)
      const current = getCurrentDoc()
      if (current.id !== doc.id) return
      if (hashDoc(current) === hashDoc(loaded.doc)) {
        markCloudSynced(current, loaded.version)
      } else {
        syncedDoc = null
        syncedProjectId = current.id
        syncedVersion = loaded.version
        restoredDirty = true
        markCloudConflict(loaded.version)
      }
    } catch {
      // Transient network/auth errors during boot restore are ignored silently.
    } finally {
      if (restoreInFlight === run) restoreInFlight = null
    }
  })()
  restoreInFlight = run
  return run
}

/** The user unlocked the cloud again: leave 'paused' and upload what is still unsynced. */
export function resumeCloudAutosave(): void {
  paused = false
  useCloudAutosave.setState({ status: 'idle' })
  if (hasUnsyncedChanges()) scheduleCloudSave(getCurrentDoc())
}

/** Test seam: forget every module-level flag and the visible status. */
export function __resetCloudAutosaveForTests(): void {
  clearTimer()
  clearPollTimer()
  syncedDoc = null
  syncedProjectId = null
  syncedVersion = null
  paused = false
  inFlight = null
  dirtyAgain = false
  pollInFlight = false
  restoredDirty = false
  restoreInFlight = null
  activeStore = useDoc
  activeFetchFn = undefined
  useCloudAutosave.setState({ status: 'idle', lastSavedAt: null, lastError: null, conflictVersion: null })
}
