import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultProject } from '../model/schema'
import type { ProjectDoc, RefImage } from '../model/types'
import {
  CloudUnauthorizedError,
  clearCloudToken,
  deleteCloudProject,
  getCloudToken,
  listCloudProjects,
  loadProjectFromCloud,
  saveProjectToCloud,
  setCloudToken,
} from './cloud'

const PNG_B64 = 'iVBORw0KGgo='
const DATA_URL = `data:image/png;base64,${PNG_B64}`

/** Minimal in-memory localStorage stand-in for the token helpers. */
function memoryStorage() {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k: string, v: string) => {
      map.set(k, v)
    },
    removeItem: (k: string) => {
      map.delete(k)
    },
  }
}

const refImage = (src: string): RefImage => ({
  id: 'img1', name: 'plan', src, naturalWidth: 10, naturalHeight: 10,
  xCm: 0, yCm: 0, cmPerPx: 1, rotationDeg: 0, opacity: 1, visible: true, locked: false,
})

const docWithImage = (src: string): ProjectDoc => ({ ...createDefaultProject(), id: 'p1', title: 'Flat', refImages: [refImage(src)] })

const ok = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' }, ...init })

afterEach(() => { vi.unstubAllGlobals() })

describe('cloud sync', () => {
  it('lists projects', async () => {
    const f = vi.fn(async (_url: string) => ok({ projects: [{ id: 'a', title: 'A', updatedAt: 't' }] }))
    const list = await listCloudProjects(f as unknown as typeof fetch)
    expect(list).toEqual([{ id: 'a', title: 'A', updatedAt: 't' }])
    expect(f.mock.calls[0][0]).toBe('/api/projects')
  })

  it('uploads data: images to R2 and sends stripped URLs to D1', async () => {
    const f = vi.fn(async (url: string) =>
      url.startsWith('/api/images/') ? ok({ ok: true }) : ok({ ok: true, updatedAt: '2026-01-01T00:00:00Z' }))
    const doc = docWithImage(DATA_URL)
    const res = await saveProjectToCloud(doc, f as unknown as typeof fetch)
    expect(res.updatedAt).toBe('2026-01-01T00:00:00Z')

    const [imgUrl, imgInit] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(imgUrl).toBe('/api/images/p1/img1')
    expect(imgInit.method).toBe('PUT')
    expect((imgInit.body as Blob).type).toBe('image/png')

    const [projUrl, projInit] = f.mock.calls[1] as unknown as [string, RequestInit]
    expect(projUrl).toBe('/api/projects/p1')
    const body = String(projInit.body)
    expect(body).not.toContain('base64')
    const parsed = JSON.parse(body) as { title: string; doc: ProjectDoc }
    expect(parsed.title).toBe('Flat')
    expect(parsed.doc.refImages[0].src).toBe('/api/images/p1/img1')
    expect(doc.refImages[0].src).toBe(DATA_URL)
  })

  it('loads a project and restores images as data URLs', async () => {
    const stored = docWithImage('/api/images/p1/img1')
    const f = vi.fn(async (url: string) =>
      url === '/api/projects/p1'
        ? ok({ id: 'p1', title: 'Flat', doc: stored, updatedAt: 't' })
        : new Response(Uint8Array.from(atob(PNG_B64), (c) => c.charCodeAt(0)), { headers: { 'Content-Type': 'image/png' } }))
    const doc = await loadProjectFromCloud('p1', f as unknown as typeof fetch)
    expect(doc.refImages[0].src).toBe(DATA_URL)
    expect(f).toHaveBeenCalledWith('/api/images/p1/img1', expect.anything())
  })

  it('rejects an invalid cloud document', async () => {
    const f = vi.fn(async () => ok({ doc: { nope: true } }))
    await expect(loadProjectFromCloud('p1', f as unknown as typeof fetch)).rejects.toThrow(/Invalid cloud project/)
  })

  it('deletes a project', async () => {
    const f = vi.fn(async () => ok({ ok: true }))
    await deleteCloudProject('p1', f as unknown as typeof fetch)
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/projects/p1')
    expect(init.method).toBe('DELETE')
  })

  it('throws on non-2xx responses', async () => {
    const f = vi.fn(async () => new Response('x', { status: 500 }))
    const fx = f as unknown as typeof fetch
    await expect(listCloudProjects(fx)).rejects.toThrow(/500/)
    await expect(deleteCloudProject('p1', fx)).rejects.toThrow(/500/)
    await expect(saveProjectToCloud(docWithImage(DATA_URL), fx)).rejects.toThrow(/500/)
    await expect(loadProjectFromCloud('p1', fx)).rejects.toThrow(/500/)
  })

  it('includes only error-severity issue messages in the failure message', async () => {
    const body = {
      error: 'invalid_document',
      issues: [
        { severity: 'warning', message: 'Room has no door' },
        { severity: 'error', message: 'Wall thickness must be positive' },
        { severity: 'error', message: 'Room area is zero' },
      ],
    }
    const f = vi.fn(async () => new Response(JSON.stringify(body), { status: 400 }))
    const doc: ProjectDoc = { ...createDefaultProject(), id: 'p1', title: 'Flat' }
    const err = await saveProjectToCloud(doc, f as unknown as typeof fetch).catch((e: unknown) => e as Error)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toBe(
      'Cloud request failed: PUT /api/projects/p1 (400): Wall thickness must be positive; Room area is zero',
    )
    expect((err as Error).message).not.toContain('Room has no door')
  })

  it('includes a plain error string from the response body', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 }))
    const err = await loadProjectFromCloud('p1', f as unknown as typeof fetch).catch((e: unknown) => e as Error)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toBe('Cloud request failed: GET /api/projects/p1 (400): Invalid JSON')
  })

  it('omits the detail when the error body is empty', async () => {
    const f = vi.fn(async () => new Response('', { status: 500 }))
    const err = await deleteCloudProject('p1', f as unknown as typeof fetch).catch((e: unknown) => e as Error)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toBe('Cloud request failed: DELETE /api/projects/p1 (500)')
  })

  it('sends x-api-token when set', async () => {
    vi.stubGlobal('localStorage', { getItem: (k: string) => (k === 'sfp-cloud-token' ? 'secret' : null) })
    const f = vi.fn(async (_url: string, _init?: RequestInit) => ok({ projects: [] }))
    await listCloudProjects(f as unknown as typeof fetch)
    const init = f.mock.calls[0][1] as RequestInit
    expect((init.headers as Record<string, string>)['x-api-token']).toBe('secret')
  })

  it('throws CloudUnauthorizedError on a 401 answer', async () => {
    const f = vi.fn(
      async (_url: string) => new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
    )
    const fx = f as unknown as typeof fetch
    await expect(listCloudProjects(fx)).rejects.toBeInstanceOf(CloudUnauthorizedError)
    await expect(saveProjectToCloud(docWithImage(DATA_URL), fx)).rejects.toBeInstanceOf(CloudUnauthorizedError)
    await expect(loadProjectFromCloud('p1', fx)).rejects.toBeInstanceOf(CloudUnauthorizedError)
    await expect(deleteCloudProject('p1', fx)).rejects.toBeInstanceOf(CloudUnauthorizedError)

    const err = await listCloudProjects(fx).catch((e: unknown) => e as CloudUnauthorizedError)
    expect(err).toBeInstanceOf(CloudUnauthorizedError)
    expect((err as CloudUnauthorizedError).name).toBe('CloudUnauthorizedError')
    expect((err as CloudUnauthorizedError).message).toBe('Passcode required')
  })

  it('stores, reads and clears the cloud token', () => {
    vi.stubGlobal('localStorage', memoryStorage())
    expect(getCloudToken()).toBeNull()
    setCloudToken('hunter2')
    expect(getCloudToken()).toBe('hunter2')
    expect(localStorage.getItem('sfp-cloud-token')).toBe('hunter2')
    clearCloudToken()
    expect(getCloudToken()).toBeNull()
    setCloudToken('')
    expect(getCloudToken()).toBeNull()
  })

  it('survives a blocked or missing localStorage', () => {
    const deny = () => {
      throw new Error('denied')
    }
    vi.stubGlobal('localStorage', { getItem: deny, setItem: deny, removeItem: deny })
    expect(getCloudToken()).toBeNull()
    expect(() => setCloudToken('x')).not.toThrow()
    expect(() => clearCloudToken()).not.toThrow()

    vi.stubGlobal('localStorage', undefined)
    expect(getCloudToken()).toBeNull()
    expect(() => setCloudToken('x')).not.toThrow()
    expect(() => clearCloudToken()).not.toThrow()
  })
})
