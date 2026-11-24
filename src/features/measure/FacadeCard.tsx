// Facade section of Measuring Mode (docs/walls-plan.md phase 5b): the OUTSIDE face length of each
// facade wall, label 'W12-E'. You measure it on site from outside, corner to corner.
// A centre value ('W12-C') is not here: it is read on the architect plan, in the Inspect wall card.
import { useState } from 'react'
import { Check } from 'lucide-react'
import { fmtCm } from '../../model/geometry'
import { wallSurveyIds, type WallSurveyId } from '../../model/survey'
import { useUi } from '../../model/store'
import type { PlanDoc } from '../../model/types'
import { inputId, setMeasurement } from './actions'
import { discrepancy, fmtDiff } from './logic'
import { NumField } from './NumField'

/** Survey label under the pointer or focus: the canvas draws it, and the matching field gets a ring. */
const setHover = (label: string) => useUi.getState().set({ hoverLabel: label })
/** Clear the hover label, but only if it is still this label. */
const clearHover = (label: string) => {
  if (useUi.getState().hoverLabel === label) useUi.getState().set({ hoverLabel: null })
}

/** One facade field: label, measured value, and what the plan says when a value exists. */
function FacadeField({ doc, sid }: { doc: PlanDoc; sid: WallSurveyId }) {
  const [focused, setFocused] = useState<string | null>(null)
  const hoverLabel = useUi((s) => s.hoverLabel)
  const measureSource = useUi((s) => s.measureSource)
  const m = doc.measurements[sid.label]
  const verified = m != null
  const dis = verified ? discrepancy(sid.plannedCm, m.actualCm) : null
  return (
    <div
      className={`flex min-w-0 flex-col gap-1 rounded-lg ${hoverLabel === sid.label ? 'ring-2 ring-orange-500 ring-offset-2 ring-offset-white dark:ring-orange-400 dark:ring-offset-[#1b2128]' : ''}`}
      data-field-highlight={hoverLabel === sid.label ? sid.label : undefined}
      onPointerEnter={() => setHover(sid.label)}
      onPointerLeave={() => { if (focused !== sid.label) clearHover(sid.label) }}
    >
      <label
        htmlFor={inputId(sid.label)}
        className={`flex items-center justify-between gap-1 font-mono text-[13px] font-semibold ${verified ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-600 dark:text-slate-300'}`}
      >
        <span className="truncate" title={`${sid.label} · outside face`}>{sid.label}</span>
        {verified
          ? <span className="flex items-center gap-0.5 font-sans text-[11px] font-medium"><Check size={13} aria-hidden /> measured</span>
          : <span className="font-sans text-[11px] font-medium text-slate-500 dark:text-slate-400">outside face</span>}
      </label>
      <NumField
        id={inputId(sid.label)}
        value={m?.actualCm}
        placeholder={sid.plannedCm != null ? fmtCm(sid.plannedCm) : undefined}
        onValue={(n) => setMeasurement(sid.label, n, measureSource)}
        onFocus={() => { setFocused(sid.label); setHover(sid.label) }}
        onBlur={() => { setFocused((f) => (f === sid.label ? null : f)); clearHover(sid.label) }}
      />
      {verified && sid.plannedCm != null && dis && (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Measured {fmtCm(m.actualCm)} · Solved {fmtCm(sid.plannedCm)} ({fmtDiff(dis.diff)})
        </p>
      )}
    </div>
  )
}

/**
 * Collapsible "Facade" section: one field per facade wall. Open by default, so a click on a facade
 * wall on the canvas can move the focus to its field.
 */
export function FacadeSection({ doc }: { doc: PlanDoc }) {
  const walls = wallSurveyIds(doc).filter((s) => s.kind === 'outside')
  const done = walls.filter((s) => doc.measurements[s.label] != null).length
  if (!walls.length) return null
  return (
    <details open className="rounded-xl border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-[#1b2128]">
      <summary className="flex min-h-9 cursor-pointer items-center text-[13px] font-semibold text-slate-600 pointer-coarse:min-h-11 dark:text-slate-300">
        Facade · {done}/{walls.length}
      </summary>
      <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
        Outside face length of each facade wall, measured from outside: from outside corner to outside corner.
      </p>
      <div className="mt-2 grid grid-cols-2 gap-2.5">
        {walls.map((sid) => <FacadeField key={sid.label} doc={doc} sid={sid} />)}
      </div>
    </details>
  )
}

/** Small hook-free helper for tests and panels: true when the plan has facade walls to measure. */
export const hasFacadeValues = (doc: Pick<PlanDoc, 'rooms' | 'walls' | 'nodes'>): boolean =>
  wallSurveyIds(doc).some((s) => s.kind === 'outside')
