// Bottom of Measuring Mode (docs/solver-plan.md, round 3): apply every measured value to the plan.
// This is the old Solve tab button "Apply measured lengths to all rooms". One undo step.
// When the solver is On it still runs when the user leaves Measuring Mode.
//
// It applies the wall lengths (applyMeasuredAll) AND the measured wall thicknesses (labels CODE-n-T):
// a thickness typed in Measuring Mode is a value only (see actions.ts setMeasurement), so this button
// is the one that puts it on the plan.
import { useDoc } from '../../model/store'
import { parseThicknessLabel } from '../../model/survey'
import type { PlanDoc } from '../../model/types'
import { toast } from '../toast'
import { applyMeasuredAll } from '../rooms/apply'
import { applyThicknessLabel } from '../rooms/thickness'

/** Label of the button. */
export const APPLY_LABEL = 'Apply measured values to the plan'
/** Muted line under the button. */
export const APPLY_HINT = 'Moves the walls of each measured room to match its values, and sets the measured wall thicknesses. Undo with Ctrl+Z.'
/** Toast when nothing could be applied. */
export const APPLY_NONE_TEXT = 'No measured value to apply yet.'

/** True when at least one value has a length to apply (the button is greyed out otherwise). */
export const hasMeasuredValue = (doc: Pick<PlanDoc, 'measurements'>): boolean =>
  Object.values(doc.measurements).some((m) => (m?.actualCm ?? 0) > 0)

/** Every measured wall thickness of the plan (labels CODE-n-T), with its value in cm. */
export function measuredThicknesses(doc: Pick<PlanDoc, 'measurements'>): { label: string; cm: number }[] {
  return Object.values(doc.measurements)
    .filter((m) => m != null && (m.actualCm ?? 0) > 0 && parseThicknessLabel(m.label) != null)
    .map((m) => ({ label: m.label, cm: m.actualCm as number }))
}

/** The document with every measured thickness put on its wall (the walls it can find). */
function withThicknesses(doc: PlanDoc, values: { label: string; cm: number }[]): { doc: PlanDoc; applied: number } {
  let next = doc
  let applied = 0
  for (const v of values) {
    const after = applyThicknessLabel(next, v.label, v.cm)
    if (after !== next) applied++
    next = after
  }
  return { doc: next, applied }
}

/**
 * Apply the measured values of every room to the plan, as ONE undo step, and return the toast text.
 * The rooms and the wall thicknesses that the apply changed are counted; a value that changes nothing
 * is not.
 */
export function applyMeasuredToPlan(): string {
  const doc = useDoc.getState().doc
  const r = applyMeasuredAll(doc)
  const thick = withThicknesses(r.doc, measuredThicknesses(doc))
  const next = thick.doc
  if (next !== doc) useDoc.getState().update(() => next)
  const n = r.reports.filter((x) => x.mode !== 'none').length
  const parts: string[] = []
  if (n) parts.push(`${n} room${n === 1 ? '' : 's'}`)
  if (thick.applied) parts.push(`${thick.applied} wall thickness${thick.applied === 1 ? '' : 'es'}`)
  return parts.length ? `Applied to ${parts.join(' and ')}.` : APPLY_NONE_TEXT
}

/** Button "Apply measured values to the plan" and its muted hint line. */
export function ApplyMeasuredButton() {
  const doc = useDoc((s) => s.doc)
  const disabled = !hasMeasuredValue(doc)
  return (
    <div className="flex flex-col gap-1" data-apply-measured="">
      <button
        type="button"
        disabled={disabled}
        onClick={() => toast(applyMeasuredToPlan())}
        className="min-h-11 w-full rounded-lg border border-orange-600 px-4 text-sm font-semibold text-orange-700 hover:bg-orange-50 disabled:cursor-not-allowed disabled:border-slate-300 disabled:text-slate-400 disabled:hover:bg-transparent pointer-coarse:min-h-12 dark:border-orange-400 dark:text-orange-400 dark:hover:bg-orange-950 dark:disabled:border-slate-600 dark:disabled:text-slate-500"
      >
        {APPLY_LABEL}
      </button>
      <p className="text-xs text-slate-500 dark:text-slate-400">{APPLY_HINT}</p>
    </div>
  )
}
