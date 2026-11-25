// The greedy overlap pass of the outside dimension texts.
import { describe, expect, it } from 'vitest'
import type { OutsideDimRun } from '../outside/outsideDims'
import { outsideDimTextBoxes, outsideHiddenTexts, type OutsideTextInput } from './outsideTextBoxes'

/** A run of one segment from a to b, normal away from the building. */
const run = (key: string, a: { x: number; y: number }, b: { x: number; y: number }, normal: { x: number; y: number }): OutsideDimRun => {
  const len = Math.hypot(b.x - a.x, b.y - a.y)
  const dir = { x: (b.x - a.x) / len, y: (b.y - a.y) / len }
  return {
    key, a, b, dir, normal, points: [a, b], overallCm: len,
    segments: [{ a, b, lengthCm: len, label: null, measuredCm: null }],
  } as OutsideDimRun
}
const input = (zoom: number): OutsideTextInput => ({
  zoom,
  segmentText: (seg) => String(Math.round(seg.lengthCm)),
  overallText: (r) => String(Math.round(r.overallCm)),
})

describe('outsideHiddenTexts', () => {
  it('hides the shorter text when two texts of two rows collide', () => {
    // Two rows of the same line, one over the other: their texts land on the same place.
    const long = run('A', { x: 0, y: 0 }, { x: 300, y: 0 }, { x: 0, y: -1 })
    const short = run('B', { x: 20, y: 0 }, { x: 280, y: 0 }, { x: 0, y: -1 })
    const hidden = outsideHiddenTexts([short, long], input(1))
    expect([...hidden]).toEqual(['B:overall'])
    expect(outsideDimTextBoxes([short, long], input(1))).toHaveLength(1)
  })

  it('hides nothing when no text collides', () => {
    const top = run('A', { x: 0, y: 0 }, { x: 300, y: 0 }, { x: 0, y: -1 })
    const bottom = run('B', { x: 0, y: 200 }, { x: 300, y: 200 }, { x: 0, y: 1 })
    expect(outsideHiddenTexts([top, bottom], input(1)).size).toBe(0)
    expect(outsideDimTextBoxes([top, bottom], input(1))).toHaveLength(2)
  })
})
