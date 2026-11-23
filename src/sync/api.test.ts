import { afterEach, describe, expect, it, vi } from 'vitest'
import * as api from './api'

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

let fetchMock: ReturnType<typeof vi.fn>

afterEach(() => {
  vi.unstubAllGlobals()
  api.setPasscode(null)
})

const stubFetch = (impl: (url: string, init: RequestInit) => Response | Promise<Response>) => {
  fetchMock = vi.fn((url: string, init: RequestInit) => Promise.resolve(impl(url, init)))
  vi.stubGlobal('fetch', fetchMock)
}

describe('api client', () => {
  it('sends JSON body, method and passcode header', async () => {
    stubFetch(() => jsonResponse({ ok: true, measurement: { label: 'SE-2', actualCm: 412, updatedAt: 't' } }))
    api.setPasscode('secret')
    const res = await api.putMeasurement('p1', 'SE-2', { actualCm: 412, updatedAt: 't' })
    expect(res.ok).toBe(true)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/projects/p1/measurements/SE-2')
    expect(init.method).toBe('PUT')
    expect(new Headers(init.headers).get('content-type')).toBe('application/json')
    expect(new Headers(init.headers).get('x-passcode')).toBe('secret')
    expect(JSON.parse(init.body as string)).toEqual({ actualCm: 412, updatedAt: 't' })
  })

  it('omits the passcode header when not set', async () => {
    stubFetch(() => jsonResponse([]))
    await api.listProjects()
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(new Headers(init.headers).get('x-passcode')).toBeNull()
  })

  it('encodes path params and the since query', async () => {
    stubFetch(() => jsonResponse({ now: 't', measurements: [], items: [], notes: [] }))
    await api.getChanges('p/1', '2025-01-01T00:00:00.000Z')
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/projects/p%2F1/changes?since=2025-01-01T00%3A00%3A00.000Z')
  })

  it('deleteItem uses DELETE on the item route', async () => {
    stubFetch(() => jsonResponse({ ok: true }))
    await api.deleteItem('p1', 'item-9')
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/projects/p1/items/item-9')
    expect(init.method).toBe('DELETE')
  })

  it('uploadImage posts FormData without a manual content-type', async () => {
    stubFetch(() => jsonResponse({ key: 'p1/x.png', url: '/api/images/p1%2Fx.png' }, 201))
    const file = new File([new Uint8Array([1, 2, 3])], 'plan.png', { type: 'image/png' })
    const res = await api.uploadImage('p1', file)
    expect(res.key).toBe('p1/x.png')
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('POST')
    expect(init.body).toBeInstanceOf(FormData)
    expect(new Headers(init.headers).get('content-type')).toBeNull()
  })

  it('imageUrl encodes the R2 key', () => {
    expect(api.imageUrl('p1/abc.png')).toBe('/api/images/p1%2Fabc.png')
  })

  it('throws ApiError with status and parsed body on failure', async () => {
    stubFetch(() => jsonResponse({ error: 'unauthorized' }, 401))
    api.setPasscode('wrong')
    const err = await api.listProjects().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(api.ApiError)
    expect((err as api.ApiError).status).toBe(401)
    expect((err as api.ApiError).body).toEqual({ error: 'unauthorized' })
  })

  it('surfaces 409 version conflicts as ApiError 409', async () => {
    stubFetch(() => jsonResponse({ error: 'version_conflict', latestVersion: 7 }, 409))
    const payload: api.SnapshotPayload = {
      projectId: 'p1',
      title: 't',
      rooms: [],
      elements: [],
      tapes: [],
      baseVersion: 3,
    }
    const err = await api.putSnapshot('p1', payload).catch((e: unknown) => e)
    expect((err as api.ApiError).status).toBe(409)
    expect((err as api.ApiError).body).toEqual({ error: 'version_conflict', latestVersion: 7 })
  })
})

describe('api: 409 update_required of an old app (walls-plan 5c)', () => {
  const refused = () => new api.ApiError(409, { error: 'update_required', message: 'This project uses a newer format.' })
  const conflict = () => new api.ApiError(409, { error: 'version_conflict', latestVersion: 7 })

  it('isUpdateRequired only matches the 409 answer of a converted project', () => {
    expect(api.isUpdateRequired(refused())).toBe(true)
    expect(api.isUpdateRequired(conflict())).toBe(false)
    expect(api.isUpdateRequired(new api.ApiError(409, null))).toBe(false)
    expect(api.isUpdateRequired(new api.ApiError(400, { error: 'update_required' }))).toBe(false)
    expect(api.isUpdateRequired(new Error('update_required'))).toBe(false)
    expect(api.isUpdateRequired(null)).toBe(false)
  })

  it('reloads once, then shows the error instead of reloading again', () => {
    // Nothing reloaded yet: reload.
    expect(api.updateRequiredAction(refused(), null, 1_000)).toBe('reload')
    // Reloaded 5 s ago: the app is still too old, so no second reload.
    expect(api.updateRequiredAction(refused(), 1_000, 6_000)).toBe('error')
    // Reloaded more than the guard ago: a new deploy can be picked up by a reload again.
    expect(api.updateRequiredAction(refused(), 1_000, 1_000 + api.UPDATE_RELOAD_GUARD_MS)).toBe('reload')
  })

  it('a normal version conflict is not an update_required case', () => {
    expect(api.updateRequiredAction(conflict(), null, 1_000)).toBe('ignore')
    expect(api.updateRequiredAction(conflict(), 1_000, 2_000)).toBe('ignore')
  })

  it('gives the wire body of the refusal', async () => {
    stubFetch(() => jsonResponse({ error: 'update_required', message: 'Reload the app.' }, 409))
    const err = await api.putSnapshot('p1', { baseVersion: 3 } as api.SnapshotPayload).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(api.ApiError)
    expect(api.isUpdateRequired(err)).toBe(true)
    expect((err as api.ApiError).body).toEqual({ error: 'update_required', message: 'Reload the app.' })
  })
})
