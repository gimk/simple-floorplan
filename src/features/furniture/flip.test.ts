// Flip (Shift+H / Shift+V): the flag of one item toggles, a multi-selection also mirrors its centres
// and rotations, the stored flag is cleaned up when it goes back to false, and the schema takes
// flipX / flipY. Units: cm and degrees.
import { beforeEach, describe, expect, it } from 'vitest'
import { createArtboard, createDefaultProject, parseProjectDoc } from '../../model/schema'
import { useDoc } from '../../model/store'
import type { Artboard, FurnitureItem } from '../../model/types'
import { useUi } from '../../shell/uiStore'
import { applyFlipPatches, flippedAngle, flipPatches, flipSelection } from './flip'

const item = (p: Partial<FurnitureItem> = {}): FurnitureItem => ({
  id: 'f1', name: 'Sofa', shape: 'rect', xCm: 100, yCm: 200, widthCm: 100, depthCm: 50, rotationDeg: 0, color: '#4b5563',
  ...p,
})

const board = (furniture: FurnitureItem[]): Artboard => ({ ...createArtboard('Plan A'), id: 'ab1', precisionCm: 1, rooms: [], furniture })

const s = () => useDoc.getState()
const ui = () => useUi.getState()
const past = () => useDoc.temporal.getState().pastStates.length
const find = (id: string) => s().doc.artboards[0].furniture.find((f) => f.id === id)!

const hydrate = (...furniture: FurnitureItem[]) => s().hydrate({ ...createDefaultProject(), artboards: [board(furniture)] })

beforeEach(() => {
  s().resetDoc()
  ui().set({ selection: { kind: 'none' }, activeArtboardId: null, mode: 'design' })
})

describe('flippedAngle', () => {
  it('mirrors the rotation horizontally with 360 - deg', () => {
    expect(flippedAngle(0, 'x')).toBe(0)
    expect(flippedAngle(90, 'x')).toBe(270)
    expect(flippedAngle(30, 'x')).toBe(330)
    expect(flippedAngle(270, 'x')).toBe(90)
  })

  it('mirrors the rotation vertically with 180 - deg, normalized', () => {
    expect(flippedAngle(0, 'y')).toBe(180)
    expect(flippedAngle(90, 'y')).toBe(90)
    expect(flippedAngle(30, 'y')).toBe(150)
    expect(flippedAngle(200, 'y')).toBe(340)
  })

  it('stays inside [0, 360) and rounds to 0.1 degree', () => {
    expect(flippedAngle(360, 'x')).toBe(0)
    expect(flippedAngle(360, 'y')).toBe(180)
    expect(flippedAngle(-90, 'x')).toBe(90)
    expect(flippedAngle(33.33, 'x')).toBe(326.7)
  })
})

describe('flipPatches', () => {
  it('only toggles the flag of a single item', () => {
    const patches = flipPatches([item({ id: 'a' })], { minX: 0, minY: 0, maxX: 100, maxY: 100 }, 'x')
    expect(patches.get('a')).toEqual({ flipX: true })
  })

  it('toggles back to false when the flag is already set', () => {
    const patches = flipPatches([item({ id: 'a', flipY: true })], null, 'y')
    expect(patches.get('a')).toEqual({ flipY: false })
  })

  it('mirrors the centres across the selection centre for 2+ items', () => {
    const items = [item({ id: 'a', xCm: 100, rotationDeg: 90 }), item({ id: 'b', xCm: 300, rotationDeg: 0 })]
    const bounds = { minX: 0, minY: 0, maxX: 400, maxY: 200 }
    const patches = flipPatches(items, bounds, 'x')
    // Centre x = 200: 100 -> 300, 300 -> 100.
    expect(patches.get('a')).toEqual({ flipX: true, rotationDeg: 270, xCm: 300 })
    expect(patches.get('b')).toEqual({ flipX: true, rotationDeg: 0, xCm: 100 })
  })

  it('mirrors y for the vertical flip', () => {
    const items = [item({ id: 'a', yCm: 100 }), item({ id: 'b', yCm: 500 })]
    const patches = flipPatches(items, { minX: 0, minY: 0, maxX: 100, maxY: 600 }, 'y')
    // Centre y = 300: 100 -> 500, 500 -> 100.
    expect(patches.get('a')).toEqual({ flipY: true, rotationDeg: 180, yCm: 500 })
    expect(patches.get('b')).toEqual({ flipY: true, rotationDeg: 180, yCm: 100 })
  })
})

describe('applyFlipPatches', () => {
  it('stores true and deletes the flag when it is false again', () => {
    const ab = board([item({ id: 'a', flipX: true })])
    applyFlipPatches(ab, new Map([['a', { flipX: false }]]))
    expect('flipX' in ab.furniture[0]).toBe(false)
    applyFlipPatches(ab, new Map([['a', { flipY: true }]]))
    expect(ab.furniture[0].flipY).toBe(true)
  })
})

describe('flipSelection action', () => {
  it('flips one item in one undo step, without moving it', () => {
    hydrate(item({ id: 'a', rotationDeg: 90 }))
    ui().set({ selection: { kind: 'furniture', artboardId: 'ab1', furnitureId: 'a' } })
    const before = past()
    expect(flipSelection('x')).toBe(true)
    expect(find('a')).toMatchObject({ flipX: true, rotationDeg: 90, xCm: 100, yCm: 200 })
    expect(past()).toBe(before + 1)
    // A second flip toggles the flag back off and stores nothing.
    expect(flipSelection('x')).toBe(true)
    expect(find('a').flipX).toBeUndefined()
    s().undo()
    expect(find('a').flipX).toBe(true)
    s().undo()
    expect(find('a').flipX).toBeUndefined()
  })

  it('flips a multi-selection, rotations included', () => {
    hydrate(item({ id: 'a', xCm: 100, rotationDeg: 90 }), item({ id: 'b', xCm: 300 }))
    ui().set({ selection: { kind: 'furnitureMulti', artboardId: 'ab1', furnitureIds: ['a', 'b'] } })
    expect(flipSelection('x')).toBe(true)
    // The selection box of the rotated item a (100 x 50 at 90 deg) runs from x 75 to x 125, so the
    // bounds are 75..350 and their centre is 212.5: 100 -> 325, 300 -> 125.
    expect(find('a')).toMatchObject({ flipX: true, xCm: 325, rotationDeg: 270 })
    expect(find('b')).toMatchObject({ flipX: true, xCm: 125, rotationDeg: 0 })
  })

  it('does nothing without a furniture selection', () => {
    hydrate(item({ id: 'a' }))
    ui().set({ selection: { kind: 'none' } })
    expect(flipSelection('y')).toBe(false)
  })
})

describe('schema', () => {
  const project = (furniture: unknown[]) => ({
    schemaVersion: 3,
    id: 'p1',
    title: 'T',
    refImages: [],
    artboards: [{ ...createArtboard('Plan A'), id: 'ab1', furniture }],
  })

  it('accepts flipX and flipY', () => {
    const r = parseProjectDoc(project([item({ id: 'a', flipX: true, flipY: true })]))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.doc.artboards[0].furniture[0]).toMatchObject({ flipX: true, flipY: true })
  })

  it('rejects a non-boolean flip flag', () => {
    expect(parseProjectDoc(project([item({ id: 'a', flipX: 'yes' as unknown as boolean })])).ok).toBe(false)
  })

  it('still accepts an item without the flags', () => {
    expect(parseProjectDoc(project([item({ id: 'a' })])).ok).toBe(true)
  })
})
