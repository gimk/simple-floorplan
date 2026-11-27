// Copy / paste properties (Alt+Cmd+C / Alt+Cmd+V): only the visual-only fields travel, one undo step
// per paste. Units: cm.
import { beforeEach, describe, expect, it } from 'vitest'
import { createArtboard, createDefaultProject } from '../../model/schema'
import { useDoc } from '../../model/store'
import type { Artboard, FurnitureItem } from '../../model/types'
import { useUi } from '../../shell/uiStore'
import { copyStyle, getCopiedStyle, itemsMissingStyle, pasteStyle, sameStyle, setCopiedStyle, STYLE_FIELDS, styleOf } from './properties'

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
  setCopiedStyle(null)
})

describe('styleOf', () => {
  it('keeps the colour, the direction arrow and the corner radius only', () => {
    const style = styleOf(item({ color: '#ff0000', showDirection: true, cornerRadiusCm: 8 }))
    expect(style).toEqual({ color: '#ff0000', showDirection: true, cornerRadiusCm: 8 })
    expect(STYLE_FIELDS).toEqual(['color', 'showDirection', 'cornerRadiusCm'])
    expect(Object.keys(styleOf(item({ showDirection: undefined, cornerRadiusCm: undefined })))).toEqual(['color'])
  })

  it('compares styles with the defaults of the optional fields', () => {
    expect(sameStyle({ color: '#fff' }, { color: '#fff', showDirection: false, cornerRadiusCm: 4 })).toBe(true)
    expect(sameStyle({ color: '#fff' }, { color: '#000' })).toBe(false)
  })
})

describe('copyStyle', () => {
  it('copies the style of the single selected item', () => {
    hydrate(item({ id: 'a', color: '#111111', showDirection: true }))
    ui().set({ selection: { kind: 'furniture', artboardId: 'ab1', furnitureId: 'a' } })
    expect(copyStyle()).toBe(true)
    expect(getCopiedStyle()).toEqual({ color: '#111111', showDirection: true })
  })

  it('does not copy from a multi-selection or an empty selection', () => {
    hydrate(item({ id: 'a' }), item({ id: 'b' }))
    ui().set({ selection: { kind: 'furnitureMulti', artboardId: 'ab1', furnitureIds: ['a', 'b'] } })
    expect(copyStyle()).toBe(false)
    ui().set({ selection: { kind: 'none' } })
    expect(copyStyle()).toBe(false)
    expect(getCopiedStyle()).toBeNull()
  })
})

describe('pasteStyle', () => {
  it('writes the style to every selected item in one undo step, and nothing else', () => {
    hydrate(
      item({ id: 'src', color: '#abcdef', showDirection: true, cornerRadiusCm: 6 }),
      item({ id: 'a', name: 'Chair', xCm: 400, widthCm: 40, depthCm: 40, rotationDeg: 45, groupId: 'g1' }),
      item({ id: 'b', shape: 'circle', color: '#000000' }),
    )
    ui().set({ selection: { kind: 'furniture', artboardId: 'ab1', furnitureId: 'src' } })
    copyStyle()
    ui().set({ selection: { kind: 'furnitureMulti', artboardId: 'ab1', furnitureIds: ['a', 'b'] } })
    const before = past()
    expect(pasteStyle()).toBe(true)
    expect(past()).toBe(before + 1)

    expect(find('a')).toMatchObject({ color: '#abcdef', showDirection: true, cornerRadiusCm: 6 })
    // Position, size, rotation, name, shape and group are untouched.
    expect(find('a')).toMatchObject({ name: 'Chair', xCm: 400, widthCm: 40, depthCm: 40, rotationDeg: 45, groupId: 'g1', shape: 'rect' })
    expect(find('b')).toMatchObject({ color: '#abcdef', shape: 'circle' })

    s().undo()
    expect(find('a').color).toBe('#4b5563')
    expect(find('b').color).toBe('#000000')
  })

  it('clears the optional fields the copied style does not have', () => {
    hydrate(item({ id: 'src' }), item({ id: 'a', showDirection: true, cornerRadiusCm: 9 }))
    ui().set({ selection: { kind: 'furniture', artboardId: 'ab1', furnitureId: 'src' } })
    copyStyle()
    ui().set({ selection: { kind: 'furniture', artboardId: 'ab1', furnitureId: 'a' } })
    expect(pasteStyle()).toBe(true)
    expect(find('a').showDirection).toBeUndefined()
    expect(find('a').cornerRadiusCm).toBeUndefined()
  })

  it('does nothing without a copied style or when every item already has it', () => {
    hydrate(item({ id: 'a' }))
    ui().set({ selection: { kind: 'furniture', artboardId: 'ab1', furnitureId: 'a' } })
    expect(pasteStyle()).toBe(false)
    copyStyle()
    expect(pasteStyle()).toBe(false)
  })

  it('lists only the items whose style differs', () => {
    const ab = board([item({ id: 'a' }), item({ id: 'b', color: '#ff0000' })])
    expect(itemsMissingStyle(ab, { kind: 'furnitureMulti', artboardId: 'ab1', furnitureIds: ['a', 'b'] }, { color: '#4b5563' })).toEqual(['b'])
  })
})
