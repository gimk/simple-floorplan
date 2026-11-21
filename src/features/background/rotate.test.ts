import { describe, expect, it } from 'vitest'
import { normalizeDeg, parseCommaNumber, rotateBy } from './rotate'

describe('normalizeDeg', () => {
  it('keeps angles already in (-180, 180]', () => {
    expect(normalizeDeg(0)).toBe(0)
    expect(normalizeDeg(90)).toBe(90)
    expect(normalizeDeg(-90)).toBe(-90)
    expect(normalizeDeg(180)).toBe(180)
    expect(normalizeDeg(-10.5)).toBe(-10.5)
  })
  it('wraps larger angles', () => {
    expect(normalizeDeg(270)).toBe(-90)
    expect(normalizeDeg(-270)).toBe(90)
    expect(normalizeDeg(360)).toBe(0)
    expect(normalizeDeg(190)).toBe(-170)
    expect(normalizeDeg(-180)).toBe(180)
  })
  it('handles non-finite input', () => {
    expect(normalizeDeg(NaN)).toBe(0)
    expect(normalizeDeg(Infinity)).toBe(0)
  })
})

describe('rotateBy', () => {
  it('rotates by a quarter turn', () => {
    expect(rotateBy(0, 90)).toBe(90)
    expect(rotateBy(0, -90)).toBe(-90)
    expect(rotateBy(90, 90)).toBe(180)
    expect(rotateBy(180, 90)).toBe(-90)
    expect(rotateBy(-90, -90)).toBe(180)
  })
})

describe('parseCommaNumber', () => {
  it('accepts dot and comma decimals', () => {
    expect(parseCommaNumber('4.25')).toBe(4.25)
    expect(parseCommaNumber('4,25')).toBe(4.25)
    expect(parseCommaNumber('412')).toBe(412)
    expect(parseCommaNumber(' 412,5 ')).toBe(412.5)
  })
  it('returns NaN for non-numbers', () => {
    expect(Number.isNaN(parseCommaNumber('abc'))).toBe(true)
    expect(Number.isNaN(parseCommaNumber(''))).toBe(true)
  })
})
