// Store actions for traced walls (docs/walls-plan.md phase 6). Kept out of the card component so
// the card file only exports components (fast refresh).
import { useDoc, useUi } from '../../model/store'
import type { PlanDoc, TraceWall } from '../../model/types'
import { undoToast } from '../toast'
import { deleteTrace } from './traces'

/** One trace of the doc, or null when it is gone. */
export const traceById = (doc: Pick<PlanDoc, 'traces'>, id: string): TraceWall | null =>
  (doc.traces ?? []).find((t) => t.id === id) ?? null

/** Change the thickness or the type of one trace (one undo step). */
export const patchTrace = (id: string, patch: Partial<TraceWall>) =>
  useDoc.getState().update((d) => ({
    ...d,
    traces: (d.traces ?? []).map((t) => (t.id === id ? { ...t, ...patch } : t)),
  }))

/** Delete one trace, with an Undo button. */
export function removeTrace(id: string) {
  useUi.getState().select(null)
  useDoc.getState().update((d) => deleteTrace(d, id))
  undoToast('Traced wall deleted', () => useDoc.temporal.getState().undo())
}
