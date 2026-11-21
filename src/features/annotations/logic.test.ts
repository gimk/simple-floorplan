import { describe, expect, it } from 'vitest'
import type { Room, TapeMeasure } from '../../model/types'
import { fitSize, isUnplaced, nearestWall, placePin, pointOnWall, roomPins, snapToPlan, tapeLabel, tracedCm } from './logic'

const room: Room = {
  id: 'r1', code: 'SE', name: 'Salon', walkOrder: 0, holes: [], walls: {},
  vertices: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 400, y: 0 }, { id: 'c', x: 400, y: 300 }, { id: 'd', x: 0, y: 300 }],
}

describe('snapToPlan', () => {
  it('snaps to a vertex first', () => {
    const h = snapToPlan({ x: 5, y: 4 }, [room], 12)
    expect(h).toMatchObject({ kind: 'vertex', point: { x: 0, y: 0 }, roomId: 'r1' })
  })
  it('snaps to a wall point away from vertices', () => {
    const h = snapToPlan({ x: 200, y: 8 }, [room], 12)
    expect(h.kind).toBe('wall')
    expect(h.point).toEqual({ x: 200, y: 0 })
    expect(h.wallStart).toBe('a')
  })
  it('stays free outside the radius', () => {
    const h = snapToPlan({ x: 200, y: 100 }, [room], 12)
    expect(h).toEqual({ point: { x: 200, y: 100 }, kind: 'free' })
  })
  it('picks the closest wall', () => {
    expect(nearestWall({ x: 395, y: 150 }, [room], 12)?.wallStart).toBe('b')
  })
})

describe('placePin', () => {
  it('attaches to the nearest wall in range', () => {
    expect(placePin({ x: 100, y: 295 }, [room], 12)).toEqual({ at: { x: 100, y: 300 }, roomId: 'r1', wallStart: 'c' })
  })
  it('keeps the point and finds the room when far from walls', () => {
    expect(placePin({ x: 200, y: 150 }, [room], 12)).toEqual({ at: { x: 200, y: 150 }, roomId: 'r1' })
  })
  it('has no room outside', () => {
    expect(placePin({ x: 900, y: 900 }, [room], 12).roomId).toBeUndefined()
  })
})

describe('tape label', () => {
  const t: TapeMeasure = { id: 't', a: { x: 0, y: 0 }, b: { x: 245, y: 0 } }
  it('shows traced only', () => {
    expect(tracedCm(t)).toBe(245)
    expect(tapeLabel(t)).toBe('traced 245')
  })
  it('shows traced and real', () => {
    expect(tapeLabel({ ...t, actualCm: 243 })).toBe('traced 245 · real 243')
    expect(tapeLabel({ ...t, actualCm: 243.5 })).toBe('traced 245 · real 243,5')
  })
  it('detects unplaced tapes', () => {
    expect(isUnplaced({ a: { x: 0, y: 0 }, b: { x: 0, y: 0 } })).toBe(true)
    expect(isUnplaced(t)).toBe(false)
  })
})

describe('pins helpers', () => {
  it('lists room pins oldest first', () => {
    const mk = (id: string, createdAt: string, roomId: string) => ({ id, roomId, at: { x: 0, y: 0 }, photoKeys: [], createdAt, updatedAt: createdAt })
    const pins = [mk('b', '2', 'r1'), mk('a', '1', 'r1'), mk('x', '0', 'r2')]
    expect(roomPins({ pins }, 'r1').map((p) => p.id)).toEqual(['a', 'b'])
    expect(roomPins({}, 'r1')).toEqual([])
  })
  it('finds a point on a wall by offset', () => {
    expect(pointOnWall(room, 'a', 100)).toEqual({ x: 100, y: 0 })
    expect(pointOnWall(room, 'a', 9999)).toEqual({ x: 400, y: 0 })
    expect(pointOnWall(room, 'nope', 1)).toBeNull()
  })
  it('fits photos without upscaling', () => {
    expect(fitSize(3200, 1600, 1600)).toEqual({ w: 1600, h: 800 })
    expect(fitSize(800, 600, 1600)).toEqual({ w: 800, h: 600 })
  })
})
