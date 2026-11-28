// Tests of the one style clipboard (Option+Cmd+C / Option+Cmd+V): only the visual fields travel
// (colour and material), never geometry or the other style fields, and one paste = one undo step.
//   ab1 holds r1 (source room), r2 and r3 (plain rooms), a few walls, doors and furniture items.
import { beforeEach, describe, expect, it } from 'vitest'
import { createArtboard, createDefaultProject } from '../../model/schema'
import { useDoc } from '../../model/store'
import type { Artboard, FurnitureItem, Opening, Room, Selection } from '../../model/types'
import { useUi } from '../../shell/uiStore'
import {
  applyStyleToArtboard,
  copyStyle,
  getCopiedStyle,
  pasteStyle,
  sameCopiedStyle,
  setCopiedStyle,
  styleOfTarget,
  targetsFromSelection,
  type StyleTarget,
} from './styleClipboard'

const room = (id: string, p: Partial<Room> = {}): Room => ({
  id,
  name: id.toUpperCase(),
  vertices: [
    { x: 0, y: 0 },
    { x: 400, y: 0 },
    { x: 400, y: 300 },
    { x: 0, y: 300 },
  ],
  ...p,
})

const door = (id: string, p: Partial<Opening> = {}): Opening => ({
  id,
  kind: 'door',
  xCm: 100,
  yCm: 0,
  angleDeg: 0,
  widthCm: 80,
  ...p,
})

const item = (id: string, p: Partial<FurnitureItem> = {}): FurnitureItem => ({
  id,
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

const board = (p: Partial<Artboard> = {}): Artboard => ({
  ...createArtboard('Plan A'),
  id: 'ab1',
  precisionCm: 1,
  ...p,
})

const s = () => useDoc.getState()
const ui = () => useUi.getState()
const past = () => useDoc.temporal.getState().pastStates.length
const ab = () => s().doc.artboards[0]
const findRoom = (id: string) => ab().rooms.find((r) => r.id === id)!
const findOpening = (id: string) => ab().openings.find((o) => o.id === id)!
const findItem = (id: string) => ab().furniture.find((f) => f.id === id)!

const hydrate = (p: Partial<Artboard>) => s().hydrate({ ...createDefaultProject(), artboards: [board(p)] })

const select = (selection: Selection) => ui().set({ selection })
/** A 'multi' selection: that kind comes from the parallel selection work, hence the cast. */
const multi = (items: StyleTarget[]): Selection => ({ kind: 'multi', artboardId: 'ab1', items }) as unknown as Selection

beforeEach(() => {
  s().resetDoc()
  select({ kind: 'none' })
  setCopiedStyle(null)
})

describe('targetsFromSelection', () => {
  it('gives one target per selected object, and none for the other kinds', () => {
    const artboard = board({ furniture: [item('a', { groupId: 'g1' }), item('b', { groupId: 'g1' }), item('c')] })
    expect(targetsFromSelection({ kind: 'room', artboardId: 'ab1', roomIds: ['r1', 'r2'] }, artboard)).toEqual([
      { kind: 'room', roomId: 'r1' },
      { kind: 'room', roomId: 'r2' },
    ])
    expect(targetsFromSelection({ kind: 'wall', artboardId: 'ab1', roomId: 'r1', edgeIndex: 2 }, artboard)).toEqual([
      { kind: 'wall', roomId: 'r1', edgeIndex: 2 },
    ])
    expect(targetsFromSelection({ kind: 'opening', artboardId: 'ab1', openingId: 'o1' }, artboard)).toEqual([
      { kind: 'opening', openingId: 'o1' },
    ])
    expect(targetsFromSelection({ kind: 'furniture', artboardId: 'ab1', furnitureId: 'c' }, artboard)).toEqual([
      { kind: 'furniture', furnitureId: 'c' },
    ])
    // Every member of a group follows its member.
    expect(targetsFromSelection({ kind: 'furniture', artboardId: 'ab1', furnitureId: 'a' }, artboard)).toEqual([
      { kind: 'furniture', furnitureId: 'a' },
      { kind: 'furniture', furnitureId: 'b' },
    ])
    expect(targetsFromSelection({ kind: 'none' }, artboard)).toEqual([])
    expect(targetsFromSelection({ kind: 'artboard', artboardId: 'ab1' }, artboard)).toEqual([])
    expect(targetsFromSelection({ kind: 'vertex', artboardId: 'ab1', roomId: 'r1', vertexIndex: 0 }, artboard)).toEqual([])
    // The 'multi' kind of the parallel selection work; furniture items are expanded to their group.
    expect(multi([{ kind: 'room', roomId: 'r1' }, { kind: 'furniture', furnitureId: 'a' }])).toBeTruthy()
    expect(targetsFromSelection(multi([{ kind: 'room', roomId: 'r1' }, { kind: 'furniture', furnitureId: 'a' }]), artboard)).toEqual([
      { kind: 'room', roomId: 'r1' },
      { kind: 'furniture', furnitureId: 'a' },
      { kind: 'furniture', furnitureId: 'b' },
    ])
  })
})

describe('styleOfTarget', () => {
  it('reads only the visual fields, and null for a missing object', () => {
    const artboard = board({
      rooms: [
        room('r1', { fill: '#111111', floorPattern: 'wood', floorPatternAngleDeg: 30, wallColors: { '1': '#222222' }, wallKinds: { '1': 'fence' } }),
      ],
      openings: [door('o1', { color: '#333333', variant: 'pocket', widthCm: 90 })],
      furniture: [item('a', { color: '#444444', showDirection: true, cornerRadiusCm: 8 })],
    })
    expect(styleOfTarget(artboard, { kind: 'furniture', furnitureId: 'a' })).toEqual({ kind: 'furniture', color: '#444444' })
    expect(styleOfTarget(artboard, { kind: 'opening', openingId: 'o1' })).toEqual({ kind: 'opening', color: '#333333' })
    expect(styleOfTarget(artboard, { kind: 'wall', roomId: 'r1', edgeIndex: 1 })).toEqual({ kind: 'wall', color: '#222222' })
    expect(styleOfTarget(artboard, { kind: 'wall', roomId: 'r1', edgeIndex: 0 })).toEqual({ kind: 'wall' })
    expect(styleOfTarget(artboard, { kind: 'room', roomId: 'r1' })).toEqual({
      kind: 'room',
      fill: '#111111',
      floorPattern: 'wood',
      floorPatternAngleDeg: 30,
    })
    // Missing objects.
    expect(styleOfTarget(artboard, { kind: 'furniture', furnitureId: 'x' })).toBeNull()
    expect(styleOfTarget(artboard, { kind: 'opening', openingId: 'x' })).toBeNull()
    expect(styleOfTarget(artboard, { kind: 'room', roomId: 'x' })).toBeNull()
    // Wall edge out of range (r1 has 4 vertices, so edges 0..3).
    expect(styleOfTarget(artboard, { kind: 'wall', roomId: 'r1', edgeIndex: 4 })).toBeNull()
  })

  it('treats omitted and undefined as equal, and an omitted angle as 0', () => {
    expect(sameCopiedStyle({ kind: 'wall' }, { kind: 'wall', color: undefined })).toBe(true)
    expect(sameCopiedStyle({ kind: 'room', floorPatternAngleDeg: 0 }, { kind: 'room' })).toBe(true)
    expect(sameCopiedStyle({ kind: 'room', floorPatternAngleDeg: 45 }, { kind: 'room' })).toBe(false)
    expect(sameCopiedStyle({ kind: 'opening', color: '#fff' }, { kind: 'opening', color: '#000' })).toBe(false)
    expect(sameCopiedStyle({ kind: 'opening' }, { kind: 'wall' })).toBe(false)
  })
})

describe('copyStyle', () => {
  it('copies the style of the first target when the selection is one kind', () => {
    hydrate({ rooms: [room('r1', { fill: '#111111' }), room('r2')] })
    select({ kind: 'room', artboardId: 'ab1', roomIds: ['r1', 'r2'] })
    expect(copyStyle()).toBe(true)
    expect(getCopiedStyle()).toEqual({ kind: 'room', fill: '#111111' })
  })

  it('refuses a mixed-kind selection and an empty one', () => {
    hydrate({ rooms: [room('r1', { fill: '#111111' })], furniture: [item('a')] })
    select(multi([{ kind: 'room', roomId: 'r1' }, { kind: 'furniture', furnitureId: 'a' }]))
    expect(copyStyle()).toBe(false)
    expect(getCopiedStyle()).toBeNull()
    select({ kind: 'none' })
    expect(copyStyle()).toBe(false)
    select({ kind: 'artboard', artboardId: 'ab1' })
    expect(copyStyle()).toBe(false)
    expect(getCopiedStyle()).toBeNull()
  })
})

describe('pasteStyle', () => {
  it('copies and pastes the colour of furniture, and nothing else', () => {
    hydrate({
      furniture: [
        item('src', { color: '#abcdef' }),
        item('a', { color: '#000000', showDirection: true, cornerRadiusCm: 9, heightCm: 120, widthCm: 40, rotationDeg: 45, groupId: 'g1' }),
      ],
    })
    select({ kind: 'furniture', artboardId: 'ab1', furnitureId: 'src' })
    expect(copyStyle()).toBe(true)
    select({ kind: 'furniture', artboardId: 'ab1', furnitureId: 'a' })
    expect(pasteStyle()).toBe(true)
    expect(findItem('a')).toMatchObject({ color: '#abcdef' })
    // The other visual and geometry fields stay exactly as they were.
    expect(findItem('a')).toMatchObject({ showDirection: true, cornerRadiusCm: 9, heightCm: 120, widthCm: 40, rotationDeg: 45, groupId: 'g1' })
  })

  it('copies and pastes the colour of an opening, and keeps its variant and size', () => {
    hydrate({
      openings: [
        door('src', { color: '#112233' }),
        door('a', { kind: 'window', variant: 'sliding', widthCm: 120, heightCm: 140, sillCm: 90, hinge: 'left', swing: 'out' }),
      ],
    })
    select({ kind: 'opening', artboardId: 'ab1', openingId: 'src' })
    expect(copyStyle()).toBe(true)
    expect(getCopiedStyle()).toEqual({ kind: 'opening', color: '#112233' })
    select({ kind: 'opening', artboardId: 'ab1', openingId: 'a' })
    expect(pasteStyle()).toBe(true)
    expect(findOpening('a')).toMatchObject({
      color: '#112233',
      kind: 'window',
      variant: 'sliding',
      widthCm: 120,
      heightCm: 140,
      sillCm: 90,
      hinge: 'left',
      swing: 'out',
    })
  })

  it('copies and pastes one wall colour, and keeps the other walls and their kinds', () => {
    hydrate({
      rooms: [
        room('src', { wallColors: { '0': '#aa0000', '2': '#00aa00' }, wallKinds: { '0': 'fence' } }),
        room('r2', { wallColors: { '3': '#0000aa' }, wallKinds: { '1': 'fence' } }),
      ],
    })
    select({ kind: 'wall', artboardId: 'ab1', roomId: 'src', edgeIndex: 0 })
    expect(copyStyle()).toBe(true)
    expect(getCopiedStyle()).toEqual({ kind: 'wall', color: '#aa0000' })
    select({ kind: 'wall', artboardId: 'ab1', roomId: 'r2', edgeIndex: 1 })
    expect(pasteStyle()).toBe(true)
    expect(findRoom('r2').wallColors).toEqual({ '3': '#0000aa', '1': '#aa0000' })
    expect(findRoom('r2').wallKinds).toEqual({ '1': 'fence' })
    // The source is untouched.
    expect(findRoom('src').wallColors).toEqual({ '0': '#aa0000', '2': '#00aa00' })
  })

  it('copies and pastes the floor of a room, and keeps its wall paints and wall kinds', () => {
    hydrate({
      rooms: [
        room('src', { fill: '#111111', floorPattern: 'parquet', floorPatternAngleDeg: 30 }),
        room('r2', { fill: '#ffffff', floorPattern: 'tile', wallColors: { '0': '#ff0000' }, wallKinds: { '2': 'fence' } }),
      ],
    })
    select({ kind: 'room', artboardId: 'ab1', roomIds: ['src'] })
    expect(copyStyle()).toBe(true)
    expect(getCopiedStyle()).toEqual({ kind: 'room', fill: '#111111', floorPattern: 'parquet', floorPatternAngleDeg: 30 })
    select({ kind: 'room', artboardId: 'ab1', roomIds: ['r2'] })
    expect(pasteStyle()).toBe(true)
    expect(findRoom('r2')).toMatchObject({ fill: '#111111', floorPattern: 'parquet', floorPatternAngleDeg: 30 })
    expect(findRoom('r2').wallColors).toEqual({ '0': '#ff0000' })
    expect(findRoom('r2').wallKinds).toEqual({ '2': 'fence' })
    expect(findRoom('r2').vertices).toHaveLength(4)
  })

  it('deletes the fields the copied style does not have', () => {
    hydrate({
      openings: [door('src'), door('a', { color: '#123456' })],
      rooms: [room('sroom'), room('aroom', { fill: '#888888', floorPattern: 'wood', floorPatternAngleDeg: 15, wallColors: { '0': '#999999' } })],
    })
    select({ kind: 'opening', artboardId: 'ab1', openingId: 'src' })
    copyStyle()
    select({ kind: 'opening', artboardId: 'ab1', openingId: 'a' })
    expect(pasteStyle()).toBe(true)
    expect(findOpening('a').color).toBeUndefined()

    select({ kind: 'room', artboardId: 'ab1', roomIds: ['sroom'] })
    copyStyle()
    select({ kind: 'room', artboardId: 'ab1', roomIds: ['aroom'] })
    expect(pasteStyle()).toBe(true)
    expect(findRoom('aroom').fill).toBeUndefined()
    expect(findRoom('aroom').floorPattern).toBeUndefined()
    expect(findRoom('aroom').floorPatternAngleDeg).toBeUndefined()
    // A room paste never clears the wall paints.
    expect(findRoom('aroom').wallColors).toEqual({ '0': '#999999' })
  })

  it('removes the wallColors map when its last key goes', () => {
    hydrate({ rooms: [room('src'), room('r2', { wallColors: { '1': '#0000aa' } })] })
    select({ kind: 'wall', artboardId: 'ab1', roomId: 'src', edgeIndex: 1 })
    expect(copyStyle()).toBe(true)
    expect(getCopiedStyle()).toEqual({ kind: 'wall' })
    select({ kind: 'wall', artboardId: 'ab1', roomId: 'r2', edgeIndex: 1 })
    expect(pasteStyle()).toBe(true)
    expect(findRoom('r2').wallColors).toBeUndefined()
  })

  it('makes no undo step when nothing changes, and one undo step for several targets', () => {
    hydrate({
      rooms: [room('src', { fill: '#111111' }), room('r2'), room('r3', { fill: '#222222' })],
      openings: [door('o1', { color: '#333333' })],
    })
    select({ kind: 'room', artboardId: 'ab1', roomIds: ['src'] })
    expect(copyStyle()).toBe(true)

    // Same room: it already has the style, so no write and no undo step.
    select({ kind: 'room', artboardId: 'ab1', roomIds: ['src'] })
    let before = past()
    expect(pasteStyle()).toBe(false)
    expect(past()).toBe(before)

    // Nothing was copied: no undo step either.
    setCopiedStyle(null)
    before = past()
    expect(pasteStyle()).toBe(false)
    expect(past()).toBe(before)

    // Two rooms at once: both change, and that is exactly one undo step.
    select({ kind: 'room', artboardId: 'ab1', roomIds: ['src'] })
    copyStyle()
    select({ kind: 'room', artboardId: 'ab1', roomIds: ['r2', 'r3'] })
    before = past()
    expect(pasteStyle()).toBe(true)
    expect(past()).toBe(before + 1)
    expect(findRoom('r2').fill).toBe('#111111')
    expect(findRoom('r3').fill).toBe('#111111')
    s().undo()
    expect(findRoom('r2').fill).toBeUndefined()
    expect(findRoom('r3').fill).toBe('#222222')
  })

  it('changes only the targets of the copied kind in a mixed selection', () => {
    hydrate({
      rooms: [room('src', { wallColors: { '0': '#aa0000' } }), room('r2'), room('r3')],
      furniture: [item('a', { color: '#000000' })],
    })
    select({ kind: 'wall', artboardId: 'ab1', roomId: 'src', edgeIndex: 0 })
    expect(copyStyle()).toBe(true)
    select(multi([{ kind: 'wall', roomId: 'r2', edgeIndex: 1 }, { kind: 'room', roomId: 'r3' }, { kind: 'furniture', furnitureId: 'a' }]))
    const before = past()
    expect(pasteStyle()).toBe(true)
    expect(past()).toBe(before + 1)
    expect(findRoom('r2').wallColors).toEqual({ '1': '#aa0000' })
    expect(findRoom('r3').fill).toBeUndefined()
    expect(findItem('a').color).toBe('#000000')
  })

  it('writes every member of a furniture group', () => {
    hydrate({
      furniture: [
        item('src', { color: '#abcabc' }),
        item('a', { color: '#000000', groupId: 'g1' }),
        item('b', { color: '#111111', groupId: 'g1' }),
      ],
    })
    select({ kind: 'furniture', artboardId: 'ab1', furnitureId: 'src' })
    expect(copyStyle()).toBe(true)
    select({ kind: 'furniture', artboardId: 'ab1', furnitureId: 'a' })
    const before = past()
    expect(pasteStyle()).toBe(true)
    expect(past()).toBe(before + 1)
    expect(findItem('a').color).toBe('#abcabc')
    expect(findItem('b').color).toBe('#abcabc')
  })
})

describe('applyStyleToArtboard', () => {
  it('counts only the targets it writes, and skips other kinds and missing objects', () => {
    const artboard = board({
      rooms: [room('r1'), room('r2', { fill: '#111111' })],
      openings: [door('o1')],
    })
    const written = applyStyleToArtboard(
      artboard,
      [
        { kind: 'room', roomId: 'r1' },
        { kind: 'room', roomId: 'r2' },
        { kind: 'room', roomId: 'missing' },
        { kind: 'opening', openingId: 'o1' },
      ],
      { kind: 'room', fill: '#111111' },
    )
    expect(written).toBe(1)
    expect(artboard.rooms[0].fill).toBe('#111111')
    // Already the same style: not counted again.
    expect(applyStyleToArtboard(artboard, [{ kind: 'room', roomId: 'r2' }], { kind: 'room', fill: '#111111' })).toBe(0)
  })
})
