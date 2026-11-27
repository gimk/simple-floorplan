// Unit tests of the copy-as-PNG shortcut and of its clipboard guard. Node environment: no DOM.
import { afterEach, describe, expect, it } from 'vitest'
import type { Artboard } from '../../model/types'
import { copyArtboardPng, isCopyPngShortcut } from './download'

type KeyLike = {
  key: string
  code?: string
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
}

/** A key event with every modifier off, then the given overrides. */
const press = (p: Partial<KeyLike> = {}): KeyLike => ({
  key: 'c',
  code: 'KeyC',
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...p,
})

const artboard = (p: Partial<Artboard> = {}): Artboard => ({
  id: 'ab1', name: 'Ground floor', xCm: 0, yCm: 0, ceilingHeightCm: 250, precisionCm: 1, wallThicknessCm: 0,
  rooms: [], openings: [], furniture: [], ...p,
})

describe('isCopyPngShortcut', () => {
  it('accepts Option+Cmd+C with a lowercase key', () => {
    expect(isCopyPngShortcut(press({ key: 'c', metaKey: true, altKey: true }))).toBe(true)
  })

  it('accepts Option+Cmd+C on macOS where Option+C gives the key "ç" and the code KeyC', () => {
    expect(isCopyPngShortcut(press({ key: 'ç', code: 'KeyC', metaKey: true, altKey: true }))).toBe(true)
  })

  it('accepts Ctrl+Alt+C', () => {
    expect(isCopyPngShortcut(press({ key: 'c', ctrlKey: true, altKey: true }))).toBe(true)
  })

  it('rejects Cmd+C without Alt', () => {
    expect(isCopyPngShortcut(press({ metaKey: true }))).toBe(false)
  })

  it('rejects Shift+Cmd+C (Shift instead of Alt)', () => {
    expect(isCopyPngShortcut(press({ key: 'c', metaKey: true, shiftKey: true }))).toBe(false)
  })

  it('rejects Option+Shift+Cmd+C', () => {
    expect(isCopyPngShortcut(press({ key: 'c', metaKey: true, shiftKey: true, altKey: true }))).toBe(false)
  })

  it('rejects a plain c', () => {
    expect(isCopyPngShortcut(press())).toBe(false)
  })

  it('rejects Option+C without Cmd or Ctrl', () => {
    expect(isCopyPngShortcut(press({ key: 'c', altKey: true }))).toBe(false)
  })

  it('rejects Option+Cmd+D', () => {
    expect(isCopyPngShortcut(press({ key: 'd', code: 'KeyD', metaKey: true, altKey: true }))).toBe(false)
  })
})

describe('copyArtboardPng without image clipboard support', () => {
  const globals = globalThis as { ClipboardItem?: unknown }
  const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard
  const savedClipboardItem = globals.ClipboardItem

  afterEach(() => {
    globals.ClipboardItem = savedClipboardItem
    if (typeof navigator !== 'undefined') {
      Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true, writable: true })
    }
  })

  it('rejects when ClipboardItem is missing', async () => {
    globals.ClipboardItem = undefined
    await expect(copyArtboardPng(artboard())).rejects.toThrow('Image clipboard is not supported in this browser')
  })

  it('rejects when navigator.clipboard.write is missing', async () => {
    // Keep a ClipboardItem stand-in so only the writer is missing.
    globals.ClipboardItem = class {}
    if (typeof navigator !== 'undefined') {
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.resolve() }, configurable: true, writable: true })
    }
    await expect(copyArtboardPng(artboard())).rejects.toThrow('Image clipboard is not supported in this browser')
  })
})
