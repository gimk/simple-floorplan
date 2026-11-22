// Projects: header title button + dialog (list, create, open, rename, delete).
import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, Cloud, FolderOpen, Pencil, Plus, Trash2, X } from 'lucide-react'
import { emptyDoc, uid, useDoc } from '../../model/store'
import type { PlanDoc } from '../../model/types'
import * as api from '../../sync/api'
import * as idb from '../../sync/idb'
import { mergeProjectLists, type ProjectListItem } from '../../sync/projects'
import { forgetProject, openDoc } from '../../sync/sync'
import { UpdateToast } from './UpdateToast'

export { UpdateToast }

const field = 'h-9 rounded-md border border-black/15 bg-transparent px-2 text-sm dark:border-white/20'
const iconBtn = 'flex h-9 w-9 items-center justify-center rounded-md hover:bg-black/5 dark:hover:bg-white/10'

async function loadList(): Promise<ProjectListItem[]> {
  const local = (await idb.listDocs()).map((r) => ({ id: r.projectId, title: r.doc.title, savedAt: r.savedAt }))
  let server: Awaited<ReturnType<typeof api.listProjects>> | null = null
  try { server = await api.listProjects() } catch { /* offline, locked or no server: local only */ }
  return mergeProjectLists(server, local)
}

async function createProject(title: string): Promise<void> {
  let projectId = 'local-' + uid()
  try { projectId = (await api.createProject({ name: title, title })).id } catch { /* offline: becomes a server project at the next connect */ }
  await openDoc({ ...emptyDoc(), projectId, title })
}

async function openProject(id: string): Promise<void> {
  const local = await idb.getDoc(id)
  // Without a local copy, start from a placeholder: connect() adopts the server doc.
  const doc: PlanDoc = local ? { ...emptyDoc(), ...local } : { ...emptyDoc(), projectId: id, title: '' }
  await openDoc(doc)
}

async function renameCurrent(title: string): Promise<void> {
  useDoc.getState().update((d) => ({ ...d, title }))
  const id = useDoc.getState().doc.projectId
  try { await api.patchProject(id, { name: title, title }) } catch { /* the snapshot carries the title when online again */ }
}

async function removeProject(id: string): Promise<void> {
  try { await api.deleteProject(id) } catch (e) {
    if (!(e instanceof api.ApiError && e.status === 404) && !id.startsWith('local')) throw e
  }
  const wasCurrent = useDoc.getState().doc.projectId === id
  if (wasCurrent) {
    // Switch away first: leaving a project saves its doc, and we delete that record last.
    const next = (await loadList()).find((p) => p.id !== id)
    if (next) await openProject(next.id)
    else await createProject('New apartment')
  }
  await forgetProject(id)
}

function ProjectsDialog({ onClose }: { onClose: () => void }) {
  const currentId = useDoc((s) => s.doc.projectId)
  const currentTitle = useDoc((s) => s.doc.title)
  const [items, setItems] = useState<ProjectListItem[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [newName, setNewName] = useState('')
  const [rename, setRename] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)

  const refresh = useCallback(() => { void loadList().then(setItems) }, [])
  useEffect(refresh, [refresh])
  const prevFocus = useRef<HTMLElement | null>(null)
  useEffect(() => {
    prevFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose() }
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      prevFocus.current?.focus()
    }
  }, [onClose])

  const run = async (fn: () => Promise<void>, closeAfter = false) => {
    setBusy(true); setError('')
    try { await fn(); if (closeAfter) onClose(); else refresh() } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-16" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Projects" className="flex max-h-[80vh] w-full max-w-md flex-col rounded-xl border border-black/10 bg-white p-4 shadow-xl dark:border-white/15 dark:bg-[#1b2128]" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center">
          <h2 className="flex-1 text-lg font-semibold">Projects</h2>
          <button autoFocus className={iconBtn} aria-label="Close" onClick={onClose}><X size={18} /></button>
        </div>

        <form className="mb-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); const t = newName.trim() || 'New apartment'; setNewName(''); void run(() => createProject(t), true) }}>
          <input name="newProjectName" aria-label="New project name" className={`${field} min-w-0 flex-1`} placeholder="New project name" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <button type="submit" disabled={busy} className="flex h-9 items-center gap-1 rounded-md bg-orange-700 px-3 text-sm font-semibold text-white hover:bg-orange-800 disabled:opacity-50"><Plus size={16} /> New</button>
        </form>

        {error && <p role="alert" className="mb-2 text-sm text-red-600 dark:text-red-400">{error}</p>}

        <ul className="min-h-0 flex-1 overflow-y-auto">
          {items === null && <li className="p-2 text-sm opacity-60">Loading…</li>}
          {items?.map((p) => {
            const current = p.id === currentId
            return (
              <li key={p.id} className={`flex items-center gap-1 rounded-md px-2 py-1 ${current ? 'bg-orange-600/10' : ''}`}>
                {rename !== null && current ? (
                  <form className="flex min-w-0 flex-1 gap-1" onSubmit={(e) => { e.preventDefault(); const t = rename.trim(); setRename(null); if (t) void run(() => renameCurrent(t)) }}>
                    <input name="projectName" aria-label="Project name" autoFocus className={`${field} min-w-0 flex-1`} value={rename} onChange={(e) => setRename(e.target.value)} />
                    <button type="submit" className="h-9 rounded-md px-2 text-sm font-semibold text-orange-700 dark:text-orange-400">Save</button>
                  </form>
                ) : (
                  <button disabled={busy} className="flex min-h-9 min-w-0 flex-1 flex-col items-start justify-center text-left" onClick={() => (current ? onClose() : void run(() => openProject(p.id), true))}>
                    <span className="flex w-full items-center gap-1 truncate text-sm font-medium">
                      {current ? currentTitle || p.name : p.name}
                      {!p.remote && <span className="rounded bg-black/10 px-1 text-[10px] dark:bg-white/15">this device only</span>}
                      {p.remote && <Cloud size={12} className="shrink-0 opacity-50" />}
                    </span>
                    {p.updatedAt && <span className="text-xs opacity-60">{new Date(p.updatedAt).toLocaleString()}</span>}
                  </button>
                )}
                {confirmId === p.id ? (
                  <>
                    <button className="h-9 rounded-md bg-red-600 px-2 text-sm font-semibold text-white" disabled={busy} onClick={() => { setConfirmId(null); void run(() => removeProject(p.id)) }}>Delete?</button>
                    <button className="h-9 px-2 text-sm" onClick={() => setConfirmId(null)}>Cancel</button>
                  </>
                ) : (
                  <>
                    {current && rename === null && <button className={iconBtn} aria-label="Rename" title="Rename" onClick={() => setRename(currentTitle)}><Pencil size={16} /></button>}
                    {!current && <button className={iconBtn} aria-label="Open" title="Open" disabled={busy} onClick={() => void run(() => openProject(p.id), true)}><FolderOpen size={16} /></button>}
                    <button className={iconBtn} aria-label="Delete" title="Delete" onClick={() => setConfirmId(p.id)}><Trash2 size={16} /></button>
                  </>
                )}
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}

/** Header: project title as a button that opens the projects dialog. Also hosts the update toast. */
export function ProjectTitleButton() {
  const title = useDoc((s) => s.doc.title)
  const [open, setOpen] = useState(false)
  return (
    <>
      <h1 className="min-w-0">
        <button className="flex h-9 max-w-full min-w-0 items-center gap-1 rounded-md px-2 font-semibold hover:bg-black/5 dark:hover:bg-white/10" title="Projects" onClick={() => setOpen(true)}>
          <span className="truncate">{title || 'Untitled'}</span>
          <ChevronDown size={16} className="shrink-0 opacity-60" />
        </button>
      </h1>
      {open && <ProjectsDialog onClose={() => setOpen(false)} />}
    </>
  )
}
