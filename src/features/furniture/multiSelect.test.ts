// Multi-selection of furniture items in Design mode: the selection builder, the group move (same
// delta for every item, one undo step), the group delete / duplicate (one undo step each) and the
// marquee hit test. Units: cm.
import { beforeEach, describe, expect, it } from 'vitest'
import { createArtboard } from '../../model/schema'
import { useDoc } from '../../model/store'
import type { Artboard, FurnitureItem } from '../../model/types'
import { useUi } from '../../shell/uiStore'
import {
  deleteFurnitureGroup,
  duplicateFurnitureGroup,
  moveFurnitureGroup,
  setFurnitureSelection,
  updateFurnitureMany,
} from './actions'
import { findFurnitureInBox } from './geometry'

// ---------- helpers ----------

const item = (p: Partial<FurnitureItem> = {}): FurnitureItem => ({
  id: 'f1', name: 'Sofa', shape: 'rect', xCm: 100, yCm: 100, widthCm: 200, depthCm: 90, rotationDeg: 0, color: '#4b5563',
  ...p,
})

const board = (furniture: FurnitureItem[]): Artboard => ({ ...createArtboard('Plan A'), precisionCm: 1, rooms: [], furniture })

const s = () => useDoc.getState()
const ui = () => useUi.getState()
const past = () => useDoc.temporal.getState().pastStates.length

/** Doc with one artboard that holds the given items; returns the artboard id. */
const hydrate = (furniture: FurnitureItem[]): string => {
  const ab = board(furniture.map((f) => ({ ...f })))
  ab.id = 'ab1'
  const doc = s().doc
  s().hydrate({ ...doc, artboards: [ab] })
  return ab.id
}

beforeEach(() => {
  s().resetDoc()
  ui().set({ selection: { kind: 'none' }, activeArtboardId: null })
})

// ---------- selection ----------

describe('setFurnitureSelection', () => {
  it('0 ids clear the selection', () => {
    ui().set({ selection: { kind: 'furniture', artboardId: 'ab1', furnitureId: 'f1' } })
    setFurnitureSelection('ab1', [])
    expect(ui().selection).toEqual({ kind: 'none' })
    expect(ui().activeArtboardId).toBe('ab1')
  })

  it('1 id is the usual single furniture selection', () => {
    setFurnitureSelection('ab1', ['f2'])
    expect(ui().selection).toEqual({ kind: 'furniture', artboardId: 'ab1', furnitureId: 'f2' })
    expect(ui().activeArtboardId).toBe('ab1')
  })

  it('2+ ids make a group, in the given order and without duplicates', () => {
    setFurnitureSelection('ab1', ['f2', 'f1', 'f2'])
    expect(ui().selection).toEqual({ kind: 'furnitureMulti', artboardId: 'ab1', furnitureIds: ['f2', 'f1'] })
    expect(ui().activeArtboardId).toBe('ab1')
  })

  it('the same id twice is still a single selection', () => {
    setFurnitureSelection('ab1', ['f1', 'f1'])
    expect(ui().selection).toEqual({ kind: 'furniture', artboardId: 'ab1', furnitureId: 'f1' })
  })
})

// ---------- group move ----------

describe('moveFurnitureGroup', () => {
  beforeEach(() => hydrate([item({ id: 'f1' }), item({ id: 'f2', xCm: 400, yCm: 300, widthCm: 40, depthCm: 40 }), item({ id: 'f3', xCm: -50, yCm: 0 })]))

  it('moves every listed item by the same delta from its start position', () => {
    const starts = new Map([
      ['f1', { xCm: 100, yCm: 100 }],
      ['f2', { xCm: 400, yCm: 300 }],
    ])
    moveFurnitureGroup('ab1', starts, 15, -5)
    const byId = new Map(s().doc.artboards[0].furniture.map((f) => [f.id, f]))
    expect(byId.get('f1')).toMatchObject({ xCm: 115, yCm: 95 })
    expect(byId.get('f2')).toMatchObject({ xCm: 415, yCm: 295 })
    // An item that is not in the map keeps its place.
    expect(byId.get('f3')).toMatchObject({ xCm: -50, yCm: 0 })
  })

  it('computes each frame from the same starts, so a drag never drifts', () => {
    const starts = new Map([['f1', { xCm: 100, yCm: 100 }], ['f2', { xCm: 400, yCm: 300 }]])
    moveFurnitureGroup('ab1', starts, 10, 0)
    moveFurnitureGroup('ab1', starts, 30, 0)
    expect(s().doc.artboards[0].furniture[0].xCm).toBe(130)
    expect(s().doc.artboards[0].furniture[1].xCm).toBe(430)
  })

  it('records one undo step, and is silent inside a drag', () => {
    const before = past()
    moveFurnitureGroup('ab1', new Map([['f1', { xCm: 100, yCm: 100 }]]), 5, 5)
    // Silent: the doc moved, the history did not.
    expect(past()).toBe(before)
    expect(s().doc.artboards[0].furniture[0]).toMatchObject({ xCm: 105, yCm: 105 })
    moveFurnitureGroup('ab1', new Map([['f1', { xCm: 100, yCm: 100 }]]), 5, 5, false)
    expect(past()).toBe(before + 1)
    s().undo()
    expect(s().doc.artboards[0].furniture[0]).toMatchObject({ xCm: 105, yCm: 105 })
  })

  it('a whole drag is one undo step', () => {
    const before = past()
    const starts = new Map([['f1', { xCm: 100, yCm: 100 }], ['f2', { xCm: 400, yCm: 300 }]])
    s().beginDrag()
    moveFurnitureGroup('ab1', starts, 10, 0)
    moveFurnitureGroup('ab1', starts, 20, 0)
    s().endDrag()
    expect(past()).toBe(before + 1)
    expect(s().doc.artboards[0].furniture[0].xCm).toBe(120)
    s().undo()
    expect(s().doc.artboards[0].furniture[0].xCm).toBe(100)
    expect(s().doc.artboards[0].furniture[1].xCm).toBe(400)
  })

  it('ignores an empty map and an unknown artboard', () => {
    const before = past()
    moveFurnitureGroup('ab1', new Map(), 10, 10)
    moveFurnitureGroup('nope', new Map([['f1', { xCm: 0, yCm: 0 }]]), 10, 10, false)
    expect(past()).toBe(before)
    expect(s().doc.artboards[0].furniture[0].xCm).toBe(100)
  })

  it('skips an id that left the document', () => {
    moveFurnitureGroup('ab1', new Map([['gone', { xCm: 0, yCm: 0 }]]), 10, 10, false)
    expect(s().doc.artboards[0].furniture[0].xCm).toBe(100)
  })
})

// ---------- group colour ----------

describe('updateFurnitureMany', () => {
  beforeEach(() => hydrate([item({ id: 'f1' }), item({ id: 'f2', color: '#ef4444' })]))

  it('patches every listed item in one undo step', () => {
    const before = past()
    updateFurnitureMany('ab1', ['f1', 'f2'], { color: '#22c55e' })
    expect(past()).toBe(before + 1)
    expect(s().doc.artboards[0].furniture.map((f) => f.color)).toEqual(['#22c55e', '#22c55e'])
    s().undo()
    expect(s().doc.artboards[0].furniture.map((f) => f.color)).toEqual(['#4b5563', '#ef4444'])
  })

  it('records nothing when no id matches', () => {
    const before = past()
    updateFurnitureMany('ab1', ['gone'], { color: '#22c55e' })
    expect(past()).toBe(before)
  })
})

// ---------- group delete / duplicate ----------

describe('deleteFurnitureGroup', () => {
  beforeEach(() => hydrate([item({ id: 'f1' }), item({ id: 'f2' }), item({ id: 'f3' })]))

  it('deletes every listed item in one undo step and clears the selection', () => {
    setFurnitureSelection('ab1', ['f1', 'f3'])
    const before = past()
    deleteFurnitureGroup('ab1', ['f1', 'f3'])
    expect(past()).toBe(before + 1)
    expect(s().doc.artboards[0].furniture.map((f) => f.id)).toEqual(['f2'])
    expect(ui().selection).toEqual({ kind: 'none' })
    s().undo()
    expect(s().doc.artboards[0].furniture.map((f) => f.id)).toEqual(['f1', 'f2', 'f3'])
  })

  it('keeps a selection that holds none of the deleted ids', () => {
    setFurnitureSelection('ab1', ['f1', 'f2'])
    deleteFurnitureGroup('ab1', ['f3'])
    expect(ui().selection).toEqual({ kind: 'furnitureMulti', artboardId: 'ab1', furnitureIds: ['f1', 'f2'] })
  })

  it('records nothing when no id matches', () => {
    const before = past()
    deleteFurnitureGroup('ab1', ['gone'])
    expect(past()).toBe(before)
  })
})

describe('duplicateFurnitureGroup', () => {
  beforeEach(() => hydrate([item({ id: 'f1' }), item({ id: 'f2', xCm: 400, yCm: 300 })]))

  it('copies every listed item with the same offset, in one undo step, and selects the copies', () => {
    const before = past()
    const ids = duplicateFurnitureGroup('ab1', ['f1', 'f2'])
    expect(ids).toHaveLength(2)
    expect(past()).toBe(before + 1)
    const list = s().doc.artboards[0].furniture
    expect(list).toHaveLength(4)
    expect(list[1]).toMatchObject({ id: ids[0], xCm: 120, yCm: 120 })
    expect(list[3]).toMatchObject({ id: ids[1], xCm: 420, yCm: 320 })
    expect(ui().selection).toEqual({ kind: 'furnitureMulti', artboardId: 'ab1', furnitureIds: ids })
    expect(ui().activeArtboardId).toBe('ab1')
    s().undo()
    expect(s().doc.artboards[0].furniture).toHaveLength(2)
  })

  it('puts each copy directly above its source', () => {
    hydrate([item({ id: 'f1' }), item({ id: 'f2', xCm: 400, yCm: 300 }), item({ id: 'f3', xCm: 800, yCm: 500 })])
    const ids = duplicateFurnitureGroup('ab1', ['f1', 'f3'])
    expect(ids).toHaveLength(2)
    expect(s().doc.artboards[0].furniture.map((f) => f.id)).toEqual(['f1', ids[0], 'f2', 'f3', ids[1]])
  })

  it('honours a custom offset and copies a single item of the group', () => {
    const ids = duplicateFurnitureGroup('ab1', ['f2'], -30)
    expect(ids).toHaveLength(1)
    expect(s().doc.artboards[0].furniture[2]).toMatchObject({ xCm: 370, yCm: 270 })
    expect(ui().selection).toEqual({ kind: 'furniture', artboardId: 'ab1', furnitureId: ids[0] })
  })

  it('returns an empty list for unknown ids and artboards', () => {
    const before = past()
    expect(duplicateFurnitureGroup('ab1', ['gone'])).toEqual([])
    expect(duplicateFurnitureGroup('nope', ['f1'])).toEqual([])
    expect(past()).toBe(before)
  })
})

// ---------- marquee hit test ----------

describe('findFurnitureInBox', () => {
  const ab = board([
    item({ id: 'f1', xCm: 100, yCm: 100, widthCm: 100, depthCm: 100 }),
    item({ id: 'f2', xCm: 300, yCm: 300, widthCm: 100, depthCm: 100 }),
    item({ id: 'f3', xCm: 700, yCm: 100, widthCm: 100, depthCm: 100, rotationDeg: 45 }),
  ])

  it('returns the items the box overlaps, in stack order', () => {
    expect(findFurnitureInBox({ minX: 0, minY: 0, maxX: 200, maxY: 200 }, ab)).toEqual(['f1'])
    expect(findFurnitureInBox({ minX: 0, minY: 0, maxX: 400, maxY: 400 }, ab)).toEqual(['f1', 'f2'])
  })

  it('a box that only touches an edge still hits', () => {
    expect(findFurnitureInBox({ minX: 150, minY: 150, maxX: 250, maxY: 250 }, ab)).toEqual(['f1', 'f2'])
  })

  it('uses the axis-aligned bounds of a rotated item', () => {
    const half = (100 * Math.SQRT2) / 2
    expect(findFurnitureInBox({ minX: 700 - half + 1, minY: 100, maxX: 700 - half + 2, maxY: 101 }, ab)).toEqual(['f3'])
  })

  it('an empty box away from everything hits nothing', () => {
    expect(findFurnitureInBox({ minX: 5000, minY: 5000, maxX: 5001, maxY: 5001 }, ab)).toEqual([])
    expect(findFurnitureInBox({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, board([]))).toEqual([])
  })
})
