// Browser client for the Cloudflare snapshot sync (/api/projects, /api/images).
// Large ref images go to R2; the D1 row only keeps a small '/api/images/...' URL.
import { parseProjectDoc } from '../model/schema'
import type { ProjectDoc } from '../model/types'

export type CloudProjectSummary = { id: string; title: string; updatedAt: string }

export const CLOUD_TOKEN_KEY = 'sfp-cloud-token'
const IMAGE_PREFIX = '/api/images/'

/** Thrown when the API answers 401: the server wants a passcode (or a valid token). */
export class CloudUnauthorizedError extends Error {
  constructor(message = 'Passcode required') {
    super(message)
    this.name = 'CloudUnauthorizedError'
  }
}

/** Saved passcode/token, or null when unset, blank, or storage is not readable. */
export function getCloudToken(): string | null {
  try {
    const t = localStorage.getItem(CLOUD_TOKEN_KEY)
    return t && t.length > 0 ? t : null
  } catch {
    return null
  }
}

/** Stores the passcode/token. Silently ignored when storage is blocked (SSR, private mode). */
export function setCloudToken(token: string): void {
  try {
    localStorage.setItem(CLOUD_TOKEN_KEY, token)
  } catch {
    // Storage unavailable: cloud calls stay unauthenticated.
  }
}

export function clearCloudToken(): void {
  try {
    localStorage.removeItem(CLOUD_TOKEN_KEY)
  } catch {
    // Storage unavailable: nothing to clear.
  }
}

type FetchFn = typeof fetch

function authHeaders(): Record<string, string> {
  const t = getCloudToken()
  return t ? { 'x-api-token': t } : {}
}

/**
 * Reads a failed response body and turns it into a short human-readable detail.
 * Understands the API's `{ error, issues: [{ severity, message }] }` shape, a plain
 * `{ error }` / `{ message }` object, and falls back to the raw text. Never throws.
 */
async function errorDetail(res: Response): Promise<string> {
  const text = await res.text().catch(() => '')
  let parsed: unknown = null
  if (text.trim().length > 0) {
    try {
      parsed = JSON.parse(text) as unknown
    } catch {
      parsed = null
    }
  }
  if (parsed !== null && typeof parsed === 'object') {
    const body = parsed as { issues?: unknown; message?: unknown; error?: unknown }
    if (Array.isArray(body.issues)) {
      const items = body.issues.filter(
        (i): i is { severity?: unknown; message?: unknown } => typeof i === 'object' && i !== null,
      )
      const errors = items.filter((i) => i.severity === 'error')
      const picked = errors.length > 0 ? errors : items
      const messages = picked
        .map((i) => (typeof i.message === 'string' ? i.message.trim() : ''))
        .filter((m) => m.length > 0)
        .slice(0, 3)
      if (messages.length > 0) return messages.join('; ')
    }
    if (typeof body.message === 'string' && body.message.trim().length > 0) return body.message.trim()
    if (typeof body.error === 'string' && body.error.trim().length > 0) return body.error.trim()
  }
  const trimmed = text.trim()
  return trimmed.length > 0 ? trimmed.slice(0, 200) : ''
}

async function call(fetchFn: FetchFn, url: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetchFn(url, {
    ...init,
    headers: { ...authHeaders(), ...(init.headers as Record<string, string> | undefined) },
  })
  if (res.status === 401) throw new CloudUnauthorizedError('Passcode required')
  if (!res.ok) {
    const detail = await errorDetail(res)
    const method = init.method ?? 'GET'
    throw new Error(
      detail
        ? `Cloud request failed: ${method} ${url} (${res.status}): ${detail}`
        : `Cloud request failed: ${method} ${url} (${res.status})`,
    )
  }
  return res
}

function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',')
  const meta = dataUrl.slice(5, comma)
  const isBase64 = meta.endsWith(';base64')
  const type = (isBase64 ? meta.slice(0, -7) : meta).split(';')[0] || 'application/octet-stream'
  const payload = dataUrl.slice(comma + 1)
  if (!isBase64) return new Blob([decodeURIComponent(payload)], { type })
  const bin = atob(payload)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type })
}

function bytesToDataUrl(buf: ArrayBuffer, type: string): string {
  const bytes = new Uint8Array(buf)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return `data:${type};base64,${btoa(bin)}`
}

export async function listCloudProjects(fetchFn: FetchFn = fetch): Promise<CloudProjectSummary[]> {
  const res = await call(fetchFn, '/api/projects')
  const data = (await res.json()) as { projects: CloudProjectSummary[] }
  return data.projects
}

export async function saveProjectToCloud(doc: ProjectDoc, fetchFn: FetchFn = fetch): Promise<{ updatedAt: string }> {
  const refImages = []
  for (const img of doc.refImages) {
    if (img.src.startsWith('data:')) {
      const url = `${IMAGE_PREFIX}${encodeURIComponent(doc.id)}/${encodeURIComponent(img.id)}`
      const blob = dataUrlToBlob(img.src)
      await call(fetchFn, url, { method: 'PUT', headers: { 'Content-Type': blob.type }, body: blob })
      refImages.push({ ...img, src: url })
    } else {
      refImages.push(img)
    }
  }
  const cloudDoc: ProjectDoc = { ...doc, refImages }
  const res = await call(fetchFn, `/api/projects/${encodeURIComponent(doc.id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: doc.title, doc: cloudDoc }),
  })
  const data = (await res.json()) as { updatedAt: string }
  return { updatedAt: data.updatedAt }
}

export async function loadProjectFromCloud(id: string, fetchFn: FetchFn = fetch): Promise<ProjectDoc> {
  const res = await call(fetchFn, `/api/projects/${encodeURIComponent(id)}`)
  const data = (await res.json()) as { doc: unknown }
  const parsed = parseProjectDoc(data.doc)
  if (!parsed.ok) throw new Error(`Invalid cloud project: ${parsed.error}`)
  const doc = parsed.doc
  const refImages = []
  for (const img of doc.refImages) {
    if (img.src.startsWith(IMAGE_PREFIX)) {
      const imgRes = await call(fetchFn, img.src)
      const type = imgRes.headers.get('content-type') ?? 'application/octet-stream'
      refImages.push({ ...img, src: bytesToDataUrl(await imgRes.arrayBuffer(), type) })
    } else {
      refImages.push(img)
    }
  }
  return { ...doc, refImages }
}

export async function deleteCloudProject(id: string, fetchFn: FetchFn = fetch): Promise<void> {
  await call(fetchFn, `/api/projects/${encodeURIComponent(id)}`, { method: 'DELETE' })
}
