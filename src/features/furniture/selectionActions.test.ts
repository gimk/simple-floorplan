// Select all (Cmd/Ctrl+A) and Enter / Shift+Enter of a furniture group: the pure resolution
// helpers and the store actions they feed. Units: cm.
import { beforeEach, describe, expect, it } from 'vitest'
import { createArtboard, createDefaultProject } from '../../model/schema'
import { useDoc } from '../../model/store'
import type { Artboard, FurnitureItem, Room } from '../../model/types'
import { useUi } from '../../shell/uiStore'
import {
  clearSelection,
  enterGroup,
  exitGroupToSelection,
  resolveEnterGroup,
  resolveSelectAll,
  resolveShiftEnterGroup,
  selectAll,
  selectionArtboardId,
} from './selectionActions'

const item = (p: Partial<FurnitureItem> = {}): FurnitureItem => ({
  id: 'f1', name: 'Sofa', shape: 'rect', xCm: 100, yCm: 100, widthCm: 100, depthCm: 50, rotationDeg: 0, color: '#4b5563',
  ...p,
})

const room = (id: string, x = 0, y = 0): Room => ({
  id, name: id, vertices: [{ x, y }, { x: x + 200, y }, { x: x + 200, y: y + 200 }, { x, y: y + 200 }],
})

const board = (p: Partial<Artboard> = {}): Artboard => ({ ...createArtboard('Plan A'), id: 'ab1', precisionCm: 1, rooms: [], furniture: [], ...p })

const s = () => useDoc.getState()
const ui = () => useUi.getState()

/** Doc with the given artboards (ids are the ones given in `p.id`). */
const hydrate = (...boards: Artboard[]) => {
  s().hydrate({ ...createDefaultProject(), artboards: boards })
}

beforeEach(() => {
  s().resetDoc()
  ui().set({ selection: { kind: 'none' }, activeArtboardId: null, mode: 'design' })
})

describe('resolveSelectAll', () => {
  it('selects every furniture item of the artboard of the current selection', () => {
    hydrate(
      board({ id: 'ab1', furniture: [item({ id: 'a' }), item({ id: 'b' })] }),
      board({ id: 'ab2', furniture: [item({ id: 'c' })] }),
    )
    const target = resolveSelectAll(s().doc, { kind: 'furniture', artboardId: 'ab2', furnitureId: 'c' }, 'design')
    expect(target).toEqual({ kind: 'furniture', artboardId: 'ab2', ids: ['c'] })
  })

  it('falls back to the first artboard that has furniture when nothing is selected', () => {
    hydrate(
      board({ id: 'empty' }),
      board({ id: 'ab2', furniture: [item({ id: 'a' }), item({ id: 'b' })] }),
    )
    expect(resolveSelectAll(s().doc, { kind: 'none' }, 'design')).toEqual({ kind: 'furniture', artboardId: 'ab2', ids: ['a', 'b'] })
  })

  it('does nothing in Design mode when no artboard holds furniture', () => {
    hydrate(board({ id: 'empty' }))
    expect(resolveSelectAll(s().doc, { kind: 'none' }, 'design')).toBeNull()
  })

  it('selects every room of a multi-room selection in Plan mode', () => {
    hydrate(board({ id: 'ab1', rooms: [room('r1'), room('r2', 300), room('r3', 600)] }))
    expect(resolveSelectAll(s().doc, { kind: 'room', artboardId: 'ab1', roomIds: ['r1', 'r3'] }, 'plan')).toEqual({
      kind: 'rooms', artboardId: 'ab1', ids: ['r1', 'r2', 'r3'],
    })
  })

  it('does nothing in Plan mode without a multi-room selection', () => {
    hydrate(board({ id: 'ab1', rooms: [room('r1'), room('r2', 300)] }))
    expect(resolveSelectAll(s().doc, { kind: 'room', artboardId: 'ab1', roomIds: ['r1'] }, 'plan')).toBeNull()
    expect(resolveSelectAll(s().doc, { kind: 'none' }, 'plan')).toBeNull()
  })
})

describe('selectAll action', () => {
  it('builds the multi-selection and makes the artboard active, in no undo step', () => {
    hydrate(board({ id: 'ab1', furniture: [item({ id: 'a' }), item({ id: 'b' }), item({ id: 'c' })] }))
    const before = useDoc.temporal.getState().pastStates.length
    ui().set({ selection: { kind: 'furniture', artboardId: 'ab1', furnitureId: 'b' } })
    expect(selectAll()).toBe(true)
    expect(ui().selection).toEqual({ kind: 'furnitureMulti', artboardId: 'ab1', furnitureIds: ['a', 'b', 'c'] })
    expect(ui().activeArtboardId).toBe('ab1')
    expect(useDoc.temporal.getState().pastStates.length).toBe(before)
  })

  it('selects the single item of an artboard as a normal furniture selection', () => {
    hydrate(board({ id: 'ab1', furniture: [item({ id: 'only' })] }))
    expect(selectAll()).toBe(true)
    expect(ui().selection).toEqual({ kind: 'furniture', artboardId: 'ab1', furnitureId: 'only' })
  })

  it('selects all rooms of the artboard in Plan mode', () => {
    hydrate(board({ id: 'ab1', rooms: [room('r1'), room('r2', 300)] }))
    ui().set({ mode: 'plan', selection: { kind: 'room', artboardId: 'ab1', roomIds: ['r1', 'r2'] } })
    expect(selectAll()).toBe(true)
    expect(ui().selection).toEqual({ kind: 'room', artboardId: 'ab1', roomIds: ['r1', 'r2'] })
  })

  it('reports that it did nothing in Plan mode with a single-room selection', () => {
    hydrate(board({ id: 'ab1', rooms: [room('r1'), room('r2', 300)] }))
    ui().set({ mode: 'plan', selection: { kind: 'room', artboardId: 'ab1', roomIds: ['r1'] } })
    expect(selectAll()).toBe(false)
  })
})

describe('Enter / Shift+Enter on a group', () => {
  const grouped = () =>
    board({
      id: 'ab1',
      furniture: [item({ id: 'a' }), item({ id: 'b', groupId: 'g1' }), item({ id: 'c', groupId: 'g1' }), item({ id: 'd' })],
    })

  it('resolves the top member of the one whole group that is selected', () => {
    const ab = grouped()
    expect(resolveEnterGroup(ab, { kind: 'furnitureMulti', artboardId: 'ab1', furnitureIds: ['b', 'c'] })).toBe('c')
  })

  it('does not resolve for a part of a group, one ungrouped item or two groups', () => {
    const ab = grouped()
    expect(resolveEnterGroup(ab, { kind: 'furnitureMulti', artboardId: 'ab1', furnitureIds: ['b'] })).toBeNull()
    expect(resolveEnterGroup(ab, { kind: 'furnitureMulti', artboardId: 'ab1', furnitureIds: ['a', 'd'] })).toBeNull()
    expect(resolveEnterGroup(ab, { kind: 'furniture', artboardId: 'ab1', furnitureId: 'b' })).toBeNull()
  })

  it('enters the group as a store action', () => {
    hydrate(grouped())
    ui().set({ selection: { kind: 'furnitureMulti', artboardId: 'ab1', furnitureIds: ['b', 'c'] } })
    expect(enterGroup()).toBe(true)
    expect(ui().selection).toEqual({ kind: 'furniture', artboardId: 'ab1', furnitureId: 'c' })
  })

  it('Shift+Enter selects the whole group of the selected member', () => {
    hydrate(grouped())
    expect(resolveShiftEnterGroup(s().doc.artboards[0], { kind: 'furniture', artboardId: 'ab1', furnitureId: 'b' })).toEqual(['b', 'c'])
    ui().set({ selection: { kind: 'furniture', artboardId: 'ab1', furnitureId: 'b' } })
    expect(exitGroupToSelection()).toBe(true)
    expect(ui().selection).toEqual({ kind: 'furnitureMulti', artboardId: 'ab1', furnitureIds: ['b', 'c'] })
  })

  it('Shift+Enter does nothing for an ungrouped item', () => {
    hydrate(grouped())
    ui().set({ selection: { kind: 'furniture', artboardId: 'ab1', furnitureId: 'a' } })
    expect(exitGroupToSelection()).toBe(false)
  })
})

describe('helpers', () => {
  it('clearSelection drops the selection', () => {
    ui().set({ selection: { kind: 'furniture', artboardId: 'ab1', furnitureId: 'a' } })
    clearSelection()
    expect(ui().selection).toEqual({ kind: 'none' })
  })

  it('selectionArtboardId reads the artboard of a selection', () => {
    expect(selectionArtboardId({ kind: 'furniture', artboardId: 'ab1', furnitureId: 'a' })).toBe('ab1')
    expect(selectionArtboardId({ kind: 'room', artboardId: 'ab2', roomIds: ['r'] })).toBe('ab2')
    expect(selectionArtboardId({ kind: 'none' })).toBeNull()
    expect(selectionArtboardId({ kind: 'refImage', imageId: 'i' })).toBeNull()
  })
})
