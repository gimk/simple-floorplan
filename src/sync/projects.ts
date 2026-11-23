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

/**
 * Snapshot versions that a prune run deletes (docs/walls-plan.md 5c, Safety).
 * The last `keep` versions stay. While the project holds a v2 snapshot, a snapshot saved before
 * the conversion (schemaVersion missing or 1) is NEVER deleted: the team can go back to it.
 * Same rule as PRUNE_SNAPSHOTS_SQL below: change both together.
 */
export function pruneSnapshotVersions(rows: SnapshotHeader[], keep = SNAPSHOTS_TO_KEEP): number[] {
  const newest = rows.reduce((m, r) => Math.max(m, r.version), 0)
  const cutoff = pruneCutoffVersion(newest, keep)
  const hasV2 = rows.some((r) => r.schemaVersion === 2)
  return rows
    .filter((r) => r.version <= cutoff && !(hasV2 && r.schemaVersion !== 2))
    .map((r) => r.version)
    .sort((a, b) => a - b)
}

/** Version and schema version of one stored snapshot. `schemaVersion` is null when it has none. */
export type SnapshotHeader = { version: number; schemaVersion?: number | null }

/**
 * Delete the old snapshots of ONE project (D1, SQLite JSON1).
 * Bind values: project id, the cutoff version, then the project id again (the subquery).
 * `COALESCE(..., 1)` reads a snapshot saved before schemaVersion as v1, exactly like pruneSnapshotVersions.
 */
export const PRUNE_SNAPSHOTS_SQL = `DELETE FROM floorplan_snapshots
WHERE project_id = ? AND version <= ?
  AND NOT (
    COALESCE(json_extract(data_json, '$.schemaVersion'), 1) <> 2
    AND EXISTS (
      SELECT 1 FROM floorplan_snapshots v2
      WHERE v2.project_id = ? AND json_extract(v2.data_json, '$.schemaVersion') = 2
    )
  )`

// ---------- photos (pins[].photoKeys) ----------

export type PinLike = { id?: string; photoKeys?: string[]; sketches?: Record<string, unknown> }

export const isDataUrl = (s: string): boolean => s.startsWith('data:')
export const isInlinePhoto = (s: string): boolean => s.startsWith('data:') || s.startsWith('blob:')

/** All data-URL photos in the pins, in order (without duplicates). */
export function collectDataUrls(pins: PinLike[] | undefined): string[] {
  const out = new Set<string>()
  for (const p of pins ?? []) for (const k of p.photoKeys ?? []) if (isDataUrl(k)) out.add(k)
  return [...out]
}

/**
 * Replace a data URL by its R2 key everywhere (photo list AND photo sketches).
 * Returns the same array if nothing matched.
 */
export function replacePhoto<T extends PinLike>(pins: T[], dataUrl: string, key: string): T[] {
  let changed = false
  const next = pins.map((p) => {
    if (!p.photoKeys?.includes(dataUrl)) return p
    changed = true
    const photoKeys = p.photoKeys.map((k) => (k === dataUrl ? key : k))
    const sketches = p.sketches?.[dataUrl] ? moveSketchKey(p.sketches, dataUrl, key) : p.sketches
    return { ...p, photoKeys, ...(sketches ? { sketches } : {}) }
  })
  return changed ? next : pins
}

/** Same sketches record with one photo key renamed (merges with marks already on the new key). */
const moveSketchKey = (
  sketches: Record<string, unknown>,
  from: string,
  to: string,
): Record<string, unknown> => {
  const { [from]: moved, ...rest } = sketches
  const merged = Array.isArray(rest[to]) && Array.isArray(moved) ? [...(rest[to] as unknown[]), ...moved] : moved
  return { ...rest, [to]: merged }
}

export const pinsOf = (doc: PlanDoc): PinLike[] => ((doc as unknown as { pins?: PinLike[] }).pins ?? [])
