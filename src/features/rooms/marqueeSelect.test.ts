import { describe, expect, it } from 'vitest'
import type { Artboard, FurnitureItem, Opening, Room, Selection } from '../../model/types'
import { designMarqueeMergedSelection, localBox, planMarqueeSelection } from './marqueeSelect'

const rect = (id: string, x0: number, y0: number, x1: number, y1: number): Room => ({
  id,
  name: id,
  vertices: [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ],
})

const item = (id: string, xCm: number, yCm: number, groupId?: string): FurnitureItem => ({
  id,
  name: id,
  shape: 'rect',
  xCm,
  yCm,
  widthCm: 80,
  depthCm: 60,
  rotationDeg: 0,
  color: '#94a3b8',
  ...(groupId ? { groupId } : {}),
})

const opening = (id: string, xCm: number, yCm: number): Opening => ({
  id,
  kind: 'door',
  xCm,
  yCm,
  angleDeg: 0,
  widthCm: 90,
})

const board = (parts: {
  id?: string
  xCm?: number
  yCm?: number
  rooms?: Room[]
  openings?: Opening[]
  furniture?: FurnitureItem[]
}): Artboard =>
  ({
    id: parts.id ?? 'ab1',
    name: parts.id ?? 'ab1',
    xCm: parts.xCm ?? 0,
    yCm: parts.yCm ?? 0,
    ceilingHeightCm: 250,
    precisionCm: 1,
    rooms: parts.rooms ?? [],
    openings: parts.openings ?? [],
    furniture: parts.furniture ?? [],
  }) as unknown as Artboard

describe('localBox', () => {
  it('moves the world box into artboard-local cm', () => {
    expect(localBox({ minX: 1050, minY: 550, maxX: 1250, maxY: 650 }, board({ xCm: 1000, yCm: 500 }))).toEqual({
      minX: 50,
      minY: 50,
      maxX: 250,
      maxY: 150,
    })
  })
})

describe('planMarqueeSelection', () => {
  // One 100 x 100 room, one door on its top wall and one door far from every room.
  const ab = board({
    rooms: [rect('r1', 0, 0, 100, 100)],
    openings: [opening('o1', 50, 0), opening('o2', 900, 900)],
  })
  const round = { minX: -10, minY: -10, maxX: 110, maxY: 110 }
  const empty = { minX: 400, minY: 400, maxX: 500, maxY: 500 }

  it('plain box that touches a room selects the rooms only (today behaviour)', () => {
    expect(planMarqueeSelection({ kind: 'none' }, ab, round, false)).toEqual({
      kind: 'room',
      artboardId: 'ab1',
      roomIds: ['r1'],
    })
  })

  it('plain box that touches no room selects the openings inside it', () => {
    // A wall is only inside a box that also holds a room vertex, so the walls stay empty here.
    const nearO2 = { minX: 890, minY: 890, maxX: 910, maxY: 910 }
    expect(planMarqueeSelection({ kind: 'none' }, ab, nearO2, false)).toEqual({
      kind: 'opening',
      artboardId: 'ab1',
      openingId: 'o2',
    })
  })

  it('plain box that touches nothing gives none', () => {
    expect(planMarqueeSelection({ kind: 'none' }, ab, empty, false)).toEqual({ kind: 'none' })
  })

  it('plain box replaces the current selection', () => {
    const current: Selection = { kind: 'wall', artboardId: 'ab1', roomId: 'r1', edgeIndex: 0 }
    expect(planMarqueeSelection(current, ab, round, false)).toEqual({
      kind: 'room',
      artboardId: 'ab1',
      roomIds: ['r1'],
    })
  })

  it('Shift box keeps the current selection and adds the walls, openings and rooms it hits', () => {
    const current: Selection = { kind: 'opening', artboardId: 'ab1', openingId: 'o2' }
    const next = planMarqueeSelection(current, ab, round, true)
    expect(next.kind).toBe('multi')
    if (next.kind !== 'multi') return
    expect(next.artboardId).toBe('ab1')
    expect(next.items).toEqual([
      { kind: 'opening', openingId: 'o2' },
      { kind: 'wall', roomId: 'r1', edgeIndex: 0 },
      { kind: 'wall', roomId: 'r1', edgeIndex: 1 },
      { kind: 'wall', roomId: 'r1', edgeIndex: 2 },
      { kind: 'wall', roomId: 'r1', edgeIndex: 3 },
      { kind: 'opening', openingId: 'o1' },
      { kind: 'room', roomId: 'r1' },
    ])
  })

  it('Shift box does not duplicate an item already selected', () => {
    const current: Selection = { kind: 'room', artboardId: 'ab1', roomIds: ['r1'] }
    const next = planMarqueeSelection(current, ab, round, true)
    expect(next.kind).toBe('multi')
    if (next.kind !== 'multi') return
    expect(next.items.filter((t) => t.kind === 'room')).toEqual([{ kind: 'room', roomId: 'r1' }])
  })

  it('Shift keeps a current selection that the box does not touch', () => {
    const current: Selection = { kind: 'wall', artboardId: 'ab1', roomId: 'r1', edgeIndex: 3 }
    const next = planMarqueeSelection(current, ab, { minX: 890, minY: 890, maxX: 910, maxY: 910 }, true)
    expect(next.kind).toBe('multi')
    if (next.kind !== 'multi') return
    expect(next.items).toEqual([
      { kind: 'wall', roomId: 'r1', edgeIndex: 3 },
      { kind: 'opening', openingId: 'o2' },
    ])
  })

  it('applies the artboard origin before the wall and opening tests', () => {
    const offset = board({ xCm: 1000, yCm: 500, rooms: [rect('r1', 0, 0, 100, 100)], openings: [opening('o1', 50, 0)] })
    const near = { minX: 1040, minY: 490, maxX: 1060, maxY: 510 }
    expect(planMarqueeSelection({ kind: 'none' }, offset, near, false)).toEqual({
      kind: 'room',
      artboardId: 'ab1',
      roomIds: ['r1'],
    })
    const far = { minX: 40, minY: 490, maxX: 60, maxY: 510 }
    expect(planMarqueeSelection({ kind: 'none' }, offset, far, false)).toEqual({ kind: 'none' })
  })

  it('gives none for a missing artboard', () => {
    expect(planMarqueeSelection({ kind: 'none' }, undefined, round, false)).toEqual({ kind: 'none' })
    expect(planMarqueeSelection({ kind: 'none' }, undefined, round, true)).toEqual({ kind: 'none' })
  })
})

describe('designMarqueeMergedSelection', () => {
  // Two free items and one group of two items. Item f1 spans 100..180 x 100..160 (local cm).
  const ab = board({
    xCm: 1000,
    yCm: 500,
    rooms: [rect('r1', 0, 0, 100, 100)],
    furniture: [item('f1', 100, 100), item('f2', 400, 400, 'g1'), item('f3', 600, 600, 'g1')],
  })

  it('merges the furniture hits with the selected rooms when Shift is held', () => {
    const current: Selection = { kind: 'room', artboardId: 'ab1', roomIds: ['r1'] }
    const next = designMarqueeMergedSelection(current, ab, { minX: 1050, minY: 550, maxX: 1250, maxY: 650 }, true)
    expect(next).toEqual({
      kind: 'multi',
      artboardId: 'ab1',
      items: [
        { kind: 'room', roomId: 'r1' },
        { kind: 'furniture', furnitureId: 'f1' },
      ],
    })
  })

  it('expands the group members of a hit furniture item', () => {
    const current: Selection = { kind: 'room', artboardId: 'ab1', roomIds: ['r1'] }
    const next = designMarqueeMergedSelection(current, ab, { minX: 1350, minY: 850, maxX: 1550, maxY: 1050 }, true)
    expect(next).toEqual({
      kind: 'multi',
      artboardId: 'ab1',
      items: [
        { kind: 'room', roomId: 'r1' },
        { kind: 'furniture', furnitureId: 'f2' },
        { kind: 'furniture', furnitureId: 'f3' },
      ],
    })
  })

  it('merges a multi selection that holds a room and a wall', () => {
    const current: Selection = {
      kind: 'multi',
      artboardId: 'ab1',
      items: [
        { kind: 'room', roomId: 'r1' },
        { kind: 'wall', roomId: 'r1', edgeIndex: 1 },
      ],
    }
    const next = designMarqueeMergedSelection(current, ab, { minX: 1050, minY: 550, maxX: 1250, maxY: 650 }, true)
    expect(next).toEqual({
      kind: 'multi',
      artboardId: 'ab1',
      items: [
        { kind: 'room', roomId: 'r1' },
        { kind: 'wall', roomId: 'r1', edgeIndex: 1 },
        { kind: 'furniture', furnitureId: 'f1' },
      ],
    })
  })

  it('returns null without Shift, so the plain furniture marquee runs', () => {
    const current: Selection = { kind: 'room', artboardId: 'ab1', roomIds: ['r1'] }
    expect(designMarqueeMergedSelection(current, ab, { minX: 1050, minY: 550, maxX: 1250, maxY: 650 }, false)).toBeNull()
  })

  it('returns null when the current selection holds no room', () => {
    const furnitureOnly: Selection = { kind: 'furniture', artboardId: 'ab1', furnitureId: 'f1' }
    const wallOnly: Selection = { kind: 'wall', artboardId: 'ab1', roomId: 'r1', edgeIndex: 0 }
    const box = { minX: 1050, minY: 550, maxX: 1250, maxY: 650 }
    expect(designMarqueeMergedSelection(furnitureOnly, ab, box, true)).toBeNull()
    expect(designMarqueeMergedSelection(wallOnly, ab, box, true)).toBeNull()
    expect(designMarqueeMergedSelection({ kind: 'none' }, ab, box, true)).toBeNull()
  })

  it('returns null when the selected rooms belong to another artboard', () => {
    const other: Selection = { kind: 'room', artboardId: 'ab2', roomIds: ['r1'] }
    expect(designMarqueeMergedSelection(other, ab, { minX: 1050, minY: 550, maxX: 1250, maxY: 650 }, true)).toBeNull()
  })

  it('keeps the rooms when the box hits no furniture', () => {
    const current: Selection = { kind: 'room', artboardId: 'ab1', roomIds: ['r1'] }
    expect(designMarqueeMergedSelection(current, ab, { minX: 5000, minY: 5000, maxX: 5100, maxY: 5100 }, true)).toEqual({
      kind: 'room',
      artboardId: 'ab1',
      roomIds: ['r1'],
    })
  })

  it('returns null for a missing artboard', () => {
    const current: Selection = { kind: 'room', artboardId: 'ab1', roomIds: ['r1'] }
    expect(designMarqueeMergedSelection(current, undefined, { minX: 0, minY: 0, maxX: 10, maxY: 10 }, true)).toBeNull()
  })
})
