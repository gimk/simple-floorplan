import { describe, expect, it } from 'vitest'
import type { Opening, Room } from '../../model/types'
import { openingHitEndpoints } from '../openings/hit'
import {
  edgeOutwardNormal, effectiveWallThickness, openingSymbolShift, openingWall, roomDoorThresholds, wallMaskModel,
  wallStrokeMaskModel,
  wallThicknessOf,
} from './walls'

const rect = (cw: boolean): Room => {
  const v = [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }, { x: 0, y: 300 }]
  return { id: 'r', name: 'r', vertices: cw ? v : [...v].reverse() }
}
const door = (p: Partial<Opening> = {}): Opening => ({ id: 'd', kind: 'door', xCm: 200, yCm: 0, angleDeg: 0, widthCm: 90, hinge: 'left', swing: 'in', ...p })

describe('wall thickness helpers', () => {
  it('defaults to 10, keeps 0 and clamps to 50', () => {
    expect(wallThicknessOf({})).toBe(10)
    expect(wallThicknessOf({ wallThicknessCm: 0 })).toBe(0)
    expect(wallThicknessOf({ wallThicknessCm: 80 })).toBe(50)
  })
  it('outward normal points away from the room for both windings', () => {
    for (const cw of [true, false]) {
      const r = rect(cw)
      const i = r.vertices.findIndex((p, k) => p.y === 0 && r.vertices[(k + 1) % 4].y === 0)
      expect(edgeOutwardNormal(r, i)).toEqual({ x: 0, y: -1 })
    }
  })
  it('wall frame needs thickness and a host wall', () => {
    expect(openingWall([rect(true)], door(), 0)).toBeNull()
    expect(openingWall([rect(true)], door({ yCm: 150 }), 10)).toBeNull()
    expect(openingWall([rect(true)], door(), 10)?.out).toEqual({ x: 0, y: -1 })
  })
  it('door hinges at the swing-side face of the wall', () => {
    const wall = openingWall([rect(true)], door(), 10)!
    // swing "in" = +n = +y = into the room: hinge on the room edge, no shift.
    expect(openingSymbolShift(door({ swing: 'in' }), wall)).toEqual({ x: 0, y: 0 })
    // swing "out" = -y = outward: hinge on the outer wall face.
    expect(openingSymbolShift(door({ swing: 'out' }), wall)).toEqual({ x: 0, y: -10 })
    expect(openingSymbolShift({ ...door(), kind: 'window' }, wall)).toEqual({ x: 0, y: -5 })
  })
  it('stroke mask is null when thin and holds one exact-width cutout per hosted opening', () => {
    const ab = { rooms: [rect(true)], openings: [door(), door({ id: 'x', yCm: 150 })] }
    expect(wallStrokeMaskModel(ab, 0, 1.5)).toBeNull()
    const m = wallStrokeMaskModel(ab, 10, 1.5)!
    expect(m.cutouts).toHaveLength(1)
    // Top wall (outward -y): from 1.5 cm inside the room to 11.5 cm outside, 90 cm wide.
    expect(m.cutouts[0]).toEqual({ x1: 200, y1: 1.5, x2: 200, y2: -11.5, width: 90 })
    // The box covers every room vertex and every cutout.
    expect(m.x).toBeLessThan(-1)
    expect(m.y).toBeLessThan(-11.5)
    expect(m.width).toBeGreaterThan(400)
    expect(m.height).toBeGreaterThan(300)
  })
  it('stroke mask keeps the pad on both faces and grows with it', () => {
    const ab = { rooms: [rect(true)], openings: [door()] }
    const small = wallStrokeMaskModel(ab, 10, 1.5)!.cutouts[0]
    const big = wallStrokeMaskModel(ab, 10, 6)!.cutouts[0]
    expect(small.y1).toBe(1.5)
    expect(big.y1).toBe(6)
    expect(big.y2).toBe(-16)
    // Thin walls never get a stroke mask, whatever the pad.
    expect(wallStrokeMaskModel(ab, 0, 6)).toBeNull()
  })
  it('mask model has a cutout per hosted opening and none when thin', () => {
    const ab = { rooms: [rect(true)], openings: [door(), door({ id: 'x', yCm: 150 })] }
    expect(wallMaskModel(ab, 0)).toBeNull()
    const m = wallMaskModel(ab, 10)!
    expect(m.roomPoints).toHaveLength(1)
    expect(m.cutouts).toHaveLength(1)
    expect(m.cutouts[0].width).toBe(90)
  })
})

// ---------- flush rooms ----------
// Two 300 cm tall rooms, the left one 0..400 wide, the right one starting `gap` cm after it. A gap of
// 0 means the two rooms share the same wall line: the thick wall of the left room is drawn into the
// right room, where the wall mask hides it, so the shared wall looks like a thin line.

/** The left room (id "a"), 400 x 300. */
const leftRoom = (): Room => ({ ...rect(true), id: 'a', name: 'A' })

/** The right room (id "b"), 300 x 300, starting `gap` cm after the left one. */
const rightRoom = (gap: number): Room => {
  const x0 = 400 + gap
  return { id: 'b', name: 'B', vertices: [{ x: x0, y: 0 }, { x: x0 + 300, y: 0 }, { x: x0 + 300, y: 300 }, { x: x0, y: 300 }] }
}

/** The two rooms `gap` cm apart. */
const pair = (gap: number): Room[] => [leftRoom(), rightRoom(gap)]

/** A 90 cm door on the shared wall, at (400, 150), running along y: outward of the left room is +x. */
const sideDoor = (p: Partial<Opening> = {}): Opening => door({ xCm: 400, yCm: 150, angleDeg: 90, ...p })

const pt = { x: 400, y: 150 }
const plusX = { x: 1, y: 0 }

describe('effective wall thickness', () => {
  it('is 0 when another room is flush behind the wall', () => {
    expect(effectiveWallThickness(pair(0), 'a', pt, plusX, 10)).toBe(0)
    expect(openingWall(pair(0), sideDoor(), 10)).toBeNull()
  })

  it('is the room gap when the other room sits inside the wall thickness', () => {
    expect(effectiveWallThickness(pair(5), 'a', pt, plusX, 10)).toBe(5)
    expect(openingWall(pair(5), sideDoor(), 10)).toEqual({ out: plusX, thicknessCm: 5 })
  })

  it('is the full thickness at a 10 cm gap, farther, or on an exterior wall', () => {
    expect(effectiveWallThickness(pair(10), 'a', pt, plusX, 10)).toBe(10)
    expect(effectiveWallThickness(pair(30), 'a', pt, plusX, 10)).toBe(10)
    expect(openingWall(pair(10), sideDoor(), 10)?.thicknessCm).toBe(10)
    expect(effectiveWallThickness([rect(true)], 'r', { x: 200, y: 0 }, { x: 0, y: -1 }, 10)).toBe(10)
  })

  it('is 0 on a thin artboard', () => {
    expect(effectiveWallThickness(pair(5), 'a', pt, plusX, 0)).toBe(0)
  })

  it('keeps the hit band and the resize handles on the wall line of a flush opening', () => {
    const wall = openingWall(pair(0), sideDoor(), 10)
    const ends = { start: { x: 400, y: 90 }, end: { x: 400, y: 210 } }
    expect(openingHitEndpoints(ends.start, ends.end, wall)).toEqual(ends)
  })

  it('puts the hit band in the middle of a visible wall narrower than the artboard', () => {
    const wall = openingWall(pair(5), sideDoor(), 10)
    const ends = { start: { x: 400, y: 90 }, end: { x: 400, y: 210 } }
    expect(openingHitEndpoints(ends.start, ends.end, wall)).toEqual({
      start: { x: 402.5, y: 90 }, end: { x: 402.5, y: 210 },
    })
  })

  it('still cuts both flush room borders out with the stroke mask', () => {
    // A flush opening has no wall frame, but the stroke mask must still span the whole artboard
    // thickness: the 1px border line of BOTH rooms crosses the opening there.
    const m = wallStrokeMaskModel({ rooms: pair(0), openings: [sideDoor()] }, 10, 1.5)!
    expect(m.cutouts).toHaveLength(1)
    expect(m.cutouts[0]).toEqual({ x1: 398.5, y1: 150, x2: 411.5, y2: 150, width: 90 })
    // The mask box covers the cutout on both sides of the flush wall line.
    expect(m.x).toBeLessThan(398.5)
    expect(m.x + m.width).toBeGreaterThan(411.5)
  })
})

// ---------- door thresholds ----------
// Threshold quads let the floor colour and the floor pattern of a room run through its doorways.
// A quad spans the opening width and bridges the wall, from just inside the room border (0.25 cm,
// so no seam shows) to the outer wall face.

describe('roomDoorThresholds', () => {
  it('is empty when the walls are thin', () => {
    const m = roomDoorThresholds([rect(true)], [door()], 0)
    expect(m.size).toBe(0)
    expect([...m.values()]).toEqual([])
    expect(roomDoorThresholds([rect(true)], [door()], -5).size).toBe(0)
    expect(roomDoorThresholds([rect(true)], [door()], Number.NaN).size).toBe(0)
  })

  it('gives one quad over the wall thickness for an exterior door', () => {
    const m = roomDoorThresholds([rect(true)], [door()], 10)
    expect(m.size).toBe(1)
    const quads = m.get('r')!
    expect(quads).toHaveLength(1)
    // Top wall: outward is -y, the door is 90 cm wide, centred at x = 200.
    expect(quads[0]).toEqual([
      { x: 155, y: 0.25 }, { x: 245, y: 0.25 },
      { x: 245, y: -10 }, { x: 155, y: -10 },
    ])
  })

  it('gives one quad for an open passage', () => {
    const m = roomDoorThresholds([rect(true)], [door({ kind: 'opening' })], 10)
    expect(m.get('r')).toHaveLength(1)
    expect(m.get('r')![0][3]).toEqual({ x: 155, y: -10 })
  })

  it('excludes windows, which sit above a wall sill', () => {
    const m = roomDoorThresholds([rect(true)], [door({ kind: 'window' })], 10)
    expect(m.size).toBe(0)
    const mixed = roomDoorThresholds([rect(true)], [door({ kind: 'window' }), door({ id: 'x', xCm: 300 })], 10)
    expect(mixed.size).toBe(1)
    expect(mixed.get('r')).toHaveLength(1)
    expect(mixed.get('r')![0][0]).toEqual({ x: 255, y: 0.25 })
  })

  it('gives no quad on a flush 0 cm shared wall', () => {
    // Adjacent rooms already touch edge to edge: there is no wall gap to fill.
    expect(roomDoorThresholds(pair(0), [sideDoor()], 10).size).toBe(0)
  })

  it('uses the effective thickness when the gap is smaller than the artboard thickness', () => {
    const m = roomDoorThresholds(pair(5), [sideDoor()], 10)
    const quads = m.get('a')!
    expect(quads).toHaveLength(1)
    // Outward of room "a" is +x; the wall body is only the 5 cm gap, the left face of room "b".
    expect(quads[0]).toEqual([
      { x: 399.75, y: 105 }, { x: 399.75, y: 195 },
      { x: 405, y: 195 }, { x: 405, y: 105 },
    ])
  })

  it('keeps the full thickness at a wide gap and groups quads by host room', () => {
    const m = roomDoorThresholds(pair(30), [sideDoor()], 10)
    expect(m.get('a')![0][2]).toEqual({ x: 410, y: 195 })
    const many = roomDoorThresholds(
      [rect(true)],
      [door(), door({ id: 'd2', xCm: 300 }), door({ id: 'd3', yCm: 300, angleDeg: 0 })],
      10,
    )
    expect(many.size).toBe(1)
    expect(many.get('r')).toHaveLength(3)
  })

  it('skips an opening that has no host wall', () => {
    expect(roomDoorThresholds([rect(true)], [door({ yCm: 150 })], 10).size).toBe(0)
    expect(roomDoorThresholds([], [door()], 10).size).toBe(0)
  })
})
