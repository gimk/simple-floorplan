// World bounds of the current selection, used by "zoom to fit the selection" (Shift+2).
// Units: cm, y points down.
import { describe, expect, it } from 'vitest'
import { createArtboard, createDefaultProject } from '../../model/schema'
import type { Artboard, FurnitureItem, Room } from '../../model/types'
import { selectionWorldBounds } from './selectionBounds'

const item = (p: Partial<FurnitureItem> = {}): FurnitureItem => ({
  id: 'f1', name: 'Sofa', shape: 'rect', xCm: 100, yCm: 100, widthCm: 100, depthCm: 50, rotationDeg: 0, color: '#4b5563',
  ...p,
})

const room = (id: string): Room => ({
  id, name: id, vertices: [{ x: 10, y: 20 }, { x: 210, y: 20 }, { x: 210, y: 220 }, { x: 10, y: 220 }],
})

/** Artboard at world (1000, 0): local + (1000, 0) is world. */
const board = (p: Partial<Artboard> = {}): Artboard => ({
  ...createArtboard('Plan A', 1000, 0), id: 'ab1', precisionCm: 1, rooms: [], furniture: [], ...p,
})

const doc = (...artboards: Artboard[]) => ({ ...createDefaultProject(), artboards })

describe('selectionWorldBounds', () => {
  it('adds the artboard offset to the furniture bounds', () => {
    const d = doc(board({ furniture: [item({ id: 'a' })] }))
    // 100 ± 50 in x, 100 ± 25 in y, plus the artboard offset of 1000.
    expect(selectionWorldBounds(d, { kind: 'furniture', artboardId: 'ab1', furnitureId: 'a' })).toEqual({
      minX: 1050, minY: 75, maxX: 1150, maxY: 125,
    })
  })

  it('grows to every item of a multi-selection', () => {
    const d = doc(board({ furniture: [item({ id: 'a' }), item({ id: 'b', xCm: 300, yCm: 400 })] }))
    expect(selectionWorldBounds(d, { kind: 'furnitureMulti', artboardId: 'ab1', furnitureIds: ['a', 'b'] })).toEqual({
      minX: 1050, minY: 75, maxX: 1350, maxY: 425,
    })
  })

  it('reads the vertices of a room selection', () => {
    const d = doc(board({ rooms: [room('r1')] }))
    expect(selectionWorldBounds(d, { kind: 'room', artboardId: 'ab1', roomIds: ['r1'] })).toEqual({
      minX: 1010, minY: 20, maxX: 1210, maxY: 220,
    })
  })

  it('reads the frame of an artboard selection', () => {
    const d = doc(board({ furniture: [item({ id: 'a' })] }))
    const b = selectionWorldBounds(d, { kind: 'artboard', artboardId: 'ab1' })!
    expect(b.minX).toBeLessThan(1050)
    expect(b.maxX).toBeGreaterThan(1150)
    expect(b.minY).toBeLessThan(75)
    expect(b.maxY).toBeGreaterThan(125)
  })

  it('returns null for selections without geometry or unknown ids', () => {
    const d = doc(board({ furniture: [item({ id: 'a' })] }))
    expect(selectionWorldBounds(d, { kind: 'none' })).toBeNull()
    expect(selectionWorldBounds(d, { kind: 'refImage', imageId: 'i' })).toBeNull()
    expect(selectionWorldBounds(d, { kind: 'furniture', artboardId: 'ab1', furnitureId: 'gone' })).toBeNull()
    expect(selectionWorldBounds(d, { kind: 'furniture', artboardId: 'nope', furnitureId: 'a' })).toBeNull()
    expect(selectionWorldBounds(d, { kind: 'artboard', artboardId: 'nope' })).toBeNull()
  })
})
