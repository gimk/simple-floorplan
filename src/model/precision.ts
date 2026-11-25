// Precision of the plan: the smallest step (cm) that the solvers write for corners and thicknesses.
import { fmtCm } from './geometry'
import { fmtLen, type LengthUnits } from './units'
import type { PlanDoc, Vec } from './types'

/** Step when the plan has no setting. */
export const DEFAULT_PRECISION_CM = 0.5

/** Step of the plan in cm. 0 = the user turned rounding off. */
export const planPrecision = (doc: Pick<PlanDoc, 'apartment'>): number => doc.apartment?.precisionCm ?? DEFAULT_PRECISION_CM

/** Round to the step. Step 0 = no change. Removes -0 and float noise (424.99999 -> 425). */
export const roundTo = (v: number, step: number): number => {
  if (!(step > 0)) return v
  const r = Math.round(v / step) * step
  return Math.round(r * 1000) / 1000 + 0
}

export const roundVec = (p: Vec, step: number): Vec => ({ x: roundTo(p.x, step), y: roundTo(p.y, step) })

/** Length as shown to the user: rounded to the plan step (0.1 cm when rounding is off). */
export const shownLength = (v: number, step: number): number => roundTo(v, step > 0 ? step : 0.1)

/**
 * True when the plan agrees with the value measured on site: the two differ by no more than the
 * tolerance of the plan, which is its step and never under 1 mm (`stepCm` 0 = rounding off).
 */
export function fitsPlan(measuredCm: number, solvedCm: number, stepCm: number): boolean {
  const tol = Math.max(stepCm || 0.1, 0.1)
  return Math.abs(measuredCm - solvedCm) <= tol + 1e-9
}

/**
 * Dimension text of a measured wall: ONE value, the one measured on site. It starts with "✓" when
 * the plan agrees with it (`fitsPlan`) and with "~" when it does not; the solved length and the
 * difference are written on hover and on selection (`measuredBreakdown`), never on the plan.
 */
export function measuredText(measuredCm: number, solvedCm: number, stepCm: number): string {
  return fitsPlan(measuredCm, solvedCm, stepCm) ? `✓ ${fmtCm(measuredCm)}` : `~${fmtCm(measuredCm)}`
}

/**
 * `measuredText` in the units of the plan (docs/measurements-plan.md section 5): the same "✓ 412"
 * rule, written with `fmtLen`. The default units (cm, 1 decimal) give exactly `measuredText`.
 */
export function measuredTextIn(
  measuredCm: number,
  solvedCm: number,
  stepCm: number,
  units: LengthUnits,
): string {
  return fitsPlan(measuredCm, solvedCm, stepCm)
    ? `✓ ${fmtLen(measuredCm, units)}`
    : `~${fmtLen(measuredCm, units)}`
}

/**
 * The full value of a measured wall, for a hover or a selection: the value measured on site, the
 * length of the plan and the difference between them, e.g. "Measured 412 · Plan 410,5 · Δ -1,5".
 */
export function measuredBreakdown(measuredCm: number, solvedCm: number, units: LengthUnits): string {
  const diff = solvedCm - measuredCm
  const sign = diff > 0 ? '+' : diff < 0 ? '-' : ''
  return (
    'Measured ' + fmtLen(measuredCm, units) +
    ' · Plan ' + fmtLen(solvedCm, units) +
    ' · Δ ' + sign + fmtLen(Math.abs(diff), units)
  )
}
