// The layout of a dimension line (docs/measurements-plan.md, "COMMON DIMENSION STYLE").
import { describe, expect, it } from 'vitest'
import { alongWall, dimLine, dimLineOfSpan, DIM_STYLE, worldPx, type DimLineInput } from './dimLine'

/** A horizontal face from (0,0) to (400,0) with the room below it (y points down). */
const face = (over: Partial<DimLineInput> = {}): DimLineInput => ({
  start: { x: 0, y: 0 },
  end: { x: 400, y: 0 },
  normal: { x: 0, y: 1 },
  offsetCm: 10,
  zoom: 1,
  text: '400',
  ...over,
})

describe('dimLine', () => {
  it('draws the line parallel to the face, offset on the side of the normal', () => {
    const d = dimLine(face())!
    expect([d.x1, d.y1, d.x2, d.y2]).toEqual([0, 10, 400, 10])
    expect(d.outside).toBe(false)
  })

  it('puts the text on the side away from the wall, always up', () => {
    const d = dimLine(face())!
    // Middle of the line, then the text gap further from the wall.
    expect(d.text).toEqual({ x: 200, y: 10 + DIM_STYLE.textGap })
    expect(d.angle).toBe(0)
  })

  it('centres a 45 degree tick on each end of the line', () => {
    const d = dimLine(face())!
    const half = DIM_STYLE.tickLength / 2 / Math.SQRT2
    // The tick of (0,10) goes from the lower left to the upper right at 45 degrees.
    expect(d.ticks[0].x1).toBeCloseTo(-half, 6)
    expect(d.ticks[0].y1).toBeCloseTo(10 - half, 6)
    expect(d.ticks[0].x2).toBeCloseTo(half, 6)
    expect(d.ticks[0].y2).toBeCloseTo(10 + half, 6)
    expect(d.ticks[1].x1).toBeCloseTo(400 - half, 6)
    expect(d.ticks[1].y1).toBeCloseTo(10 - half, 6)
    expect(d.ticks[1].x2).toBeCloseTo(400 + half, 6)
    expect(d.ticks[1].y2).toBeCloseTo(10 + half, 6)
  })

  it('draws nothing when the face is shorter than 12 screen px', () => {
    expect(dimLine(face({ start: { x: 0, y: 0 }, end: { x: 440, y: 0 }, zoom: 0.02 }))).toBeNull()
    expect(dimLine(face({ start: { x: 0, y: 0 }, end: { x: 0, y: 0 } }))).toBeNull()
  })

  it('puts the text past the end of the line when it does not fit between the ticks', () => {
    const d = dimLine(face({ end: { x: 80, y: 0 }, text: '✓ 412 · 410,7' }))!
    expect(d.outside).toBe(true)
    // 13 characters at 6.2 px each, then the gap: the text starts after the end of the line.
    const width = 13 * DIM_STYLE.charWidth
    expect(d.text.x).toBeCloseTo(80 + DIM_STYLE.outsideGap + width / 2, 6)
    expect(d.text.y).toBeCloseTo(10 + DIM_STYLE.textGap, 6)
  })

  it('keeps a short text inside the line', () => {
    const d = dimLine(face({ end: { x: 80, y: 0 }, text: '80' }))!
    expect(d.outside).toBe(false)
    expect(d.text).toEqual({ x: 40, y: 10 + DIM_STYLE.textGap })
  })

  it('keeps the text up for both directions of the face', () => {
    // Right to left: the text does not turn upside down.
    expect(dimLine(face({ start: { x: 400, y: 0 }, end: { x: 0, y: 0 } }))!.angle).toBe(0)
    // Downward and upward walls: the angle stays in -90..90.
    expect(dimLine(face({ start: { x: 0, y: 0 }, end: { x: 0, y: 400 } }))!.angle).toBe(90)
    expect(dimLine(face({ start: { x: 0, y: 400 }, end: { x: 0, y: 0 } }))!.angle).toBe(-90)
    expect(dimLine(face({ start: { x: 0, y: 0 }, end: { x: 400, y: 400 } }))!.angle).toBe(45)
  })

  it('turns the offset and the text gap into screen sizes with the zoom', () => {
    const d = dimLine(face({ zoom: 0.5, offsetCm: worldPx(10, 0.5) }))!
    // 10 px and 7 px are twice as many cm at half the zoom.
    expect(d.y1).toBe(20)
    expect(d.text.y).toBe(20 + 14)
  })
})

describe('alongWall', () => {
  it('gives the point at a distance along the wall, clamped to it', () => {
    const a = { x: 0, y: 0 }, b = { x: 400, y: 0 }
    expect(alongWall(a, b, 100)).toEqual({ x: 100, y: 0 })
    expect(alongWall(a, b, -50)).toEqual({ x: 0, y: 0 })
    expect(alongWall(a, b, 900)).toEqual({ x: 400, y: 0 })
    // A wall with no length keeps its first node.
    expect(alongWall(a, a, 100)).toEqual(a)
  })
})

describe('dimLineOfSpan', () => {
  it('measures one span of a wall, off the centre line', () => {
    const d = dimLineOfSpan({ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 0, y: -1 }, { from: 100, to: 250 }, 22, 1, '150')!
    expect([d.x1, d.y1, d.x2, d.y2]).toEqual([100, -22, 250, -22])
    // The normal points up, so the text goes above the line (away from the wall).
    expect(d.text).toEqual({ x: 175, y: -22 - DIM_STYLE.textGap })
    expect(d.angle).toBe(0)
  })

  it('takes the span in any order and sketches nothing when the span is empty', () => {
    const a = { x: 0, y: 0 }, b = { x: 400, y: 0 }
    const d = dimLineOfSpan(a, b, { x: 0, y: 1 }, { from: 250, to: 100 }, 10, 1, '150')!
    expect([d.x1, d.x2]).toEqual([100, 250])
    expect(dimLineOfSpan(a, b, { x: 0, y: 1 }, { from: 100, to: 100 }, 10, 1, '0')).toBeNull()
  })
})
