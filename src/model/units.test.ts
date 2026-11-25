// Units of the lengths on the plan (docs/measurements-plan.md section 5).
import { describe, expect, it } from 'vitest'
import { fmtCm } from './geometry'
import { fitsPlan, measuredBreakdown, measuredText, measuredTextIn } from './precision'
import { DEFAULT_UNITS, fmtLen, unitDecimals, unitSuffix, unitValue, type LengthUnits } from './units'

const cm = (decimals: number): LengthUnits => ({ unit: 'cm', decimals })
const m = (decimals: number): LengthUnits => ({ unit: 'm', decimals })
const mm = (decimals: number): LengthUnits => ({ unit: 'mm', decimals })

describe('unitSuffix and unitDecimals', () => {
  it('names the unit', () => {
    expect(unitSuffix(cm(1))).toBe('cm')
    expect(unitSuffix(m(2))).toBe('m')
    expect(unitSuffix(mm(0))).toBe('mm')
  })

  it('falls back to the default units when there is no setting', () => {
    expect(unitSuffix(undefined)).toBe('cm')
    expect(unitDecimals(undefined)).toBe(1)
  })

  it('keeps 0 to 3 decimals', () => {
    expect(unitDecimals(cm(0))).toBe(0)
    expect(unitDecimals(cm(3))).toBe(3)
    expect(unitDecimals(cm(7))).toBe(3)
    expect(unitDecimals(cm(-2))).toBe(0)
  })

  it('gives metres at least 2 decimals', () => {
    expect(unitDecimals(m(0))).toBe(2)
    expect(unitDecimals(m(1))).toBe(2)
    expect(unitDecimals(m(2))).toBe(2)
    expect(unitDecimals(m(3))).toBe(3)
  })
})

describe('unitValue', () => {
  it('converts cm to the unit', () => {
    expect(unitValue(412.5, cm(1))).toBe(412.5)
    expect(unitValue(412.5, m(2))).toBe(4.125)
    expect(unitValue(412.5, mm(0))).toBe(4125)
  })

  it('gives 0 for a value that is not a number', () => {
    expect(unitValue(Number.NaN, cm(1))).toBe(0)
    expect(unitValue(Number.POSITIVE_INFINITY, m(2))).toBe(0)
  })
})

describe('fmtLen: centimetres', () => {
  it('writes the default units exactly as fmtCm does', () => {
    for (const v of [0, 1, 12, 412, 412.5, 412.55, 999.94, -412.5, -0.04]) {
      expect(fmtLen(v, DEFAULT_UNITS)).toBe(fmtCm(v))
    }
  })

  it('drops the trailing zeros', () => {
    expect(fmtLen(412.5, cm(1))).toBe('412,5')
    expect(fmtLen(412, cm(1))).toBe('412')
    expect(fmtLen(412, cm(3))).toBe('412')
    expect(fmtLen(412.5, cm(0))).toBe('413')
  })

  it('rounds to the number of decimals', () => {
    expect(fmtLen(412.44, cm(1))).toBe('412,4')
    expect(fmtLen(412.46, cm(1))).toBe('412,5')
    expect(fmtLen(412.345, cm(2))).toBe('412,35')
    expect(fmtLen(412.345, cm(0))).toBe('412')
  })
})

describe('fmtLen: millimetres', () => {
  it('multiplies by 10 and drops the trailing zeros', () => {
    expect(fmtLen(412, mm(1))).toBe('4120')
    expect(fmtLen(412.5, mm(1))).toBe('4125')
    expect(fmtLen(412.55, mm(1))).toBe('4125,5')
    expect(fmtLen(412.55, mm(0))).toBe('4126')
    expect(fmtLen(412.555, mm(2))).toBe('4125,55')
  })
})

describe('fmtLen: metres', () => {
  it('divides by 100 and keeps two decimals by default', () => {
    expect(fmtLen(412.5, m(2))).toBe('4,13')
    expect(fmtLen(412, m(2))).toBe('4,12')
    // Metres KEEP the trailing zeros, unlike cm and mm.
    expect(fmtLen(410, m(2))).toBe('4,10')
    expect(fmtLen(1420, m(2))).toBe('14,20')
    // decimals < 2 for m: the value still reads with 2 decimals.
    expect(fmtLen(410, m(0))).toBe('4,10')
    expect(fmtLen(410, m(1))).toBe('4,10')
    expect(fmtLen(412, m(0))).toBe('4,12')
  })

  it('takes 3 decimals when the user asks for them', () => {
    expect(fmtLen(412.5, m(3))).toBe('4,125')
    expect(fmtLen(412, m(3))).toBe('4,120')
  })
})

describe('fmtLen: zero and negative values', () => {
  it('writes 0, never -0', () => {
    expect(fmtLen(0, cm(1))).toBe('0')
    expect(fmtLen(0, m(2))).toBe('0,00')
    expect(fmtLen(0, mm(0))).toBe('0')
    expect(fmtLen(-0.04, cm(1))).toBe('0')
    expect(fmtLen(-0.04, mm(0))).toBe('0')
  })

  it('keeps the sign of a negative length', () => {
    expect(fmtLen(-412.5, cm(1))).toBe('-412,5')
    expect(fmtLen(-412.5, mm(0))).toBe('-4125')
    expect(fmtLen(-1234.56, cm(0))).toBe('-1235')
    // A negative half rounds toward +Infinity, exactly as fmtCm does: -4,125 -> "-4,12".
    expect(fmtLen(-412.5, m(2))).toBe('-4,12')
    expect(fmtCm(-412.55)).toBe(fmtLen(-412.55, DEFAULT_UNITS))
  })
})

describe('fitsPlan', () => {
  it('accepts a measured value within the step of the plan', () => {
    // The tolerance is the step of the plan: 0.5 cm here, so 412 fits 412,5 but not 410,7.
    expect(fitsPlan(412, 412.5, 0.5)).toBe(true)
    expect(fitsPlan(412, 410.7, 0.5)).toBe(false)
    expect(fitsPlan(412, 412, 0.5)).toBe(true)
    // Float noise does not break an exact fit (the 1e-9 of the rule).
    expect(fitsPlan(0.1 + 0.2, 0.3, 0.5)).toBe(true)
  })

  it('never goes under 1 mm, and uses 1 mm when rounding is off', () => {
    // Step 0 = rounding off: the tolerance is 1 mm.
    expect(fitsPlan(412, 412.1, 0)).toBe(true)
    expect(fitsPlan(412, 412.2, 0)).toBe(false)
    // A step under 0.1 cm does not make the rule stricter than 1 mm.
    expect(fitsPlan(412, 412.09, 0.01)).toBe(true)
    expect(fitsPlan(412, 412.2, 0.1)).toBe(false)
  })
})

describe('measuredTextIn', () => {
  it('gives exactly measuredText with the default units', () => {
    for (const [measured, solved, step] of [[412, 412, 0.5], [412, 410.7, 0.5], [412, 412.2, 0.1], [0, 3, 0]]) {
      expect(measuredTextIn(measured, solved, step, DEFAULT_UNITS)).toBe(measuredText(measured, solved, step))
    }
  })

  it('writes ONE value: ✓ when the plan fits it, ~ when it does not', () => {
    expect(measuredTextIn(412, 412, 0.5, m(2))).toBe('✓ 4,12')
    expect(measuredTextIn(412, 412.4, 0.5, m(2))).toBe('✓ 4,12')
    expect(measuredTextIn(412, 410.7, 0.5, m(2))).toBe('~4,12')
    expect(measuredTextIn(412, 410.7, 0.5, mm(0))).toBe('~4120')
    expect(measuredTextIn(412, 412, 0.5, cm(0))).toBe('✓ 412')
    // Never the solved length on the plan: it goes in the breakdown.
    expect(measuredTextIn(412, 410.7, 0.5, m(2))).not.toContain('4,11')
  })
})

describe('measuredBreakdown', () => {
  it('writes the measured value, the plan and the difference, in the units of the plan', () => {
    expect(measuredBreakdown(412, 410.5, cm(1))).toBe('Measured 412 · Plan 410,5 · Δ -1,5')
    expect(measuredBreakdown(412, 410.5, m(2))).toBe('Measured 4,12 · Plan 4,11 · Δ -0,02')
  })

  it('keeps the sign of the difference, and has none when the two agree', () => {
    expect(measuredBreakdown(410, 412, cm(1))).toBe('Measured 410 · Plan 412 · Δ +2')
    expect(measuredBreakdown(412, 412, cm(1))).toBe('Measured 412 · Plan 412 · Δ 0')
  })

  it('reads no -0 on a difference that rounds to zero', () => {
    expect(measuredBreakdown(412, 412.04, cm(1))).toBe('Measured 412 · Plan 412 · Δ +0')
  })
})
