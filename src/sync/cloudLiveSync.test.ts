import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDefaultProject } from '../model/schema'
import { useDoc } from '../model/store'
import { useUi } from '../shell/uiStore'
import { toast } from '../features/toast'
import {
  __resetCloudAutosaveForTests,
  CLOUD_POLL_INTERVAL_MS,
  getSyncedVersion,
  markCloudSynced,
  pullCloudProject,
  startCloudAutosave,
  useCloudAutosave,
} from './cloudAutosave'

vi.mock('../features/toast', () => ({ toast: vi.fn() }))

const toastMock = vi.mocked(toast)

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(initial))
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

const ok = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function createMockDocEnv() {
  const listeners = new Map<string, Set<(e?: unknown) => void>>()
  const docTarget = {
    visibilityState: 'visible' as DocumentVisibilityState,
    addEventListener: (type: string, fn: (e?: unknown) => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type)!.add(fn)
    },
    removeEventListener: (type: string, fn: (e?: unknown) => void) => {
      listeners.get(type)?.delete(fn)
    },
    dispatch: (type: string) => {
      for (const fn of listeners.get(type) ?? []) fn()
    },
  }
  const winTarget = {
    addEventListener: (type: string, fn: (e?: unknown) => void) => docTarget.addEventListener(`win:${type}`, fn),
    removeEventListener: (type: string, fn: (e?: unknown) => void) => docTarget.removeEventListener(`win:${type}`, fn),
    dispatch: (type: string) => docTarget.dispatch(`win:${type}`),
  }
  return { docTarget, winTarget }
}

let unsubscribe: (() => void) | null = null

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('localStorage', memoryStorage({ 'sfp-cloud-token': 'secret' }))
  __resetCloudAutosaveForTests()
  toastMock.mockReset()
  useDoc.getState().hydrate(createDefaultProject())
  useUi.setState({
    view: { x: 10, y: 20, zoom: 1.5 },
    tool: 'rect',
    activeArtboardId: null,
    selection: { kind: 'none' },
  })
})

afterEach(() => {
  unsubscribe?.()
  unsubscribe = null
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('cloud live sync (poll, pull, conflict)', () => {
  it('polls every 5 s, pulls newer version when clean, and keeps viewport, tool, and valid artboard', async () => {
    const env = createMockDocEnv()
    vi.stubGlobal('document', env.docTarget)
    vi.stubGlobal('window', env.winTarget)

    const initial = { ...createDefaultProject(), id: 'proj-1', title: 'Initial' }
    const artId = initial.artboards[0].id
    useDoc.getState().hydrate(initial)
    useUi.setState({ view: { x: 42, y: 84, zoom: 2.25 }, tool: 'pen', activeArtboardId: artId })
    markCloudSynced(useDoc.getState().doc, 1)

    const remoteDoc = { ...initial, title: 'From MCP' }
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url === '/api/projects') {
        return ok({ projects: [{ id: 'proj-1', title: 'From MCP', version: 2, updatedAt: 't2' }] })
      }
      if (url === '/api/projects/proj-1') {
        return ok({ id: 'proj-1', title: 'From MCP', doc: remoteDoc, version: 2, updatedAt: 't2' })
      }
      throw new Error(`Unexpected URL: ${url}`)
    })

    unsubscribe = startCloudAutosave(useDoc, { fetchFn: fetchMock as unknown as typeof fetch })

    await vi.advanceTimersByTimeAsync(CLOUD_POLL_INTERVAL_MS)

    expect(useDoc.getState().doc.title).toBe('From MCP')
    expect(getSyncedVersion('proj-1')).toBe(2)
    expect(useDoc.temporal.getState().pastStates).toHaveLength(0)
    expect(useUi.getState().view).toEqual({ x: 42, y: 84, zoom: 2.25 })
    expect(useUi.getState().tool).toBe('pen')
    expect(useUi.getState().activeArtboardId).toBe(artId)
    expect(toastMock).toHaveBeenCalledWith('Updated from cloud', { kind: 'info' })
  })

  it('enters conflict state without overwriting when local unsynced changes exist', async () => {
    const env = createMockDocEnv()
    vi.stubGlobal('document', env.docTarget)
    vi.stubGlobal('window', env.winTarget)

    const initial = { ...createDefaultProject(), id: 'proj-1', title: 'Initial' }
    useDoc.getState().hydrate(initial)
    markCloudSynced(useDoc.getState().doc, 1)

    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url === '/api/projects') {
        return ok({ projects: [{ id: 'proj-1', title: 'Remote', version: 3, updatedAt: 't3' }] })
      }
      throw new Error(`Unexpected URL: ${url}`)
    })

    unsubscribe = startCloudAutosave(useDoc, { fetchFn: fetchMock as unknown as typeof fetch })

    // Local edit creates unsynced changes and schedules debounced autosave (3s)
    useDoc.getState().setTitle('Local Edit')
    // Advance 5s: poll detects remote v3 while local is dirty -> conflict, and no upload happened
    await vi.advanceTimersByTimeAsync(2000)
    // Wait: at 2s, poll hasn't run yet; at 3s, autosave would run! Let's check what happens if poll runs first via visibilitychange
    env.docTarget.dispatch('visibilitychange')
    await vi.advanceTimersByTimeAsync(0)

    expect(useCloudAutosave.getState().status).toBe('conflict')
    expect(useCloudAutosave.getState().conflictVersion).toBe(3)
    expect(useDoc.getState().doc.title).toBe('Local Edit')

    // Advance past autosave delay: autosave must NOT upload while in conflict
    await vi.advanceTimersByTimeAsync(5000)
    expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'PUT')).toBe(false)
  })

  it('enters conflict state on 409 during autosave and stops uploading', async () => {
    const initial = { ...createDefaultProject(), id: 'proj-1', title: 'Initial' }
    useDoc.getState().hydrate(initial)
    markCloudSynced(useDoc.getState().doc, 1)

    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        return ok({ error: 'version_conflict', currentVersion: 4 }, 409)
      }
      return ok({ projects: [{ id: 'proj-1', title: 'Initial', version: 4, updatedAt: 't4' }] })
    })

    unsubscribe = startCloudAutosave(useDoc, { fetchFn: fetchMock as unknown as typeof fetch })
    useDoc.getState().setTitle('Local Change')

    await vi.advanceTimersByTimeAsync(3000)
    expect(useCloudAutosave.getState().status).toBe('conflict')
    expect(useCloudAutosave.getState().conflictVersion).toBe(4)

    // Further edits must not upload while in conflict
    useDoc.getState().setTitle('Another Change')
    await vi.advanceTimersByTimeAsync(5000)
    const putCalls = fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'PUT')
    expect(putCalls).toHaveLength(1)
    const sentBody = JSON.parse(String((putCalls[0][1] as RequestInit).body)) as { baseVersion?: number }
    expect(sentBody.baseVersion).toBe(1)
  })

  it('stops polling for non-cloud projects, when token is missing, when hidden, and on 401', async () => {
    const env = createMockDocEnv()
    vi.stubGlobal('document', env.docTarget)
    vi.stubGlobal('window', env.winTarget)

    const fetchMock = vi.fn(async () => ok({ error: 'Unauthorized' }, 401))
    unsubscribe = startCloudAutosave(useDoc, { fetchFn: fetchMock as unknown as typeof fetch })

    // 1. Non-cloud project: no polling
    await vi.advanceTimersByTimeAsync(CLOUD_POLL_INTERVAL_MS * 2)
    expect(fetchMock).not.toHaveBeenCalled()

    // 2. Cloud project, but token missing: no polling
    const proj = { ...createDefaultProject(), id: 'proj-1', title: 'P' }
    useDoc.getState().hydrate(proj)
    markCloudSynced(useDoc.getState().doc, 1)
    vi.stubGlobal('localStorage', memoryStorage({}))
    await vi.advanceTimersByTimeAsync(CLOUD_POLL_INTERVAL_MS)
    expect(fetchMock).not.toHaveBeenCalled()

    // 3. Token present, but hidden: no polling
    vi.stubGlobal('localStorage', memoryStorage({ 'sfp-cloud-token': 'secret' }))
    env.docTarget.visibilityState = 'hidden'
    await vi.advanceTimersByTimeAsync(CLOUD_POLL_INTERVAL_MS)
    expect(fetchMock).not.toHaveBeenCalled()

    // 4. Visible -> polls and hits 401 -> pauses and stops polling
    env.docTarget.visibilityState = 'visible'
    env.docTarget.dispatch('visibilitychange')
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(useCloudAutosave.getState().status).toBe('paused')

    await vi.advanceTimersByTimeAsync(CLOUD_POLL_INTERVAL_MS * 2)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not overlap polls when a poll request is still in flight', async () => {
    let resolveList!: (res: Response) => void
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveList = resolve
        }),
    )

    const proj = { ...createDefaultProject(), id: 'proj-1', title: 'P' }
    useDoc.getState().hydrate(proj)
    markCloudSynced(useDoc.getState().doc, 1)

    unsubscribe = startCloudAutosave(useDoc, { fetchFn: fetchMock as unknown as typeof fetch })

    await vi.advanceTimersByTimeAsync(CLOUD_POLL_INTERVAL_MS)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // Next interval fires while first poll is still pending
    await vi.advanceTimersByTimeAsync(CLOUD_POLL_INTERVAL_MS)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    resolveList(ok({ projects: [{ id: 'proj-1', title: 'P', version: 1, updatedAt: 't1' }] }))
    await vi.advanceTimersByTimeAsync(0)

    await vi.advanceTimersByTimeAsync(CLOUD_POLL_INTERVAL_MS)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('polls on online event and pullCloudProject clears conflict and resets missing activeArtboardId', async () => {
    const env = createMockDocEnv()
    vi.stubGlobal('document', env.docTarget)
    vi.stubGlobal('window', env.winTarget)

    const initial = { ...createDefaultProject(), id: 'proj-1', title: 'Initial' }
    useDoc.getState().hydrate(initial)
    useUi.setState({ activeArtboardId: 'deleted-artboard' })
    markCloudSynced(useDoc.getState().doc, 1)

    const remoteDoc = { ...initial, title: 'Updated' }
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url === '/api/projects') {
        return ok({ projects: [{ id: 'proj-1', title: 'Updated', version: 2, updatedAt: 't2' }] })
      }
      return ok({ id: 'proj-1', title: 'Updated', doc: remoteDoc, version: 2, updatedAt: 't2' })
    })

    unsubscribe = startCloudAutosave(useDoc, { fetchFn: fetchMock as unknown as typeof fetch })
    env.winTarget.dispatch('online')
    await vi.advanceTimersByTimeAsync(0)

    expect(useDoc.getState().doc.title).toBe('Updated')
    expect(useUi.getState().activeArtboardId).toBeNull()

    // Test pullCloudProject directly
    await pullCloudProject('proj-1', fetchMock as unknown as typeof fetch)
    expect(getSyncedVersion('proj-1')).toBe(2)
  })
})
