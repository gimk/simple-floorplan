import { describe, expect, it } from 'vitest'
import type { Artboard, FurnitureItem, Selection } from '../../model/types'
import { mixesFurnitureWithSelection, toggleFurnitureWithMixed } from './mixedClick'

const AB = 'ab1'

const item = (id: string, groupId?: string): FurnitureItem => ({
  id,
  name: id,
  shape: 'rect',
  xCm: 0,
  yCm: 0,
  widthCm: 40,
  depthCm: 40,
  rotationDeg: 0,
  color: '#4b5563',
  ...(groupId ? { groupId } : {}),
})

/** f1 alone, f2 + f3 in group 'g1', f4 alone on another artboard (never touched). */
const artboard = (): Pick<Artboard, 'id' | 'furniture'> => ({
  id: AB,
  furniture: [item('f1'), item('f2', 'g1'), item('f3', 'g1'), item('f4')],
})

const roomSel = (roomIds: string[], artboardId = AB): Selection => ({ kind: 'room', artboardId, roomIds })

describe('mixesFurnitureWithSelection', () => {
  it('is true for a room selection and for a mixed selection', () => {
    expect(mixesFurnitureWithSelection(roomSel(['r1']))).toBe(true)
    expect(
      mixesFurnitureWithSelection({
        kind: 'multi',
        artboardId: AB,
        items: [
          { kind: 'room', roomId: 'r1' },
          { kind: 'furniture', furnitureId: 'f1' },
        ],
      }),
    ).toBe(true)
  })

  it('is false for the furniture-only kinds that keep the existing path', () => {
    expect(mixesFurnitureWithSelection({ kind: 'none' })).toBe(false)
    expect(mixesFurnitureWithSelection({ kind: 'furniture', artboardId: AB, furnitureId: 'f1' })).toBe(false)
    expect(mixesFurnitureWithSelection({ kind: 'furnitureMulti', artboardId: AB, furnitureIds: ['f1', 'f2'] })).toBe(
      false,
    )
  })
})

describe('toggleFurnitureWithMixed', () => {
  it('adds the clicked item to a room selection and gives a mixed selection', () => {
    const next = toggleFurnitureWithMixed(artboard(), roomSel(['r1']), 'f1')

    expect(next).toEqual({
      kind: 'multi',
      artboardId: AB,
      items: [
        { kind: 'room', roomId: 'r1' },
        { kind: 'furniture', furnitureId: 'f1' },
      ],
    })
  })

  it('adds every member of the clicked group, the clicked item first', () => {
    const next = toggleFurnitureWithMixed(artboard(), roomSel(['r1', 'r2']), 'f3')

    expect(next).toEqual({
      kind: 'multi',
      artboardId: AB,
      items: [
        { kind: 'room', roomId: 'r1' },
        { kind: 'room', roomId: 'r2' },
        { kind: 'furniture', furnitureId: 'f3' },
        { kind: 'furniture', furnitureId: 'f2' },
      ],
    })
  })

  it('removes the whole group when every member is already selected', () => {
    const current: Selection = {
      kind: 'multi',
      artboardId: AB,
      items: [
        { kind: 'room', roomId: 'r1' },
        { kind: 'furniture', furnitureId: 'f2' },
        { kind: 'furniture', furnitureId: 'f3' },
      ],
    }
    const next = toggleFurnitureWithMixed(artboard(), current, 'f2')

    expect(next).toEqual({ kind: 'room', artboardId: AB, roomIds: ['r1'] })
  })

  it('adds the whole group when only one member of it is selected', () => {
    const current: Selection = {
      kind: 'multi',
      artboardId: AB,
      items: [
        { kind: 'room', roomId: 'r1' },
        { kind: 'furniture', furnitureId: 'f2' },
      ],
    }
    const next = toggleFurnitureWithMixed(artboard(), current, 'f2')

    expect(next).toEqual({
      kind: 'multi',
      artboardId: AB,
      items: [
        { kind: 'room', roomId: 'r1' },
        { kind: 'furniture', furnitureId: 'f2' },
        { kind: 'furniture', furnitureId: 'f3' },
      ],
    })
  })

  it('gives furnitureMulti when the kept targets are furniture only', () => {
    // A selection of another artboard contributes no target: only the added group is left.
    const current: Selection = { kind: 'multi', artboardId: 'ab2', items: [{ kind: 'room', roomId: 'r1' }] }
    expect(toggleFurnitureWithMixed(artboard(), current, 'f3')).toEqual({
      kind: 'furnitureMulti',
      artboardId: AB,
      furnitureIds: ['f3', 'f2'],
    })
  })

  it('keeps a single room selection when the last furniture item leaves', () => {
    const current: Selection = {
      kind: 'multi',
      artboardId: AB,
      items: [
        { kind: 'room', roomId: 'r1' },
        { kind: 'furniture', furnitureId: 'f1' },
      ],
    }
    expect(toggleFurnitureWithMixed(artboard(), current, 'f1')).toEqual(roomSel(['r1']))
  })

  it('gives 2 rooms + 1 furniture as multi (no furnitureMulti for a mixed set)', () => {
    const next = toggleFurnitureWithMixed(artboard(), roomSel(['r1', 'r2']), 'f4')

    expect(next.kind).toBe('multi')
    expect(next).toEqual({
      kind: 'multi',
      artboardId: AB,
      items: [
        { kind: 'room', roomId: 'r1' },
        { kind: 'room', roomId: 'r2' },
        { kind: 'furniture', furnitureId: 'f4' },
      ],
    })
  })

  it('keeps the current selection for an unknown item', () => {
    const current = roomSel(['r1'])
    expect(toggleFurnitureWithMixed(artboard(), current, 'nope')).toBe(current)
  })

  it('starts fresh when the selection belongs to another artboard', () => {
    const next = toggleFurnitureWithMixed(artboard(), roomSel(['r1'], 'ab2'), 'f1')

    expect(next).toEqual({ kind: 'furniture', artboardId: AB, furnitureId: 'f1' })
  })
})
