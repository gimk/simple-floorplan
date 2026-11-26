// Browser client for the Cloudflare snapshot sync (/api/projects, /api/images).
// Large ref images go to R2; the D1 row only keeps a small '/api/images/...' URL.
import { parseProjectDoc } from '../model/schema'
import type { ProjectDoc } from '../model/types'

export type CloudProjectSummary = { id: string; title: string; updatedAt: string }

export const CLOUD_TOKEN_KEY = 'sfp-cloud-token'
const IMAGE_PREFIX = '/api/images/'

type FetchFn = typeof fetch

function authHeaders(): Record<string, string> {
  try {
    const t = localStorage.getItem(CLOUD_TOKEN_KEY)
    return t ? { 'x-api-token': t } : {}
  } catch {
    return {}
  }
}

async function call(fetchFn: FetchFn, url: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetchFn(url, { ...init, headers: { ...authHeaders(), ...(init.headers as Record<string, string> | undefined) } })
  if (!res.ok) throw new Error(`Cloud request failed: ${init.method ?? 'GET'} ${url} (${res.status})`)
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
