// Small side-effect helpers for Measuring Mode (store writes, DOM navigation).
import { nowIso, useDoc } from '../../model/store'
import { scheduleAutoApply, wallLabelRoom } from '../rooms/measureRules'

export const inputId = (label: string) => `m-${label}`

/**
 * Save one on-site value. Not an undo step. Empty (null) removes it.
 * A wall value also solves its room again shortly after the typing stops (the plan follows
 * the measurements; that shape change is one undo step).
 */
export function setMeasurement(label: string, cm: number | null) {
  useDoc.getState().updateSilent((d) => {
    const measurements = { ...d.measurements }
    if (cm == null) delete measurements[label]
    else measurements[label] = { label, actualCm: cm, updatedAt: nowIso() }
    return { ...d, measurements }
  })
  const code = wallLabelRoom(label)
  if (cm != null && code && useDoc.getState().doc.rooms.some((r) => r.code === code)) scheduleAutoApply(code)
}

export const goRoom = (code: string) => {
  document.getElementById(`room-${code}`)?.scrollIntoView({ block: 'start' })
  try { history.replaceState(null, '', `#room-${code}`) } catch { /* ignore */ }
}
