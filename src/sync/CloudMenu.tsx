// Compact cloud-sync popover for the top bar: saves the current project as a D1 snapshot
// (reference images go to R2) and loads or deletes earlier cloud projects.
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Cloud, CloudAlert, CloudOff, CloudUpload, Loader2, Lock, Trash2 } from 'lucide-react'
import { toast } from '../features/toast'
import { useDoc } from '../model/store'
import { BTN, BTN_DANGER, BTN_PRIMARY, IconButton, INPUT } from '../shell/panel'
import { useUi } from '../shell/uiStore'
import { useDialogFocus } from '../shell/useDialogFocus'
import {
  CloudUnauthorizedError,
  clearCloudToken,
  deleteCloudProject,
  getCloudToken,
  listCloudProjects,
  loadProjectFromCloud,
  saveProjectToCloud,
  setCloudToken,
  type CloudProjectSummary,
} from './cloud'
import { relativeTime } from './relativeTime'
import {
  hasUnsyncedChanges,
  isCloudAutosaveEnabled,
  markCloudSynced,
  resumeCloudAutosave,
  setCloudAutosaveEnabled,
  useCloudAutosave,
} from './cloudAutosave'

const ROW_BTN = 'min-w-0 flex-1 rounded-md px-2 py-1.5 text-left hover:bg-white/10 disabled:opacity-50 pointer-coarse:min-h-11'
const DEL_BTN =
  'flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-white/10 hover:text-red-400 disabled:opacity-40 pointer-coarse:h-11 pointer-coarse:w-11'
const LOCK_BTN =
  'flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:bg-white/10 hover:text-slate-200 disabled:opacity-40 pointer-coarse:h-11 pointer-coarse:w-11'
const HEAD = 'text-[11px] font-semibold uppercase tracking-wide text-slate-400'

/** Shown when /api/* is missing, e.g. plain `vite dev` without the Worker runtime. */
const UNAVAILABLE =
  'Cloud API unavailable. It needs the Cloudflare Worker deployment (or `wrangler dev`); a static-only deployment or plain `vite dev` has no /api.'

const errorText = (err: unknown) => (err instanceof Error ? err.message : 'unknown error')

type Pending = { kind: 'load' | 'delete'; id: string }

export function CloudMenu({ showLabel = false }: { /** Render the trigger as a full-width labelled row (for the overflow menu). */ showLabel?: boolean }) {
  const [open, setOpen] = useState(false)
  const [projects, setProjects] = useState<CloudProjectSummary[] | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  const [locked, setLocked] = useState(false)
  const [passcode, setPasscode] = useState('')
  const [rejected, setRejected] = useState(false)
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
  const [synced, setSynced] = useState(false)
  const [pending, setPending] = useState<Pending | null>(null)
  const [autoOn, setAutoOn] = useState(isCloudAutosaveEnabled)
  const auto = useCloudAutosave()
  const rootRef = useRef<HTMLDivElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const saveRef = useRef<HTMLButtonElement>(null)
  const passRef = useRef<HTMLInputElement>(null)
  const title = useDoc((s) => s.doc.title)

  /** No fetched list and no failure yet: a request is in flight (or about to be). */
  const loading = projects === null && !unavailable
  /** Only offer the Lock button once we hold a saved passcode and the list is usable. */
  const canLock = !locked && getCloudToken() !== null

  const triggerEl = () => rootRef.current?.querySelector<HTMLButtonElement>('button') ?? null
  const close = useCallback((returnFocus = true) => {
    setOpen(false)
    setPending(null)
    if (returnFocus) requestAnimationFrame(() => triggerEl()?.focus())
  }, [])

  /** A 401 means the server wants a passcode: show the unlock form, not "unavailable". */
  const showLocked = useCallback(() => {
    setProjects(null)
    setUnavailable(false)
    setRejected(false)
    setLocked(true)
    setSynced(false)
  }, [])

  const refresh = useCallback(async () => {
    try {
      setProjects(await listCloudProjects())
      setUnavailable(false)
      setLocked(false)
      setSynced(true)
    } catch (err) {
      if (err instanceof CloudUnauthorizedError) {
        showLocked()
        return
      }
      setProjects(null)
      setUnavailable(true)
      setSynced(false)
    }
  }, [showLocked])

  // Fetch the list on every open (other tabs may have written new snapshots, and the last
  // request may have failed in local dev). Not an effect: the click is the only trigger.
  const toggle = () => {
    if (open) {
      close()
      return
    }
    setOpen(true)
    setProjects(null)
    setUnavailable(false)
    setPending(null)
    void refresh()
  }

  // Focus in on open, Tab trapped inside the popover, focus restored on close.
  useDialogFocus(open, dialogRef)

  // Focus: the passcode input when locked, else the Save button.
  useEffect(() => {
    if (!open) return
    if (locked) passRef.current?.focus()
    else saveRef.current?.focus()
  }, [open, locked])

  // Close on Escape or on a pointer press outside the button + popover.
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // Do not let the global shortcut handler also act on this Escape.
      e.stopPropagation()
      close()
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, close])

  /** Try the typed passcode: keep it on success, drop it and hint on a second 401. */
  const onSubmitPasscode = async (e: FormEvent) => {
    e.preventDefault()
    const value = passcode.trim()
    if (!value || busy) return
    setBusy(true)
    setCloudToken(value)
    try {
      setProjects(await listCloudProjects())
      setUnavailable(false)
      setLocked(false)
      setRejected(false)
      setSynced(true)
      setPasscode('')
      resumeCloudAutosave()
    } catch (err) {
      clearCloudToken()
      setProjects(null)
      if (err instanceof CloudUnauthorizedError) {
        setLocked(true)
        setRejected(true)
        passRef.current?.focus()
      } else {
        setLocked(false)
        setUnavailable(true)
      }
    } finally {
      setBusy(false)
    }
  }

  /** Forget the saved passcode, then re-check access: 401 locks, no secret means the list shows. */
  const onLock = () => {
    clearCloudToken()
    setPasscode('')
    setRejected(false)
    setProjects(null)
    setUnavailable(false)
    setLocked(false)
    setSynced(false)
    void refresh()
  }

  const onSave = async () => {
    setBusy(true)
    setSaving(true)
    const doc = useDoc.getState().doc
    try {
      await saveProjectToCloud(doc)
      markCloudSynced(doc)
      setFailed(false)
      toast(`Saved "${doc.title || 'Untitled plan'}" to cloud`, { kind: 'success' })
      await refresh()
    } catch (err) {
      if (err instanceof CloudUnauthorizedError) showLocked()
      else {
        setFailed(true)
        toast(`Cloud save failed: ${errorText(err)}`, { kind: 'error' })
      }
    } finally {
      setSaving(false)
      setBusy(false)
    }
  }

  const doLoad = async (id: string) => {
    setBusy(true)
    setPending(null)
    try {
      const doc = await loadProjectFromCloud(id)
      useDoc.getState().hydrate(doc)
      markCloudSynced(useDoc.getState().doc)
      useUi.getState().set({ activeArtboardId: null, selection: { kind: 'none' } })
      setFailed(false)
      close()
      toast(`Loaded "${doc.title}"`, { kind: 'success' })
    } catch (err) {
      if (err instanceof CloudUnauthorizedError) showLocked()
      else {
        setFailed(true)
        toast(`Cloud load failed: ${errorText(err)}`, { kind: 'error' })
      }
    } finally {
      setBusy(false)
    }
  }

  /** Loading replaces the open plan: ask first when it has unsaved changes. */
  const onLoad = (id: string) => {
    if (hasUnsyncedChanges()) setPending({ kind: 'load', id })
    else void doLoad(id)
  }

  const doDelete = async (p: CloudProjectSummary) => {
    setBusy(true)
    setPending(null)
    try {
      await deleteCloudProject(p.id)
      setFailed(false)
      toast(`Deleted "${p.title || 'Untitled'}" from cloud`, { kind: 'success' })
      await refresh()
    } catch (err) {
      if (err instanceof CloudUnauthorizedError) showLocked()
      else {
        setFailed(true)
        toast(`Cloud delete failed: ${errorText(err)}`, { kind: 'error' })
      }
    } finally {
      setBusy(false)
    }
  }

  const statusText = busy
    ? 'working'
    : locked
      ? 'locked'
      : unavailable
        ? 'unavailable'
        : failed
          ? 'last action failed'
          : synced
            ? 'connected'
            : ''
  const StatusIcon = locked || unavailable ? CloudOff : failed ? CloudAlert : Cloud
  const autoBusy = autoOn && auto.status === 'saving'
  const dot =
    busy || autoBusy ? 'animate-pulse bg-amber-400' : synced && !failed && !locked && !unavailable ? 'bg-emerald-400' : ''
  const triggerIcon = (
    <span className="relative flex">
      <StatusIcon size={18} aria-hidden="true" />
      {dot && <span className={`absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full ring-2 ring-surface-1 ${dot}`} aria-hidden="true" />}
      {statusText && <span className="sr-only">{statusText}</span>}
    </span>
  )

  const saveName = title.trim() || 'Untitled plan'

  /** Short autosave state, or nothing while the feature is off. */
  const autoLabel = !autoOn
    ? ''
    : auto.status === 'pending'
      ? 'Unsaved…'
      : auto.status === 'saving'
        ? 'Saving…'
        : auto.status === 'saved'
          ? auto.lastSavedAt
            ? `Saved ${relativeTime(new Date(auto.lastSavedAt).toISOString())}`
            : 'Saved'
          : auto.status === 'error'
            ? 'Failed'
            : auto.status === 'paused'
              ? 'Locked'
              : ''

  return (
    <div ref={rootRef} className="relative">
      {showLabel ? (
        <button
          type="button"
          title="Cloud sync (save/load)"
          aria-label="Cloud sync"
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={toggle}
          className="flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-sm text-slate-200 hover:bg-white/10 pointer-coarse:h-11"
        >
          {triggerIcon}
          <span>Cloud sync</span>
        </button>
      ) : (
        <IconButton label="Cloud sync" variant="bar" icon={triggerIcon} pressed={open} onClick={toggle} />
      )}
      {open && (
        <div
          ref={dialogRef}
          role="dialog"
          aria-label="Cloud sync"
          aria-busy={busy}
          className="absolute right-0 top-full z-50 mt-1 w-72 max-w-[calc(100vw-1rem)] rounded-lg border border-white/10 bg-surface-2 p-3 text-slate-200 shadow-xl"
        >
          <div className="flex items-center justify-between pb-2">
            <h2 className={HEAD}>Cloud sync</h2>
            {canLock && (
              <button
                type="button"
                disabled={busy}
                aria-label="Lock cloud saves"
                title="Lock cloud saves (forget passcode)"
                onClick={onLock}
                className={LOCK_BTN}
              >
                <Lock size={14} />
              </button>
            )}
          </div>
          {locked ? (
            <form
              className="space-y-2"
              onSubmit={(e) => {
                void onSubmitPasscode(e)
              }}
            >
              <p className="text-xs leading-snug text-slate-400">Enter the passcode to use cloud saves.</p>
              <input
                ref={passRef}
                type="password"
                value={passcode}
                disabled={busy}
                placeholder="Enter passcode"
                aria-label="Cloud passcode"
                aria-invalid={rejected}
                autoComplete="current-password"
                onChange={(e) => {
                  setPasscode(e.target.value)
                  setRejected(false)
                }}
                className={`${INPUT} disabled:opacity-50`}
              />
              <button type="submit" disabled={busy || passcode.trim() === ''} className={`${BTN_PRIMARY} w-full`}>
                <Lock size={14} />
                Unlock
              </button>
              {rejected && (
                <p role="alert" className="text-xs text-red-400">
                  Wrong passcode
                </p>
              )}
            </form>
          ) : (
            <>
              <button
                ref={saveRef}
                type="button"
                disabled={busy}
                aria-busy={saving}
                onClick={() => void onSave()}
                className={`${BTN_PRIMARY} w-full min-w-0`}
              >
                {saving ? <Loader2 size={16} className="shrink-0 animate-spin" aria-hidden="true" /> : <CloudUpload size={16} className="shrink-0" aria-hidden="true" />}
                <span className="truncate">{saving ? 'Saving…' : `Save "${saveName}"`}</span>
              </button>
              <label className="mt-2 flex items-center gap-2 text-xs text-slate-300">
                <input type="checkbox" checked={autoOn} onChange={(e) => { setAutoOn(e.target.checked); setCloudAutosaveEnabled(e.target.checked) }} />
                <span>Auto-save to cloud</span>
                <span className="ml-auto text-slate-400" aria-live="polite">{autoLabel}</span>
              </label>
              <div className="my-3 border-t border-white/10" />
              <h2 className={`${HEAD} pb-1`}>Cloud projects</h2>
              <div className="max-h-64 overflow-y-auto">
                {loading ? (
                  <p role="status" className="px-2 py-1 text-xs text-slate-400">Loading…</p>
                ) : unavailable ? (
                  <p className="px-2 py-1 text-xs leading-snug text-slate-400">{UNAVAILABLE}</p>
                ) : !projects || projects.length === 0 ? (
                  <p className="px-2 py-1 text-xs text-slate-400">No cloud projects yet.</p>
                ) : (
                  <ul className="space-y-0.5">
                    {projects.map((p) => {
                      const name = p.title || 'Untitled'
                      if (pending?.id === p.id) {
                        const isLoad = pending.kind === 'load'
                        return (
                          <li key={p.id} className="space-y-1.5 rounded-md bg-white/5 p-2">
                            <p className="text-xs leading-snug text-slate-200">
                              {isLoad ? `Replace the open plan with "${name}"? Unsaved changes are lost.` : `Delete "${name}"?`}
                            </p>
                            <div className="flex gap-1.5">
                              <button
                                type="button"
                                disabled={busy}
                                autoFocus
                                onClick={() => void (isLoad ? doLoad(p.id) : doDelete(p))}
                                className={`${isLoad ? BTN_PRIMARY : BTN_DANGER} flex-1`}
                              >
                                {isLoad ? 'Load' : 'Yes'}
                              </button>
                              <button type="button" disabled={busy} onClick={() => setPending(null)} className={`${BTN} flex-1`}>
                                {isLoad ? 'Cancel' : 'No'}
                              </button>
                            </div>
                          </li>
                        )
                      }
                      return (
                        <li key={p.id} className="flex items-center gap-1">
                          <button
                            type="button"
                            disabled={busy}
                            title={`Load "${name}"`}
                            onClick={() => onLoad(p.id)}
                            className={ROW_BTN}
                          >
                            <span className="block truncate text-sm text-slate-100">{name}</span>
                            <span className="block text-[11px] text-slate-400" title={p.updatedAt}>
                              {relativeTime(p.updatedAt)}
                            </span>
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            aria-label={`Delete "${name}"`}
                            title={`Delete "${name}"`}
                            onClick={() => setPending({ kind: 'delete', id: p.id })}
                            className={DEL_BTN}
                          >
                            <Trash2 size={14} />
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
