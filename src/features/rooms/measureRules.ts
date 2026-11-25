// Measurements control the plan (local edits only; changes from the server are not touched):
//  0. In a v2 document the walls are the source (docs/walls-plan.md phase 5c): the sync rule keeps
//     the room polygons and the wall graph in step before the other rules read the plan.
//  1. When a room outline changes (cutout, slice, merge, corner added or removed), on-site
//     values move with their wall (model/relabel.ts). In a v2 document each value follows its
//     stored target instead (model/v2/relabelV2.ts). A split or removed wall loses its value,
//     and a toast says which walls to measure again.
//  2. A value typed in Measuring Mode NEVER moves the plan (docs/solver-plan.md): the plan changes
//     only when the user applies the values, or when the solver runs on leaving Measuring Mode.
import { graphRule } from '../../model/graphRule'
import { appendOld, REASON_WORDS, renameOldCode, renamedCodes } from '../../model/oldMeasurements'
import { relabelMeasurements } from '../../model/relabel'
import { relabelByTarget, type RelabelTargetsResult } from '../../model/v2/relabelV2'
import { v2SyncRule } from '../../model/v2/syncRule'
import { attachTargets, isV2Doc } from '../../model/v2/targets'
import { removedWallValues } from '../../model/wallValues'
import { addDocRule, addSettleRule, isSilentEdit, nowIso, type DocRule, type SettleRule } from '../../model/store'
import type { OldMeasurement, PlanDoc } from '../../model/types'
import { toast } from '../toast'
import { solverEditRule } from '../solver/rule'

/** Toast text for the walls that must be measured again, e.g. 'Measure again: SE-2 (wall split). The old value is kept in the room card.' */
export function measureAgainText(dropped: { label: string; reason: 'wall-split' | 'wall-removed' | 'room-deleted' }[]): string {
  const groups = new Map<string, string[]>()
  for (const d of dropped) groups.set(REASON_WORDS[d.reason], [...(groups.get(REASON_WORDS[d.reason]) ?? []), d.label])
  const parts = [...groups].map(([reason, labels]) => `${labels.join(', ')} (${reason})`)
  return `Measure again: ${parts.join('; ')}. The old value${dropped.length > 1 ? 's are' : ' is'} kept in the room card.`
}

/** In a v2 document every value that can hold a target gets one (a height cannot). */
const withTargets = (on: boolean, d: PlanDoc) => (on ? attachTargets(d) : d)

/** Tell the user which walls to measure again (the values themselves are kept in the room card). */
function showRelabelToasts(res: RelabelTargetsResult) {
  const again = res.droppedValues.filter((d) => res.dropped.includes(d.measurement.label) && d.reason !== 'room-deleted')
  if (again.length) {
    const text = measureAgainText(again.map((d) => ({ label: d.measurement.label, reason: d.reason })))
    // A toast is another store: show it after this update, not inside it.
    queueMicrotask(() => toast(text, { durationMs: 8000 }))
  }
  const gone = res.droppedValues.filter((d) => d.reason === 'room-deleted')
  if (gone.length) {
    const code = gone[0].roomCode
    queueMicrotask(() => toast(`Room ${code} deleted. ${gone.length} measured value${gone.length > 1 ? 's are' : ' is'} kept under "Old values".`, { durationMs: 8000 }))
  }
}

/**
 * The document with the result of a relabel: the values that left `measurements` go to the old
 * values (never lost), and the user is told what to measure again when `toastIt` is true.
 */
function withRelabel(
  next: PlanDoc,
  old: OldMeasurement[] | undefined,
  res: RelabelTargetsResult,
  byTarget: boolean,
  now: string,
  toastIt: boolean,
): PlanDoc {
  const kept = appendOld(old, res.droppedValues, now)
  if (toastIt) showRelabelToasts(res)
  const out: PlanDoc = { ...next, measurements: res.measurements, ...(kept ? { oldMeasurements: kept } : {}) }
  return withTargets(byTarget, out)
}

const relabelRule: DocRule = (prev, next) => {
  const now = nowIso()
  // A renamed room: its old values follow the new code.
  let old = next.oldMeasurements ?? prev.oldMeasurements
  for (const r of renamedCodes(prev, next)) old = renameOldCode(old, r.from, r.to)
  // A v2 document relabels by stored target (stable wall ids); a v1 document by its corner ids.
  const byTarget = isV2Doc(next)
  // A move of a drag (updateSilent) is a preview: the values follow their faces, but a value whose
  // face has no label stays under its old label. Nothing leaves the plan and no toast fires until
  // the drag ends (settleRelabel), so a corner dragged back gives no false "Measure again"
  // (review finding 7).
  const preview = byTarget && isSilentEdit()
  const res = byTarget
    ? relabelByTarget(attachTargets(prev), next, now, { rawMeasurements: prev.measurements, preview })
    : relabelMeasurements(prev, next, now)
  if (!res) return withTargets(byTarget, old === next.oldMeasurements ? next : { ...next, oldMeasurements: old })
  return withRelabel(next, old, res, byTarget, now, !preview)
}

/**
 * The end of an edit (every `update`, and the end of a drag): in a v2 document the values follow
 * their target in the FINAL document, a value whose face is gone goes to the old values (one
 * "Measure again" toast), and a wall that was stretched gives its values the new span. The drag
 * preview above already moved the labels, so this step only finishes the job (findings 7 and 9).
 */
const settleRelabel: SettleRule = (doc) => {
  if (!isV2Doc(doc)) return doc
  const now = nowIso()
  const res = relabelByTarget(doc, doc, now)
  if (!res) return doc
  return withRelabel(doc, doc.oldMeasurements, res, true, now, true)
}

/**
 * Values of a stored wall leave `measurements` when the wall is gone (label 'W12-C' / 'W12-E').
 * They go to `doc.oldMeasurements` with the reason 'wall-removed' and no room code: the value of a
 * wall does not belong to one room. A wall that keeps its id keeps its values.
 */
const wallValueRule: DocRule = (prev, next) => {
  if (prev.walls === next.walls) return next
  // The graph rule runs before this one: `prev.walls` are the old ids, `next.walls` the new ones.
  const moved = removedWallValues(prev, next)
  if (!moved) return next
  const old = appendOld(next.oldMeasurements ?? prev.oldMeasurements, moved.dropped, nowIso())
  return { ...next, measurements: moved.measurements, ...(old ? { oldMeasurements: old } : {}) }
}

/** Install the rules once, at app start (not in the read-only share viewer). */
export function installMeasureRules() {
  // 1. A v2 document keeps its walls and its rooms in step (docs/walls-plan.md phase 5c): the
  //    polygons that a tool wrote go into the graph, and the polygons follow a wall edit. This rule
  //    runs FIRST, so every rule after it reads a plan whose rooms and walls agree.
  addDocRule(v2SyncRule)
  // 2. A v1 document: the stored wall graph follows the rooms (after the relabel rule: ids stay
  //    stable). In a v2 document graphRule is a no-op: there the walls are the source.
  addDocRule(graphRule)
  // 3. A changed outline (cutout, slice, merge, corner added or removed): values follow their wall,
  //    by target in a v2 document.
  addDocRule(relabelRule)
  // 4. The values of a wall that the new graph does not have any more (after the graph rule).
  addDocRule(wallValueRule)
  // 4b. A user edit of a wall while the solver is On drops its recorded change and holds its new value as base.
  addDocRule(solverEditRule)
  // 5. The end of an edit: a drag preview that is over (a value whose face is gone, a wall that was
  //    stretched). Runs after the rules, on every update and at the end of a drag.
  addSettleRule(settleRelabel)
}

/** Wall label "CODE-n" -> room code, or null for a diagonal, a height or any other label. */
export function wallLabelRoom(label: string): string | null {
  const m = /^(.+)-(\d+)$/.exec(label)
  return m ? m[1] : null
}
