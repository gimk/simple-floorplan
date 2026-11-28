// Tests of the pure delete behind a mixed 'multi' selection (deleteMultiItems): one call removes
// rooms, walls, openings and furniture of one artboard draft. Each kind follows the single-item
// delete it mirrors (see deleteMulti.ts). A plain artboard object stands in for the document draft.
//   ab1 holds r1 = a 400 x 300 room at the origin, r2 = the same room 1000 cm to the right, o1 on the
//   top wall of r1, o2 on the top wall of r2, and four furniture items.
import { describe, expect, it } from 'vitest'
import { createArtboard } from '../../model/schema'
import type { Artboard, FurnitureItem, MultiTarget, Opening, Room } from '../../model/types'
import { deleteMultiItems } from './deleteMulti'

const room = (id: string, dx = 0): Room => ({
  id,
  name: id.toUpperCase(),
  vertices: [
    { x: dx, y: 0 },
    { x: dx + 400, y: 0 },
    { x: dx + 400, y: 300 },
    { x: dx, y: 300 },
  ],
})

const opening = (id: string, xCm = 200): Opening => ({ id, kind: 'door', xCm, yCm: 0, angleDeg: 0, widthCm: 80 })

const item = (id: string, groupId?: string): FurnitureItem => ({
  id,
  name: 'Sofa',
  shape: 'rect',
  xCm: 100,
  yCm: 200,
  widthCm: 100,
  depthCm: 50,
  rotationDeg: 0,
  color: '#4b5563',
  ...(groupId ? { groupId } : {}),
})

const board = (p: Partial<Artboard> = {}): Artboard => ({ ...createArtboard('Plan A'), id: 'ab1', precisionCm: 1, ...p })

const ab1 = (): Artboard =>
  board({
    rooms: [room('r1'), room('r2', 1000)],
    openings: [opening('o1'), opening('o2', 1200)],
    furniture: [item('a', 'g'), item('b', 'g'), item('c', 'h'), item('d', 'h')],
  })

const rm = (roomId: string): MultiTarget => ({ kind: 'room', roomId })
const wall = (roomId: string, edgeIndex: number): MultiTarget => ({ kind: 'wall', roomId, edgeIndex })
const open = (openingId: string): MultiTarget => ({ kind: 'opening', openingId })
const furn = (furnitureId: string): MultiTarget => ({ kind: 'furniture', furnitureId })

const ids = (list: { id: string }[]): string[] => list.map((x) => x.id)

describe('deleteMultiItems', () => {
  it('deletes mixed items of one artboard in one call, in one pass', () => {
    const ab = ab1()
    // o1 = opening, a = furniture (group g), r1 = whole room, r2's top wall.
    const deleted = deleteMultiItems(ab, [open('o1'), furn('a'), rm('r1'), wall('r2', 0)])

    // o2 stays: its room is still there, only one of its walls was removed.
    expect(ids(ab.openings)).toEqual(['o2'])
    // r1 is gone; r2 lost one wall, so it has 3 vertices.
    expect(ids(ab.rooms)).toEqual(['r2'])
    expect(ab.rooms[0].vertices).toHaveLength(3)
    // a brought its whole group g; b went with it, c and d stay.
    expect(ids(ab.furniture)).toEqual(['c', 'd'])
    // o1, a, b, r1 and one wall of r2.
    expect(deleted).toBe(5)
  })

  it('deletes every member of the group of a furniture target, then cleans up 1-member groups', () => {
    // c already sits alone in group h: the clean-up drops that group id. d has no group.
    const ab = board({ furniture: [item('a', 'g'), item('b', 'g'), item('c', 'h'), item('d')] })
    const deleted = deleteMultiItems(ab, [furn('a')])

    // The group g (a, b) goes as a whole: one target, two items.
    expect(ids(ab.furniture)).toEqual(['c', 'd'])
    expect(ab.furniture[0].groupId).toBeUndefined()
    expect(deleted).toBe(2)
  })

  it('ignores missing ids and walls that cannot be removed', () => {
    const ab = ab1()
    const before = { rooms: ids(ab.rooms), openings: ids(ab.openings), furniture: ids(ab.furniture) }
    const deleted = deleteMultiItems(ab, [
      open('nope'),
      furn('nope'),
      rm('nope'),
      wall('nope', 0),
      wall('r1', 9),
    ])

    expect(deleted).toBe(0)
    expect(ids(ab.rooms)).toEqual(before.rooms)
    expect(ids(ab.openings)).toEqual(before.openings)
    expect(ids(ab.furniture)).toEqual(before.furniture)
  })

  it('keeps the wall of a room that would drop below 3 points', () => {
    const ab = board({ rooms: [{ id: 'tri', name: 'TRI', vertices: [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 0, y: 300 }] }] })
    const deleted = deleteMultiItems(ab, [wall('tri', 0)])

    expect(deleted).toBe(0)
    expect(ab.rooms).toHaveLength(1)
    expect(ab.rooms[0].vertices).toHaveLength(3)
  })

  it('removes the openings that were only on the walls of a deleted room', () => {
    const ab = ab1()
    const deleted = deleteMultiItems(ab, [rm('r1')])

    expect(ids(ab.rooms)).toEqual(['r2'])
    // o1 goes with its wall; only the deleted room counts, not the opening it took with it.
    expect(ids(ab.openings)).toEqual(['o2'])
    expect(deleted).toBe(1)
  })

  it('counts a repeated target once', () => {
    const ab = ab1()
    const deleted = deleteMultiItems(ab, [furn('a'), furn('a'), open('o1'), open('o1')])

    expect(ids(ab.openings)).toEqual(['o2'])
    expect(ids(ab.furniture)).toEqual(['c', 'd'])
    expect(deleted).toBe(3)
  })

  it('deletes nothing for an empty item list', () => {
    const ab = ab1()
    expect(deleteMultiItems(ab, [])).toBe(0)
    expect(ids(ab.rooms)).toEqual(['r1', 'r2'])
    expect(ids(ab.openings)).toEqual(['o1', 'o2'])
    expect(ab.furniture).toHaveLength(4)
  })
})
