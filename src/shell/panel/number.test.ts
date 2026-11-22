import { describe, expect, it } from 'vitest'
import { formatCmInput, formatDecimal, formatM2, parseDecimal } from './number'

describe('parseDecimal', () => {
  it('accepts a comma decimal separator', () => {
    expect(parseDecimal('4,25')).toBe(4.25)
  })

  it('accepts a dot decimal separator', () => {
    expect(parseDecimal('4.25')).toBe(4.25)
  })

  it('accepts an integer and zero', () => {
    expect(parseDecimal('412')).toBe(412)
    expect(parseDecimal('0')).toBe(0)
  })

  it('ignores spaces around the number', () => {
    expect(parseDecimal('  412,5 ')).toBe(412.5)
  })

  it('accepts a negative number', () => {
    expect(parseDecimal('-12,5')).toBe(-12.5)
  })

  it('returns null for empty and blank text', () => {
    expect(parseDecimal('')).toBeNull()
    expect(parseDecimal('   ')).toBeNull()
  })

  it('returns null for text', () => {
    expect(parseDecimal('abc')).toBeNull()
    expect(parseDecimal('12 cm')).toBeNull()
  })

  it('returns null for two decimal separators', () => {
    expect(parseDecimal('4,2,5')).toBeNull()
  })
})

describe('formatCmInput', () => {
  it('shows a comma decimal', () => {
    expect(formatCmInput(412.5)).toBe('412,5')
    expect(formatCmInput(412)).toBe('412')
  })

  it('shows nothing for a missing value', () => {
    expect(formatCmInput(null)).toBe('')
    expect(formatCmInput(undefined)).toBe('')
  })

  it('shows nothing for a non-finite value', () => {
    expect(formatCmInput(Number.NaN)).toBe('')
    expect(formatCmInput(Number.POSITIVE_INFINITY)).toBe('')
  })
})

describe('formatDecimal', () => {
  it('uses two decimals and a comma by default', () => {
    expect(formatDecimal(12)).toBe('12,00')
    expect(formatDecimal(3.456)).toBe('3,46')
  })

  it('keeps the sign and never prints a negative zero', () => {
    expect(formatDecimal(-3.5)).toBe('-3,50')
    expect(formatDecimal(-0.004)).toBe('0,00')
  })

  it('honours the digit count', () => {
    expect(formatDecimal(1.23456, 1)).toBe('1,2')
  })

  it('returns an empty string for a non-finite value', () => {
    expect(formatDecimal(Number.NaN)).toBe('')
  })
})

describe('formatM2', () => {
  it('always shows two decimals', () => {
    expect(formatM2(12.5)).toBe('12,50')
  })
})
