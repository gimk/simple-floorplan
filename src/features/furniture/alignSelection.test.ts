// Align (Alt+A / D / W / S / H / V) and distribute (Ctrl+Alt+H / V) of a furniture multi-selection.
// Alignment works inside the bounds of the selection; distribute gives equal gaps. Units: cm.
import { beforeEach, describe, expect, it } from 'vitest'
import { createArtboard, createDefaultProject } from '../../model/schema'
import { useDoc } from '../../model/store'
import type { Artboard, FurnitureItem } from '../../model/types'
import { useUi } from '../../shell/uiStore'
import { alignMoves, alignSelection, distributeMoves, distributeSelection, selectionBounds } from './alignSelection'

/** 100 x 50 item, top-left corner at (x, y). */
const box = (id: string, x: number, y: number): FurnitureItem => ({
  id, name: id, shape: 'rect', xCm: x + 50, yCm: y + 25, widthCm: 100, depthCm: 50, rotationDeg: 0, color: '#4b5563',
})

const board = (furniture: FurnitureItem[]): Artboard => ({ ...createArtboard('Plan A'), id: 'ab1', precisionCm: 1, rooms: [], furniture })

const s = () => useDoc.getState()
const ui = () => useUi.getState()
const past = () => useDoc.temporal.getState().pastStates.length

const hydrate = (...furniture: FurnitureItem[]) => s().hydrate({ ...createDefaultProject(), artboards: [board(furniture)] })

const pos = (id: string) => {
  const f = s().doc.artboards[0].furniture.find((x) => x.id === id)!
  return { xCm: f.xCm, yCm: f.yCm }
}

beforeEach(() => {
  s().resetDoc()
  ui().set({ selection: { kind: 'none' }, activeArtboardId: null, mode: 'design' })
})

const TWO = [box('a', 0, 0), box('b', 300, 200)]

describe('selectionBounds and alignMoves', () => {
  it('lines the items up on the left, right, top and bottom of the selection', () => {
    const bounds = selectionBounds(TWO)!
    expect(bounds).toEqual({ minX: 0, minY: 0, maxX: 400, maxY: 250 })

    expect(alignMoves(TWO, bounds, 'left').get('b')).toEqual({ xCm: 50, yCm: 225 })
    expect(alignMoves(TWO, bounds, 'right').get('a')).toEqual({ xCm: 350, yCm: 25 })
    expect(alignMoves(TWO, bounds, 'top').get('b')).toEqual({ xCm: 350, yCm: 25 })
    expect(alignMoves(TWO, bounds, 'bottom').get('a')).toEqual({ xCm: 50, yCm: 225 })
  })

  it('centers the items horizontally and vertically', () => {
    const bounds = selectionBounds(TWO)!
    // Selection centre: x = 200, y = 125.
    expect(alignMoves(TWO, bounds, 'center-h').get('a')).toEqual({ xCm: 200, yCm: 25 })
    expect(alignMoves(TWO, bounds, 'center-v').get('a')).toEqual({ xCm: 50, yCm: 125 })
  })

  it('leaves out the items that already sit on the edge', () => {
    const bounds = selectionBounds(TWO)!
    expect(alignMoves(TWO, bounds, 'left').has('a')).toBe(false)
  })
})

describe('alignSelection action', () => {
  it('aligns the selection in one undo step', () => {
    hydrate(...TWO)
    ui().set({ selection: { kind: 'furnitureMulti', artboardId: 'ab1', furnitureIds: ['a', 'b'] } })
    const before = past()
    expect(alignSelection('left')).toBe(true)
    expect(pos('a')).toEqual({ xCm: 50, yCm: 25 })
    expect(pos('b')).toEqual({ xCm: 50, yCm: 225 })
    expect(past()).toBe(before + 1)
    s().undo()
    expect(pos('b')).toEqual({ xCm: 350, yCm: 225 })
  })

  it('needs 2 items', () => {
    hydrate(box('a', 0, 0))
    ui().set({ selection: { kind: 'furniture', artboardId: 'ab1', furnitureId: 'a' } })
    expect(alignSelection('left')).toBe(false)
  })
})

describe('distributeMoves', () => {
  it('gives equal horizontal gaps and keeps the outer items', () => {
    const items = [box('a', 0, 0), box('b', 150, 0), box('c', 600, 0)]
    const moves = distributeMoves(items, 'horizontal')
    // Span 0..700, widths 100 + 100 + 100, gap = (700 - 300) / 2 = 200 -> b starts at 300.
    expect(moves.get('b')).toEqual({ xCm: 350, yCm: 25 })
    expect(moves.has('a')).toBe(false)
    expect(moves.has('c')).toBe(false)
  })

  it('gives equal vertical gaps and keeps the outer items', () => {
    const items = [box('a', 0, 0), box('b', 0, 60), box('c', 0, 600)]
    const moves = distributeMoves(items, 'vertical')
    // Span 0..650, depths 50 + 50 + 50, gap = (650 - 150) / 2 = 250 -> b starts at 300.
    expect(moves.get('b')).toEqual({ xCm: 50, yCm: 325 })
    expect(moves.size).toBe(1)
  })

  it('needs 3 items', () => {
    expect(distributeMoves(TWO, 'horizontal').size).toBe(0)
  })
})

describe('distributeSelection action', () => {
  it('spreads 3 selected items in one undo step', () => {
    hydrate(box('a', 0, 0), box('b', 150, 0), box('c', 600, 0))
    ui().set({ selection: { kind: 'furnitureMulti', artboardId: 'ab1', furnitureIds: ['a', 'b', 'c'] } })
    const before = past()
    expect(distributeSelection('horizontal')).toBe(true)
    expect(pos('b')).toEqual({ xCm: 350, yCm: 25 })
    expect(past()).toBe(before + 1)
  })

  it('does nothing with 2 items', () => {
    hydrate(...TWO)
    ui().set({ selection: { kind: 'furnitureMulti', artboardId: 'ab1', furnitureIds: ['a', 'b'] } })
    expect(distributeSelection('vertical')).toBe(false)
  })

  it('does nothing when the items already have equal gaps', () => {
    hydrate(box('a', 0, 0), box('b', 300, 0), box('c', 600, 0))
    ui().set({ selection: { kind: 'furnitureMulti', artboardId: 'ab1', furnitureIds: ['a', 'b', 'c'] } })
    expect(distributeSelection('horizontal')).toBe(false)
  })
})
