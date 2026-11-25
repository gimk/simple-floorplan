// Store actions for the document-level solver (docs/solver-plan.md). One undo step each.
import { useDoc, useUi } from '../../model/store'
import type { SolverKey } from '../../model/types'
import { describeGlobal } from '../rooms/applyGlobal'
import { restoreChange, revokeChange, solverOff, solverOn, type SolverOptions } from './engine'

function currentSolverOptions(): SolverOptions {
  const ui = useUi.getState()
  return {
    keepLocked: ui.solveKeepLocked,
    surfaceMode: ui.solveSurfaceMode,
    snapThickness: ui.solveSnapThickness,
    angles: ui.solveAngles,
  }
}

/** Turn the solver On or Off (one undo step). Returns the solve report text when On, or null when Off. */
export function setSolverEnabled(on: boolean): string | null {
  if (!on) {
    useDoc.getState().update((d) => solverOff(d))
    return null
  }
  let reportText: string | null = null
  const opts = currentSolverOptions()
  useDoc.getState().update((d) => {
    const res = solverOn(d, opts)
    reportText = describeGlobal(res.report)
    return res.doc
  })
  return reportText
}

/** Re-solve the plan now if the solver is On (one undo step). No-op returning null when Off. */
export function solveNow(): string | null {
  if (!useDoc.getState().doc.solver?.enabled) return null
  let reportText: string | null = null
  const opts = currentSolverOptions()
  useDoc.getState().update((d) => {
    if (!d.solver?.enabled) return d
    const res = solverOn(d, opts)
    reportText = describeGlobal(res.report)
    return res.doc
  })
  return reportText
}

/**
 * Re-solve the plan silently (no new undo step) if the solver is On.
 * Used by Edit Mode settle triggers to fold the re-solve into the user edit's undo step.
 */
export function solveNowSilent(): string | null {
  if (!useDoc.getState().doc.solver?.enabled) return null
  let reportText: string | null = null
  const opts = currentSolverOptions()
  useDoc.getState().updateSilent((d) => {
    if (!d.solver?.enabled) return d
    const res = solverOn(d, opts)
    reportText = describeGlobal(res.report)
    return res.doc
  })
  return reportText
}

/** Hold a wall's position or thickness at its base value and re-solve if On (one undo step). */
export function revokeSolverChange(key: SolverKey): string | null {
  let reportText: string | null = null
  const opts = currentSolverOptions()
  useDoc.getState().update((d) => {
    const res = revokeChange(d, key, opts)
    reportText = res.report ? describeGlobal(res.report) : null
    return res.doc
  })
  return reportText
}

/** Remove a wall hold and re-solve if On (one undo step). */
export function restoreSolverChange(key: SolverKey): string | null {
  let reportText: string | null = null
  const opts = currentSolverOptions()
  useDoc.getState().update((d) => {
    const res = restoreChange(d, key, opts)
    reportText = res.report ? describeGlobal(res.report) : null
    return res.doc
  })
  return reportText
}
