// Measurements control the plan (local edits only; changes from the server are not touched):
//  0. In a v2 document the walls are the source (docs/walls-plan.md phase 5c): the sync rule keeps
//     the room polygons and the wall graph in step before the other rules read the plan.
//  1. When a room outline changes (cutout, slice, merge, corner added or removed), on-site
//     values move with their wall (model/relabel.ts). In a v2 document each value follows its
//     stored target instead (model/v2/relabelV2.ts). A split or removed wall loses its value,
//     and a toast says which walls to measure again.
//  2. When a wall value is entered, its room is solved again from all its values ("Apply
//     measured lengths" for that room), a short time after the typing stops.
import { graphRule } from '../../model/graphRule'
import { appendOld, REASON_WORDS, renameOldCode, renamedCodes } from '../../model/oldMeasurements'
import { relabelMeasurements } from '../../model/relabel'
import { relabelByTarget } from '../../model/v2/relabelV2'
import { v2SyncRule } from '../../model/v2/syncRule'
import { attachTargets, isV2Doc } from '../../model/v2/targets'
import { removedWallValues } from '../../model/wallValues'
import { addDocRule, nowIso, useDoc, type DocRule } from '../../model/store'
import type { PlanDoc } from '../../model/types'
import { toast } from '../toast'
import { applyMeasuredNear, describeReport } from './apply'

/** Toast text for the walls that must be measured again, e.g. 'Measure again: SE-2 (wall split). The old value is kept in the room card.' */
export function measureAgainText(dropped: { label: string; reason: 'wall-split' | 'wall-removed' | 'room-deleted' }[]): string {
  const groups = new Map<string, string[]>()
  for (const d of dropped) groups.set(REASON_WORDS[d.reason], [...(groups.get(REASON_WORDS[d.reason]) ?? []), d.label])
  const parts = [...groups].map(([reason, labels]) => `${labels.join(', ')} (${reason})`)
  return `Measure again: ${parts.join('; ')}. The old value${dropped.length > 1 ? 's are' : ' is'} kept in the room card.`
}

/** In a v2 document every value that can hold a target gets one (a height cannot). */
const withTargets = (on: boolean, d: PlanDoc) => (on ? attachTargets(d) : d)

const relabelRule: DocRule = (prev, next) => {
  const now = nowIso()
  // A renamed room: its old values follow the new code.
  let old = next.oldMeasurements ?? prev.oldMeasurements
  for (const r of renamedCodes(prev, next)) old = renameOldCode(old, r.from, r.to)
  // A v2 document relabels by stored target (stable wall ids); a v1 document by its corner ids.
  const byTarget = isV2Doc(next)
  const res = byTarget
    ? relabelByTarget(attachTargets(prev), next, now)
    : relabelMeasurements(prev, next, now)
  if (!res) return withTargets(byTarget, old === next.oldMeasurements ? next : { ...next, oldMeasurements: old })
  // The values that leave `measurements` are kept in `oldMeasurements`, never lost.
  old = appendOld(old, res.droppedValues, now)
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
  const out: PlanDoc = { ...next, measurements: res.measurements, ...(old ? { oldMeasurements: old } : {}) }
  return withTargets(byTarget, out)
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
}

// ---------- auto-apply after a wall value is entered ----------

const AUTO_APPLY_MS = 800
const timers = new Map<string, ReturnType<typeof setTimeout>>()

/** Wall label "CODE-n" -> room code, or null for a diagonal, a height or any other label. */
export function wallLabelRoom(label: string): string | null {
  const m = /^(.+)-(\d+)$/.exec(label)
  return m ? m[1] : null
}

/** Solve the room again from its values now (one undo step). Returns the report text. */
export function applyRoomNow(code: string): string | null {
  const doc = useDoc.getState().doc
  const room = doc.rooms.find((r) => r.code === code)
  if (!room) return null
  const r = applyMeasuredNear(doc, room.id)
  if (r.doc !== doc) useDoc.getState().update(() => r.doc)
  return r.reports[0].mode === 'none' ? null : describeReport(r.reports[0])
}

/**
 * A wall value of room `code` changed: solve the room again once the typing stops.
 * Every key press restarts the wait, so "2", "29", "296" do not each move the plan.
 */
export function scheduleAutoApply(code: string) {
  const t = timers.get(code)
  if (t) clearTimeout(t)
  timers.set(code, setTimeout(() => { timers.delete(code); applyRoomNow(code) }, AUTO_APPLY_MS))
}

/** Run a waiting auto-apply now (field blur, leaving the room). */
export function flushAutoApply(code?: string) {
  for (const [c, t] of [...timers]) {
    if (code && c !== code) continue
    clearTimeout(t); timers.delete(c); applyRoomNow(c)
  }
}
