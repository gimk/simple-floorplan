import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_DURATION_MS, dismiss, toast, undoToast, useToast } from './index'

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
})
