// Drop-on-edit doc rule (docs/solver-plan.md).
// When the user edits a wall's position or thickness while the solver is On, drop that wall's
// recorded change, treat the user's new value as base (remove from baseNodes / baseThickness),
// and hold it with `by: 'edit'`. Also prunes entries for deleted walls/nodes.
// During silent drag previews (`isSilentEdit()` true), defers the drop-on-edit until `endDrag`
// settles (`solverSettleRule`), comparing the drag start doc with the settled doc so a drag that
// ends where it started drops nothing. Solver writes (`next.solver !== prev.solver`) are ignored.
import { isSilentEdit, type DocRule, type SettleRule } from '../../model/store'
import type { PlanDoc } from '../../model/types'
import { applySolverEdit } from './engine'

/** Docs whose `solver` field was updated by `solverEditRule` or `solverSettleRule` (a user edit, not a solver run). */
const editRuledDocs = new WeakSet<PlanDoc>()

/** True when `doc` is the direct output of `solverEditRule` / `solverSettleRule` (so triggers know it was a user edit). */
export const isEditRuledDoc = (doc: PlanDoc) => editRuledDocs.has(doc)

/** Doc snapshot captured at the start of a silent drag preview; compared on settle. */
let dragStartDoc: PlanDoc | null = null

/** Clear any pending drag start snapshot (called on external doc changes / test resets). */
export const clearSolverDragStart = () => {
  dragStartDoc = null
}

function runSolverEdit(prev: PlanDoc, next: PlanDoc): PlanDoc {
  const out = applySolverEdit(prev, next)
  if (out !== next) editRuledDocs.add(out)
  return out
}

export const solverEditRule: DocRule = (prev, next) => {
  const s = next.solver
  if (!s?.enabled || next.solver !== prev.solver) {
    dragStartDoc = null
    return next
  }
  if (isSilentEdit()) {
    if (dragStartDoc === null && (next.nodes !== prev.nodes || next.walls !== prev.walls)) {
      dragStartDoc = prev
    }
    return next
  }
  dragStartDoc = null
  return runSolverEdit(prev, next)
}

/** Settle rule paired with `solverEditRule`: applies drop-on-edit at `endDrag` against the drag start doc. */
export const solverSettleRule: SettleRule = (doc) => {
  const start = dragStartDoc
  dragStartDoc = null
  if (!start) return doc
  return runSolverEdit(start, doc)
}
