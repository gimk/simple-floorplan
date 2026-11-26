import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ACTION_DURATION_MS, DEFAULT_DURATION_MS, ERROR_DURATION_MS, MAX_TOASTS, dismiss, pauseToast, resumeToast, toast, undoToast, useToast } from './index'

beforeEach(() => {
  vi.useFakeTimers()
  useToast.setState({ toasts: [] })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('toast store', () => {
  it('adds a toast with default 5 s duration', () => {
    const id = toast('Room deleted')
    const t = useToast.getState().toasts.find((x) => x.id === id)
    expect(t?.message).toBe('Room deleted')
    expect(t?.durationMs).toBe(DEFAULT_DURATION_MS)
    expect(t?.actionLabel).toBeUndefined()
  })

  it('auto-dismisses after the duration', () => {
    const id = toast('Gone soon', { durationMs: 5000 })
    expect(useToast.getState().toasts).toHaveLength(1)
    vi.advanceTimersByTime(5000)
    expect(useToast.getState().toasts.find((x) => x.id === id)).toBeUndefined()
  })

  it('dismiss removes immediately and cancels the timer', () => {
    const id = toast('Bye')
    dismiss(id)
    expect(useToast.getState().toasts).toHaveLength(0)
    vi.advanceTimersByTime(60000)
    expect(useToast.getState().toasts).toHaveLength(0)
  })

  it('undoToast wires an action label and callback', () => {
    const undo = vi.fn()
    const id = undoToast('Element deleted', undo)
    const t = useToast.getState().toasts.find((x) => x.id === id)
    expect(t?.actionLabel).toBe('Undo')
    t?.onAction?.()
    expect(undo).toHaveBeenCalledTimes(1)
  })

  it('keeps multiple toasts and expires them independently', () => {
    const a = toast('First', { durationMs: 1000 })
    const b = toast('Second', { durationMs: 9000 })
    vi.advanceTimersByTime(1000)
    expect(useToast.getState().toasts.map((t) => t.id)).toEqual([b])
    vi.advanceTimersByTime(8000)
    expect(useToast.getState().toasts).toHaveLength(0)
    expect(a).not.toBe(b)
  })

  it('defaults kind to info and sets longer durations for errors and actions', () => {
    const a = useToast.getState().toasts
    expect(a).toHaveLength(0)
    const i = toast('i')
    const e = toast('e', { kind: 'error' })
    const u = undoToast('u', () => {})
    const get = (id: number) => useToast.getState().toasts.find((x) => x.id === id)
    expect(get(i)?.kind).toBe('info')
    expect(get(e)?.durationMs).toBe(ERROR_DURATION_MS)
    expect(get(u)?.durationMs).toBe(ACTION_DURATION_MS)
  })

  it('caps the stack at 3, dropping the oldest', () => {
    for (let n = 0; n < 5; n++) toast(`m${n}`)
    const msgs = useToast.getState().toasts.map((t) => t.message)
    expect(msgs).toHaveLength(MAX_TOASTS)
    expect(msgs).toEqual(['m2', 'm3', 'm4'])
  })

  it('collapses consecutive duplicates and restarts the timer', () => {
    const a = toast('same')
    vi.advanceTimersByTime(4000)
    const b = toast('same')
    expect(b).toBe(a)
    expect(useToast.getState().toasts).toHaveLength(1)
    vi.advanceTimersByTime(4000)
    expect(useToast.getState().toasts).toHaveLength(1)
    vi.advanceTimersByTime(1000)
    expect(useToast.getState().toasts).toHaveLength(0)
  })

  it('pauses and resumes the timer', () => {
    const id = toast('hover', { durationMs: 5000 })
    vi.advanceTimersByTime(2000)
    pauseToast(id)
    vi.advanceTimersByTime(60000)
    expect(useToast.getState().toasts).toHaveLength(1)
    resumeToast(id)
    vi.advanceTimersByTime(3000)
    expect(useToast.getState().toasts).toHaveLength(0)
  })
})
