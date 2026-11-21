// Small side-effect helpers for Measuring Mode (store writes, DOM navigation).
import { nowIso, useDoc } from '../../model/store'

export const inputId = (label: string) => `m-${label}`

/** Save one on-site value. Not an undo step. Empty (null) removes it. */
export function setMeasurement(label: string, cm: number | null) {
  useDoc.getState().updateSilent((d) => {
    const measurements = { ...d.measurements }
    if (cm == null) delete measurements[label]
    else measurements[label] = { label, actualCm: cm, updatedAt: nowIso() }
    return { ...d, measurements }
  })
}

export const goRoom = (code: string) => {
  document.getElementById(`room-${code}`)?.scrollIntoView({ block: 'start' })
  try { history.replaceState(null, '', `#room-${code}`) } catch { /* ignore */ }
}
