import { describe, expect, it } from 'vitest'
import { nextTrapTarget, shortcutsBlocked } from './useDialogFocus'

describe('nextTrapTarget', () => {
  const items = ['a', 'b', 'c']
  it('wraps Tab from the last to the first', () => expect(nextTrapTarget(items, 'c', false)).toBe('a'))
  it('wraps Shift+Tab from the first to the last', () => expect(nextTrapTarget(items, 'a', true)).toBe('c'))
  it('lets the browser move inside the list', () => {
    expect(nextTrapTarget(items, 'b', false)).toBeNull()
    expect(nextTrapTarget(items, 'b', true)).toBeNull()
  })
  it('pulls focus in from outside', () => {
    expect(nextTrapTarget(items, null, false)).toBe('a')
    expect(nextTrapTarget(items, null, true)).toBe('c')
  })
  it('does nothing for an empty list', () => expect(nextTrapTarget([], null, false)).toBeNull())
})

describe('shortcutsBlocked', () => {
  const none = { querySelector: () => null }
  it('is false with nothing open', () => expect(shortcutsBlocked({ shortcutsOpen: false, moreOpen: false }, none)).toBe(false))
  it('is true with the cheat sheet open', () => expect(shortcutsBlocked({ shortcutsOpen: true, moreOpen: false }, none)).toBe(true))
  it('is true with the More menu open', () => expect(shortcutsBlocked({ shortcutsOpen: false, moreOpen: true }, none)).toBe(true))
  it('is true with an open dialog', () =>
    expect(shortcutsBlocked({ shortcutsOpen: false, moreOpen: false }, { querySelector: () => ({}) })).toBe(true))
})
