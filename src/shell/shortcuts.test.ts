// Cmd/Ctrl+' toggles the canvas grid. The matcher must work on AZERTY and on synthetic events.
import { describe, expect, it } from 'vitest'
import { isGridToggleShortcut } from './shortcuts'

/** Keyboard event fields, with every modifier off unless the test turns it on. */
const ev = (patch: Partial<Parameters<typeof isGridToggleShortcut>[0]>) => ({
  key: '',
  code: '',
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...patch,
})

describe('isGridToggleShortcut', () => {
  it('matches Cmd+Quote on a US layout', () => {
    expect(isGridToggleShortcut(ev({ key: "'", code: 'Quote', metaKey: true }))).toBe(true)
  })

  it('matches Ctrl+Quote on Windows and Linux', () => {
    expect(isGridToggleShortcut(ev({ key: "'", code: 'Quote', ctrlKey: true }))).toBe(true)
  })

  it('matches a French AZERTY keyboard, where the quote key has no Quote code', () => {
    expect(isGridToggleShortcut(ev({ key: "'", code: 'Digit4', metaKey: true }))).toBe(true)
  })

  it('matches an event that only carries the code', () => {
    expect(isGridToggleShortcut(ev({ key: 'Dead', code: 'Quote', metaKey: true }))).toBe(true)
  })

  it('needs Cmd or Ctrl', () => {
    expect(isGridToggleShortcut(ev({ key: "'", code: 'Quote' }))).toBe(false)
  })

  it('ignores Alt, so the Option shortcuts keep their meaning', () => {
    expect(isGridToggleShortcut(ev({ key: "'", code: 'Quote', metaKey: true, altKey: true }))).toBe(false)
    expect(isGridToggleShortcut(ev({ key: "'", code: 'Quote', ctrlKey: true, altKey: true }))).toBe(false)
  })

  it('stays on for Shift, which some layouts need to type the quote', () => {
    expect(isGridToggleShortcut(ev({ key: "'", code: 'Quote', metaKey: true, shiftKey: true }))).toBe(true)
  })

  it('ignores other keys', () => {
    expect(isGridToggleShortcut(ev({ key: '`', code: 'Backquote', metaKey: true }))).toBe(false)
    expect(isGridToggleShortcut(ev({ key: 'v', code: 'KeyV', ctrlKey: true, altKey: true }))).toBe(false)
  })
})
