// Tab / Shift+Tab in Design mode: step through the furniture of one artboard in layer order and
// wrap around. Units: cm.
import { beforeEach, describe, expect, it } from 'vitest'
import { createArtboard, createDefaultProject } from '../../model/schema'
import { useDoc } from '../../model/store'
import type { Artboard, FurnitureItem } from '../../model/types'
import { useUi } from '../../shell/uiStore'
import { furnitureSelectionIds, nextFurnitureId, selectNextFurniture } from './tabOrder'

const item = (id: string): FurnitureItem => ({
  id, name: id, shape: 'rect', xCm: 100, yCm: 100, widthCm: 100, depthCm: 50, rotationDeg: 0, color: '#4b5563',
})

const board = (furniture: FurnitureItem[]): Artboard => ({ ...createArtboard('Plan A'), id: 'ab1', precisionCm: 1, rooms: [], furniture })

const s = () => useDoc.getState()
const ui = () => useUi.getState()
const hydrate = () => s().hydrate({ ...createDefaultProject(), artboards: [board([item('a'), item('b'), item('c')])] })

beforeEach(() => {
  s().resetDoc()
  ui().set({ selection: { kind: 'none' }, activeArtboardId: null, mode: 'design' })
})

describe('nextFurnitureId', () => {
  const ids = ['a', 'b', 'c']

  it('steps forward and backward in layer order', () => {
    expect(nextFurnitureId(ids, ['a'], false)).toBe('b')
    expect(nextFurnitureId(ids, ['a'], true)).toBe('c')
  })

  it('wraps around at both ends', () => {
    expect(nextFurnitureId(ids, ['c'], false)).toBe('a')
    expect(nextFurnitureId(ids, ['a'], true)).toBe('c')
  })

  it('uses the last id of a multi-selection as the anchor', () => {
    expect(nextFurnitureId(ids, ['a', 'b'], false)).toBe('c')
  })

  it('returns null when there is no furniture or no anchor', () => {
    expect(nextFurnitureId([], ['a'], false)).toBeNull()
    expect(nextFurnitureId(ids, [], false)).toBeNull()
  })

  it('starts at the bottom item when the anchor is not in the list any more', () => {
    expect(nextFurnitureId(ids, ['gone'], false)).toBe('a')
  })
})

describe('furnitureSelectionIds', () => {
  it('reads the ids of both furniture selection kinds of the same artboard', () => {
    expect(furnitureSelectionIds({ kind: 'furniture', artboardId: 'ab1', furnitureId: 'a' }, 'ab1')).toEqual(['a'])
    expect(furnitureSelectionIds({ kind: 'furnitureMulti', artboardId: 'ab1', furnitureIds: ['a', 'b'] }, 'ab1')).toEqual(['a', 'b'])
    expect(furnitureSelectionIds({ kind: 'furniture', artboardId: 'ab2', furnitureId: 'a' }, 'ab1')).toEqual([])
    expect(furnitureSelectionIds({ kind: 'none' }, 'ab1')).toEqual([])
  })
})

describe('selectNextFurniture action', () => {
  it('selects the next and previous item, without an undo step', () => {
    hydrate()
    const before = useDoc.temporal.getState().pastStates.length
    ui().set({ selection: { kind: 'furniture', artboardId: 'ab1', furnitureId: 'a' } })
    expect(selectNextFurniture(false)).toBe(true)
    expect(ui().selection).toEqual({ kind: 'furniture', artboardId: 'ab1', furnitureId: 'b' })
    expect(selectNextFurniture(true)).toBe(true)
    expect(ui().selection).toEqual({ kind: 'furniture', artboardId: 'ab1', furnitureId: 'a' })
    expect(useDoc.temporal.getState().pastStates.length).toBe(before)
  })

  it('does nothing without a furniture selection', () => {
    hydrate()
    ui().set({ selection: { kind: 'none' } })
    expect(selectNextFurniture(false)).toBe(false)
    expect(ui().selection).toEqual({ kind: 'none' })
  })
})
