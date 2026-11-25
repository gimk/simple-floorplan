// Drop-on-edit doc rule (docs/solver-plan.md).
// When the user edits a wall's position or thickness while the solver is On, drop that wall's
// recorded change, treat the user's new value as base (remove from baseNodes / baseThickness),
// and hold it with `by: 'edit'`. Also prunes entries for deleted walls/nodes.
// During silent drag previews (`isSilentEdit()` true), defers the drop-on-edit until `endDrag`
// settles (`solverSettleRule`), comparing the drag start doc with the settled doc so a drag that
// ends where it started drops nothing. Solver writes (`next.solver !== prev.solver`) are ignored.
import { isSilentEdit, type DocRule, type SettleRule } from '../../model/store'
import type { PlanDoc, SolverHold } from '../../model/types'
import { userEditedWalls } from './engine'

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

function applySolverEdit(prev: PlanDoc, next: PlanDoc): PlanDoc {
  const s = next.solver
  if (!s?.enabled) return next
  if (next.solver !== prev.solver) return next

  const edited = userEditedWalls(prev, next)
  const hasGraph = next.nodes !== undefined && next.walls !== undefined
  const liveNodeIds = hasGraph ? new Set(next.nodes!.map((n) => n.id)) : null
  const liveWallIds = hasGraph ? new Set(next.walls!.map((w) => w.id)) : null
  const hasDeleted =
    liveNodeIds !== null
    && liveWallIds !== null
    && (
      s.changes.some((c) => !liveWallIds.has(c.wallId))
      || Object.keys(s.baseNodes).some((nid) => !liveNodeIds.has(nid))
      || Object.keys(s.baseThickness).some((wid) => !liveWallIds.has(wid))
      || s.revoked.some((h) => !liveWallIds.has(h.wallId))
    )

  if (!edited.position.length && !edited.thickness.length && !edited.movedNodes.length && !hasDeleted) return next

  const posSet = new Set(edited.position)
  const thickSet = new Set(edited.thickness)
  const movedNodeSet = new Set(edited.movedNodes)

  const changes = s.changes.filter(
    (c) =>
      (!liveWallIds || liveWallIds.has(c.wallId))
      && !(c.kind === 'position' && posSet.has(c.wallId))
      && !(c.kind === 'thickness' && thickSet.has(c.wallId)),
  )

  const baseNodes: Record<string, { x: number; y: number }> = {}
  for (const [nid, pt] of Object.entries(s.baseNodes)) {
    if ((!liveNodeIds || liveNodeIds.has(nid)) && !movedNodeSet.has(nid)) baseNodes[nid] = pt
  }

  const baseThickness: Record<string, number> = {}
  for (const [wid, cm] of Object.entries(s.baseThickness)) {
    if ((!liveWallIds || liveWallIds.has(wid)) && !thickSet.has(wid)) baseThickness[wid] = cm
  }

  const revoked: SolverHold[] = liveWallIds ? s.revoked.filter((h) => liveWallIds.has(h.wallId)) : [...s.revoked]
  const addEditHold = (kind: 'position' | 'thickness', wallId: string) => {
    if (liveWallIds && !liveWallIds.has(wallId)) return
    const idx = revoked.findIndex((h) => h.kind === kind && h.wallId === wallId)
    if (idx >= 0) revoked[idx] = { kind, wallId, by: 'edit' }
    else revoked.push({ kind, wallId, by: 'edit' })
  }
  for (const wallId of edited.position) addEditHold('position', wallId)
  for (const wallId of edited.thickness) addEditHold('thickness', wallId)

  const out: PlanDoc = {
    ...next,
    solver: {
      ...s,
      changes,
      revoked,
      baseNodes,
      baseThickness,
    },
  }
  editRuledDocs.add(out)
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
  return applySolverEdit(prev, next)
}

/** Settle rule paired with `solverEditRule`: applies drop-on-edit at `endDrag` against the drag start doc. */
export const solverSettleRule: SettleRule = (doc) => {
  const start = dragStartDoc
  dragStartDoc = null
  if (!start) return doc
  return applySolverEdit(start, doc)
}
