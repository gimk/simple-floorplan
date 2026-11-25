// State of the length texts of the plan (docs/solver-plan.md, "Purple everywhere"):
// green = measured, purple = solved by the solver, grey = estimated.
//
// The state of ONE text comes from `valueState()` (features/solver/lookup.ts), which resolves the
// survey label to a stored wall and reads `doc.solver.changes`. That resolution walks the rooms and
// their cycles, so it is NOT run once per text node of the plan on every frame: this file builds one
// memoized lookup per document (`makeValueStates`; the React hook is in useValueStates.ts, so the
// pure export can use the same lookup without the store).
import type { PlanDoc } from '../../../model/types'
import { valueState, type ValueState } from '../../solver/lookup'

/**
 * State of a length text, by survey label and measured value:
 * `'measured'`, `'solved'` or `'estimated'` (a label that names no single wall is estimated).
 */
export type ValueStates = (label: string | null | undefined, measuredCm?: number | null) => ValueState

/** One memoized lookup for a document (pure: no store, no React). */
export function makeValueStates(doc: PlanDoc): ValueStates {
  const cache = new Map<string, ValueState>()
  return (label, measuredCm) => {
    if (!label) return 'estimated'
    const key = `${label}\u0000${measuredCm ?? ''}`
    const hit = cache.get(key)
    if (hit) return hit
    const state = valueState(doc, label, measuredCm)
    cache.set(key, state)
    return state
  }
}
