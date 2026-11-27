// Cmd/Ctrl+[ and Cmd/Ctrl+] on a furniture selection: send to back / bring to front, keeping the
// relative order of the moved items and the members of a group contiguous. Units: cm.
import { beforeEach, describe, expect, it } from 'vitest'
import { createArtboard, createDefaultProject } from '../../model/schema'
import { useDoc } from '../../model/store'
import type { Artboard, FurnitureItem } from '../../model/types'
import { useUi } from '../../shell/uiStore'
import { moveSelectionToEnd, stackWithSelectionAtEnd } from './layerOrder'

const item = (id: string, groupId?: string): FurnitureItem => ({
  id, name: id, shape: 'rect', xCm: 100, yCm: 100, widthCm: 100, depthCm: 50, rotationDeg: 0, color: '#4b5563',
  ...(groupId ? { groupId } : {}),
})

const board = (furniture: FurnitureItem[]): Artboard => ({ ...createArtboard('Plan A'), id: 'ab1', precisionCm: 1, rooms: [], furniture })

const s = () => useDoc.getState()
const ui = () => useUi.getState()
const past = () => useDoc.temporal.getState().pastStates.length
const order = () => s().doc.artboards[0].furniture.map((f) => f.id)

const hydrate = (...furniture: FurnitureItem[]) => s().hydrate({ ...createDefaultProject(), artboards: [board(furniture)] })

beforeEach(() => {
  s().resetDoc()
  ui().set({ selection: { kind: 'none' }, activeArtboardId: null, mode: 'design' })
})

describe('stackWithSelectionAtEnd', () => {
  const list = [item('a'), item('b'), item('c'), item('d')]

  it('moves one item to the back and to the front', () => {
    expect(stackWithSelectionAtEnd(list, ['c'], 'back')?.map((f) => f.id)).toEqual(['c', 'a', 'b', 'd'])
    expect(stackWithSelectionAtEnd(list, ['c'], 'front')?.map((f) => f.id)).toEqual(['a', 'b', 'd', 'c'])
  })

  it('keeps the relative order of the moved items', () => {
    expect(stackWithSelectionAtEnd(list, ['d', 'b'], 'back')?.map((f) => f.id)).toEqual(['b', 'd', 'a', 'c'])
    expect(stackWithSelectionAtEnd(list, ['a', 'c'], 'front')?.map((f) => f.id)).toEqual(['b', 'd', 'a', 'c'])
  })

  it('keeps the members of a group contiguous, even when they were apart', () => {
    const split = [item('a', 'g1'), item('b'), item('c', 'g1'), item('d')]
    expect(stackWithSelectionAtEnd(split, ['a', 'c'], 'back')?.map((f) => f.id)).toEqual(['a', 'c', 'b', 'd'])
    expect(stackWithSelectionAtEnd(split, ['a', 'c'], 'front')?.map((f) => f.id)).toEqual(['b', 'd', 'a', 'c'])
  })

  it('returns null when nothing would change', () => {
    expect(stackWithSelectionAtEnd(list, ['a'], 'back')).toBeNull()
    expect(stackWithSelectionAtEnd(list, ['d'], 'front')).toBeNull()
    expect(stackWithSelectionAtEnd(list, ['gone'], 'front')).toBeNull()
    expect(stackWithSelectionAtEnd([], ['a'], 'front')).toBeNull()
  })
})

describe('moveSelectionToEnd action', () => {
  it('sends one selected item to the back in one undo step and keeps it selected', () => {
    hydrate(item('a'), item('b'), item('c'))
    ui().set({ selection: { kind: 'furniture', artboardId: 'ab1', furnitureId: 'c' } })
    const before = past()
    expect(moveSelectionToEnd('back')).toBe(true)
    expect(order()).toEqual(['c', 'a', 'b'])
    expect(past()).toBe(before + 1)
    expect(ui().selection).toEqual({ kind: 'furniture', artboardId: 'ab1', furnitureId: 'c' })
    s().undo()
    expect(order()).toEqual(['a', 'b', 'c'])
  })

  it('brings a multi-selection to the front, with the whole group', () => {
    hydrate(item('a'), item('b'), item('c', 'g1'), item('d', 'g1'), item('e'))
    ui().set({ selection: { kind: 'furnitureMulti', artboardId: 'ab1', furnitureIds: ['a', 'c', 'd'] } })
    expect(moveSelectionToEnd('front')).toBe(true)
    expect(order()).toEqual(['b', 'e', 'a', 'c', 'd'])
  })

  it('returns false when the selection does not move', () => {
    hydrate(item('a'), item('b'))
    ui().set({ selection: { kind: 'furniture', artboardId: 'ab1', furnitureId: 'b' } })
    expect(moveSelectionToEnd('front')).toBe(false)
    ui().set({ selection: { kind: 'none' } })
    expect(moveSelectionToEnd('back')).toBe(false)
  })
})
