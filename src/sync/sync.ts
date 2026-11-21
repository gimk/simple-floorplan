// Wires the local store to the API (docs/plan.md 3.2 + 2.5.5).
// - Local first: the store saves to IndexedDB (src/sync/idb.ts); every change is also put in the outbox.
// - Per-value changes (measurements, notes, elements) are separate jobs, so two devices
//   can edit different values at the same time.
// - Geometry (rooms, background, title, tapes, elements) goes as a versioned snapshot.
//   The sender always uploads the CURRENT doc and adopts the server version on a 409
//   (last write wins for geometry: it is edited from one desktop at a time).
// - Remote changes are pulled by polling, and only applied when the outbox is empty,
//   so they never overwrite local changes that are not uploaded yet.
//   WHY POLLING: Pages Functions are short-lived request/response handlers. They cannot
//   hold a long connection (SSE / WebSocket would need Durable Objects), so the client
//   asks for `changes?since=` instead. Interval: 3 s while the tab is visible AND
//   Measuring Mode is open (two people measuring together want to see values quickly),
//   else 15 s (cheap background refresh).
// - Many projects: version / since keys are per project, outbox jobs carry their projectId,
//   and `openDoc()` switches the whole app to another project.
import { useEffect, useState } from 'react'
import { useDoc, useUi } from '../model/store'
import type { BackgroundImage, PlanDoc } from '../model/types'
import * as api from './api'
import * as idb from './idb'
import { collectDataUrls, isLocalId, pinsOf, pollIntervalMs, projectKey, replacePhoto, titlePatchForDoc, type PinLike } from './projects'
import * as queue from './queue'

const PASS_KEY = 'simple-floorplan:passcode'
const LEGACY_VERSION_KEY = 'simple-floorplan:version'
const LEGACY_SINCE_KEY = 'simple-floorplan:since'
const CONNECT_RETRY_MS = 30_000

export type ConnState = 'connecting' | 'online' | 'offline' | 'locked' | 'no-server'
type SyncState = { conn: ConnState; detail?: string }

let syncState: SyncState = { conn: 'connecting' }
const listeners = new Set<() => void>()
const setSync = (s: SyncState) => { syncState = s; listeners.forEach((l) => l()) }

const ls = {
  get: (k: string) => { try { return localStorage.getItem(k) } catch { return null } },
  set: (k: string, v: string | null) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v) } catch { /* ignore */ } },
}

// Per-project snapshot version and changes cursor.
const getVersion = (pid: string) => Number(ls.get(projectKey('version', pid)) || 0)
const setVersion = (pid: string, v: number) => ls.set(projectKey('version', pid), String(v))
const getSince = (pid: string) => ls.get(projectKey('since', pid))
/** Old versions kept one global version/since for the single project. Move them once. */
function migrateLegacyKeys(pid: string) {
  const v = ls.get(LEGACY_VERSION_KEY), since = ls.get(LEGACY_SINCE_KEY)
  if (v != null && ls.get(projectKey('version', pid)) == null) ls.set(projectKey('version', pid), v)
  if (since != null && ls.get(projectKey('since', pid)) == null) ls.set(projectKey('since', pid), since)
  ls.set(LEGACY_VERSION_KEY, null)
  ls.set(LEGACY_SINCE_KEY, null)
}
const setSince = (pid: string, v: string) => ls.set(projectKey('since', pid), v)

/** Bumps on every project switch; async work from an older project checks it and stops. */
let generation = 0

/** True while we apply server data to the store (so it is not sent back). */
let applying = false
let connected = false
let pullTimer: ReturnType<typeof setTimeout> | null = null
let snapTimer: ReturnType<typeof setTimeout> | null = null

// ---------- passcode ----------
export function setPasscode(p: string | null) {
  ls.set(PASS_KEY, p)
  api.setPasscode(p)
  if (!connected) void connect()
}
api.setPasscode(ls.get(PASS_KEY))

// ---------- snapshot payload ----------
const stripBackground = (bg?: BackgroundImage): BackgroundImage | undefined =>
  bg && (bg.r2Key ? { ...bg, src: '' } : bg.src.startsWith('data:') ? { ...bg, src: '' } : bg)

const snapshotOf = (d: PlanDoc): Omit<api.SnapshotPayload, 'baseVersion'> => {
  const { measurements: _m, roomNotes: _n, ...rest } = d
  return { ...rest, background: stripBackground(d.background) }
}

// ---------- sender (wraps the API for the outbox) ----------
const sender: queue.SendJob = async (job, projectId, signal) => {
  const opts = { signal }
  switch (job.kind) {
    case 'snapshot': {
      // The job may belong to a project we already left: use its saved doc then.
      const current = useDoc.getState().doc
      const doc = current.projectId === projectId ? current : await idb.getDoc(projectId)
      if (!doc) return // project was deleted locally: nothing to send
      const send = (base: number) => api.putSnapshot(projectId, { ...snapshotOf(doc), baseVersion: base }, opts)
      try {
        setVersion(projectId, (await send(getVersion(projectId))).version)
      } catch (e) {
        if (e instanceof api.ApiError && e.status === 409) {
          const latest = (e.body as { latestVersion?: number } | null)?.latestVersion ?? getVersion(projectId)
          setVersion(projectId, (await send(latest)).version)
        } else throw e
      }
      return
    }
    case 'measurement': await api.putMeasurement(projectId, job.key, job.payload as api.MeasurementPut, opts); return
    case 'delete-measurement': await api.deleteMeasurement(projectId, job.key, opts); return
    case 'item': await api.putItem(projectId, job.key, job.payload as api.ItemData, opts); return
    case 'delete-item': await api.deleteItem(projectId, job.key, opts); return
    case 'note': await api.putNote(projectId, job.key, job.payload as api.NotePut, opts); return
  }
}

// ---------- local changes -> outbox ----------
function diffAndEnqueue(next: PlanDoc, prev: PlanDoc) {
  if (applying || next === prev) return
  const now = new Date().toISOString()

  if (next.measurements !== prev.measurements) {
    for (const [label, m] of Object.entries(next.measurements))
      if (prev.measurements[label] !== m) void queue.enqueue('measurement', label, { actualCm: m.actualCm, updatedAt: m.updatedAt })
    for (const label of Object.keys(prev.measurements))
      if (!(label in next.measurements)) void queue.enqueue('delete-measurement', label, null)
  }
  if (next.roomNotes !== prev.roomNotes) {
    for (const [code, text] of Object.entries(next.roomNotes))
      if (prev.roomNotes[code] !== text) void queue.enqueue('note', code, { text, updatedAt: now })
  }
  if (next.elements !== prev.elements) {
    const before = new Map(prev.elements.map((e) => [e.id, e]))
    for (const e of next.elements) if (before.get(e.id) !== e) void queue.enqueue('item', e.id, { ...e, updatedAt: e.updatedAt || now })
    const after = new Set(next.elements.map((e) => e.id))
    for (const e of prev.elements) if (!after.has(e.id)) void queue.enqueue('delete-item', e.id, null)
  }
  const pinsChanged = (next as { pins?: unknown }).pins !== (prev as { pins?: unknown }).pins
  if (pinsChanged) void uploadPhotos()
  if (next.rooms !== prev.rooms || next.background !== prev.background || next.title !== prev.title || next.tapes !== prev.tapes || next.elements !== prev.elements || pinsChanged) {
    // Debounce: drags produce many updates.
    if (snapTimer) clearTimeout(snapTimer)
    snapTimer = setTimeout(() => { void queue.enqueue('snapshot', '', null) }, 1500)
  }
  // Keep the server project list in sync when the plan title changes (e.g. "Load demo apartment"
  // or a rename): PATCH projects.title right away. Best effort — offline, the snapshot PUT
  // also copies the title into the projects row when it is uploaded.
  const titlePatch = titlePatchForDoc(prev.title, next.title)
  if (titlePatch && !isLocalId(next.projectId)) {
    void api.patchProject(next.projectId, titlePatch).catch(() => { /* the snapshot carries the title later */ })
  }
  if (next.background?.src.startsWith('data:') && !next.background.r2Key && next.background !== prev.background) void uploadBackground()
}

// ---------- background image (R2) ----------
let uploading = false
async function uploadBackground() {
  const d = useDoc.getState().doc
  if (!connected || uploading || !d.background?.src.startsWith('data:') || d.background.r2Key) return
  uploading = true
  try {
    const blob = await (await fetch(d.background.src)).blob()
    const { key } = await api.uploadImage(d.projectId, blob, 'plan.' + (blob.type.split('/')[1] || 'png'))
    useDoc.getState().updateSilent((doc) => (doc.background ? { ...doc, background: { ...doc.background, r2Key: key } } : doc))
  } catch { /* retried on next connect */ } finally { uploading = false }
}

// ---------- pin photos (R2) ----------
// Pins keep photos as data URLs while offline. When connected, each one is uploaded
// and replaced by its R2 key (silent update: no undo step). The change to `pins`
// then goes out with the next snapshot.
let uploadingPhotos = false
async function uploadPhotos() {
  if (!connected || uploadingPhotos) return
  uploadingPhotos = true
  const gen = generation
  try {
    for (;;) {
      const doc = useDoc.getState().doc
      const [dataUrl] = collectDataUrls(pinsOf(doc))
      if (!dataUrl || gen !== generation) break
      const blob = await (await fetch(dataUrl)).blob()
      const { key } = await api.uploadImage(doc.projectId, blob, 'photo.' + (blob.type.split('/')[1] || 'jpg'))
      if (gen !== generation) break
      useDoc.getState().updateSilent((d) => {
        const pins = (d as unknown as { pins?: PinLike[] }).pins
        return pins ? ({ ...d, pins: replacePhoto(pins, dataUrl, key) } as PlanDoc) : d
      })
    }
  } catch { /* retried on next connect or next pins change */ } finally { uploadingPhotos = false }
}

async function loadBackgroundFromR2(bg: BackgroundImage): Promise<string> {
  const pass = ls.get(PASS_KEY)
  const res = await fetch(api.imageUrl(bg.r2Key!), { headers: pass ? { 'x-passcode': pass } : {} })
  if (!res.ok) throw new Error('image ' + res.status)
  return URL.createObjectURL(await res.blob())
}

// ---------- server -> local ----------
function applyServer(fn: (d: PlanDoc) => PlanDoc) {
  applying = true
  try { useDoc.getState().updateSilent(fn) } finally { applying = false }
}

async function pull() {
  const d = useDoc.getState().doc
  if (!connected || queue.getState().pending > 0) return
  const gen = generation
  const since = getSince(d.projectId) || new Date(0).toISOString()
  try {
    const ch = await api.getChanges(d.projectId, since)
    if (gen !== generation || queue.getState().pending > 0) return
    if (ch.measurements.length || ch.notes.length || ch.items.length) {
      applyServer((doc) => {
        const measurements = { ...doc.measurements }
        for (const m of ch.measurements) measurements[m.label] = { label: m.label, actualCm: m.actualCm, updatedAt: m.updatedAt }
        const roomNotes = { ...doc.roomNotes }
        for (const n of ch.notes) roomNotes[n.roomCode] = n.text
        let elements = doc.elements
        for (const it of ch.items) {
          elements = elements.filter((e) => e.id !== it.id)
          if (!it.deleted && it.data) elements = [...elements, it.data]
        }
        return { ...doc, measurements, roomNotes, elements }
      })
    }
    setSince(d.projectId, ch.now)
    if (syncState.conn !== 'online') setSync({ conn: 'online' })
  } catch (e) { handleError(e) }
}

function handleError(e: unknown) {
  if (e instanceof api.ApiError && e.status === 401) { connected = false; setSync({ conn: 'locked' }) }
  else if (e instanceof api.ApiError && e.status === 404) setSync({ conn: 'no-server', detail: 'project not found' })
  else setSync({ conn: 'offline', detail: e instanceof Error ? e.message : String(e) })
}

// ---------- polling ----------
function schedulePull() {
  if (pullTimer) clearTimeout(pullTimer)
  const ms = pollIntervalMs(document.visibilityState === 'visible', useUi.getState().mode === 'measure')
  pullTimer = setTimeout(() => { void pull().finally(() => { if (connected) schedulePull() }) }, ms)
}

/** Full load from the server, or first upload of a local project. */
async function connect() {
  const gen = generation
  const stale = () => gen !== generation
  try {
    let d = useDoc.getState().doc
    if (isLocalId(d.projectId)) {
      const oldId = d.projectId
      const p = await api.createProject({ name: d.title, title: d.title })
      if (stale()) return
      applyServer((doc) => ({ ...doc, projectId: p.id }))
      setVersion(p.id, 0)
      idb.setLastProjectId(p.id)
      await idb.flushSave()
      await idb.deleteDoc(oldId)
      d = useDoc.getState().doc
    }
    queue.setProjectId(d.projectId)
    const server = await api.getProject(d.projectId)
    if (stale()) return
    connected = true
    const version = getVersion(d.projectId)
    const localPending = (await queue.countJobs(d.projectId)) > 0
    if (server.version > version && !localPending) {
      // Server has newer geometry: adopt it all.
      const { version: v, ...rest } = server
      let background = rest.background
      if (background?.r2Key && !background.src) {
        try { background = { ...background, src: await loadBackgroundFromR2(background) } } catch { /* show without image */ }
      }
      if (stale()) return
      applyServer(() => ({ ...rest, background }))
      setVersion(d.projectId, v)
    } else if (server.version === 0 || server.version < version || localPending) {
      // First upload, or local geometry is ahead: push everything we have.
      await queue.enqueue('snapshot', '', null)
      if (server.version === 0) {
        for (const m of Object.values(d.measurements)) await queue.enqueue('measurement', m.label, { actualCm: m.actualCm, updatedAt: m.updatedAt })
        for (const [code, text] of Object.entries(d.roomNotes)) await queue.enqueue('note', code, { text })
        for (const e of d.elements) await queue.enqueue('item', e.id, e)
      }
    }
    // Local background / photos that have not been uploaded yet.
    void uploadBackground()
    void uploadPhotos()
    // Background stored in R2 but not loaded on this device (or a stale blob: URL after reload).
    const bg = useDoc.getState().doc.background
    if (bg?.r2Key && (!bg.src || bg.src.startsWith('blob:'))) {
      loadBackgroundFromR2(bg).then((src) => { if (!stale()) applyServer((doc) => (doc.background ? { ...doc, background: { ...doc.background, src } } : doc)) }, () => {})
    }
    setSync({ conn: 'online' })
    schedulePull()
    void pull()
  } catch (e) {
    if (stale()) return
    if (e instanceof TypeError || (e instanceof api.ApiError && e.status >= 500) || (e instanceof api.ApiError && e.status === 404 && isLocalId(useDoc.getState().doc.projectId))) {
      // No API reachable (e.g. plain `vite` dev without wrangler): stay local.
      setSync({ conn: 'no-server' })
    } else handleError(e)
    setTimeout(() => { if (!connected && !stale()) void connect() }, CONNECT_RETRY_MS)
  }
}

/**
 * Switch the whole app to another project (used by the projects dialog).
 * The doc must already hold the right projectId. Undo history is reset.
 */
export async function openDoc(doc: PlanDoc): Promise<void> {
  // Send the pending geometry of the project we are leaving, and save it locally.
  if (snapTimer) { clearTimeout(snapTimer); snapTimer = null; await queue.enqueue('snapshot', '', null) }
  await idb.flushSave()
  generation++
  connected = false
  if (pullTimer) { clearTimeout(pullTimer); pullTimer = null }
  uploading = false
  uploadingPhotos = false
  applying = true
  try {
    useDoc.getState().replace(doc)
    useDoc.temporal.getState().clear()
  } finally { applying = false }
  idb.setLastProjectId(doc.projectId)
  await idb.saveDoc(doc)
  queue.setProjectId(doc.projectId)
  setSync({ conn: 'connecting' })
  void connect()
}

/** Forget a deleted project: waiting jobs, local record, version keys. */
export async function forgetProject(projectId: string): Promise<void> {
  await queue.dropJobs(projectId)
  await idb.deleteDoc(projectId)
  ls.set(projectKey('version', projectId), null)
  ls.set(projectKey('since', projectId), null)
}

export const isConnected = (): boolean => connected

let started = false
export function startSync() {
  if (started || typeof window === 'undefined') return
  started = true
  migrateLegacyKeys(useDoc.getState().doc.projectId)
  queue.setSender(sender)
  queue.start()
  useDoc.subscribe((s, p) => diffAndEnqueue(s.doc, p.doc))
  // Poll faster/slower when the tab is shown/hidden or the mode changes.
  document.addEventListener('visibilitychange', () => { if (connected) schedulePull() })
  useUi.subscribe((s, p) => { if (s.mode !== p.mode && connected) schedulePull() })
  void connect()
}

// ---------- status for the UI ----------
const hhmm = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '')

export function useSyncState() {
  const [, force] = useState(0)
  useEffect(() => {
    const l = () => force((n) => n + 1)
    listeners.add(l)
    const un = queue.subscribe(l)
    return () => { listeners.delete(l); un() }
  }, [])
  const q = queue.getState()
  return { ...syncState, pending: q.pending, lastError: q.lastError, lastSyncAt: q.lastSyncAt }
}

/** One-line status text, like the prototype. */
export function useSyncStatusText(): { text: string; warn: boolean } {
  const s = useSyncState()
  const n = s.pending, ch = `${n} change${n > 1 ? 's' : ''}`
  if (s.conn === 'locked') return { text: 'Passcode needed to save online. Changes are kept on this device.', warn: true }
  if (s.conn === 'no-server') return { text: n ? `${ch} kept on this device only. Online saving is not available here.` : 'Online saving is not available here. Values are kept on this device.', warn: true }
  if (n) return { text: `${ch} waiting to upload. They are safe on this device and upload when the connection is back.${s.lastError ? ` (Last error: ${s.lastError})` : ''}`, warn: true }
  if (s.conn === 'offline') return { text: `Offline. Values are kept on this device.${s.detail ? ` (${s.detail})` : ''}`, warn: true }
  if (s.conn === 'connecting') return { text: 'Connecting…', warn: false }
  return { text: `All saved online${s.lastSyncAt ? ` · ${hhmm(s.lastSyncAt)}` : ''}`, warn: false }
}
