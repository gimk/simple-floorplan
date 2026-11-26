import { describe, expect, it } from 'vitest'
import { createArtboard } from '../../model/schema'
import type { Artboard, Room } from '../../model/types'
import {
  ARTBOARD_PAD_CM,
  MIN_ARTBOARD_HEIGHT_CM,
  MIN_ARTBOARD_WIDTH_CM,
  artboardAreaM2,
  artboardFrame,
  pickArtboard,
  roomAreaM2,
} from './frame'

const rect = (id: string, w: number, h: number, x = 0, y = 0): Room => ({
  id,
  name: id,
  vertices: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }],
})

const withRooms = (rooms: Room[], xCm = 0, yCm = 0): Artboard => ({
  ...createArtboard('Plan A', xCm, yCm),
  rooms,
})

describe('artboardFrame', () => {
  it('gives an empty artboard the minimum frame, padded around its origin', () => {
    const f = artboardFrame(withRooms([]))
    expect(f.width).toBe(MIN_ARTBOARD_WIDTH_CM)
    expect(f.height).toBe(MIN_ARTBOARD_HEIGHT_CM)
    expect(f.x).toBe(-ARTBOARD_PAD_CM)
    expect(f.y).toBe(-ARTBOARD_PAD_CM)
    expect(f.maxX).toBe(f.x + f.width)
    expect(f.maxY).toBe(f.y + f.height)
  })

  it('uses manual widthCm/heightCm as the minimum frame size', () => {
    const f = artboardFrame({ ...withRooms([]), widthCm: 1200, heightCm: 900 })
    expect(f.width).toBe(1200)
    expect(f.height).toBe(900)
    expect(f.x).toBe(-ARTBOARD_PAD_CM)
    expect(f.maxX).toBe(f.x + 1200)
  })

  it('clamps manual width/height to the global minimum', () => {
    const f = artboardFrame({ ...withRooms([]), widthCm: 100, heightCm: 50 })
    expect(f.width).toBe(MIN_ARTBOARD_WIDTH_CM)
    expect(f.height).toBe(MIN_ARTBOARD_HEIGHT_CM)
  })

  it('still expands past manual width/height when the content is bigger', () => {
    const f = artboardFrame({ ...withRooms([rect('r1', 2000, 1500)]), widthCm: 1000, heightCm: 800 })
    expect(f.width).toBe(2000 + 2 * ARTBOARD_PAD_CM)
    expect(f.height).toBe(1500 + 2 * ARTBOARD_PAD_CM)
  })

  it('only one manual dimension: the other keeps the default minimum', () => {
    const f = artboardFrame({ ...withRooms([]), widthCm: 1000 })
    expect(f.width).toBe(1000)
    expect(f.height).toBe(MIN_ARTBOARD_HEIGHT_CM)
  })

  it('grows with the rooms and keeps 40 cm of padding on every side', () => {
    const a = withRooms([rect('r1', 1000, 800)])
    const f = artboardFrame(a)
    expect(f.width).toBe(1000 + 2 * ARTBOARD_PAD_CM)
    expect(f.height).toBe(800 + 2 * ARTBOARD_PAD_CM)
    expect(f.x).toBe(a.xCm - ARTBOARD_PAD_CM)
    expect(f.y).toBe(a.yCm - ARTBOARD_PAD_CM)
    // The room's far corner is inside the frame, one padding away from its edge.
    expect(f.maxX).toBe(a.xCm + 1000 + ARTBOARD_PAD_CM)
    expect(f.maxY).toBe(a.yCm + 800 + ARTBOARD_PAD_CM)
  })

  it('follows the artboard offset (xCm, yCm)', () => {
    const at0 = artboardFrame(withRooms([rect('r1', 700, 500)], 0, 0))
    const far = artboardFrame(withRooms([rect('r1', 700, 500)], 2000, -1500))
    expect(far.width).toBe(at0.width)
    expect(far.height).toBe(at0.height)
    expect(far.x - at0.x).toBe(2000)
    expect(far.y - at0.y).toBe(-1500)
  })

  it('takes the widest room, the openings and the furniture into account', () => {
    const a = withRooms([rect('r1', 300, 200)])
    a.openings = [{ id: 'o1', kind: 'door', xCm: 900, yCm: 50, angleDeg: 0, widthCm: 90 }]
    a.furniture = [
      { id: 'f1', name: 'Bed', shape: 'rect', xCm: 100, yCm: 620, widthCm: 160, depthCm: 200, rotationDeg: 0, color: '#fff' },
    ]
    const f = artboardFrame(a)
    // Widest content: the opening at x = 900 cm; deepest: the bed, yCm + depthCm / 2 = 720 cm.
    expect(f.width).toBe(900 + 2 * ARTBOARD_PAD_CM)
    expect(f.height).toBe(720 + 2 * ARTBOARD_PAD_CM)
  })
})

describe('artboard area', () => {
  it('computes a room area in m²', () => {
    expect(roomAreaM2(rect('r1', 400, 300))).toBeCloseTo(12, 10)
    expect(roomAreaM2(rect('r1', 1000, 1000))).toBeCloseTo(100, 10)
  })

  it('sums the rooms of an artboard', () => {
    const a = withRooms([rect('r1', 500, 400), rect('r2', 250, 200, 500, 0)])
    expect(artboardAreaM2(a)).toBeCloseTo(20 + 5, 10)
  })

  it('is 0 m² for an artboard without rooms', () => {
    expect(artboardAreaM2(withRooms([]))).toBe(0)
  })

  it('does not depend on the winding direction of the vertices', () => {
    const cw = rect('r1', 300, 200)
    const ccw = { ...rect('r1', 300, 200), vertices: [...rect('r1', 300, 200).vertices].reverse() }
    expect(roomAreaM2(ccw)).toBeCloseTo(roomAreaM2(cw), 10)
    expect(roomAreaM2(cw)).toBeCloseTo(6, 10)
  })
})

describe('pickArtboard', () => {
  const a = { ...withRooms([rect('r', 500, 400)]), id: 'a' }
  const b = { ...withRooms([rect('r', 500, 400)], 1000, 0), id: 'b' }
  it('picks the artboard whose frame contains the point', () => {
    expect(pickArtboard([a, b], { x: 1200, y: 100 }, 'a').id).toBe('b')
    expect(pickArtboard([a, b], { x: 10, y: 10 }, 'b').id).toBe('a')
  })
  it('falls back to the active artboard, then the first', () => {
    expect(pickArtboard([a, b], { x: 800, y: 2000 }, 'b').id).toBe('b')
    expect(pickArtboard([a, b], { x: 800, y: 2000 }, null).id).toBe('a')
  })
})
