// Debounced cloud autosave: CLOUD_AUTOSAVE_DELAY_MS after the last document change, the doc is
// uploaded with the same call the Save button uses. The status lives in a small zustand store so
// the CloudMenu popover can show it without prop drilling.
import { create, type StoreApi, type UseBoundStore } from 'zustand'
import { toast } from '../features/toast'
import { useDoc } from '../model/store'
import type { ProjectDoc } from '../model/types'
import { CloudUnauthorizedError, saveProjectToCloud } from './cloud'

export type CloudAutosaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error' | 'paused'

/** localStorage key: '0' = off, anything else (or missing) = on. */
export const CLOUD_AUTOSAVE_KEY = 'sfp-cloud-autosave'
export const CLOUD_AUTOSAVE_DELAY_MS = 3000
/** A failed upload is tried again after this delay (the status stays 'error' meanwhile). */
const RETRY_DELAY_MS = 30_000

export type CloudAutosaveState = {
  status: CloudAutosaveStatus
  lastSavedAt: number | null
  lastError: string | null
}

export const useCloudAutosave: UseBoundStore<StoreApi<CloudAutosaveState>> = create<CloudAutosaveState>()(() => ({
  status: 'idle',
  lastSavedAt: null,
  lastError: null,
}))

/** The document the cloud has, by identity ("unsynced changes" = `doc !== syncedDoc`). */
let syncedDoc: ProjectDoc | null = null
let timer: ReturnType<typeof setTimeout> | null = null
/** Set by a 401: no upload until the user unlocks again (see `resumeCloudAutosave`). */
let paused = false
let inFlight: Promise<unknown> | null = null
/** A change arrived while an upload was running: schedule one more pass after it. */
let dirtyAgain = false

/** Store shape needed by `startCloudAutosave` (the real one is `useDoc`). */
type DocStore = {
  subscribe: (fn: (s: { doc: ProjectDoc }, prev: { doc: ProjectDoc }) => void) => () => void
}

function clearTimer(): void {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
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
    useCloudAutosave.setState({ status: 'idle' })
    return
  }
  if (hasUnsyncedChanges()) scheduleCloudSave(useDoc.getState().doc)
}

/** The last document the cloud has (null when nothing was synced since the page loaded). */
export function getSyncedDoc(): ProjectDoc | null {
  return syncedDoc
}

/** The cloud and the store agree on `doc`: drop any pending upload and show "saved". */
export function markCloudSynced(doc: ProjectDoc): void {
  syncedDoc = doc
  clearTimer()
  paused = false
  dirtyAgain = false
  useCloudAutosave.setState({ status: 'saved', lastSavedAt: Date.now(), lastError: null })
}

/** True when the open plan differs from the last cloud sync (or was edited and never synced). */
export function hasUnsyncedChanges(): boolean {
  const doc = useDoc.getState().doc
  if (syncedDoc) return doc !== syncedDoc
  return useDoc.temporal.getState().pastStates.length > 0
}

/** Upload the current doc after a quiet period. Later calls restart the countdown. */
export function scheduleCloudSave(doc: ProjectDoc): void {
  if (!isCloudAutosaveEnabled() || paused) return
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
  if (!isCloudAutosaveEnabled() || paused || !hasUnsyncedChanges()) return
  if (inFlight) {
    dirtyAgain = true
    return
  }
  const doc = useDoc.getState().doc
  // Status before this attempt: a retry that fails again must not toast again.
  const wasError = useCloudAutosave.getState().status === 'error'
  useCloudAutosave.setState({ status: 'saving' })
  inFlight = saveProjectToCloud(doc)
  try {
    await inFlight
    syncedDoc = doc
    useCloudAutosave.setState({ status: 'saved', lastSavedAt: Date.now(), lastError: null })
  } catch (err) {
    if (err instanceof CloudUnauthorizedError) {
      // A lock is not an error the user must see twice: wait for the passcode form.
      paused = true
      useCloudAutosave.setState({ status: 'paused', lastError: 'Passcode required' })
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
    if (dirtyAgain) {
      dirtyAgain = false
      scheduleCloudSave(useDoc.getState().doc)
    }
  }
}

/** Autosave every document change. Returns the unsubscribe function. */
export function startCloudAutosave(store: DocStore = useDoc): () => void {
  return store.subscribe((s, prev) => {
    if (s.doc !== prev.doc) scheduleCloudSave(s.doc)
  })
}

/** The user unlocked the cloud again: leave 'paused' and upload what is still unsynced. */
export function resumeCloudAutosave(): void {
  paused = false
  useCloudAutosave.setState({ status: 'idle' })
  if (hasUnsyncedChanges()) scheduleCloudSave(useDoc.getState().doc)
}

/** Test seam: forget every module-level flag and the visible status. */
export function __resetCloudAutosaveForTests(): void {
  clearTimer()
  syncedDoc = null
  paused = false
  inFlight = null
  dirtyAgain = false
  useCloudAutosave.setState({ status: 'idle', lastSavedAt: null, lastError: null })
}

if (typeof window !== 'undefined') {
  // Leaving the page: do not lose the last edits to the debounce.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && timer) void flushCloudSave()
  })
}
