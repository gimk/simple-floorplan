import { describe, expect, it } from 'vitest'
import type { Opening, Room } from '../../model/types'
import { openingOutward } from '../rooms/walls'
import { createOpening, snapToWall } from './geometry'
import { hostWallIn, syncOpeningsForRoomChange, syncOpeningsForRoomMove } from './sync'

const rect = (id: string, x: number, y: number, w: number, h: number): Room => ({
  id, name: id, vertices: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }],
})
const door = (id: string, xCm: number, yCm: number, angleDeg = 0, roomId?: string): Opening =>
  ({ id, kind: 'door', xCm, yCm, angleDeg, widthCm: 90, hinge: 'left', swing: 'in', roomId })
const shift = (r: Room, dx: number, dy: number): Room => ({ ...r, vertices: r.vertices.map((v) => ({ x: v.x + dx, y: v.y + dy })) })

describe('syncOpeningsForRoomMove', () => {
  it('moves an opening on a wall with the room', () => {
    const room = rect('a', 0, 0, 400, 300)
    const out = syncOpeningsForRoomMove([door('o', 100, 0)], room, shift(room, 50, 70))
    expect(out[0]).toMatchObject({ xCm: 150, yCm: 70, angleDeg: 0 })
  })

  it('keeps the same fraction t when a wall gets longer, and updates the angle', () => {
    const room = rect('a', 0, 0, 400, 300)
    const next: Room = { ...room, vertices: [{ x: 0, y: 0 }, { x: 800, y: 100 }, { x: 800, y: 300 }, { x: 0, y: 300 }] }
    const out = syncOpeningsForRoomMove([door('o', 100, 0)], room, next)
    expect(out[0].xCm).toBeCloseTo(200)
    expect(out[0].yCm).toBeCloseTo(25)
    expect(out[0].angleDeg).toBeCloseTo((Math.atan2(100, 800) * 180) / Math.PI)
  })

  it('leaves openings that are not on a wall of the room', () => {
    const room = rect('a', 0, 0, 400, 300)
    const far = door('o', 200, 150)
    const out = syncOpeningsForRoomMove([far], room, shift(room, 10, 10))
    expect(out[0]).toBe(far)
  })

  it('uses a 2 cm tolerance', () => {
    const room = rect('a', 0, 0, 400, 300)
    const out = syncOpeningsForRoomMove([door('near', 100, 1.5), door('far', 100, 3)], room, shift(room, 0, 10))
    expect(out[0].yCm).toBeCloseTo(10)
    expect(out[1].yCm).toBe(3)
  })

  it('keeps the opening side (no 180 degree flip) on a reversed wall', () => {
    const room = rect('a', 0, 0, 400, 300)
    const out = syncOpeningsForRoomMove([door('o', 100, 0, 180)], room, shift(room, 0, 5))
    expect(Math.abs(out[0].angleDeg)).toBeCloseTo(180)
  })
})

describe('syncOpeningsForRoomChange', () => {
  it('removes an opening whose only host room was deleted', () => {
    const a = rect('a', 0, 0, 400, 300)
    const out = syncOpeningsForRoomChange([door('o', 100, 0), door('free', 200, 150)], [a], [])
    expect(out.map((o) => o.id)).toEqual(['free'])
  })

  it('keeps an opening on a shared wall when the other room stays', () => {
    const a = rect('a', 0, 0, 400, 300)
    const b = rect('b', 400, 0, 300, 300)
    const o = door('o', 400, 150, 90)
    const out = syncOpeningsForRoomChange([o], [a, b], [b])
    expect(out).toEqual([o])
  })

  it('moves an opening with the moved room, leaves openings of unchanged rooms', () => {
    const a = rect('a', 0, 0, 400, 300)
    const b = rect('b', 1000, 0, 300, 300)
    const out = syncOpeningsForRoomChange([door('oa', 100, 0), door('ob', 1100, 0)], [a, b], [shift(a, 0, 20), b])
    expect(out[0].yCm).toBeCloseTo(20)
    expect(out[1].yCm).toBe(0)
  })

  it('keeps an opening on a wall that survives a cut (new room ids)', () => {
    const a = rect('a', 0, 0, 400, 300)
    const part = rect('a2', 0, 0, 200, 300)
    const out = syncOpeningsForRoomChange([door('on', 100, 0), door('gone', 300, 0)], [a], [part])
    expect(out.map((o) => o.id)).toEqual(['on'])
  })
})

// Two rooms flush: room B is snapped against the right wall of room A, so that wall of A (edge 1,
// "up" on screen) and the left wall of B (edge 3, "down") are at the same place. A door on that wall
// is at distance 0 from an edge of both rooms.
describe('flush walls (0 cm gap)', () => {
  /** Room A, 400 x 300, from (0, 0). The door of the tests sits on its right wall (x = 400). */
  const a = rect('a', 0, 0, 400, 300)
  /** Room B, 300 x 300, left wall flush with the right wall of room A. */
  const bFlush = rect('b', 400, 0, 300, 300)
  /** Room B with a 20 cm gap, before it is snapped flush (or after it is pulled away). */
  const bApart = rect('b', 420, 0, 300, 300)

  it('keeps the door on room B (and its outward side) when room B is snapped flush', () => {
    const owned = door('owned', 420, 150, -90, 'b')
    const legacy = door('legacy', 420, 150, -90)
    const out = syncOpeningsForRoomChange([owned, legacy], [a, bApart], [a, bFlush])
    // Both openings follow the wall of room B, which moved by 20 cm to the left.
    for (const o of out) expect(o).toMatchObject({ xCm: 400, yCm: 150, angleDeg: -90 })
    // The legacy opening (no roomId) is placed by the direction tie-breaker, then records its room.
    for (const o of out) expect(o.roomId).toBe('b')
    // The wall that hosts them is the left wall of room B, not the right wall of room A.
    for (const o of [out[0], out[1]]) {
      expect(hostWallIn([a, bFlush], o)).toMatchObject({ room: { id: 'b' }, edgeIndex: 3 })
      // Room B is on the +x side: its outward normal points to -x. Room A's would point to +x.
      expect(openingOutward([a, bFlush], o)?.x).toBeCloseTo(-1)
    }
  })

  it('hosts an opening on the flush wall of its own room when a room is missing from the list', () => {
    // An unknown roomId (deleted room) falls back to the nearest edge, then to the door direction.
    expect(hostWallIn([a, bFlush], door('gone', 400, 150, 90, 'gone'))?.room.id).toBe('a')
    expect(hostWallIn([a, bFlush], door('gone', 400, 150, -90, 'gone'))?.room.id).toBe('b')
  })

  it('keeps the door on room B when room B is pulled away from room A', () => {
    const out = syncOpeningsForRoomChange([door('o', 400, 150, -90, 'b')], [a, bFlush], [a, shift(bFlush, 100, 0)])
    expect(out[0]).toMatchObject({ roomId: 'b', xCm: 500, yCm: 150 })
    expect(hostWallIn([a, shift(bFlush, 100, 0)], out[0])).toMatchObject({ room: { id: 'b' }, edgeIndex: 3 })
  })

  it('does not move an opening that belongs to another room', () => {
    const o = door('o', 400, 150, -90, 'b')
    const out = syncOpeningsForRoomMove([o], a, shift(a, 0, 20))
    expect(out[0]).toBe(o)
  })

  it('keeps the door on room A after it is dragged there (the drag sets roomId)', () => {
    // The opening was on room B, then dragged onto the top wall of room A: the drag patches roomId
    // with the room of the wall snap (see OpeningsLayer).
    const dragged: Opening = { ...door('o', 200, 0, 0, 'b'), roomId: 'a' }
    expect(hostWallIn([a, bFlush], dragged)).toMatchObject({ room: { id: 'a' }, edgeIndex: 0 })
    // Room B is then moved: the door stays on room A.
    const out = syncOpeningsForRoomChange([dragged], [a, bFlush], [a, shift(bFlush, 100, 0)])
    expect(out[0]).toMatchObject({ roomId: 'a', xCm: 200, yCm: 0 })
  })

  it('records the host room when an opening is created', () => {
    const snap = snapToWall({ x: 690, y: 120 }, [a, bFlush], 90, 20)
    expect(snap?.roomId).toBe('b')
    expect(createOpening('door', snap!).roomId).toBe('b')
  })

  it('falls back cleanly when room B is deleted', () => {
    const out = syncOpeningsForRoomChange([door('o', 400, 150, -90, 'b')], [a, bFlush], [a])
    // The door is not removed: it stays on the wall that is still there, now owned by room A.
    expect(out.map((o) => o.id)).toEqual(['o'])
    expect(out[0]).toMatchObject({ xCm: 400, yCm: 150, roomId: 'a', angleDeg: -90 })
    expect(hostWallIn([a], out[0])).toMatchObject({ room: { id: 'a' }, edgeIndex: 1 })
  })
})
