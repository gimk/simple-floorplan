import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDefaultProject } from '../model/schema'
import { useDoc } from '../model/store'
import { CloudUnauthorizedError, saveProjectToCloud } from './cloud'
import { toast } from '../features/toast'
import {
  __resetCloudAutosaveForTests,
  CLOUD_AUTOSAVE_KEY,
  hasUnsyncedChanges,
  markCloudSynced,
  resumeCloudAutosave,
  setCloudAutosaveEnabled,
  startCloudAutosave,
  useCloudAutosave,
} from './cloudAutosave'

vi.mock('./cloud', async (orig) => ({ ...(await orig()), saveProjectToCloud: vi.fn() }))
vi.mock('../features/toast', () => ({ toast: vi.fn() }))

const saveMock = vi.mocked(saveProjectToCloud)
const toastMock = vi.mocked(toast)

/** Minimal in-memory localStorage stand-in for the enable flag. */
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

/** One recorded doc change (a title edit is a normal undo step). */
const edit = (title: string) => useDoc.getState().setTitle(title)

let unsubscribe: (() => void) | null = null

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('localStorage', memoryStorage())
  __resetCloudAutosaveForTests()
  saveMock.mockReset()
  toastMock.mockReset()
  saveMock.mockResolvedValue({ updatedAt: '2026-01-01T00:00:00.000Z', version: 1 })
  useDoc.getState().hydrate(createDefaultProject())
  useDoc.temporal.getState().clear()
})

afterEach(() => {
  unsubscribe?.()
  unsubscribe = null
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const status = () => useCloudAutosave.getState().status

describe('cloud autosave', () => {
  it('uploads once, 3 s after the last change', async () => {
    unsubscribe = startCloudAutosave()
    edit('Flat')
    expect(saveMock).not.toHaveBeenCalled()
    expect(status()).toBe('pending')

    await vi.advanceTimersByTimeAsync(2999)
    expect(saveMock).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(saveMock).toHaveBeenCalledTimes(1)
    expect(status()).toBe('saved')
  })

  it('coalesces three edits one second apart into one upload of the last doc', async () => {
    unsubscribe = startCloudAutosave()
    edit('One')
    await vi.advanceTimersByTimeAsync(1000)
    edit('Two')
    await vi.advanceTimersByTimeAsync(1000)
    edit('Three')
    await vi.advanceTimersByTimeAsync(1000)
    expect(saveMock).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(2000)
    expect(saveMock).toHaveBeenCalledTimes(1)
    const uploaded = saveMock.mock.calls[0][0]
    expect(uploaded.title).toBe('Three')
    expect(uploaded).toBe(useDoc.getState().doc)
  })

  it('does nothing while the user turned autosave off', async () => {
    unsubscribe = startCloudAutosave()
    setCloudAutosaveEnabled(false)
    expect(localStorage.getItem(CLOUD_AUTOSAVE_KEY)).toBe('0')

    edit('Flat')
    await vi.advanceTimersByTimeAsync(5000)
    expect(saveMock).not.toHaveBeenCalled()
    expect(status()).toBe('idle')
  })

  it('pauses on a 401 and only resumes when the passcode is accepted', async () => {
    saveMock.mockRejectedValueOnce(new CloudUnauthorizedError('Passcode required'))
    unsubscribe = startCloudAutosave()
    edit('Flat')
    await vi.advanceTimersByTimeAsync(3000)
    expect(saveMock).toHaveBeenCalledTimes(1)
    expect(status()).toBe('paused')
    expect(useCloudAutosave.getState().lastError).toBe('Passcode required')
    expect(toastMock).not.toHaveBeenCalled()

    // Still locked: edits must not retry.
    edit('Flat 2')
    await vi.advanceTimersByTimeAsync(5000)
    expect(saveMock).toHaveBeenCalledTimes(1)

    resumeCloudAutosave()
    await vi.advanceTimersByTimeAsync(3000)
    expect(saveMock).toHaveBeenCalledTimes(2)
    expect(status()).toBe('saved')
  })

  it('reports one toast for a failing upload and retries after 30 s', async () => {
    saveMock.mockRejectedValue(new Error('network down'))
    unsubscribe = startCloudAutosave()
    edit('Flat')
    await vi.advanceTimersByTimeAsync(3000)
    expect(saveMock).toHaveBeenCalledTimes(1)
    expect(status()).toBe('error')
    expect(useCloudAutosave.getState().lastError).toBe('network down')
    expect(toastMock).toHaveBeenCalledTimes(1)
    expect(toastMock).toHaveBeenCalledWith('Cloud autosave failed: network down', { kind: 'error' })

    await vi.advanceTimersByTimeAsync(29_000)
    expect(saveMock).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1000)
    expect(saveMock).toHaveBeenCalledTimes(2)
    expect(toastMock).toHaveBeenCalledTimes(1) // still one toast for the same failure streak
  })

  it('treats a synced doc as clean and schedules no upload', async () => {
    unsubscribe = startCloudAutosave()
    edit('Flat')
    markCloudSynced(useDoc.getState().doc)
    expect(hasUnsyncedChanges()).toBe(false)
    expect(status()).toBe('saved')

    await vi.advanceTimersByTimeAsync(5000)
    expect(saveMock).not.toHaveBeenCalled()
  })
})
