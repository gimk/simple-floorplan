import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __test,
  enqueue,
  getState,
  setProjectId,
  setSender,
  subscribe,
  REQUEST_TIMEOUT_MS,
  RETRY_AFTER_FAILURE_MS,
  type OutboxJob,
  type SendJob,
} from './queue'

beforeEach(() => {
  __test.reset()
  __test.setStore(__test.memoryStore())
  setProjectId('p1')
})

afterEach(() => {
  setSender(null)
  setProjectId(null)
  __test.setStore(null)
  vi.useRealTimers()
})

describe('outbox queue', () => {
  it('assigns increasing sequence numbers and drains to pending 0', async () => {
    setSender(async () => {})
    const seen: number[] = []
    const unsub = subscribe((s) => {
      seen.push(s.pending)
    })
    const s1 = await enqueue('measurement', 'SE-2', { actualCm: 100 })
    const s2 = await enqueue('note', 'SE', { text: 'hello' })
    expect(s2).toBe(s1 + 1)
    await vi.waitFor(() => expect(getState().pending).toBe(0))
    expect(seen).toContain(1)
    expect(seen[seen.length - 1]).toBe(0)
    unsub()
  })

  it('flushes jobs in seq order and records lastSyncAt', async () => {
    const sent: OutboxJob[] = []
    let release: () => void = () => undefined
    const gate = new Promise<void>((r) => {
      release = r
    })
    // gate the sender so all three enqueues land before any flush completes
    const sender: SendJob = async (job) => {
      sent.push(job)
      await gate
    }
    setSender(sender)
    await enqueue('measurement', 'SE-1', { actualCm: 1 })
    await enqueue('measurement', 'SE-2', { actualCm: 2 })
    await enqueue('delete-measurement', 'SE-3', {})
    release()
    await vi.waitFor(() => expect(getState().pending).toBe(0))
    expect(sent.map((j) => j.key)).toEqual(['SE-1', 'SE-2', 'SE-3'])
    expect(sent.map((j) => j.seq)).toEqual([1, 2, 3])
    expect(getState().lastError).toBeNull()
    expect(getState().lastSyncAt).not.toBeNull()
  })

  it('keeps the job and records lastError on failure, then succeeds on retry', async () => {
    vi.useFakeTimers()
    let attempts = 0
    const sender: SendJob = async () => {
      attempts++
      if (attempts === 1) throw new Error('network down')
    }
    setSender(sender)
    await enqueue('measurement', 'SE-2', { actualCm: 412 })
    await vi.waitFor(() => expect(getState().lastError).toBe('network down'))
    expect(getState().pending).toBe(1)
    // retry fires 15 s after the failure
    await vi.advanceTimersByTimeAsync(RETRY_AFTER_FAILURE_MS)
    await vi.waitFor(() => expect(getState().pending).toBe(0))
    expect(attempts).toBe(2)
    expect(getState().lastError).toBeNull()
  })

  it('does not remove a job that changed locally before the server confirmed', async () => {
    const mem = __test.memoryStore()
    __test.setStore(mem)
    let resolveSend: () => void = () => undefined
    const sender: SendJob = () =>
      new Promise<void>((resolve) => {
        resolveSend = resolve
      })
    setSender(sender)
    await enqueue('note', 'SE', { text: 'v1' })
    // while the request is in flight, replace the local job under the same seq
    await vi.waitFor(async () => {
      const jobs = await mem.all()
      expect(jobs).toHaveLength(1)
    })
    const jobs = await mem.all()
    await mem.put({ ...jobs[0], payload: { text: 'v2' } })
    resolveSend()
    await vi.waitFor(() => expect(getState().lastSyncAt).not.toBeNull())
    const after = await mem.all()
    expect(after).toHaveLength(1)
    expect(after[0].payload).toEqual({ text: 'v2' }) // guard kept the newer local job
  })

  it('times out a hanging request after 15 s and keeps the job', async () => {
    vi.useFakeTimers()
    const sender: SendJob = (_job, _pid, signal) =>
      new Promise<void>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')))
      })
    setSender(sender)
    await enqueue('item', 'it-1', { widthCm: 80 })
    // let the scheduled flush reach the request (microtasks only)
    for (let i = 0; i < 20; i++) await Promise.resolve()
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS + 1)
    for (let i = 0; i < 20; i++) await Promise.resolve()
    expect(getState().lastError).toContain('timed out')
    expect(getState().pending).toBe(1)
  })

  it('subscribe receives state updates', async () => {
    setSender(async () => {})
    const states: number[] = []
    const unsub = subscribe((s) => states.push(s.pending))
    await enqueue('measurement', 'SE-H', { actualCm: 250 })
    await vi.waitFor(() => expect(getState().pending).toBe(0))
    unsub()
    expect(states).toContain(1)
    expect(states[states.length - 1]).toBe(0)
  })
})
