// Store writes for tapes and pins. Edit Mode actions are undo steps; Measuring Mode ones are silent.
import { nowIso, uid, useDoc } from '../../model/store'
import type { Pin, PlanDoc, TapeMeasure } from '../../model/types'

type Fn = (d: PlanDoc) => PlanDoc
const run = (fn: Fn, silent: boolean) => (silent ? useDoc.getState().updateSilent(fn) : useDoc.getState().update(fn))

export const addTape = (t: Omit<TapeMeasure, 'id'>, silent = false) => {
  const id = uid('t')
  run((d) => ({ ...d, tapes: [...d.tapes, { ...t, id }] }), silent)
  return id
}
export const patchTape = (id: string, p: Partial<TapeMeasure>, silent = true) =>
  run((d) => ({ ...d, tapes: d.tapes.map((t) => (t.id === id ? { ...t, ...p } : t)) }), silent)
export const removeTape = (id: string, silent = false) =>
  run((d) => ({ ...d, tapes: d.tapes.filter((t) => t.id !== id) }), silent)

export const addPin = (p: Omit<Pin, 'id' | 'createdAt' | 'updatedAt' | 'photoKeys'> & { photoKeys?: string[] }, silent = false) => {
  const id = uid('p'), t = nowIso()
  run((d) => ({ ...d, pins: [...(d.pins ?? []), { photoKeys: [], ...p, id, createdAt: t, updatedAt: t }] }), silent)
  return id
}
export const patchPin = (id: string, p: Partial<Pin>, silent = true) =>
  run((d) => ({ ...d, pins: (d.pins ?? []).map((x) => (x.id === id ? { ...x, ...p, updatedAt: nowIso() } : x)) }), silent)
export const removePin = (id: string, silent = false) =>
  run((d) => ({ ...d, pins: (d.pins ?? []).filter((x) => x.id !== id) }), silent)
