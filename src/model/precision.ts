// Precision of the plan: the smallest step (cm) that the solvers write for corners and thicknesses.
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
