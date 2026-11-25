// Drop-on-edit doc rule (docs/solver-plan.md).
// When the user edits a wall's position or thickness while the solver is On, drop that wall's
// recorded change, treat the user's new value as base (remove from baseNodes / baseThickness),
// and hold it with `by: 'edit'`. Solver writes (`next.solver !== prev.solver`) are ignored.
import type { DocRule } from '../../model/store'
import type { SolverHold } from '../../model/types'
import { userEditedWalls } from './engine'

export const solverEditRule: DocRule = (prev, next) => {
  const s = next.solver
  if (!s?.enabled) return next
  if (next.solver !== prev.solver) return next

  const edited = userEditedWalls(prev, next)
  if (!edited.position.length && !edited.thickness.length && !edited.movedNodes.length) return next

  const posSet = new Set(edited.position)
  const thickSet = new Set(edited.thickness)
  const movedNodeSet = new Set(edited.movedNodes)

  const changes = s.changes.filter(
    (c) => !(c.kind === 'position' && posSet.has(c.wallId)) && !(c.kind === 'thickness' && thickSet.has(c.wallId)),
  )

  const baseNodes: Record<string, { x: number; y: number }> = {}
  for (const [nid, pt] of Object.entries(s.baseNodes)) {
    if (!movedNodeSet.has(nid)) baseNodes[nid] = pt
  }

  const baseThickness: Record<string, number> = {}
  for (const [wid, cm] of Object.entries(s.baseThickness)) {
    if (!thickSet.has(wid)) baseThickness[wid] = cm
  }

  const revoked: SolverHold[] = [...s.revoked]
  const addEditHold = (kind: 'position' | 'thickness', wallId: string) => {
    const idx = revoked.findIndex((h) => h.kind === kind && h.wallId === wallId)
    if (idx >= 0) revoked[idx] = { kind, wallId, by: 'edit' }
    else revoked.push({ kind, wallId, by: 'edit' })
  }
  for (const wallId of edited.position) addEditHold('position', wallId)
  for (const wallId of edited.thickness) addEditHold('thickness', wallId)

  return {
    ...next,
    solver: {
      ...s,
      changes,
      revoked,
      baseNodes,
      baseThickness,
    },
  }
}
