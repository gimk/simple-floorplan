// Typed fetch client for the API (functions/app.ts, served by functions/worker.ts).
// All routes live under /api (Vite proxies /api to wrangler on :8788 in dev).
import type { MeasureSource, PlanDoc, WallElement } from '../model/types'

export class ApiError extends Error {
  status: number
  body: unknown
  constructor(status: number, body: unknown) {
    super(`API request failed with status ${status}`)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }
}

// ---------- wire types (mirror functions/app.ts) ----------

export type ProjectSummary = { id: string; name: string; title: string | null; updatedAt: string }

/** GET /projects/:id — PlanDoc-shaped JSON plus the snapshot version. */
export type ProjectResponse = PlanDoc & { version: number }

/** PUT snapshot body: PlanDoc minus measurements/roomNotes, plus baseVersion. */
export type SnapshotPayload = Omit<PlanDoc, 'measurements' | 'roomNotes'> & { baseVersion: number }

export type MeasurementPut = { actualCm: number; updatedAt?: string; source?: MeasureSource }
export type MeasurementRow = { label: string; actualCm: number; updatedAt: string; source?: MeasureSource }
export type MeasurementResult = { ok: boolean; ignored?: boolean; measurement: MeasurementRow }

export type ItemData = WallElement & { updatedAt?: string }
export type ItemRow = { id: string; data: ItemData | null; updatedAt: string; deleted: boolean }
export type ItemResult = { ok: boolean; ignored?: boolean; item: ItemRow }

export type NotePut = { text: string; updatedAt?: string }
export type NoteRow = { roomCode: string; text: string; updatedAt: string }
export type NoteResult = { ok: boolean; ignored?: boolean; note: NoteRow }

export type ChangesResponse = {
  now: string
  measurements: MeasurementRow[]
  items: ItemRow[]
  notes: NoteRow[]
}

export type SnapshotResult = { version: number }
export type ImageUploadResult = { key: string; url: string }

// ---------- request plumbing ----------

const BASE = '/api'

let passcode: string | null = null

/** Set the passcode sent as `x-passcode` on every request (null = none). */
export const setPasscode = (p: string | null): void => {
  passcode = p
}

/** Headers for plain fetch calls (images), same auth as `request`. */
export const authHeaders = (): Record<string, string> => (passcode ? { 'x-passcode': passcode } : {})

/** True when this browser already holds a passcode (token admin needs one). */
export const hasPasscode = (): boolean => passcode !== null

type ReqOpts = { method?: string; body?: unknown; signal?: AbortSignal }

async function request<T>(path: string, opts: ReqOpts = {}): Promise<T> {
  const headers = new Headers()
  if (passcode) headers.set('x-passcode', passcode)
  let body: BodyInit | undefined
  if (opts.body !== undefined) {
    if (opts.body instanceof FormData || opts.body instanceof Blob) {
      body = opts.body // let the browser set the multipart boundary
    } else {
      headers.set('content-type', 'application/json')
      body = JSON.stringify(opts.body)
    }
  }
  const res = await fetch(BASE + path, { method: opts.method ?? 'GET', headers, body, signal: opts.signal })
  if (!res.ok) {
    let parsed: unknown = null
    try {
      parsed = await res.json()
    } catch {
      try {
        parsed = await res.text()
      } catch {
        // ignore
      }
    }
    throw new ApiError(res.status, parsed)
  }
  return (await res.json()) as T
}

const enc = encodeURIComponent

// ---------- routes ----------

export const listProjects = (opts: { signal?: AbortSignal } = {}) =>
  request<ProjectSummary[]>('/projects', opts)

export const createProject = (body: { name?: string; title?: string }, opts: { signal?: AbortSignal } = {}) =>
  request<ProjectSummary>('/projects', { ...opts, method: 'POST', body })

export const patchProject = (
  projectId: string,
  body: { name?: string; title?: string },
  opts: { signal?: AbortSignal } = {},
) => request<ProjectSummary>(`/projects/${enc(projectId)}`, { ...opts, method: 'PATCH', body })

export const deleteProject = (projectId: string, opts: { signal?: AbortSignal } = {}) =>
  request<{ ok: boolean }>(`/projects/${enc(projectId)}`, { ...opts, method: 'DELETE' })

export const getProject = (projectId: string, opts: { signal?: AbortSignal } = {}) =>
  request<ProjectResponse>(`/projects/${enc(projectId)}`, opts)

export const putSnapshot = (projectId: string, payload: SnapshotPayload, opts: { signal?: AbortSignal } = {}) =>
  request<SnapshotResult>(`/projects/${enc(projectId)}/snapshot`, { ...opts, method: 'PUT', body: payload })

export const putMeasurement = (
  projectId: string,
  label: string,
  body: MeasurementPut,
  opts: { signal?: AbortSignal } = {},
) => request<MeasurementResult>(`/projects/${enc(projectId)}/measurements/${enc(label)}`, { ...opts, method: 'PUT', body })

export const deleteMeasurement = (projectId: string, label: string, opts: { signal?: AbortSignal } = {}) =>
  request<{ ok: boolean }>(`/projects/${enc(projectId)}/measurements/${enc(label)}`, { ...opts, method: 'DELETE' })

export const putItem = (projectId: string, itemId: string, data: ItemData, opts: { signal?: AbortSignal } = {}) =>
  request<ItemResult>(`/projects/${enc(projectId)}/items/${enc(itemId)}`, { ...opts, method: 'PUT', body: data })

export const deleteItem = (projectId: string, itemId: string, opts: { signal?: AbortSignal } = {}) =>
  request<{ ok: boolean }>(`/projects/${enc(projectId)}/items/${enc(itemId)}`, { ...opts, method: 'DELETE' })

export const putNote = (projectId: string, code: string, body: NotePut, opts: { signal?: AbortSignal } = {}) =>
  request<NoteResult>(`/projects/${enc(projectId)}/notes/${enc(code)}`, { ...opts, method: 'PUT', body })

export const getChanges = (projectId: string, since: string, opts: { signal?: AbortSignal } = {}) =>
  request<ChangesResponse>(`/projects/${enc(projectId)}/changes?since=${enc(since)}`, opts)

export const uploadImage = (
  projectId: string,
  file: File | Blob,
  filename?: string,
  opts: { signal?: AbortSignal } = {},
) => {
  const form = new FormData()
  form.append('file', file, filename)
  return request<ImageUploadResult>(`/projects/${enc(projectId)}/images`, { ...opts, method: 'POST', body: form })
}

/** URL for GET /images/:key (R2 keys contain "/", so they are encoded). */
export const imageUrl = (key: string): string => `${BASE}/images/${enc(key)}`

// ---------- API tokens (admin scope: passcode, or an admin bearer token) ----------

/** GET /tokens row. The plaintext token is never returned again after creation. */
export type ApiTokenRow = {
  id: string
  name: string
  scopes: string[]
  projectId: string | null
  createdAt: string
  lastUsedAt: string | null
  revoked: boolean
}

/** POST /tokens answer: `token` (plaintext, once) plus the stored row. */
export type ApiTokenCreated = ApiTokenRow & { token: string }

export const listTokens = (opts: { signal?: AbortSignal } = {}) =>
  request<{ tokens: ApiTokenRow[] }>('/tokens', opts)

export const createToken = (
  body: { name: string; scopes: string | string[]; projectId?: string | null },
  opts: { signal?: AbortSignal } = {},
) => request<ApiTokenCreated>('/tokens', { ...opts, method: 'POST', body })

export const revokeToken = (id: string, opts: { signal?: AbortSignal } = {}) =>
  request<{ ok: boolean; id: string; revoked: boolean }>(`/tokens/${enc(id)}`, { ...opts, method: 'DELETE' })
