import { describe, expect, it } from 'vitest'
import { roomWalls } from '../model/geometry'
import type { PlanDoc, Room, Vec, WallElement } from '../model/types'
import { itemSpan } from '../features/measure/logic'
import { normalizeDoorHosts, openingRoomHost } from './doorHost'

// Two rectangles sharing the wall x = 400. A is left, B is right. Vertex i of a room has id "<CODE><i>".
// Wall A-2 runs (400,0) -> (400,300) and starts at vertex A1; wall B-4 runs (400,300) -> (400,0) and
// starts at vertex B3: the shared walls of the two rooms run in OPPOSITE directions.
const rect = (prefix: string, x: number, y: number, w: number, h: number): Room => ({
  id: `r${prefix}`,
  code: prefix,
  name: prefix === 'A' ? 'Entrance' : 'Living',
  vertices: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].map(([px, py], i) => ({ id: `${prefix}${i}`, x: px, y: py })),
  holes: [],
  walls: {},
  walkOrder: prefix === 'A' ? 0 : 1,
})

const docWith = (elements: WallElement[]): PlanDoc => ({
  projectId: 'test',
  title: 'Test',
  rooms: [rect('A', 0, 0, 400, 300), rect('B', 400, 0, 200, 300)],
  elements,
  measurements: {},
  roomNotes: {},
  tapes: [],
  pins: [],
})

const door = (p: Partial<WallElement> = {}): WallElement => ({
  id: 'd1', roomId: 'rA', wallStart: 'A1', kind: 'door', offsetCm: 50, widthCm: 80,
  hinge: 'start', swing: 'out', createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z', ...p,
})

/** World point of the hinge, using the same span helper as Measuring Mode. */
function hingePoint(doc: PlanDoc, el: WallElement): Vec | null {
  const room = doc.rooms.find((r) => r.id === el.roomId)
  if (!room) return null
  const span = itemSpan(doc, room, el)
  if (!span) return null
  return el.hinge === 'end' ? span.p1 : span.p0
}

describe('doorHost: openingRoomHost', () => {
  it('moves an out-door of A onto the shared wall of B, with swing in', () => {
    const doc = docWith([door()])
    const host = openingRoomHost(doc, doc.elements[0])
    expect(host.roomId).toBe('rB')
    expect(host.wallStart).toBe('B3') // B-4 starts at vertex B3 = (400,300)
    expect(host.swing).toBe('in')
    expect(host.id).toBe('d1')
    expect(host.widthCm).toBe(80)
    expect(host.updatedAt).not.toBe('2024-01-01T00:00:00.000Z')
  })

  it('recomputes the offset along the neighbour wall direction (170, not 50)', () => {
    const doc = docWith([door()])
    const host = openingRoomHost(doc, doc.elements[0])
    // B-4 runs from (400,300) to (400,0): the near edge of the opening (y = 130) is 300 - 130 = 170 from its start.
    expect(host.offsetCm).toBeCloseTo(170, 6)
  })

  it('keeps the hinge at the same world point (hinge start)', () => {
    const doc = docWith([door({ hinge: 'start' })])
    const before = hingePoint(doc, doc.elements[0])!
    const host = openingRoomHost(doc, doc.elements[0])
    expect(host.hinge).toBe('end')
    const after = hingePoint(docWith([host]), host)!
    expect(after.x).toBeCloseTo(before.x, 6)
    expect(after.y).toBeCloseTo(before.y, 6)
  })

  it('keeps the hinge at the same world point (hinge end)', () => {
    const doc = docWith([door({ hinge: 'end' })])
    const before = hingePoint(doc, doc.elements[0])!
    const host = openingRoomHost(doc, doc.elements[0])
    expect(host.hinge).toBe('start')
    const after = hingePoint(docWith([host]), host)!
    expect(after.x).toBeCloseTo(before.x, 6)
    expect(after.y).toBeCloseTo(before.y, 6)
  })

  it('leaves an in-door untouched (same object)', () => {
    const el = door({ swing: 'in' })
    const doc = docWith([el])
    expect(openingRoomHost(doc, el)).toBe(el)
  })

  it('leaves an out-door on an exterior wall untouched', () => {
    const el = door({ wallStart: 'A0', offsetCm: 100 }) // A-1 = (0,0) -> (400,0): exterior, nothing beyond
    const doc = docWith([el])
    expect(openingRoomHost(doc, el)).toBe(el)
  })

  it('leaves an out-door that is partly outside the shared segment untouched', () => {
    const el = door({ offsetCm: 250 }) // span 250..330 on a 300 cm wall
    const doc = docWith([el])
    expect(openingRoomHost(doc, el)).toBe(el)
  })

  it('leaves a door on a wall with no neighbour room untouched', () => {
    const el = door({ roomId: 'rB', wallStart: 'B1', offsetCm: 20 }) // B-2 = (600,0) -> (600,300): no room beyond
    const doc = docWith([el])
    expect(openingRoomHost(doc, el)).toBe(el)
  })

  it('works when the two shared walls run in the SAME direction (rooms wound the other way)', () => {
    // B drawn counter-clockwise: its wall v3 -> v0 runs (400,0) -> (400,300), same direction as A-2.
    const ccw: Room = { ...rect('B', 400, 0, 200, 300), vertices: [{ id: 'B3', x: 400, y: 300 }, { id: 'B2', x: 600, y: 300 }, { id: 'B1', x: 600, y: 0 }, { id: 'B0', x: 400, y: 0 }] }
    const doc: PlanDoc = { ...docWith([door()]), rooms: [rect('A', 0, 0, 400, 300), ccw] }
    const host = openingRoomHost(doc, doc.elements[0])
    expect(host.roomId).toBe('rB')
    expect(host.wallStart).toBe('B0')
    expect(host.offsetCm).toBeCloseTo(50, 6) // same count from the same end
    expect(host.hinge).toBe('start')
    const before = hingePoint(doc, doc.elements[0])!
    const after = hingePoint({ ...doc, elements: [host] }, host)!
    expect(after.x).toBeCloseTo(before.x, 6)
    expect(after.y).toBeCloseTo(before.y, 6)
  })

  it('keeps note and variant when the door moves', () => {
    const el = door({ variant: 'single', note: 'hinge left', heightCm: 204 })
    const host = openingRoomHost(docWith([el]), el)
    expect(host.note).toBe('hinge left')
    expect(host.variant).toBe('single')
    expect(host.heightCm).toBe(204)
  })
})

describe('doorHost: normalizeDoorHosts', () => {
  it('returns the same doc object when nothing changes', () => {
    const doc = docWith([door({ swing: 'in' })])
    const res = normalizeDoorHosts(doc)
    expect(res.doc).toBe(doc)
    expect(res.moved).toEqual([])
  })

  it('returns the same doc object for an empty plan', () => {
    const doc = docWith([])
    expect(normalizeDoorHosts(doc).doc).toBe(doc)
  })

  it('moves out-doors and reports them, leaving other elements alone', () => {
    const other: WallElement = { ...door({ id: 'w1', kind: 'window', swing: undefined }), widthCm: 120 }
    const doc = docWith([door(), other])
    const res = normalizeDoorHosts(doc)
    expect(res.moved).toEqual([{ elementId: 'd1', fromRoomId: 'rA', toRoomId: 'rB' }])
    expect(res.doc).not.toBe(doc)
    expect(res.doc.elements[1]).toBe(other)
    expect(res.doc.elements[0].roomId).toBe('rB')
  })

  it('is idempotent: normalizing twice gives the same result', () => {
    const once = normalizeDoorHosts(docWith([door()]))
    const twice = normalizeDoorHosts(once.doc)
    expect(twice.moved).toEqual([])
    expect(twice.doc).toBe(once.doc)
    expect(twice.doc.elements[0]).toEqual(once.doc.elements[0])
  })

  it('does not touch other kinds of element on a shared wall', () => {
    const el: WallElement = { ...door({ kind: 'opening', swing: 'out' }) }
    const doc = docWith([el])
    expect(normalizeDoorHosts(doc).doc).toBe(doc)
  })

  it('the neighbour wall of the moved door is a wall of the neighbour room', () => {
    const res = normalizeDoorHosts(docWith([door()]))
    const moved = res.doc.elements[0]
    const room = res.doc.rooms.find((r) => r.id === moved.roomId)!
    expect(roomWalls(room).some((w) => w.start.id === moved.wallStart)).toBe(true)
  })
})
