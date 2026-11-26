// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'

const ev = (o: Partial<{ shiftKey: boolean; altKey: boolean; metaKey: boolean; ctrlKey: boolean }> = {}) =>
  ({ shiftKey: false, altKey: false, metaKey: false, ctrlKey: false, ...o })

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

describe('modifiers (no window)', () => {
  it('works without window', async () => {
    vi.resetModules()
    const m = await import('./modifiers')
    expect(m.getModifiers()).toEqual({ shift: false, alt: false, cmd: false })
    const cb = vi.fn()
    const un = m.subscribeModifiers(cb)
    expect(m.syncModifiersFromEvent(ev({ shiftKey: true }))).toEqual({ shift: true, alt: false, cmd: false })
    expect(cb).toHaveBeenCalledTimes(1)
    un()
  })
  it('maps ctrl and meta to cmd, and ignores unchanged state', async () => {
    vi.resetModules()
    const m = await import('./modifiers')
    const cb = vi.fn()
    const un = m.subscribeModifiers(cb)
    expect(m.syncModifiersFromEvent(ev({ ctrlKey: true })).cmd).toBe(true)
    expect(m.syncModifiersFromEvent(ev({ metaKey: true })).cmd).toBe(true)
    expect(cb).toHaveBeenCalledTimes(1)
    expect(m.syncModifiersFromEvent(ev({ altKey: true }))).toEqual({ shift: false, alt: true, cmd: false })
    expect(cb).toHaveBeenCalledTimes(2)
    un()
    m.syncModifiersFromEvent(ev({ shiftKey: true }))
    expect(cb).toHaveBeenCalledTimes(2)
  })
})

describe('free snap', () => {
  it('uses cmd/ctrl only and exports a label', async () => {
    vi.resetModules()
    const m = await import('./modifiers')
    expect(m.isFreeSnap({ cmd: true })).toBe(true)
    expect(m.isFreeSnap({ cmd: false })).toBe(false)
    expect(['⌘', 'Ctrl']).toContain(m.FREE_SNAP_LABEL)
  })
})

describe('modifiers (fake window)', () => {
  it('tracks keydown, keyup and blur, and removes listeners on last unsubscribe', async () => {
    const handlers: Record<string, Array<(e: unknown) => void>> = {}
    vi.stubGlobal('window', {
      addEventListener: (t: string, h: (e: unknown) => void) => { (handlers[t] ??= []).push(h) },
      removeEventListener: (t: string, h: (e: unknown) => void) => { handlers[t] = (handlers[t] ?? []).filter((x) => x !== h) },
    })
    vi.resetModules()
    const m = await import('./modifiers')
    const seen: unknown[] = []
    const un = m.subscribeModifiers((x) => seen.push(x))
    expect(handlers.keydown).toHaveLength(1)
    handlers.keydown[0](ev({ shiftKey: true, altKey: true }))
    expect(m.getModifiers()).toEqual({ shift: true, alt: true, cmd: false })
    handlers.keyup[0](ev({ altKey: false, shiftKey: true }))
    expect(m.getModifiers()).toEqual({ shift: true, alt: false, cmd: false })
    handlers.blur[0]({})
    expect(m.getModifiers()).toEqual({ shift: false, alt: false, cmd: false })
    expect(seen).toHaveLength(3)
    un()
    expect(handlers.keydown).toHaveLength(0)
    expect(handlers.blur).toHaveLength(0)
  })
})
