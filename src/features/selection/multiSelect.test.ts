import { describe, expect, it } from 'vitest'
import type { MultiTarget, Selection } from '../../model/types'
import {
  normalizeSelection,
  sameTarget,
  selectedFurnitureIds,
  selectedOpeningIds,
  selectedRoomIds,
  selectedWallKeys,
  selectionToTargets,
  toggleMultiTarget,
} from './multiSelect'

const room = (roomId: string): MultiTarget => ({ kind: 'room', roomId })
const wall = (roomId: string, edgeIndex: number): MultiTarget => ({ kind: 'wall', roomId, edgeIndex })
const opening = (openingId: string): MultiTarget => ({ kind: 'opening', openingId })
const furniture = (furnitureId: string): MultiTarget => ({ kind: 'furniture', furnitureId })

describe('sameTarget', () => {
  it('compares rooms, openings and furniture by id', () => {
    expect(sameTarget(room('r1'), room('r1'))).toBe(true)
    expect(sameTarget(room('r1'), room('r2'))).toBe(false)
    expect(sameTarget(opening('o1'), opening('o1'))).toBe(true)
    expect(sameTarget(furniture('f1'), furniture('f2'))).toBe(false)
  })
  it('needs both the room id and the edge index for walls', () => {
    expect(sameTarget(wall('r1', 0), wall('r1', 0))).toBe(true)
    expect(sameTarget(wall('r1', 0), wall('r1', 1))).toBe(false)
    expect(sameTarget(wall('r1', 0), wall('r2', 0))).toBe(false)
  })
  it('never matches two different kinds', () => {
    expect(sameTarget(room('x'), opening('x'))).toBe(false)
    expect(sameTarget(wall('x', 0), room('x'))).toBe(false)
  })
})

describe('selectionToTargets', () => {
  const ab = 'a'
  it('returns the room ids of a room selection', () => {
    const sel: Selection = { kind: 'room', artboardId: ab, roomIds: ['r1', 'r2'] }
    expect(selectionToTargets(sel, ab)).toEqual([room('r1'), room('r2')])
  })
  it('returns one target for wall, opening and furniture', () => {
    expect(selectionToTargets({ kind: 'wall', artboardId: ab, roomId: 'r1', edgeIndex: 2 }, ab)).toEqual([wall('r1', 2)])
    expect(selectionToTargets({ kind: 'opening', artboardId: ab, openingId: 'o1' }, ab)).toEqual([opening('o1')])
    expect(selectionToTargets({ kind: 'furniture', artboardId: ab, furnitureId: 'f1' }, ab)).toEqual([furniture('f1')])
  })
  it('returns one target per furnitureMulti id', () => {
    const sel: Selection = { kind: 'furnitureMulti', artboardId: ab, furnitureIds: ['f1', 'f2'] }
    expect(selectionToTargets(sel, ab)).toEqual([furniture('f1'), furniture('f2')])
  })
  it('copies the items of a multi selection', () => {
    const items = [room('r1'), wall('r1', 0), opening('o1')]
    const sel: Selection = { kind: 'multi', artboardId: ab, items }
    const out = selectionToTargets(sel, ab)
    expect(out).toEqual(items)
    expect(out[0]).not.toBe(items[0])
  })
  it('returns [] for none, artboard, vertex and refImage', () => {
    expect(selectionToTargets({ kind: 'none' }, ab)).toEqual([])
    expect(selectionToTargets({ kind: 'artboard', artboardId: ab }, ab)).toEqual([])
    expect(selectionToTargets({ kind: 'vertex', artboardId: ab, roomId: 'r1', vertexIndex: 0 }, ab)).toEqual([])
    expect(selectionToTargets({ kind: 'refImage', imageId: 'i1' }, ab)).toEqual([])
  })
  it('returns [] when the selection is on another artboard', () => {
    expect(selectionToTargets({ kind: 'room', artboardId: 'b', roomIds: ['r1'] }, ab)).toEqual([])
    expect(selectionToTargets({ kind: 'wall', artboardId: 'b', roomId: 'r1', edgeIndex: 0 }, ab)).toEqual([])
    expect(selectionToTargets({ kind: 'opening', artboardId: 'b', openingId: 'o1' }, ab)).toEqual([])
    expect(selectionToTargets({ kind: 'furniture', artboardId: 'b', furnitureId: 'f1' }, ab)).toEqual([])
    expect(selectionToTargets({ kind: 'furnitureMulti', artboardId: 'b', furnitureIds: ['f1'] }, ab)).toEqual([])
    expect(selectionToTargets({ kind: 'multi', artboardId: 'b', items: [room('r1')] }, ab)).toEqual([])
  })
})

describe('normalizeSelection', () => {
  it('gives none for no item', () => {
    expect(normalizeSelection('a', [])).toEqual({ kind: 'none' })
  })
  it('gives the native single kind for one item', () => {
    expect(normalizeSelection('a', [room('r1')])).toEqual({ kind: 'room', artboardId: 'a', roomIds: ['r1'] })
    expect(normalizeSelection('a', [wall('r1', 3)])).toEqual({
      kind: 'wall',
      artboardId: 'a',
      roomId: 'r1',
      edgeIndex: 3,
    })
    expect(normalizeSelection('a', [opening('o1')])).toEqual({ kind: 'opening', artboardId: 'a', openingId: 'o1' })
    expect(normalizeSelection('a', [furniture('f1')])).toEqual({
      kind: 'furniture',
      artboardId: 'a',
      furnitureId: 'f1',
    })
  })
  it('drops duplicates before choosing the kind', () => {
    expect(normalizeSelection('a', [room('r1'), room('r1')])).toEqual({ kind: 'room', artboardId: 'a', roomIds: ['r1'] })
    expect(normalizeSelection('a', [wall('r1', 0), wall('r1', 0)])).toEqual({
      kind: 'wall',
      artboardId: 'a',
      roomId: 'r1',
      edgeIndex: 0,
    })
    expect(normalizeSelection('a', [furniture('f1'), furniture('f1')])).toEqual({
      kind: 'furniture',
      artboardId: 'a',
      furnitureId: 'f1',
    })
  })
  it('keeps the two edges of one room as two walls', () => {
    expect(normalizeSelection('a', [wall('r1', 0), wall('r1', 1)])).toEqual({
      kind: 'multi',
      artboardId: 'a',
      items: [wall('r1', 0), wall('r1', 1)],
    })
  })
  it('gives furnitureMulti for 2 or more furniture items', () => {
    expect(normalizeSelection('a', [furniture('f1'), furniture('f2'), furniture('f3')])).toEqual({
      kind: 'furnitureMulti',
      artboardId: 'a',
      furnitureIds: ['f1', 'f2', 'f3'],
    })
  })
  it('gives room for 2 or more rooms', () => {
    expect(normalizeSelection('a', [room('r1'), room('r2')])).toEqual({
      kind: 'room',
      artboardId: 'a',
      roomIds: ['r1', 'r2'],
    })
  })
  it('gives multi for several openings', () => {
    expect(normalizeSelection('a', [opening('o1'), opening('o2')])).toEqual({
      kind: 'multi',
      artboardId: 'a',
      items: [opening('o1'), opening('o2')],
    })
  })
  it('gives multi for mixed kinds, in item order', () => {
    const items = [furniture('f1'), room('r1'), wall('r1', 0), opening('o1')]
    expect(normalizeSelection('a', items)).toEqual({ kind: 'multi', artboardId: 'a', items })
  })
})

describe('toggleMultiTarget', () => {
  const ab = 'a'
  it('adds a wall to an empty selection', () => {
    expect(toggleMultiTarget({ kind: 'none' }, ab, wall('r1', 0))).toEqual({
      kind: 'wall',
      artboardId: ab,
      roomId: 'r1',
      edgeIndex: 0,
    })
  })
  it('adds a different edge of the same room as a second wall', () => {
    const sel: Selection = { kind: 'wall', artboardId: ab, roomId: 'r1', edgeIndex: 0 }
    expect(toggleMultiTarget(sel, ab, wall('r1', 1))).toEqual({
      kind: 'multi',
      artboardId: ab,
      items: [wall('r1', 0), wall('r1', 1)],
    })
  })
  it('removes a wall that is already selected', () => {
    const sel: Selection = { kind: 'multi', artboardId: ab, items: [wall('r1', 0), wall('r1', 1)] }
    expect(toggleMultiTarget(sel, ab, wall('r1', 0))).toEqual({
      kind: 'wall',
      artboardId: ab,
      roomId: 'r1',
      edgeIndex: 1,
    })
  })
  it('gives the native kind when toggling down to one item', () => {
    const sel: Selection = { kind: 'multi', artboardId: ab, items: [opening('o1'), room('r1')] }
    expect(toggleMultiTarget(sel, ab, opening('o1'))).toEqual({ kind: 'room', artboardId: ab, roomIds: ['r1'] })
    const twoRooms: Selection = { kind: 'room', artboardId: ab, roomIds: ['r1', 'r2'] }
    expect(toggleMultiTarget(twoRooms, ab, room('r2'))).toEqual({ kind: 'room', artboardId: ab, roomIds: ['r1'] })
  })
  it('gives none when the last item is removed', () => {
    const sel: Selection = { kind: 'opening', artboardId: ab, openingId: 'o1' }
    expect(toggleMultiTarget(sel, ab, opening('o1'))).toEqual({ kind: 'none' })
  })
  it('starts fresh when the selection is on another artboard', () => {
    const sel: Selection = { kind: 'room', artboardId: 'b', roomIds: ['r9'] }
    expect(toggleMultiTarget(sel, ab, opening('o1'))).toEqual({ kind: 'opening', artboardId: ab, openingId: 'o1' })
  })
  it('adds furniture to a room selection as a mixed multi', () => {
    const sel: Selection = { kind: 'room', artboardId: ab, roomIds: ['r1'] }
    expect(toggleMultiTarget(sel, ab, furniture('f1'))).toEqual({
      kind: 'multi',
      artboardId: ab,
      items: [room('r1'), furniture('f1')],
    })
  })
})

describe('selected id helpers', () => {
  const ab = 'a'
  const sel: Selection = {
    kind: 'multi',
    artboardId: ab,
    items: [wall('r1', 0), wall('r1', 2), opening('o1'), room('r3'), furniture('f1')],
  }
  it('selectedWallKeys uses roomId:edgeIndex', () => {
    expect([...selectedWallKeys(sel, ab)].sort()).toEqual(['r1:0', 'r1:2'])
  })
  it('selectedOpeningIds returns the opening ids', () => {
    expect([...selectedOpeningIds(sel, ab)]).toEqual(['o1'])
  })
  it('selectedRoomIds returns the room ids', () => {
    expect([...selectedRoomIds(sel, ab)]).toEqual(['r3'])
  })
  it('selectedFurnitureIds returns the furniture ids', () => {
    expect([...selectedFurnitureIds(sel, ab)]).toEqual(['f1'])
  })
  it('all helpers are empty for another artboard', () => {
    expect(selectedWallKeys(sel, 'b').size).toBe(0)
    expect(selectedOpeningIds(sel, 'b').size).toBe(0)
    expect(selectedRoomIds(sel, 'b').size).toBe(0)
    expect(selectedFurnitureIds(sel, 'b').size).toBe(0)
  })
  it('works on the older selection kinds too', () => {
    const fm: Selection = { kind: 'furnitureMulti', artboardId: ab, furnitureIds: ['f1', 'f2'] }
    expect([...selectedFurnitureIds(fm, ab)]).toEqual(['f1', 'f2'])
    const r: Selection = { kind: 'room', artboardId: ab, roomIds: ['r1', 'r2'] }
    expect([...selectedRoomIds(r, ab)]).toEqual(['r1', 'r2'])
    const w: Selection = { kind: 'wall', artboardId: ab, roomId: 'r1', edgeIndex: 1 }
    expect([...selectedWallKeys(w, ab)]).toEqual(['r1:1'])
    const o: Selection = { kind: 'opening', artboardId: ab, openingId: 'o7' }
    expect([...selectedOpeningIds(o, ab)]).toEqual(['o7'])
  })
})
