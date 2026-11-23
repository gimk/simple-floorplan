// Measurement source (docs/walls-plan.md phase 3a): how one on-site value was taken.
// The source sets the weight of the value in the solver: a laser value counts more
// than a tape value, and a value read on the architect plan counts less.
import type { MeasureSource } from './types'

/** Standard deviation of one measurement, in cm, per source. */
export const SOURCE_SIGMA_CM: Record<MeasureSource, number> = {
  laser: 0.3,
  tape: 1,
  plan: 3,
  other: 2,
}

/** Source used by the values that have none (old documents, quick typing). */
export const DEFAULT_MEASURE_SOURCE: MeasureSource = 'tape'

/** Short names shown in the pickers and in the segmented control. */
export const MEASURE_SOURCE_LABELS: Record<MeasureSource, string> = {
  tape: 'Tape',
  laser: 'Laser',
  plan: 'Plan',
  other: 'Other',
}

/** Every source, in the order the picker shows them. */
export const MEASURE_SOURCES: readonly MeasureSource[] = ['tape', 'laser', 'plan', 'other']

/** Standard deviation of one measurement in cm. A missing source counts as tape. */
export function sourceSigmaCm(source?: MeasureSource): number {
  return SOURCE_SIGMA_CM[source ?? DEFAULT_MEASURE_SOURCE]
}

/** One letter tag shown next to a measured value, or null when no tag is needed (tape, other). */
export function sourceTag(source?: MeasureSource): 'L' | 'P' | null {
  if (source === 'laser') return 'L'
  if (source === 'plan') return 'P'
  return null
}
