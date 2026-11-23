// Relabel the values of a v2 document by their TARGET (docs/walls-plan.md, phase 5c step 2). Pure.
//
// In a v1 document a value follows the two corner ids of its wall (model/relabel.ts). In a v2
// document a value can carry a target (`Measurement.target`), and that is stronger: the value goes
// to the label of its target in the new document. So a corner added before a measured wall moves
// the label ('EN-3' becomes 'EN-4') and the value follows; a wall that is cut or removed loses its
// target, and the value goes to the old values (same reasons as v1: wall-split, wall-removed,
// room-deleted). A value without a target (a height, an old label) stays under its label; it
// follows its room when the room code changed, and it goes to the old values when the room is gone.
//
// `before` must be the document BEFORE the edit (best: `attachTargets(before)`, so every value that
// can hold a target holds one). No store import.
import { labelRoomCode } from '../survey'
import type { MeasureTarget, Measurement, OldMeasurement, PlanDoc } from '../types'
import type { DroppedValue } from '../relabel'
import { isV2Doc, labelOfTarget } from './targets'

export type RelabelTargetsResult = {
  measurements: PlanDoc['measurements']
  /** Labels (before the change) whose value left `measurements`: the toast asks to measure again. */
  dropped: string[]
  /** Every value that left `measurements`, with its room code and the reason. Never lost. */
  droppedValues: DroppedValue[]
}

/** Room code of the room that a target belongs to ('' for a value of a stored wall). */
function roomCodeOf(before: PlanDoc, target: MeasureTarget): string {
  if (target.roomId === undefined) return ''
  return before.rooms.find((r) => r.id === target.roomId)?.code ?? ''
}

/** Why a target has no label any more. */
function gapReason(after: PlanDoc, target: MeasureTarget): OldMeasurement['reason'] {
  if (target.roomId !== undefined && !after.rooms.some((r) => r.id === target.roomId)) return 'room-deleted'
  const kind = target.kind ?? 'face'
  const wallThere = (after.walls ?? []).some((w) => w.id === target.wallId)
  // A face or a thickness of a wall that is still there lost its span: the wall was cut.
  return wallThere && (kind === 'face' || kind === 'thickness') ? 'wall-split' : 'wall-removed'
}

/**
 * New measurements for `after`, or null when nothing has to move (the outline did not change, the
 * target of every value still gives its label, or the edit wrote the values itself).
 * `now` is the updatedAt of the values that moved, so the server's last-write-wins keeps them.
 */
export function relabelByTarget(before: PlanDoc, after: PlanDoc, now: string): RelabelTargetsResult | null {
  // An edit that already wrote the measurements (a value entered, a room code renamed) is not
  // relabelled: same guard as the v1 rule.
  if (after.measurements !== before.measurements) return null
  if (!isV2Doc(after)) return null
  const m = before.measurements
  const labels = Object.keys(m)
  if (!labels.length) return null

  const out: PlanDoc['measurements'] = {}
  const dropped: string[] = []
  const droppedValues: DroppedValue[] = []
  /** Two values that land on one label: the other one is kept too. */
  const clashed: Measurement[] = []
  const put = (label: string, src: Measurement, moved: boolean) => {
    const v: Measurement = moved ? { ...src, label, updatedAt: now } : src
    const cur = out[label]
    if (!cur || cur.updatedAt <= v.updatedAt) {
      if (cur) clashed.push(cur)
      out[label] = v
    } else clashed.push(v)
  }
  // A room keeps its values when its code changed; a room that is gone has no new code.
  const newCodeOf = new Map(before.rooms.map((r) => [r.code, after.rooms.find((a) => a.id === r.id)?.code]))
  const drop = (label: string, roomCode: string, reason: OldMeasurement['reason'], v: Measurement) => {
    dropped.push(label)
    droppedValues.push({ roomCode, reason, measurement: v })
  }

  for (const label of labels) {
    const v = m[label]
    if (v.target) {
      const nl = labelOfTarget(after, v.target)
      if (nl) put(nl, v, nl !== label)
      else drop(label, roomCodeOf(before, v.target) || labelRoomCode(label), gapReason(after, v.target), v)
      continue
    }
    // No target: the label stays, and follows the code of its room when the room was renamed.
    const code = labelRoomCode(label)
    const newCode = newCodeOf.get(code)
    if (newCode && newCode !== code) put(newCode + label.slice(code.length), v, true)
    else if (!newCode && newCodeOf.has(code)) drop(label, code, 'room-deleted', v)
    else put(label, v, false)
  }

  for (const v of clashed) droppedValues.push({ roomCode: labelRoomCode(v.label), reason: 'wall-removed', measurement: v })

  const same = Object.keys(out).length === labels.length && labels.every((k) => m[k] === out[k])
  return same ? null : { measurements: out, dropped, droppedValues }
}
