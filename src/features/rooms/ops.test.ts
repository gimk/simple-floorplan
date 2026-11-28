import { beforeEach, describe, expect, it } from 'vitest'
import { area } from '../../model/geometry'
import { createDefaultProject } from '../../model/schema'
import { useDoc } from '../../model/store'
import type { Room } from '../../model/types'
import {
  constrainAngle45, constrainAxis, constrainWallPerpendicular, createRectRoom, cutoutRoom, formatLengthCm, deleteVertex, deleteWall, insertVertexOnEdge, isAxisAlignedRect, mergeRooms,
  moveEdge, moveRoom, moveVertex, moveVertexOrtho, nextRoomName, roomWalls, roundToPrecision, scaleRoomFromVertex, setWallLength, wallResizeCursor,
} from './ops'
import {
  addRoom, cutoutArtboardRooms, deleteRoomVertex, deleteRoomWall, deleteRooms, mergeArtboardRooms, renameRoom, setRoomWallLength,
} from './actions'

const rect = (id: string, x0: number, y0: number, x1: number, y1: number): Room => ({
  id, name: id, fill: '#abc',
  vertices: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }],
})
const tri: Room = { id: 't', name: 't', vertices: [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 0, y: 400 }] }

describe('roomWalls', () => {
  it('lists walls with length, mid and angle', () => {
    const w = roomWalls(rect('a', 0, 0, 400, 300))
    expect(w).toHaveLength(4)
    expect(w[0]).toMatchObject({ index: 0, lengthCm: 400, mid: { x: 200, y: 0 }, angleDeg: 0 })
    expect(w[1].angleDeg).toBeCloseTo(90)
    expect(w[3].lengthCm).toBe(300)
    expect(w[3].b).toEqual({ x: 0, y: 0 })
  })
})

describe('isAxisAlignedRect', () => {
  it('detects rects', () => {
    expect(isAxisAlignedRect(rect('a', 0, 0, 10, 20).vertices)).toBe(true)
    expect(isAxisAlignedRect(tri.vertices)).toBe(false)
    expect(isAxisAlignedRect([{ x: 0, y: 0 }, { x: 10, y: 5 }, { x: 10, y: 20 }, { x: 0, y: 20 }])).toBe(false)
  })
})

describe('setWallLength', () => {
  it('keeps a rect rectangular (horizontal wall)', () => {
    const r = setWallLength(rect('a', 0, 0, 400, 300), 0, 500)!
    expect(isAxisAlignedRect(r.vertices)).toBe(true)
    expect(r.vertices[1]).toEqual({ x: 500, y: 0 })
    expect(r.vertices[2]).toEqual({ x: 500, y: 300 })
    expect(r.vertices[0]).toEqual({ x: 0, y: 0 })
  })
  it('keeps a rect rectangular (vertical wall, shrink)', () => {
    const r = setWallLength(rect('a', 0, 0, 400, 300), 1, 200)!
    expect(isAxisAlignedRect(r.vertices)).toBe(true)
    expect(r.vertices[2]).toEqual({ x: 400, y: 200 })
    expect(r.vertices[3]).toEqual({ x: 0, y: 200 })
  })
  it('works on the closing wall', () => {
    const r = setWallLength(rect('a', 0, 0, 400, 300), 3, 100)!
    expect(isAxisAlignedRect(r.vertices)).toBe(true)
    expect(roomWalls(r)[3].lengthCm).toBeCloseTo(100)
  })
  it('moves only the end vertex of a polygon', () => {
    const r = setWallLength(tri, 0, 200)!
    expect(r.vertices[0]).toEqual({ x: 0, y: 0 })
    expect(r.vertices[1]).toEqual({ x: 200, y: 0 })
    expect(r.vertices[2]).toEqual({ x: 0, y: 400 })
  })
  it('returns null when invalid', () => {
    expect(setWallLength(tri, 0, 0)).toBeNull()
    expect(setWallLength(tri, 0, -5)).toBeNull()
    expect(setWallLength(tri, 0, NaN)).toBeNull()
    expect(setWallLength(tri, 9, 5)).toBeNull()
  })
  it('does not change its input', () => {
    const src = rect('a', 0, 0, 400, 300)
    setWallLength(src, 0, 500)
    expect(src.vertices[1]).toEqual({ x: 400, y: 0 })
  })
})

describe('move and edit', () => {
  it('moveRoom', () => {
    expect(moveRoom(rect('a', 0, 0, 10, 10), 5, -5).vertices[0]).toEqual({ x: 5, y: -5 })
  })
  it('moveVertex', () => {
    const r = moveVertex(tri, 1, { x: 350, y: 20 })
    expect(r.vertices[1]).toEqual({ x: 350, y: 20 })
    expect(r.vertices[0]).toEqual({ x: 0, y: 0 })
  })
  it('moveEdge moves both ends', () => {
    const r = moveEdge(rect('a', 0, 0, 400, 300), 1, { x: 50, y: 0 })
    expect(r.vertices[1].x).toBe(450)
    expect(r.vertices[2].x).toBe(450)
    expect(r.vertices[0].x).toBe(0)
  })
  it('moveEdge on the closing wall wraps', () => {
    const r = moveEdge(rect('a', 0, 0, 400, 300), 3, { x: 0, y: 10 })
    expect(r.vertices[3].y).toBe(310)
    expect(r.vertices[0].y).toBe(10)
  })
  it('insertVertexOnEdge', () => {
    const r = insertVertexOnEdge(rect('a', 0, 0, 400, 300), 0, { x: 200, y: 0 })
    expect(r.vertices).toHaveLength(5)
    expect(r.vertices[1]).toEqual({ x: 200, y: 0 })
    expect(r.vertices[2]).toEqual({ x: 400, y: 0 })
    const last = insertVertexOnEdge(rect('a', 0, 0, 400, 300), 3, { x: 0, y: 100 })
    expect(last.vertices[4]).toEqual({ x: 0, y: 100 })
  })
  it('deleteVertex keeps min 3', () => {
    expect(deleteVertex(rect('a', 0, 0, 10, 10), 0)!.vertices).toHaveLength(3)
    expect(deleteVertex(tri, 0)).toBeNull()
    expect(deleteVertex(rect('a', 0, 0, 10, 10), 7)).toBeNull()
  })
})

describe('createRectRoom and names', () => {
  it('makes 4 clockwise vertices from any corner order', () => {
    const r = createRectRoom({ x: 400, y: 300 }, { x: 0, y: 0 }, 'R')
    expect(r.vertices).toEqual([{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }, { x: 0, y: 300 }])
    expect(r.id).toBeTruthy()
    expect(area(r.vertices)).toBe(120000)
  })
  it('enforces min 10 cm per side', () => {
    const r = createRectRoom({ x: 0, y: 0 }, { x: 3, y: -2 }, 'S')
    expect(r.vertices[1].x - r.vertices[0].x).toBe(10)
    expect(r.vertices[2].y - r.vertices[1].y).toBe(10)
  })
  it('nextRoomName', () => {
    expect(nextRoomName([])).toBe('Room 1')
    expect(nextRoomName([rect('Room 1', 0, 0, 1, 1), rect('Room 2', 0, 0, 1, 1)])).toBe('Room 3')
    expect(nextRoomName([rect('Room 2', 0, 0, 1, 1)])).toBe('Room 1')
  })
})

describe('cutoutRoom', () => {
  const big = rect('big', 0, 0, 400, 300)
  it('notches a corner and keeps id/name', () => {
    const res = cutoutRoom(big, rect('c', 300, 200, 500, 400).vertices)
    expect(res).toHaveLength(1)
    expect(res[0].id).toBe('big')
    expect(res[0].name).toBe('big')
    expect(res[0].vertices).toHaveLength(6)
    expect(area(res[0].vertices)).toBeCloseTo(120000 - 100 * 100)
  })
  it('splits into two rooms; largest keeps the id', () => {
    const res = cutoutRoom(big, rect('c', 100, -10, 150, 310).vertices)
    expect(res).toHaveLength(2)
    expect(res[0].id).toBe('big')
    expect(res[1].id).not.toBe('big')
    expect(area(res[0].vertices)).toBeGreaterThan(area(res[1].vertices))
  })
  it('returns [] when fully covered', () => {
    expect(cutoutRoom(big, rect('c', -10, -10, 500, 500).vertices)).toEqual([])
  })
  it('returns the same shape when disjoint', () => {
    const res = cutoutRoom(big, rect('c', 1000, 1000, 1100, 1100).vertices)
    expect(res).toHaveLength(1)
    expect(area(res[0].vertices)).toBeCloseTo(120000)
  })
})

describe('mergeRooms', () => {
  it('merges touching rooms, keeps first id/name/fill', () => {
    const m = mergeRooms([rect('a', 0, 0, 200, 200), rect('b', 200, 0, 400, 200)])!
    expect(m.id).toBe('a')
    expect(m.fill).toBe('#abc')
    expect(m.vertices).toHaveLength(4)
    expect(area(m.vertices)).toBeCloseTo(80000)
  })
  it('merges overlapping rooms into an L', () => {
    const m = mergeRooms([rect('a', 0, 0, 200, 200), rect('b', 100, 100, 300, 300)])!
    expect(m.vertices).toHaveLength(8)
    expect(area(m.vertices)).toBeCloseTo(40000 + 40000 - 10000)
  })
  it('returns null for disjoint rooms or fewer than 2', () => {
    expect(mergeRooms([rect('a', 0, 0, 100, 100), rect('b', 500, 500, 600, 600)])).toBeNull()
    expect(mergeRooms([rect('a', 0, 0, 100, 100)])).toBeNull()
  })
  it('returns null when the union has a hole', () => {
    const ring = [rect('a', 0, 0, 300, 100), rect('b', 200, 0, 300, 300), rect('c', 0, 200, 300, 300), rect('d', 0, 0, 100, 300)]
    expect(mergeRooms(ring)).toBeNull()
  })
})

describe('mergeRooms with wall thickness', () => {
  const T = 10
  const L = (id: string, pts: [number, number][]): Room => ({ id, name: id, vertices: pts.map(([x, y]) => ({ x, y })) })
  const sorted = (r: Room) => r.vertices.map((p) => `${p.x},${p.y}`).sort()

  it('merges two rectangles separated by the wall thickness into one exact rectangle', () => {
    const m = mergeRooms([rect('a', 0, 0, 200, 200), rect('b', 210, 0, 400, 200)], T)!
    expect(m.id).toBe('a')
    expect(m.vertices).toHaveLength(4)
    expect(sorted(m)).toEqual(['0,0', '0,200', '400,0', '400,200'])
    expect(area(m.vertices)).toBe(80000)
  })
  it('merges an L-shaped room with a room tucked in its notch (two shared walls, 10x10 corner)', () => {
    // Salon: 0..400 x 0..300 minus the notch 200..400 x 0..150. Cuisine fills the notch with a 10 cm gap.
    const salon = L('s', [[0, 0], [200, 0], [200, 150], [400, 150], [400, 300], [0, 300]])
    const cuisine = rect('c', 210, 0, 400, 140)
    const m = mergeRooms([salon, cuisine], T)!
    expect(m).not.toBeNull()
    expect(m.vertices).toHaveLength(4)
    expect(sorted(m)).toEqual(['0,0', '0,300', '400,0', '400,300'])
    expect(area(m.vertices)).toBe(120000)
  })
  it('merges 3 rooms chained with wall-thickness gaps', () => {
    const m = mergeRooms([rect('a', 0, 0, 100, 100), rect('b', 110, 0, 210, 100), rect('c', 220, 0, 320, 100)], T)!
    expect(sorted(m)).toEqual(['0,0', '0,100', '320,0', '320,100'])
  })
  it('does not merge rooms farther apart than the wall thickness', () => {
    expect(mergeRooms([rect('a', 0, 0, 200, 200), rect('b', 211, 0, 400, 200)], T)).toBeNull()
  })
  it('does not merge rooms that only meet at a corner', () => {
    expect(mergeRooms([rect('a', 0, 0, 100, 100), rect('b', 110, 110, 210, 210)], T)).toBeNull()
  })
  it('returns null for 4 rooms around a hole', () => {
    const ring = [rect('t', 0, 0, 300, 100), rect('r', 310, 0, 410, 300), rect('b', 110, 310, 410, 410), rect('l', 0, 110, 100, 410)]
    expect(mergeRooms(ring, T)).toBeNull()
  })
  it('thickness 0 keeps touch-only behaviour', () => {
    expect(mergeRooms([rect('a', 0, 0, 200, 200), rect('b', 210, 0, 400, 200)])).toBeNull()
    expect(mergeRooms([rect('a', 0, 0, 200, 200), rect('b', 210, 0, 400, 200)], 0)).toBeNull()
    expect(mergeRooms([rect('a', 0, 0, 200, 200), rect('b', 200, 0, 400, 200)], 0)).not.toBeNull()
  })
  it('still merges flush rooms when the thickness is set', () => {
    const m = mergeRooms([rect('a', 0, 0, 200, 200), rect('b', 200, 0, 400, 200)], T)!
    expect(area(m.vertices)).toBe(80000)
  })
})

describe('store actions', () => {
  let ab: string
  beforeEach(() => {
    useDoc.getState().hydrate(createDefaultProject())
    ab = useDoc.getState().doc.artboards[0].id
  })
  const rooms = () => useDoc.getState().doc.artboards[0].rooms

  it('add, rename, delete', () => {
    addRoom(ab, rect('a', 0, 0, 400, 300))
    addRoom(ab, rect('b', 500, 0, 600, 100))
    renameRoom(ab, 'a', 'Kitchen')
    expect(rooms()[0].name).toBe('Kitchen')
    deleteRooms(ab, ['a'])
    expect(rooms().map((r) => r.id)).toEqual(['b'])
  })
  it('one undo step per action', () => {
    addRoom(ab, rect('a', 0, 0, 400, 300))
    expect(setRoomWallLength(ab, 'a', 0, 500)).toBe(true)
    expect(rooms()[0].vertices[1].x).toBe(500)
    useDoc.getState().undo()
    expect(rooms()[0].vertices[1].x).toBe(400)
    expect(setRoomWallLength(ab, 'a', 0, -1)).toBe(false)
    expect(setRoomWallLength(ab, 'zz', 0, 10)).toBe(false)
  })
  it('cutout targets only listed rooms', () => {
    addRoom(ab, rect('a', 0, 0, 400, 300))
    addRoom(ab, rect('b', 0, 400, 400, 700))
    const cutter = rect('c', 300, 200, 500, 500).vertices
    expect(cutoutArtboardRooms(ab, cutter, ['a'])).toBe(true)
    expect(rooms().find((r) => r.id === 'a')!.vertices).toHaveLength(6)
    expect(rooms().find((r) => r.id === 'b')!.vertices).toHaveLength(4)
    expect(cutoutArtboardRooms(ab, rect('c', 2000, 2000, 2100, 2100).vertices)).toBe(false)
  })
  it('merge replaces rooms with one', () => {
    addRoom(ab, rect('a', 0, 0, 200, 200))
    addRoom(ab, rect('b', 200, 0, 400, 200))
    addRoom(ab, rect('c', 900, 900, 1000, 1000))
    expect(mergeArtboardRooms(ab, ['a', 'b'])!.id).toBe('a')
    expect(rooms().map((r) => r.id)).toEqual(['a', 'c'])
    expect(mergeArtboardRooms(ab, ['a', 'c'])).toBeNull()
    expect(rooms()).toHaveLength(2)
  })
})

describe('merge with wall thickness: store action and openings', () => {
  it('keeps outer openings at their exact position and drops the ones on the removed wall', () => {
    useDoc.getState().hydrate(createDefaultProject())
    const ab = useDoc.getState().doc.artboards[0].id
    addRoom(ab, rect('a', 0, 0, 200, 200))
    addRoom(ab, rect('b', 210, 0, 400, 200))
    useDoc.getState().update((d) => {
      const base = { kind: 'door' as const, widthCm: 90, heightCm: 210 }
      d.artboards[0].openings.push(
        { ...base, id: 'outer-a', roomId: 'a', xCm: 50, yCm: 0, angleDeg: 0 },
        { ...base, id: 'outer-b', roomId: 'b', xCm: 300, yCm: 200, angleDeg: 0 },
        { ...base, id: 'inner', roomId: 'a', xCm: 200, yCm: 100, angleDeg: 90 },
        { ...base, id: 'far', roomId: 'z', xCm: 900, yCm: 900, angleDeg: 0 },
      )
    })
    const merged = mergeArtboardRooms(ab, ['a', 'b'])!
    expect(merged).not.toBeNull()
    expect(merged.vertices).toHaveLength(4)
    const a = useDoc.getState().doc.artboards[0]
    expect(a.rooms.map((r) => r.id)).toEqual(['a'])
    const byId = Object.fromEntries(a.openings.map((o) => [o.id, o]))
    expect(Object.keys(byId).sort()).toEqual(['far', 'outer-a', 'outer-b'])
    expect(byId['outer-a']).toMatchObject({ xCm: 50, yCm: 0, roomId: 'a' })
    expect(byId['outer-b']).toMatchObject({ xCm: 300, yCm: 200, roomId: 'a' })
    expect(byId.far).toMatchObject({ xCm: 900, yCm: 900, roomId: 'z' })
  })
})

describe('precision and constraints (Phase 3.5A)', () => {
  const sq = (x0: number, y0: number, x1: number, y1: number) => ({
    id: 'r', name: 'r',
    vertices: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }],
  })

  it('roundToPrecision', () => {
    expect(roundToPrecision(12.4, 1)).toBe(12)
    expect(roundToPrecision(12.6, 1)).toBe(13)
    expect(roundToPrecision(12.26, 0.5)).toBe(12.5)
    expect(roundToPrecision(12.04, 0.1)).toBe(12)
    expect(roundToPrecision(0.3, 0.1)).toBe(0.3)
    expect(roundToPrecision(-0.2, 1)).toBe(0)
    expect(Object.is(roundToPrecision(-0.2, 1), 0)).toBe(true)
    expect(roundToPrecision(7.77, 0)).toBe(7.77)
  })

  it('formatLengthCm', () => {
    expect(formatLengthCm(123.4, 1)).toBe('123')
    expect(formatLengthCm(123.6, 1)).toBe('124')
    expect(formatLengthCm(123.26, 0.5)).toBe('123.5')
    expect(formatLengthCm(123, 0.5)).toBe('123.0')
    expect(formatLengthCm(123.04, 0.1)).toBe('123.0')
    expect(formatLengthCm(123.14, 0.1)).toBe('123.1')
  })

  it('scaleRoomFromVertex scales about the opposite corner and tracks the cursor', () => {
    const r = scaleRoomFromVertex(sq(0, 0, 100, 100), 2, { x: 200, y: 200 })
    expect(r.vertices[0]).toEqual({ x: 0, y: 0 })
    expect(r.vertices[2]).toEqual({ x: 200, y: 200 })
    expect(r.vertices[1]).toEqual({ x: 200, y: 0 })
    expect(r.vertices[3]).toEqual({ x: 0, y: 200 })
  })
  it('scaleRoomFromVertex anchors per corner', () => {
    const r = scaleRoomFromVertex(sq(0, 0, 100, 100), 0, { x: -100, y: -100 })
    expect(r.vertices[2]).toEqual({ x: 100, y: 100 })
    expect(r.vertices[0]).toEqual({ x: -100, y: -100 })
    // vertex 1 (top-right) drags: the anchor is the bottom-left corner (0, 50); k = 0.6
    const t = scaleRoomFromVertex(sq(0, 0, 100, 50), 1, { x: 50, y: 0 })
    expect(t.vertices[3]).toEqual({ x: 0, y: 50 })
    expect(t.vertices[1].x).toBeCloseTo(60)
    expect(t.vertices[1].y).toBeCloseTo(20)
    expect(t.vertices[2].x).toBeCloseTo(60)
  })
  it('scaleRoomFromVertex is uniform (keeps the aspect ratio) and handles a non-rect room', () => {
    const tri: Room = { id: 't', name: 't', vertices: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 0, y: 100 }] }
    // anchor (0, 100); k = 2
    const r = scaleRoomFromVertex(tri, 1, { x: 400, y: -100 })
    expect(r.vertices[1].x).toBeCloseTo(400)
    expect(r.vertices[1].y).toBeCloseTo(-100)
    expect(r.vertices[0].y).toBeCloseTo(-100)
    expect(r.vertices[2]).toEqual({ x: 0, y: 100 })
  })
  it('scaleRoomFromVertex enforces a 10 cm minimum bbox', () => {
    const r = scaleRoomFromVertex(sq(0, 0, 100, 200), 2, { x: -500, y: -500 })
    const xs = r.vertices.map((v) => v.x), ys = r.vertices.map((v) => v.y)
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThanOrEqual(10 - 1e-9)
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThanOrEqual(10 - 1e-9)
    expect(r.vertices.every((v) => Number.isFinite(v.x) && Number.isFinite(v.y))).toBe(true)
  })
  it('scaleRoomFromVertex rounds the cursor to the precision and ignores bad indexes', () => {
    const base = sq(0, 0, 100, 100)
    const r = scaleRoomFromVertex(base, 2, { x: 200.4, y: 200.4 }, 1)
    expect(r.vertices[2]).toEqual({ x: 200, y: 200 })
    expect(scaleRoomFromVertex(base, 9, { x: 1, y: 1 })).toBe(base)
    expect(scaleRoomFromVertex(base, -1, { x: 1, y: 1 })).toBe(base)
    expect(base.vertices[2]).toEqual({ x: 100, y: 100 }) // input not changed
  })

  it('constrainAxis keeps the dominant axis', () => {
    expect(constrainAxis(10, 3)).toEqual({ x: 10, y: 0 })
    expect(constrainAxis(-3, 10)).toEqual({ x: 0, y: 10 })
    expect(constrainAxis(5, -5)).toEqual({ x: 5, y: 0 })
    expect(constrainAxis(0, 0)).toEqual({ x: 0, y: 0 })
  })

  it('constrainWallPerpendicular keeps only the normal component', () => {
    expect(constrainWallPerpendicular({ x: 0, y: 0 }, { x: 100, y: 0 }, 30, 20)).toEqual({ x: 0, y: 20 })
    expect(constrainWallPerpendicular({ x: 0, y: 0 }, { x: 0, y: 100 }, 30, 20)).toEqual({ x: 30, y: 0 })
    const d = constrainWallPerpendicular({ x: 0, y: 0 }, { x: 100, y: 100 }, 10, 0)
    expect(d.x).toBeCloseTo(5); expect(d.y).toBeCloseTo(-5)
    expect(constrainWallPerpendicular({ x: 1, y: 1 }, { x: 1, y: 1 }, 4, 5)).toEqual({ x: 4, y: 5 })
  })

  it('constrainAngle45 snaps the direction and keeps the distance', () => {
    const a = { x: 10, y: 10 }
    const h = constrainAngle45(a, { x: 110, y: 20 })
    expect(h.y).toBeCloseTo(10)
    expect(h.x).toBeCloseTo(10 + Math.hypot(100, 10))
    const diag = constrainAngle45(a, { x: 60, y: 45 })
    expect(diag.x - a.x).toBeCloseTo(diag.y - a.y)
    expect(Math.hypot(diag.x - a.x, diag.y - a.y)).toBeCloseTo(Math.hypot(50, 35))
    const up = constrainAngle45(a, { x: 12, y: -90 })
    expect(up.x).toBeCloseTo(10); expect(up.y).toBeCloseTo(10 - Math.hypot(2, 100))
    expect(constrainAngle45(a, a)).toEqual(a)
  })

  it('wallResizeCursor', () => {
    const o = { x: 0, y: 0 }
    expect(wallResizeCursor(o, { x: 100, y: 0 })).toBe('ns-resize')
    expect(wallResizeCursor({ x: 100, y: 0 }, o)).toBe('ns-resize')
    expect(wallResizeCursor(o, { x: 0, y: 100 })).toBe('ew-resize')
    expect(wallResizeCursor(o, { x: 100, y: 100 })).toBe('nesw-resize')
    expect(wallResizeCursor(o, { x: 100, y: -100 })).toBe('nwse-resize')
    expect(wallResizeCursor(o, { x: -100, y: 100 })).toBe('nwse-resize')
    expect(wallResizeCursor(o, { x: 100, y: 10 })).toBe('ns-resize')
  })
})

describe('deleteWall', () => {
  // Square 0..400 with a notch: wall 3->4 is the notch bottom (from (300,100) to (100,100)).
  const notch: Room = {
    id: 'n', name: 'n',
    vertices: [
      { x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 400 }, { x: 300, y: 400 },
      { x: 300, y: 100 }, { x: 100, y: 100 }, { x: 100, y: 400 }, { x: 0, y: 400 },
    ],
  }
  it('returns null for a triangle', () => {
    expect(deleteWall(tri, 0)).toBeNull()
  })
  it('returns null for an invalid index', () => {
    expect(deleteWall(rect('r', 0, 0, 100, 100), 9)).toBeNull()
    expect(deleteWall(rect('r', 0, 0, 100, 100), -1)).toBeNull()
  })
  it('collapses a rectangle to a triangle (parallel neighbours use the midpoint)', () => {
    const r = rect('r', 0, 0, 400, 300)
    const out = deleteWall(r, 0)!
    expect(out.vertices).toHaveLength(3)
    expect(out.vertices[0]).toEqual({ x: 200, y: 0 })
    expect(area(out.vertices)).toBeGreaterThan(10)
  })
  it('keeps id, name and fill and does not change the input', () => {
    const r = rect('r', 0, 0, 400, 300)
    const copy = JSON.stringify(r)
    const out = deleteWall(r, 1)!
    expect(out.id).toBe('r')
    expect(out.fill).toBe('#abc')
    expect(JSON.stringify(r)).toBe(copy)
  })
  it('reconnects a chamfer at the intersection of the neighbour walls', () => {
    // Square with the corner (400,0) cut: wall 1 is the chamfer (300,0)->(400,100).
    const c: Room = {
      id: 'c', name: 'c',
      vertices: [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 400, y: 100 }, { x: 400, y: 400 }, { x: 0, y: 400 }],
    }
    const out = deleteWall(c, 1)!
    expect(out.vertices).toHaveLength(4)
    expect(out.vertices[0].x).toBeCloseTo(400)
    expect(out.vertices[0].y).toBeCloseTo(0)
    expect(area(out.vertices)).toBeCloseTo(160000)
  })
  it('removes a notch: neighbour walls meet on their intersection', () => {
    // Wall 4 (300,100)->(100,100) is parallel to nothing useful: neighbours are vertical, so they
    // never meet and the midpoint is used.
    const out = deleteWall(notch, 4)!
    expect(out.vertices).toHaveLength(7)
    expect(out.vertices).toContainEqual({ x: 200, y: 100 })
  })
  it('handles the closing wall (last vertex to first)', () => {
    const c: Room = {
      id: 'c', name: 'c',
      vertices: [{ x: 400, y: 100 }, { x: 400, y: 400 }, { x: 0, y: 400 }, { x: 0, y: 0 }, { x: 300, y: 0 }],
    }
    const out = deleteWall(c, 4)!
    expect(out.vertices).toHaveLength(4)
    expect(out.vertices).toContainEqual({ x: 400, y: 0 })
    expect(area(out.vertices)).toBeCloseTo(160000)
  })
  it('falls back to the midpoint when the intersection is too far away', () => {
    // Neighbours nearly parallel: they meet far from the wall.
    const r: Room = {
      id: 'f', name: 'f',
      vertices: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 20 }, { x: 0, y: 21 }],
    }
    const out = deleteWall(r, 1)
    expect(out).not.toBeNull()
    expect(out!.vertices).toContainEqual({ x: 1000, y: 10 })
  })
  it('returns null when the result has no area', () => {
    const flat: Room = {
      id: 'z', name: 'z',
      vertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 0.1 }, { x: 0, y: 0.1 }],
    }
    expect(deleteWall(flat, 0)).toBeNull()
  })
})

describe('deleteRoomVertex / deleteRoomWall actions', () => {
  beforeEach(() => { useDoc.getState().hydrate(createDefaultProject()) })
  const setup = (room: Room) => {
    const ab = useDoc.getState().doc.artboards[0]
    addRoom(ab.id, room)
    return ab.id
  }
  it('deleteRoomVertex removes a vertex in one undo step', () => {
    const id = setup(rect('r', 0, 0, 400, 300))
    expect(deleteRoomVertex(id, 'r', 1)).toBe(true)
    expect(useDoc.getState().doc.artboards[0].rooms[0].vertices).toHaveLength(3)
    useDoc.getState().undo()
    expect(useDoc.getState().doc.artboards[0].rooms[0].vertices).toHaveLength(4)
  })
  it('deleteRoomVertex returns false for a triangle or unknown room', () => {
    const id = setup(tri)
    expect(deleteRoomVertex(id, 't', 0)).toBe(false)
    expect(deleteRoomVertex(id, 'nope', 0)).toBe(false)
  })
  it('deleteRoomWall removes a wall in one undo step', () => {
    const id = setup(rect('r', 0, 0, 400, 300))
    expect(deleteRoomWall(id, 'r', 0)).toBe(true)
    expect(useDoc.getState().doc.artboards[0].rooms[0].vertices).toHaveLength(3)
    useDoc.getState().undo()
    expect(useDoc.getState().doc.artboards[0].rooms[0].vertices).toHaveLength(4)
  })
  it('deleteRoomWall returns false for a triangle', () => {
    const id = setup(tri)
    expect(deleteRoomWall(id, 't', 0)).toBe(false)
  })
})

describe('moveVertexOrtho', () => {
  const allRightAngles = (r: Room) => r.vertices.every((c, i) => {
    const n = r.vertices.length
    const p = r.vertices[(i + n - 1) % n], q = r.vertices[(i + 1) % n]
    return Math.abs((c.x - p.x) * (q.x - c.x) + (c.y - p.y) * (q.y - c.y)) < 1e-9
  })
  it('keeps a rectangle rectangular', () => {
    const r = rect('r', 0, 0, 100, 80)
    const out = moveVertexOrtho(r, 2, { x: 130, y: 120 })
    expect(out.vertices).toEqual([{ x: 0, y: 0 }, { x: 130, y: 0 }, { x: 130, y: 120 }, { x: 0, y: 120 }])
    expect(allRightAngles(out)).toBe(true)
    expect(r.vertices[2]).toEqual({ x: 100, y: 80 })
  })
  it('keeps an L-shape at 90° on every corner', () => {
    const l: Room = { id: 'l', name: 'l', vertices: [
      { x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 }, { x: 100, y: 100 }, { x: 100, y: 200 }, { x: 0, y: 200 },
    ] }
    for (let i = 0; i < 6; i++) {
      const out = moveVertexOrtho(l, i, { x: l.vertices[i].x + 13, y: l.vertices[i].y + 7 })
      expect(out.vertices).toHaveLength(6)
      expect(allRightAngles(out)).toBe(true)
    }
  })
  it('triangle only moves one vertex, axis-locked to the previous one', () => {
    const out = moveVertexOrtho(tri, 1, { x: 350, y: 20 })
    expect(out.vertices[1]).toEqual({ x: 350, y: 0 })
    expect(out.vertices[0]).toEqual(tri.vertices[0])
    expect(out.vertices[2]).toEqual(tri.vertices[2])
  })
})

describe('wallKinds remapping', () => {
  // A 400 x 300 rectangle (walls 0..3) whose per-edge kinds are given by `kinds`.
  const room = (kinds?: Record<string, 'wall' | 'fence'>): Room => {
    const r = rect('a', 0, 0, 400, 300)
    return kinds ? { ...r, wallKinds: kinds } : r
  }

  it('insertVertexOnEdge: the split wall becomes two walls, later walls shift by 1', () => {
    const r = room({ '0': 'fence', '2': 'fence' })
    const on0 = insertVertexOnEdge(r, 0, { x: 200, y: 0 })
    expect(on0.vertices).toHaveLength(5)
    // Old wall 0 -> walls 0 and 1; old wall 2 -> wall 3.
    expect(on0.wallKinds).toEqual({ '0': 'fence', '1': 'fence', '3': 'fence' })

    const on2 = insertVertexOnEdge(r, 2, { x: 400, y: 150 })
    expect(on2.vertices).toHaveLength(5)
    // Old wall 2 -> walls 2 and 3; wall 0 is before the split and keeps its index.
    expect(on2.wallKinds).toEqual({ '0': 'fence', '2': 'fence', '3': 'fence' })
  })

  it('insertVertexOnEdge: a room without wallKinds stays without wallKinds', () => {
    expect(insertVertexOnEdge(room(), 1, { x: 400, y: 100 }).wallKinds).toBeUndefined()
  })

  it('deleteVertex: the wall that ended on the vertex goes away, later walls shift down', () => {
    // Vertex 0 is gone: wall 0 disappears, walls 1..3 become walls 0..2.
    const del0 = deleteVertex(room({ '0': 'fence', '2': 'fence' }), 0)!
    expect(del0.vertices).toHaveLength(3)
    expect(del0.wallKinds).toEqual({ '1': 'fence' })

    // Vertex 2 is gone: wall 2 disappears, wall 0 keeps its index.
    const del2 = deleteVertex(room({ '0': 'fence', '2': 'fence' }), 2)!
    expect(del2.wallKinds).toEqual({ '0': 'fence' })
  })

  it('deleteVertex: an empty map is dropped and a kind-free room has no map', () => {
    expect(deleteVertex(room({ '1': 'fence' }), 1)!.wallKinds).toBeUndefined()
    expect(deleteVertex(room(), 0)!.wallKinds).toBeUndefined()
  })

  it('deleteWall: the removed wall drops its kind, later walls shift down', () => {
    // Wall 0 is removed: walls 1..3 become walls 0..2.
    const out = deleteWall(room({ '1': 'fence', '3': 'fence' }), 0)!
    expect(out.vertices).toHaveLength(3)
    expect(out.wallKinds).toEqual({ '0': 'fence', '2': 'fence' })

    // A kind on the removed wall is thrown away, the others stay.
    expect(deleteWall(room({ '0': 'fence', '2': 'fence' }), 0)!.wallKinds).toEqual({ '1': 'fence' })
    // Nothing left: the map is dropped.
    expect(deleteWall(room({ '0': 'fence' }), 0)!.wallKinds).toBeUndefined()
  })

  it('cutoutRoom: the boolean result renumbers the edges, so wallKinds is dropped', () => {
    const big: Room = { ...rect('big', 0, 0, 400, 400), wallKinds: { '0': 'fence', '2': 'fence' } }
    const res = cutoutRoom(big, rect('c', 300, 200, 500, 400).vertices)
    expect(res.length).toBeGreaterThan(0)
    for (const r of res) expect(r.wallKinds).toBeUndefined()
  })

  it('cutoutRoom: a cutter that misses keeps one room and drops the map too', () => {
    const big: Room = { ...rect('big', 0, 0, 400, 400), wallKinds: { '1': 'fence' } }
    const res = cutoutRoom(big, rect('c', 1000, 1000, 1100, 1100).vertices)
    expect(res).toHaveLength(1)
    expect(res[0].wallKinds).toBeUndefined()
  })

  it('mergeRooms: the union renumbers the edges, so wallKinds of the first room is dropped', () => {
    const a: Room = { ...rect('a', 0, 0, 200, 200), wallKinds: { '0': 'fence' } }
    const b: Room = { ...rect('b', 200, 0, 400, 200), wallKinds: { '1': 'fence' } }
    expect(mergeRooms([a, b])!.wallKinds).toBeUndefined()
    // The shared-wall path (wall thickness > 0) drops it as well.
    expect(mergeRooms([a, { ...b, vertices: [{ x: 210, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 200 }, { x: 210, y: 200 }] }], 10)!.wallKinds).toBeUndefined()
  })
})
