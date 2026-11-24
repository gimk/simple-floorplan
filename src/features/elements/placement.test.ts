import { describe, expect, it } from 'vitest'
import { normalizeDoorHosts } from '../../core/doorHost'
import { roomWalls } from '../../model/geometry'
import type { PlanDoc, Room, WallElement } from '../../model/types'
import { flipHinge, swingForPointer } from './geometry'

// The rule of the place-element tool (docs/measurements-plan.md section 7):
//   1. the side of the wall where the pointer is gives the swing (the door opens toward the pointer);
//   2. normalizeDoorHosts moves a door that opens into the neighbour room to that room, swing 'in';
//   3. key F flips the hinge and the world hinge point stays where it was after the move.

const rect = (prefix: string, x: number, y: number, w: number, h: number): Room => ({
  id: `r${prefix}`,
  code: prefix,
  name: prefix,
  vertices: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].map(([px, py], i) => ({ id: `${prefix}${i}`, x: px, y: py })),
  holes: [],
  walls: {},
  walkOrder: prefix === 'A' ? 0 : 1,
})

// A is left (0..400), B is right (400..600). Their shared wall is x = 400.
const rooms = (): Room[] => [rect('A', 0, 0, 400, 300), rect('B', 400, 0, 200, 300)]

const docWith = (elements: WallElement[]): PlanDoc => ({
  projectId: 'test',
  title: 'Test',
  rooms: rooms(),
  elements,
  measurements: {},
  roomNotes: {},
  tapes: [],
  pins: [],
})

/** Host wall of room A that carries the shared edge x = 400 (A-2: (400,0) -> (400,300), start id A1). */
const sharedWallA = () => roomWalls(rooms()[0]).find((w) => w.start.id === 'A1')!

const door = (p: Partial<WallElement> = {}): WallElement => ({
  id: 'd1', roomId: 'rA', wallStart: 'A1', kind: 'door', variant: 'single', offsetCm: 50, widthCm: 80,
  heightCm: 204, hinge: 'start', swing: 'in',
  createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z', ...p,
})

describe('place-element: pointer side -> door swing', () => {
  it('keeps the door in room A when the pointer is in room A', () => {
    const swing = swingForPointer(sharedWallA(), { x: 390, y: 100 })
    expect(swing).toBe('in')
    const el = door({ swing })
    const { doc, moved } = normalizeDoorHosts(docWith([el]))
    expect(moved).toEqual([])
    expect(doc.elements[0].roomId).toBe('rA')
    expect(doc.elements[0].swing).toBe('in')
  })

  it('moves the door to room B when the pointer is in room B (a door that opens into it)', () => {
    const swing = swingForPointer(sharedWallA(), { x: 410, y: 100 })
    expect(swing).toBe('out')
    const el = door({ swing })
    const { doc, moved } = normalizeDoorHosts(docWith([el]))
    expect(moved).toEqual([{ elementId: 'd1', fromRoomId: 'rA', toRoomId: 'rB' }])
    expect(doc.elements[0].roomId).toBe('rB')
    expect(doc.elements[0].swing).toBe('in')
    expect(doc.elements[0].id).toBe('d1')
    // The hinge follows the same world end: offset 50 in A = (400,50) is the far end of wall B-4.
    expect(doc.elements[0].offsetCm).toBeCloseTo(170, 6)
    expect(doc.elements[0].hinge).toBe('end')
  })

  it('keeps the door on an exterior wall when the pointer is outside the plan', () => {
    // A-1 = (0,0) -> (400,0) is the top facade: nothing beyond it.
    const wall = roomWalls(rooms()[0]).find((w) => w.start.id === 'A0')!
    const swing = swingForPointer(wall, { x: 200, y: -60 })
    expect(swing).toBe('out')
    const { doc, moved } = normalizeDoorHosts(docWith([door({ wallStart: 'A0', offsetCm: 100, swing })]))
    expect(moved).toEqual([])
    expect(doc.elements[0].roomId).toBe('rA')
    expect(doc.elements[0].swing).toBe('out')
  })

  it('flipping the hinge moves the leaf to the other end of the opening', () => {
    expect(flipHinge(door().hinge)).toBe('end')
    const flipped = door({ hinge: flipHinge(door().hinge) })
    const swing = swingForPointer(sharedWallA(), { x: 390, y: 100 })
    const { doc } = normalizeDoorHosts(docWith([flipped]))
    // Same room, same span, hinge at the other end (no move needed for an in-door).
    expect(doc.elements[0].roomId).toBe('rA')
    expect(doc.elements[0].offsetCm).toBe(flipped.offsetCm)
    expect(doc.elements[0].hinge).toBe('end')
    expect(swing).toBe('in')
  })
})
