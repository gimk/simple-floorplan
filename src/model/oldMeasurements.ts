// Old values: measured values that left `doc.measurements` (wall split or removed, room deleted).
// They are kept in `doc.oldMeasurements` and removed ONLY by an explicit user action.
// Pure, no store imports.
import type { OldMeasurement, PlanDoc } from './types'
import type { DroppedValue } from './relabel'

/** Same value, same room, same reason: one entry only (a redo must not double it). */
const sameEntry = (a: OldMeasurement, b: OldMeasurement) =>
  a.label === b.label && a.roomCode === b.roomCode && a.reason === b.reason &&
  a.actualCm === b.actualCm && a.updatedAt === b.updatedAt

/** `list` plus the dropped values. Returns the same array when nothing is new. */
export function appendOld(list: OldMeasurement[] | undefined, dropped: DroppedValue[], now: string): OldMeasurement[] | undefined {
  if (!dropped.length) return list
  const out = [...(list ?? [])]
  let added = false
  for (const d of dropped) {
    const entry: OldMeasurement = { ...d.measurement, roomCode: d.roomCode, reason: d.reason, droppedAt: now }
    if (out.some((e) => sameEntry(e, entry))) continue
    out.push(entry)
    added = true
  }
  return added ? out : list
}

/** A room code was renamed: its old values follow the new code (label prefix and roomCode). */
export function renameOldCode(list: OldMeasurement[] | undefined, from: string, to: string): OldMeasurement[] | undefined {
  if (!list?.some((e) => e.roomCode === from)) return list
  return list.map((e) => {
    if (e.roomCode !== from) return e
    const label = e.label.startsWith(from + '-') ? to + e.label.slice(from.length) : e.label
    return { ...e, label, roomCode: to }
  })
}

/** Room code renames between two docs (same room id, other code). */
export function renamedCodes(before: Pick<PlanDoc, 'rooms'>, after: Pick<PlanDoc, 'rooms'>): { from: string; to: string }[] {
  const out: { from: string; to: string }[] = []
  for (const r of before.rooms) {
    const a = after.rooms.find((x) => x.id === r.id)
    if (a && a.code !== r.code) out.push({ from: r.code, to: a.code })
  }
  return out
}

/** Delete one entry (explicit user action). */
export function removeOld(list: OldMeasurement[] | undefined, entry: OldMeasurement): OldMeasurement[] | undefined {
  return list?.filter((e) => !sameEntry(e, entry))
}

export const REASON_WORDS: Record<OldMeasurement['reason'], string> = {
  'wall-split': 'wall split',
  'wall-removed': 'wall removed',
  'room-deleted': 'room deleted',
}
