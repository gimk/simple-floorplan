// Measurements control the plan (local edits only; changes from the server are not touched):
//  1. When a room outline changes (cutout, slice, merge, corner added or removed), on-site
//     values move with their wall (model/relabel.ts). A split or removed wall loses its value,
//     and a toast says which walls to measure again.
//  2. When a wall value is entered, its room is solved again from all its values ("Apply
//     measured lengths" for that room), a short time after the typing stops.
import { relabelMeasurements } from '../../model/relabel'
import { addDocRule, nowIso, useDoc, type DocRule } from '../../model/store'
import { toast } from '../toast'
import { applyMeasuredNear, describeReport } from './apply'

const relabelRule: DocRule = (prev, next) => {
  const res = relabelMeasurements(prev, next, nowIso())
  if (!res) return next
  if (res.dropped.length) {
    const text = `Measure again: ${res.dropped.join(', ')} (wall split or removed).`
    // A toast is another store: show it after this update, not inside it.
    queueMicrotask(() => toast(text, { durationMs: 8000 }))
  }
  return { ...next, measurements: res.measurements }
}

/** Install the rules once, at app start (not in the read-only share viewer). */
export function installMeasureRules() {
  addDocRule(relabelRule)
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
