// Compact cloud-sync popover for the top bar: saves the current project as a D1 snapshot
// (reference images go to R2) and loads or deletes earlier cloud projects.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Cloud, CloudUpload, Trash2 } from 'lucide-react'
import { toast } from '../features/toast'
import { useDoc } from '../model/store'
import { useUi } from '../shell/uiStore'
import {
  deleteCloudProject,
  listCloudProjects,
  loadProjectFromCloud,
  saveProjectToCloud,
  type CloudProjectSummary,
} from './cloud'

const MENU_BTN = 'flex h-9 w-9 items-center justify-center rounded-md text-zinc-300 hover:bg-white/10 disabled:opacity-40'
const ROW_BTN = 'min-w-0 flex-1 rounded-md px-2 py-1.5 text-left hover:bg-white/10 disabled:opacity-50'
const DEL_BTN =
  'flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-zinc-500 hover:bg-white/10 hover:text-red-400 disabled:opacity-40'

/** Shown when /api/* is missing, e.g. plain `vite dev` without the Pages Functions runtime. */
const UNAVAILABLE = 'Cloud API unavailable in local dev. Deploy to Cloudflare Pages to enable.'

/** Short, local, human date for a project row; empty string when the stamp is unparsable. */
function shortDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : 'unknown error')

export function CloudMenu() {
  const [open, setOpen] = useState(false)
  const [projects, setProjects] = useState<CloudProjectSummary[] | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  const [busy, setBusy] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  /** No fetched list and no failure yet: a request is in flight (or about to be). */
  const loading = projects === null && !unavailable

  const refresh = useCallback(async () => {
    try {
      setProjects(await listCloudProjects())
      setUnavailable(false)
    } catch {
      setProjects(null)
      setUnavailable(true)
    }
  }, [])

  // Fetch the list on every open (other tabs may have written new snapshots, and the last
  // request may have failed in local dev). Not an effect: the click is the only trigger.
  const toggle = () => {
    if (open) {
      setOpen(false)
      return
    }
    setOpen(true)
    setProjects(null)
    setUnavailable(false)
    void refresh()
  }

  // Close on Escape or on a pointer press outside the button + popover.
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // Do not let the global shortcut handler also act on this Escape.
      e.stopPropagation()
      setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const onSave = async () => {
    setBusy(true)
    try {
      await saveProjectToCloud(useDoc.getState().doc)
      toast('Saved to cloud')
      await refresh()
    } catch (err) {
      toast(`Cloud save failed: ${errorText(err)}`)
    } finally {
      setBusy(false)
    }
  }

  const onLoad = async (id: string) => {
    setBusy(true)
    try {
      const doc = await loadProjectFromCloud(id)
      useDoc.getState().hydrate(doc)
      useUi.getState().set({ activeArtboardId: null, selection: { kind: 'none' } })
      setOpen(false)
      toast(`Loaded "${doc.title}"`)
    } catch (err) {
      toast(`Cloud load failed: ${errorText(err)}`)
    } finally {
      setBusy(false)
    }
  }

  const onDelete = async (p: CloudProjectSummary) => {
    setBusy(true)
    try {
      await deleteCloudProject(p.id)
      await refresh()
    } catch (err) {
      toast(`Cloud delete failed: ${errorText(err)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        className={MENU_BTN}
        aria-label="Cloud sync"
        title="Cloud sync (save/load)"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={toggle}
      >
        <Cloud size={18} />
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Cloud sync"
          className="absolute right-0 top-full z-50 mt-1 w-72 rounded-lg border border-white/10 bg-[#1a2028] p-3 shadow-xl"
        >
          <button
            type="button"
            disabled={busy}
            onClick={() => void onSave()}
            className="flex w-full items-center justify-center gap-1.5 rounded-md bg-orange-700 px-2 py-2 text-sm font-semibold text-white hover:bg-orange-800 disabled:opacity-50"
          >
            <CloudUpload size={16} />
            Save current project
          </button>
          <div className="my-3 border-t border-white/10" />
          <p className="pb-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Cloud projects</p>
          <div className="max-h-64 overflow-y-auto">
            {loading ? (
              <p className="px-2 py-1 text-xs text-zinc-500">Loading…</p>
            ) : unavailable ? (
              <p className="px-2 py-1 text-xs leading-snug text-zinc-500">{UNAVAILABLE}</p>
            ) : !projects || projects.length === 0 ? (
              <p className="px-2 py-1 text-xs text-zinc-500">No cloud projects yet.</p>
            ) : (
              <ul className="space-y-0.5">
                {projects.map((p) => (
                  <li key={p.id} className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={busy}
                      title={`Load "${p.title}"`}
                      onClick={() => void onLoad(p.id)}
                      className={ROW_BTN}
                    >
                      <span className="block truncate text-sm text-zinc-100">{p.title || 'Untitled'}</span>
                      <span className="block text-[11px] text-zinc-500">{shortDate(p.updatedAt)}</span>
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      aria-label={`Delete "${p.title}"`}
                      title={`Delete "${p.title}"`}
                      onClick={() => void onDelete(p)}
                      className={DEL_BTN}
                    >
                      <Trash2 size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
