// Furniture clipboard: copy, cut (copy + delete in one undo step), paste (new ids, new groupId per
// source group, +20 cm inside the same artboard, same coordinates on another artboard), and the
// localStorage copy. Units: cm.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createArtboard, createDefaultProject } from '../../model/schema'
import { useDoc } from '../../model/store'
import type { Artboard, FurnitureItem } from '../../model/types'
import { useUi } from '../../shell/uiStore'
import {
  CLIPBOARD_STORAGE_KEY,
  copyFurniture,
  cutFurniture,
  getClipboard,
  PASTE_OFFSET_CM,
  pasteFurniture,
  readStoredClipboard,
  setClipboard,
} from './clipboard'

const item = (p: Partial<FurnitureItem> = {}): FurnitureItem => ({
  id: 'f1', name: 'Sofa', shape: 'rect', xCm: 100, yCm: 200, widthCm: 100, depthCm: 50, rotationDeg: 0, color: '#4b5563',
  ...p,
})

const board = (p: Partial<Artboard> = {}): Artboard => ({ ...createArtboard('Plan A'), id: 'ab1', precisionCm: 1, rooms: [], furniture: [], ...p })

const s = () => useDoc.getState()
const ui = () => useUi.getState()
const past = () => useDoc.temporal.getState().pastStates.length
const furniture = (artboardId = 'ab1') => s().doc.artboards.find((a) => a.id === artboardId)!.furniture

const hydrate = (a: Artboard, b: Artboard = board({ id: 'ab2' })) => s().hydrate({ ...createDefaultProject(), artboards: [a, b] })

/** Minimal in-memory localStorage stand-in (the test environment has none). */
const store = new Map<string, string>()
const fakeStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v) },
  removeItem: (k: string) => { store.delete(k) },
}

const globals = globalThis as { localStorage?: unknown }
const savedStorage = globals.localStorage

beforeEach(() => {
  s().resetDoc()
  ui().set({ selection: { kind: 'none' }, activeArtboardId: null, mode: 'design' })
  store.clear()
  setClipboard(null)
})

afterEach(() => {
  globals.localStorage = savedStorage
  setClipboard(null)
})

describe('copy and cut', () => {
  it('copies the selected item into the clipboard without touching the document', () => {
    hydrate(board({ furniture: [item({ id: 'a' }), item({ id: 'b', xCm: 300 })] }))
    ui().set({ selection: { kind: 'furniture', artboardId: 'ab1', furnitureId: 'b' } })
    const before = past()
    expect(copyFurniture()).toBe(1)
    expect(getClipboard()).toMatchObject({ artboardId: 'ab1', items: [{ id: 'b', xCm: 300 }] })
    expect(past()).toBe(before)
    expect(furniture().map((f) => f.id)).toEqual(['a', 'b'])
  })

  it('copies the whole group of a member that is selected alone', () => {
    hydrate(board({ furniture: [item({ id: 'a', groupId: 'g1' }), item({ id: 'b', groupId: 'g1' }), item({ id: 'c' })] }))
    ui().set({ selection: { kind: 'furniture', artboardId: 'ab1', furnitureId: 'a' } })
    expect(copyFurniture()).toBe(2)
    expect(getClipboard()?.items.map((f) => f.id)).toEqual(['a', 'b'])
  })

  it('cuts: copies, deletes and clears the selection in one undo step', () => {
    hydrate(board({ furniture: [item({ id: 'a' }), item({ id: 'b' })] }))
    ui().set({ selection: { kind: 'furnitureMulti', artboardId: 'ab1', furnitureIds: ['a', 'b'] } })
    const before = past()
    expect(cutFurniture()).toBe(2)
    expect(furniture()).toEqual([])
    expect(ui().selection).toEqual({ kind: 'none' })
    expect(past()).toBe(before + 1)
    expect(getClipboard()?.items.map((f) => f.id)).toEqual(['a', 'b'])
    s().undo()
    expect(furniture().map((f) => f.id)).toEqual(['a', 'b'])
  })

  it('does nothing without a furniture selection', () => {
    hydrate(board({ furniture: [item({ id: 'a' })] }))
    ui().set({ selection: { kind: 'none' } })
    expect(copyFurniture()).toBe(0)
    expect(cutFurniture()).toBe(0)
    expect(getClipboard()).toBeNull()
  })
})

describe('paste', () => {
  it('pastes on top of the same artboard, offset by 20 cm, with new ids, and selects the copies', () => {
    hydrate(board({ furniture: [item({ id: 'a' }), item({ id: 'b', xCm: 300 })] }))
    ui().set({ selection: { kind: 'furniture', artboardId: 'ab1', furnitureId: 'a' } })
    copyFurniture()
    const before = past()
    const ids = pasteFurniture()
    expect(ids).toHaveLength(1)
    expect(ids[0]).not.toBe('a')
    expect(furniture().map((f) => f.id)).toEqual(['a', 'b', ids[0]])
    expect(furniture()[2]).toMatchObject({ xCm: 100 + PASTE_OFFSET_CM, yCm: 200 + PASTE_OFFSET_CM })
    expect(past()).toBe(before + 1)
    expect(ui().selection).toEqual({ kind: 'furniture', artboardId: 'ab1', furnitureId: ids[0] })
  })

  it('gives a pasted group one new groupId and selects every copy', () => {
    hydrate(board({ furniture: [item({ id: 'a', groupId: 'g1' }), item({ id: 'b', groupId: 'g1' })] }))
    ui().set({ selection: { kind: 'furniture', artboardId: 'ab1', furnitureId: 'a' } })
    copyFurniture()
    const ids = pasteFurniture()
    expect(ids).toHaveLength(2)
    const copies = furniture().filter((f) => ids.includes(f.id))
    expect(copies).toHaveLength(2)
    expect(copies[0].groupId).toBe(copies[1].groupId)
    expect(copies[0].groupId).toBeTruthy()
    expect(copies[0].groupId).not.toBe('g1')
    expect(ui().selection).toEqual({ kind: 'furnitureMulti', artboardId: 'ab1', furnitureIds: ids })
  })

  it('pastes at the same coordinates on another artboard, without offset', () => {
    hydrate(board({ furniture: [item({ id: 'a', xCm: 120, yCm: 240 })] }), board({ id: 'ab2' }))
    ui().set({ selection: { kind: 'furniture', artboardId: 'ab1', furnitureId: 'a' } })
    copyFurniture()
    ui().set({ selection: { kind: 'none' }, activeArtboardId: 'ab1' })
    // With nothing selected the paste goes to the source artboard, so ask for ab2 with an artboard
    // selection there (any selection with that artboard id is enough).
    ui().set({ selection: { kind: 'artboard', artboardId: 'ab2' } })
    const ids = pasteFurniture()
    expect(ids).toHaveLength(1)
    expect(furniture('ab2')[0]).toMatchObject({ xCm: 120, yCm: 240 })
    expect(ui().activeArtboardId).toBe('ab2')
  })

  it('pastes back onto the source artboard when nothing is selected', () => {
    hydrate(board({ furniture: [item({ id: 'a', xCm: 120, yCm: 240 })] }), board({ id: 'ab2' }))
    ui().set({ selection: { kind: 'furniture', artboardId: 'ab1', furnitureId: 'a' } })
    copyFurniture()
    ui().set({ selection: { kind: 'none' } })
    expect(pasteFurniture()).toHaveLength(1)
    expect(furniture('ab1')[1]).toMatchObject({ xCm: 140, yCm: 260 })
  })

  it('does nothing when the clipboard is empty', () => {
    hydrate(board({ furniture: [item({ id: 'a' })] }))
    expect(pasteFurniture()).toEqual([])
  })
})

describe('localStorage copy', () => {
  it('writes the copy under the documented key and reads it back', () => {
    globals.localStorage = fakeStorage
    hydrate(board({ furniture: [item({ id: 'a' })] }))
    ui().set({ selection: { kind: 'furniture', artboardId: 'ab1', furnitureId: 'a' } })
    copyFurniture()
    const raw = store.get(CLIPBOARD_STORAGE_KEY)
    expect(raw).toBeTruthy()
    expect(JSON.parse(raw as string)).toMatchObject({ artboardId: 'ab1', items: [{ id: 'a' }] })
    // The stored copy alone is enough: this is the read after a reload.
    expect(readStoredClipboard()).toMatchObject({ artboardId: 'ab1', items: [{ id: 'a' }] })
  })

  it('ignores a broken stored copy', () => {
    globals.localStorage = fakeStorage
    store.set(CLIPBOARD_STORAGE_KEY, 'not json')
    expect(readStoredClipboard()).toBeNull()
    store.set(CLIPBOARD_STORAGE_KEY, JSON.stringify({ artboardId: 'ab1', items: [{ id: 'a' }] }))
    expect(readStoredClipboard()).toBeNull()
  })

  it('works without any storage (private mode, tests)', () => {
    globals.localStorage = undefined
    hydrate(board({ furniture: [item({ id: 'a' })] }))
    ui().set({ selection: { kind: 'furniture', artboardId: 'ab1', furnitureId: 'a' } })
    expect(copyFurniture()).toBe(1)
    expect(readStoredClipboard()).toBeNull()
    expect(pasteFurniture()).toHaveLength(1)
  })
})
