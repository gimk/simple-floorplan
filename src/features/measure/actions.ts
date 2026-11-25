// Small side-effect helpers for Measuring Mode (store writes, DOM navigation).
import { nowIso, useDoc } from '../../model/store'
import { parseThicknessLabel } from '../../model/survey'
import type { MeasureSource, MeasureTarget } from '../../model/types'
import { splitRunTotal, type MeasureRow } from './logic'
import { scheduleAutoApply, wallLabelRoom } from '../rooms/measureRules'
import { applyThicknessLabel } from '../rooms/thickness'

export const inputId = (label: string) => `m-${label}`

/**
 * Save one on-site value. Not an undo step. Empty (null) removes it.
 * `source` says how the value was measured (it sets its weight in the solver). With no
 * source the value has no `source` field, which counts as tape.
 * `target` says what the value measures (phase 5c). With no target the value keeps the
 * target already stored for this label, so typing a new value never drops it.
 * A wall value also solves its room again shortly after the typing stops (the plan follows
 * the measurements; that shape change is one undo step).
 * `opts.undo`: the write is one undo step (a value typed on the plan, docs/measurements-plan.md 4).
 */
export function setMeasurement(
  label: string, cm: number | null, source?: MeasureSource, target?: MeasureTarget, opts: { undo?: boolean } = {},
) {
  // The schema needs actualCm > 0: a value of 0 (or less, or NaN) is never stored.
  if (cm != null && !(cm > 0)) return
  const write = opts.undo ? useDoc.getState().update : useDoc.getState().updateSilent
  write((d) => {
    const measurements = { ...d.measurements }
    if (cm == null) delete measurements[label]
    else {
      const kept = target ?? d.measurements[label]?.target
      measurements[label] = {
        label,
        actualCm: cm,
        updatedAt: nowIso(),
        ...(source ? { source } : {}),
        ...(kept ? { target: kept } : {}),
      }
    }
    // A thickness (CODE-n-T) becomes the thickness of the wall, on both sides of it.
    return cm == null ? { ...d, measurements } : applyThicknessLabel({ ...d, measurements }, label, cm)
  })
  const code = wallLabelRoom(label) ?? parseThicknessLabel(label)?.code
  if (cm != null && code && useDoc.getState().doc.rooms.some((r) => r.code === code)) scheduleAutoApply(code)
}

/**
 * Save the TOTAL length of a grouped wall row (one visible wall stored as 2+ faces). The solver reads
 * one value per face, so the total is split over the pieces and each piece is saved as its own value:
 * the pieces keep their proportions (measured value if the piece has one, else the planned length).
 * The sum of the pieces is exactly the total, so the solver sees the total as the sum.
 * Empty (null) removes the values of every piece.
 */
export function setRunMeasurement(
  row: Pick<MeasureRow, 'labels' | 'pieces'>, total: number | null, source?: MeasureSource,
  opts: { undo?: boolean } = {},
) {
  if (row.labels.length < 2 || total == null) {
    for (const l of row.labels) setMeasurement(l, total, source, undefined, opts)
    return
  }
  const cur = useDoc.getState().doc.measurements
  const bases = row.pieces.map((p) => cur[p.label]?.actualCm ?? p.plannedCm)
  const parts = splitRunTotal(total, bases)
  row.pieces.forEach((p, i) => setMeasurement(p.label, parts[i], source, undefined, opts))
}

export const goRoom = (code: string) => {
  document.getElementById(`room-${code}`)?.scrollIntoView({ block: 'start' })
  try { history.replaceState(null, '', `#room-${code}`) } catch { /* ignore */ }
}
