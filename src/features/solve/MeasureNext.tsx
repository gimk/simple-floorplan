// "Measure next" section of the Solve tab (docs/walls-plan.md phase 2b).
// The solver says which value to measure next, most useful first. Each line has a field: type the
// value, press Enter, and the plan takes it in and the list is calculated again.
// The measured values that do not fit the plan come first: measure them again.
import { Crosshair } from 'lucide-react'
import { useMemo, useState } from 'react'
import { fmtCm } from '../../model/geometry'
import { nowIso, useDoc, useUi } from '../../model/store'
import type { PlanDoc } from '../../model/types'
import { EmptyHint, IconButton, INPUT_BARE, MUTED, PanelSection, inputGroup } from '../../shell/panel'
import { setMeasurement } from '../measure/actions'
import { sourceSigmaCm } from '../../model/measureSource'
import { parseCm } from '../measure/logic'
import type { SurfaceMode } from '../rooms/globalSolve'
import { scheduleAutoApply } from '../rooms/measureRules'
import { suggestMeasurements, type Remeasure, type Suggestion } from '../rooms/suggest'

/** Select the wall (or the room, for a diagonal) on the plan. */
function showOnPlan(s: Suggestion) {
  const { select } = useUi.getState()
  if (s.kind !== 'diagonal' && s.wallStart) select({ kind: 'wall', roomId: s.roomId, wallStart: s.wallStart })
  else select({ kind: 'room', roomId: s.roomId })
}

/**
 * Save a suggested value. A diagonal also needs its corner pair on the room, and both go in one
 * undo step: the value is meaningless without the pair.
 */
function saveValue(s: Suggestion, cm: number) {
  // The value gets the source picked in Measuring Mode (tape, laser, plan).
  const source = useUi.getState().measureSource
  if (s.kind === 'diagonal' && s.diagonal) {
    const [i, j] = s.diagonal
    const pair: [number, number] = [i, j]
    useDoc.getState().update((d) => ({
      ...d,
      rooms: d.rooms.map((r) => (r.id === s.roomId ? { ...r, diagonal: pair } : r)),
      measurements: { ...d.measurements, [s.label]: { label: s.label, actualCm: cm, updatedAt: nowIso(), source } },
    }))
    const code = useDoc.getState().doc.rooms.find((r) => r.id === s.roomId)?.code
    if (code) scheduleAutoApply(code)
    return
  }
  // A wall or a thickness: the same path as Measuring Mode.
  setMeasurement(s.label, cm, source)
}

/** Number field of one line: Enter or blur with a valid value saves it. */
function ValueField({ label, onSave }: { label: string; onSave: (cm: number) => void }) {
  const [draft, setDraft] = useState('')
  const cm = parseCm(draft)
  const bad = draft.trim() !== '' && !Number.isFinite(cm)
  const save = () => {
    if (cm === null || !Number.isFinite(cm)) {
      // Nothing to save: an empty field stays empty, a wrong one is cleared at blur.
      if (bad) setDraft('')
      return
    }
    onSave(cm)
    setDraft('')
  }
  return (
    <span className={`${inputGroup(bad)} w-20 shrink-0`}>
      <input
        type="text"
        inputMode="decimal"
        autoComplete="off"
        enterKeyHint="done"
        aria-label={`Measured value of ${label}`}
        aria-invalid={bad || undefined}
        value={draft}
        placeholder="cm"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            save()
          }
        }}
        onBlur={save}
        className={INPUT_BARE}
      />
    </span>
  )
}

/**
 * One line, on two rows so it fits the narrow sidebar: button, label, uncertainty and field on
 * the first row; the reason under the label.
 */
function SuggestionRow({ s }: { s: Suggestion }) {
  return (
    <li data-measure-suggestion={s.label} className="flex min-h-9 items-center gap-2 py-1 pointer-coarse:min-h-11">
      <IconButton label="Show on plan" icon={<Crosshair size={16} />} onClick={() => showOnPlan(s)} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="font-mono text-xs">{s.label}</span>
        <span className={`text-[11px] leading-tight ${MUTED}`} data-measure-reason={s.label}>{s.reason}</span>
      </span>
      <span
        data-measure-sd={s.label}
        title={`Uncertainty of this value now: ±${fmtCm(s.nowSdCm)} cm. Plan says ${fmtCm(s.plannedCm)} cm.`}
        className="shrink-0 font-mono text-xs tabular-nums text-slate-700 dark:text-slate-200"
      >
        ±{fmtCm(s.nowSdCm)}<span className={`ml-0.5 text-[11px] ${MUTED}`}>cm</span>
      </span>
      <ValueField label={s.label} onSave={(cm) => saveValue(s, cm)} />
    </li>
  )
}

/** A measured value that does not fit the plan: the old value, the plan value and a field for the new one. */
function RemeasureRow({ r }: { r: Remeasure }) {
  return (
    <li data-measure-again={r.label} className="flex min-h-9 items-center gap-2 py-1 pointer-coarse:min-h-11">
      <span className="flex min-w-0 flex-1 flex-col text-xs text-amber-700 dark:text-amber-300">
        <span>Measure again: <span className="font-mono">{r.label}</span></span>
        <span className="text-[11px] leading-tight">measured {fmtCm(r.measuredCm)}, plan says {fmtCm(r.solvedCm)}</span>
      </span>
      <ValueField
        label={r.label}
        onSave={(cm) => setMeasurement(r.label, cm, useUi.getState().measureSource)}
      />
    </li>
  )
}

/**
 * Section "Measure next": the values to measure again, then the best measurements in order.
 * `surfaceMode` and `keepLocked` default to the Solve settings of the UI store.
 */
export function MeasureNext({ doc, surfaceMode, keepLocked }: {
  doc: PlanDoc
  surfaceMode?: SurfaceMode
  keepLocked?: boolean
}) {
  const uiSurface = useUi((s) => s.solveSurfaceMode)
  const uiKeepLocked = useUi((s) => s.solveKeepLocked)
  const mode = surfaceMode ?? uiSurface
  const keep = keepLocked ?? uiKeepLocked
  // The value will be typed with the source picked in Measuring Mode: it sets its accuracy.
  const source = useUi((s) => s.measureSource)
  // Same solve as "Solve whole plan", so the list follows every value and every setting.
  const { suggestions, remeasure } = useMemo(
    () => suggestMeasurements(doc, { keepLocked: keep, surfaceMode: mode, sigmaCm: sourceSigmaCm(source) }),
    [doc, keep, mode, source],
  )
  return (
    <PanelSection id="solve-measure-next" title="Measure next" icon={<Crosshair size={16} />} collapsible>
      {remeasure.length > 0 && (
        <ul data-measure-remeasure className="flex flex-col">
          {remeasure.map((r) => <RemeasureRow key={r.label} r={r} />)}
        </ul>
      )}
      {suggestions.length > 0 && (
        <>
          <ul data-measure-list className="flex flex-col">
            {suggestions.map((s) => <SuggestionRow key={`${s.kind}-${s.label}`} s={s} />)}
          </ul>
          <EmptyHint>
            Type a value and press Enter: the plan takes it in and the list is calculated again.
            ± cm is what the plan does not know about that value yet.
          </EmptyHint>
        </>
      )}
      {!suggestions.length && !remeasure.length && (
        <EmptyHint>Nothing left to suggest: every value of this plan has a measurement.</EmptyHint>
      )}
    </PanelSection>
  )
}
