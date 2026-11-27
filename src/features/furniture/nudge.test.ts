// Arrow-key nudge of the selected furniture: 1 cm, 10 cm with Shift, one undo step per press, and
// group members always move together. Units: cm.
import { beforeEach, describe, expect, it } from 'vitest'
import { createArtboard, createDefaultProject } from '../../model/schema'
import { useDoc } from '../../model/store'
import type { Artboard, FurnitureItem } from '../../model/types'
import { useUi } from '../../shell/uiStore'
import { hasFurnitureSelection, NUDGE_STEP_BIG_CM, NUDGE_STEP_CM, nudgeFurniture, nudgeFurnitureSelection, nudgeStep } from './nudge'

const item = (p: Partial<FurnitureItem> = {}): FurnitureItem => ({
  id: 'f1', name: 'Sofa', shape: 'rect', xCm: 100, yCm: 200, widthCm: 100, depthCm: 50, rotationDeg: 0, color: '#4b5563',
  ...p,
})

const board = (furniture: FurnitureItem[]): Artboard => ({ ...createArtboard('Plan A'), id: 'ab1', precisionCm: 1, rooms: [], furniture })

const s = () => useDoc.getState()
const ui = () => useUi.getState()
const past = () => useDoc.temporal.getState().pastStates.length

const hydrate = (...furniture: FurnitureItem[]) => s().hydrate({ ...createDefaultProject(), artboards: [board(furniture)] })

const pos = (id: string) => {
  const f = s().doc.artboards[0].furniture.find((x) => x.id === id)
  return { xCm: f?.xCm, yCm: f?.yCm }
}

beforeEach(() => {
  s().resetDoc()
  ui().set({ selection: { kind: 'none' }, activeArtboardId: null, mode: 'design' })
})

describe('nudge steps', () => {
  it('is 1 cm, or 10 cm with Shift', () => {
    expect(NUDGE_STEP_CM).toBe(1)
    expect(NUDGE_STEP_BIG_CM).toBe(10)
    expect(nudgeStep(false)).toBe(1)
    expect(nudgeStep(true)).toBe(10)
  })

  it('accepts a furniture selection only', () => {
    expect(hasFurnitureSelection({ kind: 'furniture', artboardId: 'ab1', furnitureId: 'a' })).toBe(true)
    expect(hasFurnitureSelection({ kind: 'furnitureMulti', artboardId: 'ab1', furnitureIds: ['a', 'b'] })).toBe(true)
    expect(hasFurnitureSelection({ kind: 'none' })).toBe(false)
    expect(hasFurnitureSelection({ kind: 'room', artboardId: 'ab1', roomIds: ['r'] })).toBe(false)
  })
})

describe('nudge selection', () => {
  it('moves the selected item by 1 cm in one undo step', () => {
    hydrate(item({ id: 'a' }))
    ui().set({ selection: { kind: 'furniture', artboardId: 'ab1', furnitureId: 'a' } })
    const before = past()
    expect(nudgeFurnitureSelection(0, -1)).toBe(true)
    expect(pos('a')).toEqual({ xCm: 100, yCm: 199 })
    expect(past()).toBe(before + 1)
    s().undo()
    expect(pos('a')).toEqual({ xCm: 100, yCm: 200 })
  })

  it('moves every selected item of a multi-selection with one undo step', () => {
    hydrate(item({ id: 'a' }), item({ id: 'b', xCm: 300 }))
    ui().set({ selection: { kind: 'furnitureMulti', artboardId: 'ab1', furnitureIds: ['a', 'b'] } })
    const before = past()
    expect(nudgeFurnitureSelection(10, 10)).toBe(true)
    expect(pos('a')).toEqual({ xCm: 110, yCm: 210 })
    expect(pos('b')).toEqual({ xCm: 310, yCm: 210 })
    expect(past()).toBe(before + 1)
  })

  it('moves the whole group when only one member is selected', () => {
    hydrate(item({ id: 'a', groupId: 'g1' }), item({ id: 'b', groupId: 'g1', xCm: 300 }), item({ id: 'c', xCm: 500 }))
    ui().set({ selection: { kind: 'furniture', artboardId: 'ab1', furnitureId: 'b' } })
    expect(nudgeFurnitureSelection(1, 0)).toBe(true)
    expect(pos('a')).toEqual({ xCm: 101, yCm: 200 })
    expect(pos('b')).toEqual({ xCm: 301, yCm: 200 })
    expect(pos('c')).toEqual({ xCm: 500, yCm: 200 })
  })

  it('moves a group once when both members are already selected', () => {
    hydrate(item({ id: 'a', groupId: 'g1' }), item({ id: 'b', groupId: 'g1', xCm: 300 }))
    ui().set({ selection: { kind: 'furnitureMulti', artboardId: 'ab1', furnitureIds: ['a', 'b'] } })
    expect(nudgeFurnitureSelection(0, 10)).toBe(true)
    expect(pos('a')).toEqual({ xCm: 100, yCm: 210 })
    expect(pos('b')).toEqual({ xCm: 300, yCm: 210 })
  })

  it('does nothing without a furniture selection or for an unknown item', () => {
    hydrate(item({ id: 'a' }))
    ui().set({ selection: { kind: 'none' } })
    expect(nudgeFurnitureSelection(1, 0)).toBe(false)
    ui().set({ selection: { kind: 'furniture', artboardId: 'ab1', furnitureId: 'gone' } })
    expect(nudgeFurnitureSelection(1, 0)).toBe(false)
  })
})

describe('nudgeFurniture on a doc', () => {
  it('returns null when the artboard of the selection is missing', () => {
    const doc = { ...createDefaultProject(), artboards: [board([item({ id: 'a' })])] }
    expect(nudgeFurniture(doc, { kind: 'furniture', artboardId: 'nope', furnitureId: 'a' }, 1, 0)).toBeNull()
  })
})
