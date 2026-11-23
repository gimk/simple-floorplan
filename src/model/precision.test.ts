import { describe, expect, it } from 'vitest'
import { roundTo } from './precision'

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
