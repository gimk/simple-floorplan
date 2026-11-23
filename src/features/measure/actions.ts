// Small side-effect helpers for Measuring Mode (store writes, DOM navigation).
import { nowIso, useDoc } from '../../model/store'
import { parseThicknessLabel } from '../../model/survey'
import type { MeasureSource } from '../../model/types'
import { scheduleAutoApply, wallLabelRoom } from '../rooms/measureRules'
import { applyThicknessLabel } from '../rooms/thickness'

export const inputId = (label: string) => `m-${label}`

/**
 * Save one on-site value. Not an undo step. Empty (null) removes it.
 * `source` says how the value was measured (it sets its weight in the solver). With no
 * source the value has no `source` field, which counts as tape.
 * A wall value also solves its room again shortly after the typing stops (the plan follows
 * the measurements; that shape change is one undo step).
 */
export function setMeasurement(label: string, cm: number | null, source?: MeasureSource) {
  useDoc.getState().updateSilent((d) => {
    const measurements = { ...d.measurements }
    if (cm == null) delete measurements[label]
    else
      measurements[label] = {
        label,
        actualCm: cm,
        updatedAt: nowIso(),
        ...(source ? { source } : {}),
      }
    // A thickness (CODE-n-T) becomes the thickness of the wall, on both sides of it.
    return cm == null ? { ...d, measurements } : applyThicknessLabel({ ...d, measurements }, label, cm)
  })
  const code = wallLabelRoom(label) ?? parseThicknessLabel(label)?.code
  if (cm != null && code && useDoc.getState().doc.rooms.some((r) => r.code === code)) scheduleAutoApply(code)
}

export const goRoom = (code: string) => {
  document.getElementById(`room-${code}`)?.scrollIntoView({ block: 'start' })
  try { history.replaceState(null, '', `#room-${code}`) } catch { /* ignore */ }
}
