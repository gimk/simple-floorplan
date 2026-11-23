import { describe, expect, it } from 'vitest'
import { roundTo, shownLength } from './precision'

describe('roundTo', () => {
  it('rounds to the step', () => {
    expect(roundTo(425.26, 0.5)).toBe(425.5)
    expect(roundTo(425.24, 0.5)).toBe(425)
    expect(roundTo(425.5, 1)).toBe(426)
    expect(roundTo(-0.2, 1)).toBe(0)
    expect(Object.is(roundTo(-0.2, 1), -0)).toBe(false)
  })
  it('does not change the value with no step', () => {
    expect(roundTo(425.26, 0)).toBe(425.26)
  })
})

describe('shownLength', () => {
  it('rounds to the plan step', () => {
    expect(shownLength(33.9, 0.5)).toBe(34)
    expect(shownLength(55.6, 0.5)).toBe(55.5)
    expect(shownLength(82.26, 1)).toBe(82)
  })
  it('shows 0.1 cm when rounding is off', () => {
    expect(shownLength(33.94, 0)).toBe(33.9)
  })
})
