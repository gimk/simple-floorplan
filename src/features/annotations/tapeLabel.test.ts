// The text of a tape measure (round 2 suggestion 5): the label "traced 200,5" touched the tag of a
// room when it sat on the side of the line that the line direction happened to pick. It now sits
// ABOVE the line, px(8) away from it, turned with the line and always up.
import { describe, expect, it } from 'vitest'
import { tapeLabelPlacement } from './tapeLabel'

const GAP = 8

describe('tapeLabelPlacement', () => {
  it('puts the text above a horizontal tape, centred on its middle', () => {
    const at = tapeLabelPlacement({ x: 0, y: 100 }, { x: 200, y: 100 }, GAP)
    expect(at.p).toEqual({ x: 100, y: 100 - GAP })
    expect(at.angle).toBeCloseTo(0, 6)
  })

  it('goes above for a tape drawn right to left too', () => {
    // The same line read backwards: the text still goes up, and it reads left to right.
    const at = tapeLabelPlacement({ x: 200, y: 100 }, { x: 0, y: 100 }, GAP)
    expect(at.p).toEqual({ x: 100, y: 100 - GAP })
    expect(at.angle).toBeCloseTo(0, 6)
  })

  it('goes above a sloping tape, on the side of the screen up', () => {
    const up = tapeLabelPlacement({ x: 0, y: 0 }, { x: 100, y: -100 }, GAP)
    const down = tapeLabelPlacement({ x: 0, y: 0 }, { x: 100, y: 100 }, GAP)
    // y points down: a smaller y is higher on the screen, for both readings of the line. The two
    // lines share the middle (50, -50) and (50, 50), and the text goes 8 cm up from it.
    const d = GAP / Math.SQRT2
    expect(up.p.y).toBeCloseTo(-50 - d, 6)
    expect(down.p.y).toBeCloseTo(50 - d, 6)
    expect(up.p.x).toBeCloseTo(50 - d, 6)
    expect(down.p.x).toBeCloseTo(50 + d, 6)
  })

  it('keeps the text turned with the line and always up', () => {
    // A tape that goes down the screen: the angle folds into -90..90, so the text is not upside down.
    const vertical = tapeLabelPlacement({ x: 50, y: 0 }, { x: 50, y: 200 }, GAP)
    expect(vertical.angle).toBeCloseTo(90, 6)
    expect(vertical.p).toEqual({ x: 50 + GAP, y: 100 })
    const other = tapeLabelPlacement({ x: 50, y: 200 }, { x: 50, y: 0 }, GAP)
    expect(other.angle).toBeCloseTo(90, 6)
    expect(other.p.x).toBeCloseTo(50 + GAP, 6)
  })

  it('never puts the text on the line itself', () => {
    for (const [a, b] of [
      [{ x: 0, y: 0 }, { x: 300, y: 0 }],
      [{ x: 0, y: 0 }, { x: 0, y: 300 }],
      [{ x: 0, y: 0 }, { x: 200, y: 200 }],
    ] as const) {
      const at = tapeLabelPlacement(a, b, GAP)
      const d = Math.hypot(at.p.x - (a.x + b.x) / 2, at.p.y - (a.y + b.y) / 2)
      expect(d).toBeCloseTo(GAP, 6)
    }
  })

  it('handles a tape of no length without a NaN', () => {
    const at = tapeLabelPlacement({ x: 10, y: 10 }, { x: 10, y: 10 }, GAP)
    expect(Number.isFinite(at.p.x)).toBe(true)
    expect(Number.isFinite(at.p.y)).toBe(true)
    expect(Number.isFinite(at.angle)).toBe(true)
  })
})
