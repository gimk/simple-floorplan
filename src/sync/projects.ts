// Pure helpers for projects (no browser APIs, easy to test).
import type { PlanDoc } from '../model/types'

export const LAST_PROJECT_KEY = 'simple-floorplan:last-project'
export const SNAPSHOTS_TO_KEEP = 50

/** localStorage key for a per-project value ("version", "since", ...). */
export const projectKey = (base: string, projectId: string): string => `simple-floorplan:${base}:${projectId}`

/** Ids that never reached the server: the first one is 'local', the others 'local-xxxx'. */
export const isLocalId = (id: string): boolean => id === 'local' || id.startsWith('local-')

export type ProjectListItem = {
  id: string
  name: string
  updatedAt: string | null
  /** The project exists on the server. */
  remote: boolean
  /** The project exists in this browser (IndexedDB). */
  local: boolean
}

type ServerItem = { id: string; name: string; title: string | null; updatedAt: string }
type LocalItem = { id: string; title: string; savedAt: string }

const displayName = (name: string | null | undefined, fallback: string): string => (name && name.trim() ? name : fallback)

/**
 * Merge the server list with the local records. Offline, `server` is null and only
 * local projects are shown. Newest first.
 */
export function mergeProjectLists(server: ServerItem[] | null, local: LocalItem[]): ProjectListItem[] {
  const map = new Map<string, ProjectListItem>()
  for (const s of server ?? []) {
    map.set(s.id, { id: s.id, name: displayName(s.title, displayName(s.name, 'Untitled')), updatedAt: s.updatedAt, remote: true, local: false })
  }
  for (const l of local) {
    const prev = map.get(l.id)
    if (prev) {
      prev.local = true
      // The local title is the freshest one for a project we have opened.
      if (l.title.trim()) prev.name = l.title
    } else {
      map.set(l.id, { id: l.id, name: displayName(l.title, 'Untitled'), updatedAt: l.savedAt, remote: false, local: true })
    }
  }
  return [...map.values()].sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
}

/**
 * PATCH payload that keeps the server project title in sync with the doc title.
 * Returns null when nothing needs to be sent (title unchanged or blank).
 */
export function titlePatchForDoc(prevTitle: string, nextTitle: string): { title: string } | null {
  return nextTitle !== prevTitle && nextTitle.trim() ? { title: nextTitle } : null
}

/** Polling interval (ms). Fast only while a person is looking at Measuring Mode. */
export const POLL_FAST_MS = 3_000
export const POLL_SLOW_MS = 15_000
export const pollIntervalMs = (visible: boolean, measuring: boolean): number => (visible && measuring ? POLL_FAST_MS : POLL_SLOW_MS)

/** Highest version that must be deleted so only the last `keep` remain (<= 0: delete nothing). */
export const pruneCutoffVersion = (newestVersion: number, keep = SNAPSHOTS_TO_KEEP): number => newestVersion - keep

export const PRUNE_SNAPSHOTS_SQL = 'DELETE FROM floorplan_snapshots WHERE project_id = ? AND version <= ?'

// ---------- photos (pins[].photoKeys) ----------

export type PinLike = { id?: string; photoKeys?: string[] }

export const isDataUrl = (s: string): boolean => s.startsWith('data:')
export const isInlinePhoto = (s: string): boolean => s.startsWith('data:') || s.startsWith('blob:')

/** All data-URL photos in the pins, in order (without duplicates). */
export function collectDataUrls(pins: PinLike[] | undefined): string[] {
  const out = new Set<string>()
  for (const p of pins ?? []) for (const k of p.photoKeys ?? []) if (isDataUrl(k)) out.add(k)
  return [...out]
}

/** Replace a data URL by its R2 key everywhere. Returns the same array if nothing matched. */
export function replacePhoto<T extends PinLike>(pins: T[], dataUrl: string, key: string): T[] {
  let changed = false
  const next = pins.map((p) => {
    if (!p.photoKeys?.includes(dataUrl)) return p
    changed = true
    return { ...p, photoKeys: p.photoKeys.map((k) => (k === dataUrl ? key : k)) }
  })
  return changed ? next : pins
}

export const pinsOf = (doc: PlanDoc): PinLike[] => ((doc as unknown as { pins?: PinLike[] }).pins ?? [])
