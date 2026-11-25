// Automatic solver triggers (docs/solver-plan.md). Installed once from main.tsx.
//
// 1. Leaving Measuring Mode ('measure' -> 'edit') while solver is On: `solveNow()` (one undo step).
// 2. Edit ends in Edit Mode while solver is On: a local non-silent geometry or measurement edit
//    (or the end of a drag via `endDrag`) schedules a debounced (~300 ms) silent re-solve
//    (`solveNowSilent`), folding the re-solve into that edit's undo step so one Ctrl+Z undoes both.
//    Drag previews (`updateSilent`), remote updates (`updateSilent(..., { remote: true })`),
//    solver writes (`next.solver !== prev.solver`), `replace()`, and undo/redo never trigger it.
// 3. Solver setting changed while On and in Edit Mode (`solveKeepLocked`, `solveSurfaceMode`,
//    `solveSnapThickness`, `solveAngles`, `doc.apartment.precisionCm`): `solveNow()`.
//
// Never solves while `mode === 'measure'`.
import { addDocRule, addSettleRule, isSilentEdit, useDoc, useUi, type DocRule, type SettleRule } from '../../model/store'
import { solveNow, solveNowSilent } from './actions'
import { userEditedWalls } from './engine'
import { isEditRuledDoc } from './rule'

export const SOLVER_DEBOUNCE_MS = 300

let installed = false
let debounceTimer: ReturnType<typeof setTimeout> | null = null
/** True when a local geometry edit happened during a silent drag preview; settled on `endDrag`. */
let dragDirty = false
/** True when the current local update changed `doc.apartment.precisionCm`. */
let precisionDirty = false
/** Set by our local rules so `useDoc.subscribe` distinguishes local edits from undo/redo/remote/replace. */
let sawLocal = false

function cancelPendingSolve() {
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
}

function scheduleDebouncedSolve() {
  cancelPendingSolve()
  debounceTimer = setTimeout(() => {
    debounceTimer = null
    if (useUi.getState().mode === 'measure') return
    if (!useDoc.getState().doc.solver?.enabled) return
    solveNowSilent()
  }, SOLVER_DEBOUNCE_MS)
}

const hasGeometryEdit = (prev: Parameters<DocRule>[0], next: Parameters<DocRule>[1]): boolean => {
  if (isEditRuledDoc(next)) return true
  const edited = userEditedWalls(prev, next)
  return edited.position.length > 0 || edited.thickness.length > 0 || edited.movedNodes.length > 0
}

/**
 * Runs only on local edits (`update` and non-remote `updateSilent`).
 * Never runs on `remote: true`, `replace()`, or zundo `undo()`/`redo()`.
 */
const triggerDocRule: DocRule = (prev, next) => {
  sawLocal = true
  if (!next.solver?.enabled) return next
  if (useUi.getState().mode !== 'edit') return next

  // Ignore solver's own writes (new solver object not produced by solverEditRule).
  const isSolverWrite = next.solver !== prev.solver && !isEditRuledDoc(next)
  if (isSolverWrite) return next

  const silent = isSilentEdit()

  // Precision setting changed while On.
  if (!silent && prev.apartment?.precisionCm !== next.apartment?.precisionCm) {
    precisionDirty = true
    return next
  }

  const geomChanged = hasGeometryEdit(prev, next)
  const measChanged = next.measurements !== prev.measurements

  if (silent) {
    // Drag preview: defer until `endDrag` runs settle rules.
    if (geomChanged) dragDirty = true
    return next
  }

  // Non-silent local update: clear any stale drag flag and debounce re-solve if qualifying.
  dragDirty = false
  if (geomChanged || measChanged) {
    scheduleDebouncedSolve()
  }
  return next
}

/**
 * Runs at the end of a finished local edit (`update` and `endDrag`), never during drag previews,
 * remote updates, `replace()`, or undo/redo.
 */
const triggerSettleRule: SettleRule = (doc) => {
  sawLocal = true
  if (dragDirty) {
    dragDirty = false
    if (doc.solver?.enabled && useUi.getState().mode === 'edit') {
      scheduleDebouncedSolve()
    }
  }
  return doc
}

/** Install automatic solver triggers once at app start. */
export function installSolverTriggers() {
  if (installed) return
  installed = true

  addDocRule(triggerDocRule)
  addSettleRule(triggerSettleRule)

  useDoc.subscribe((s, prev) => {
    if (s.doc === prev.doc) return
    if (precisionDirty) {
      precisionDirty = false
      sawLocal = false
      cancelPendingSolve()
      if (useUi.getState().mode !== 'measure' && s.doc.solver?.enabled) {
        solveNow()
      }
      return
    }
    if (sawLocal) {
      sawLocal = false
      return
    }
    // External doc change (undo, redo, replace, remote): drop any stale pending solve.
    dragDirty = false
    cancelPendingSolve()
  })

  useUi.subscribe((s, prev) => {
    // Entering Measuring Mode: cancel any pending Edit Mode solve.
    if (s.mode === 'measure' && prev.mode !== 'measure') {
      cancelPendingSolve()
      dragDirty = false
      return
    }

    // Leaving Measuring Mode ('measure' -> 'edit') while On: solve in one visible undo step.
    if (prev.mode === 'measure' && s.mode === 'edit') {
      cancelPendingSolve()
      if (useDoc.getState().doc.solver?.enabled) {
        solveNow()
      }
      return
    }

    // Solver UI setting changed while On and not in Measuring Mode: solve now.
    const settingChanged =
      s.solveKeepLocked !== prev.solveKeepLocked
      || s.solveSurfaceMode !== prev.solveSurfaceMode
      || s.solveSnapThickness !== prev.solveSnapThickness
      || s.solveAngles !== prev.solveAngles
    if (settingChanged && s.mode !== 'measure' && useDoc.getState().doc.solver?.enabled) {
      cancelPendingSolve()
      solveNow()
    }
  })
}

/** Reset pending trigger timers/flags between unit tests. */
export function _resetSolverTriggersForTest() {
  cancelPendingSolve()
  dragDirty = false
  precisionDirty = false
  sawLocal = false
}
