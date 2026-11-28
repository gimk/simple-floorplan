// properties.ts is now a thin compatibility file: App.tsx imports copyStyle / pasteStyle from it, and
// they are the style clipboard of src/features/style/styleClipboard.ts. The style is VISUAL ONLY:
// the colour of furniture, openings and walls and the floor colour and material of rooms.
// These tests only pin the re-export and the furniture case (colour only, groups included); the full
// matrix lives in src/features/style/styleClipboard.test.ts. Units: cm.
import { beforeEach, describe, expect, it } from 'vitest'
import { createArtboard, createDefaultProject } from '../../model/schema'
import { useDoc } from '../../model/store'
import type { Artboard, FurnitureItem } from '../../model/types'
import { useUi } from '../../shell/uiStore'
import { copyStyle, getCopiedStyle, pasteStyle, setCopiedStyle } from './properties'

const item = (p: Partial<FurnitureItem> = {}): FurnitureItem => ({
  id: 'f1',
  name: 'Sofa',
  shape: 'rect',
  xCm: 100,
  yCm: 200,
  widthCm: 100,
  depthCm: 50,
  rotationDeg: 0,
  color: '#4b5563',
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

describe('properties.ts (compatibility surface)', () => {
  it('re-exports the clipboard of colour only', () => {
    hydrate(item({ id: 'src', color: '#ff0000', showDirection: true, cornerRadiusCm: 8 }))
    ui().set({ selection: { kind: 'furniture', artboardId: 'ab1', furnitureId: 'src' } })
    expect(copyStyle()).toBe(true)
    // The direction arrow and the corner radii are not style any more.
    expect(getCopiedStyle()).toEqual({ kind: 'furniture', color: '#ff0000' })
  })

  it('pastes the colour onto every member of a group in one undo step', () => {
    hydrate(
      item({ id: 'src', color: '#abcdef' }),
      item({ id: 'a', color: '#000000', groupId: 'g1', cornerRadiusCm: 9 }),
      item({ id: 'b', color: '#111111', groupId: 'g1' }),
    )
    ui().set({ selection: { kind: 'furniture', artboardId: 'ab1', furnitureId: 'src' } })
    copyStyle()
    ui().set({ selection: { kind: 'furnitureMulti', artboardId: 'ab1', furnitureIds: ['a', 'b'] } })
    const before = past()
    expect(pasteStyle()).toBe(true)
    expect(past()).toBe(before + 1)
    expect(find('a').color).toBe('#abcdef')
    expect(find('b').color).toBe('#abcdef')
    expect(find('a').cornerRadiusCm).toBe(9)
  })
})
