import { describe, expect, it } from 'vitest'
import type { Room } from '../../model/types'
import { roomWalls } from '../../model/geometry'
import {
  clampOffset, defaultElement, doorOpeningFor, elementFrame, flipHinge, nearestWall, offsetFromEnd, offsetFromEndToStart,
  overflows, placeOffset, snapTo, swingForPointer, wallSide, wallThickness,
} from './geometry'

const room: Room = {
  id: 'r', code: 'SE', name: 'Room', holes: [], walkOrder: 0,
  vertices: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 400, y: 0 }, { id: 'c', x: 400, y: 300 }, { id: 'd', x: 0, y: 300 }],
  walls: { a: { type: 'bearing', thicknessCm: 0 }, b: { type: 'exterior', thicknessCm: 35 }, c: { type: 'exterior', thicknessCm: 0 } },
}

describe('elements geometry', () => {
  it('wallThickness defaults', () => {
    expect(wallThickness(room, 'a')).toBe(25)
    expect(wallThickness(room, 'b')).toBe(35)
    expect(wallThickness(room, 'c')).toBe(30)
    expect(wallThickness(room, 'd')).toBe(10)
  })
  it('clamps offsets', () => {
    expect(clampOffset(-5, 80, 400)).toBe(0)
    expect(clampOffset(350, 80, 400)).toBe(320)
    expect(clampOffset(10, 500, 400)).toBe(0)
  })
  it('snaps and places centered', () => {
    expect(snapTo(12, 5)).toBe(10)
    expect(snapTo(12, 0)).toBe(12)
    expect(placeOffset(200, 80, 400, 5)).toBe(160)
    expect(placeOffset(10, 80, 400)).toBe(0)
    expect(placeOffset(399, 80, 400)).toBe(320)
  })
  it('offset from end', () => {
    expect(offsetFromEnd({ offsetCm: 100, widthCm: 80 }, 400)).toBe(220)
    expect(offsetFromEndToStart(220, 80, 400)).toBe(100)
    expect(overflows({ offsetCm: 350, widthCm: 80 }, 400)).toBe(true)
    expect(overflows({ offsetCm: 320, widthCm: 80 }, 400)).toBe(false)
  })
  it('element frame follows the wall', () => {
    const w = roomWalls(room)[1] // (400,0)->(400,300)
    const f = elementFrame(w, { offsetCm: 50, widthCm: 100 })
    expect(f.a).toEqual({ x: 400, y: 50 })
    expect(f.b).toEqual({ x: 400, y: 150 })
    expect(Math.round(f.inward.x)).toBe(-1)
  })
  it('nearest wall', () => {
    const hit = nearestWall([room], { x: 120, y: 12 }, 30)!
    expect(hit.wall.start.id).toBe('a')
    expect(Math.round(hit.along)).toBe(120)
    expect(nearestWall([room], { x: 200, y: 150 }, 30)).toBeNull()
  })
  it('defaults', () => {
    expect(defaultElement('door')).toMatchObject({ widthCm: 80, heightCm: 204 })
    expect(defaultElement('door', 'double').widthCm).toBe(140)
    expect(defaultElement('window')).toMatchObject({ widthCm: 120, heightCm: 135, sillCm: 90, variant: 'standard' })
    expect(defaultElement('cupboard', 'bogus' as never).variant).toBe('wall-cabinet')
    expect(defaultElement('other').widthCm).toBe(50)
  })
})

describe('opening side of a door (section 7)', () => {
  // Room below the wall y = 0: wall 0 runs (0,0) -> (400,0) with inward (0,1) (y points down).
  const wall = roomWalls(room)[0]

  it('measures the side of the wall the pointer is on', () => {
    expect(wallSide(wall, { x: 200, y: 40 })).toBeCloseTo(40, 6)
    expect(wallSide(wall, { x: 200, y: -40 })).toBeCloseTo(-40, 6)
    expect(wallSide(wall, { x: 200, y: 0 })).toBe(0)
  })

  it('opens toward the pointer: in for the room side, out for the other side', () => {
    expect(swingForPointer(wall, { x: 200, y: 40 })).toBe('in')
    expect(swingForPointer(wall, { x: 200, y: -40 })).toBe('out')
    // On the line itself the door opens into the room that owns the wall.
    expect(swingForPointer(wall, { x: 200, y: 0 })).toBe('in')
  })

  it('follows the inward normal of every wall of a room', () => {
    const walls = roomWalls(room)
    // Wall 1 runs (400,0) -> (400,300): its room is on the left, so the right side is "out".
    expect(swingForPointer(walls[1], { x: 390, y: 150 })).toBe('in')
    expect(swingForPointer(walls[1], { x: 410, y: 150 })).toBe('out')
    // Wall 3 runs (0,300) -> (0,0): its room is on the right.
    expect(swingForPointer(walls[3], { x: 20, y: 150 })).toBe('in')
    expect(swingForPointer(walls[3], { x: -20, y: 150 })).toBe('out')
  })

  it('gives a new door its hinge choice and the pointer side', () => {
    expect(doorOpeningFor('door', wall, { x: 200, y: 40 }, 'start')).toEqual({ hinge: 'start', swing: 'in' })
    expect(doorOpeningFor('door', wall, { x: 200, y: -40 }, 'end')).toEqual({ hinge: 'end', swing: 'out' })
  })

  it('gives no hinge and no swing to a window or an opening', () => {
    expect(doorOpeningFor('window', wall, { x: 200, y: 40 }, 'start')).toEqual({})
    expect(doorOpeningFor('opening', wall, { x: 200, y: -40 }, 'end')).toEqual({})
  })

  it('flips the hinge', () => {
    expect(flipHinge('start')).toBe('end')
    expect(flipHinge('end')).toBe('start')
    expect(flipHinge(undefined)).toBe('end')
  })
})
