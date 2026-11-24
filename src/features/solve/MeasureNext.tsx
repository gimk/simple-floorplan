// "Measure next" section of the Solve tab (docs/walls-plan.md phase 2b).
// The solver says which value to measure next, most useful first. Each line has a field: type the
// value, press Enter, and the plan takes it in and the list is calculated again.
// The measured values that do not fit the plan come first: measure them again.
import { Crosshair } from 'lucide-react'
import { useEffect, useMemo, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { fmtCm } from '../../model/geometry'
import { nowIso, useDoc, useUi } from '../../model/store'
import { labelRoomCode } from '../../model/survey'
import type { PlanDoc } from '../../model/types'
import { EmptyHint, IconButton, INPUT_BARE, MUTED, PanelSection, inputGroup } from '../../shell/panel'
import { setMeasurement } from '../measure/actions'
import { isV2Doc, targetOfLabel } from '../../model/v2/targets'
import { sourceSigmaCm } from '../../model/measureSource'
import { parseCm } from '../measure/logic'
import type { RoomAngles, SurfaceMode } from '../rooms/globalSolve'
import { scheduleAutoApply } from '../rooms/measureRules'
import { roomFaceKeyOnSide } from '../rooms/wallSides'
import { suggestMeasurements, type Remeasure, type Suggestion } from '../rooms/suggest'

/** UI state that shows one survey label on the plan (null clears the highlight). */
export const hoverUi = (
  label: string | null,
  diagonal: { roomId: string; pair: [number, number] } | null = null,
) => ({ hoverLabel: label, hoverDiagonal: diagonal })

/**
 * Hover of one line: the plan highlights that element (wall, thickness, diagonal).
 * A touch screen has no hover, so only a mouse or a pen shows it. The field of the line does the
 * same on focus, so a value being typed in is always visible on the plan.
 */
function useRowHover(label: string, diagonal: { roomId: string; pair: [number, number] } | null = null) {
  const set = useUi((s) => s.set)
  const enter = () => set(hoverUi(label, diagonal))
  const leave = () => set(hoverUi(null))
  const onPointerEnter = (e: ReactPointerEvent) => { if (e.pointerType !== 'touch') enter() }
  const onPointerLeave = (e: ReactPointerEvent) => { if (e.pointerType !== 'touch') leave() }
  // A line that goes away (the list is calculated again) must not leave a highlight behind.
  useEffect(() => () => set(hoverUi(null)), [set])
  return { onPointerEnter, onPointerLeave, onFieldEnter: enter, onFieldLeave: leave }
}

/**
 * Select what one survey label measures on the plan. A v2 document selects the STORED wall, on the
 * side the value is on: the breadcrumb, the wall card and the wall band on the plan then agree
 * (review finding 4). A facade ('W12-E') and a centre ('W12-C') value name their wall directly.
 * A v1 document keeps the per-room wall selection.
 */
export function showLabelOnPlan(doc: PlanDoc, label: string, fallbackRoomId?: string) {
  const { select } = useUi.getState()
  const target = isV2Doc(doc) ? targetOfLabel(doc, label) : undefined
  if (target) {
    const kind = target.kind ?? 'face'
    if (kind === 'diagonal') {
      const roomId = target.roomId ?? fallbackRoomId
      if (roomId) select({ kind: 'room', roomId })
      return
    }
    // The side of a centre value says nothing: the wall card then shows both sides.
    if (kind === 'centre') {
      select({ kind: 'storedWall', wallId: target.wallId, side: undefined })
      return
    }
    // A face value names ONE face of the wall: select that face (the room face of the label).
    const face = kind === 'face' && target.roomId
      ? roomFaceKeyOnSide(doc, target.wallId, target.side, target.roomId,
        target.from !== undefined && target.to !== undefined ? { from: target.from, to: target.to } : undefined)
      : undefined
    select({ kind: 'storedWall', wallId: target.wallId, side: target.side, ...(face ? { face } : {}) })
    return
  }
  const code = labelRoomCode(label)
  const room = code ? doc.rooms.find((r) => r.code === code) : doc.rooms.find((r) => r.id === fallbackRoomId)
  if (!room) return
  const n = code ? /^(\d+)/.exec(label.slice(code.length + 1)) : null
  const start = n ? room.vertices[Number(n[1]) - 1]?.id : undefined
  select(start ? { kind: 'wall', roomId: room.id, wallStart: start } : { kind: 'room', roomId: room.id })
}

/** Select the wall (or the room, for a diagonal) of one suggestion on the plan. */
function showOnPlan(doc: PlanDoc, s: Suggestion) {
  showLabelOnPlan(doc, s.label, s.roomId)
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
    useDoc.getState().update((d) => {
      const rooms = d.rooms.map((r) => (r.id === s.roomId ? { ...r, diagonal: pair } : r))
      // The target is read AFTER the pair is on the room: the diagonal of a v2 document names the
      // wall of its first corner face (docs/walls-plan.md phase 5c). A stored target is kept.
      const kept = d.measurements[s.label]?.target ?? targetOfLabel({ ...d, rooms }, s.label)
      return {
        ...d,
        rooms,
        measurements: { ...d.measurements, [s.label]: { label: s.label, actualCm: cm, updatedAt: nowIso(), source, ...(kept ? { target: kept } : {}) } },
      }
    })
    const code = useDoc.getState().doc.rooms.find((r) => r.id === s.roomId)?.code
    if (code) scheduleAutoApply(code)
    return
  }
  // A wall or a thickness: the same path as Measuring Mode.
  setMeasurement(s.label, cm, source)
}

/** Number field of one line: Enter or blur with a valid value saves it. */
function ValueField({ label, onSave, onEnter, onLeave }: {
  label: string
  onSave: (cm: number) => void
  /** The plan highlights this value while the field has the focus. */
  onEnter?: () => void
  onLeave?: () => void
}) {
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
        onBlur={() => { save(); onLeave?.() }}
        onFocus={onEnter}
        className={INPUT_BARE}
      />
    </span>
  )
}

/**
 * One line, on two rows so it fits the narrow sidebar: button, label, uncertainty and field on
 * the first row; the reason under the label.
 */
function SuggestionRow({ doc, s }: { doc: PlanDoc; s: Suggestion }) {
  // A diagonal of a room that has no pair yet needs the pair: the label alone cannot give it.
  const hover = useRowHover(
    s.label,
    s.kind === 'diagonal' && s.diagonal ? { roomId: s.roomId, pair: s.diagonal } : null,
  )
  return (
    <li data-measure-suggestion={s.label} className="flex min-h-9 items-center gap-2 py-1 pointer-coarse:min-h-11"
      data-hover-row={s.label} onPointerEnter={hover.onPointerEnter} onPointerLeave={hover.onPointerLeave}>
      {/* Names the row: ten buttons called "Show on plan" say nothing to a screen reader. */}
      <IconButton label={`Show ${s.label} on plan`} icon={<Crosshair size={16} />} onClick={() => showOnPlan(doc, s)} />
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
      <ValueField label={s.label} onSave={(cm) => saveValue(s, cm)}
        onEnter={hover.onFieldEnter} onLeave={hover.onFieldLeave} />
    </li>
  )
}

/** A measured value that does not fit the plan: the old value, the plan value and a field for the new one. */
function RemeasureRow({ doc, r }: { doc: PlanDoc; r: Remeasure }) {
  // The pair of a diagonal comes from the room itself: a remeasured value is on the plan already.
  const hover = useRowHover(r.label)
  return (
    <li data-measure-again={r.label} className="flex min-h-9 items-center gap-2 py-1 pointer-coarse:min-h-11"
      data-hover-row={r.label} onPointerEnter={hover.onPointerEnter} onPointerLeave={hover.onPointerLeave}>
      <IconButton label={`Show ${r.label} on plan`} icon={<Crosshair size={16} />} onClick={() => showLabelOnPlan(doc, r.label)} />
      <span className="flex min-w-0 flex-1 flex-col text-xs text-amber-700 dark:text-amber-300">
        <span>Measure again: <span className="font-mono">{r.label}</span></span>
        <span className="text-[11px] leading-tight">measured {fmtCm(r.measuredCm)}, plan says {fmtCm(r.solvedCm)}</span>
      </span>
      <ValueField
        label={r.label}
        onSave={(cm) => setMeasurement(r.label, cm, useUi.getState().measureSource)}
        onEnter={hover.onFieldEnter}
        onLeave={hover.onFieldLeave}
      />
    </li>
  )
}

/**
 * Section "Measure next": the values to measure again, then the best measurements in order.
 * `surfaceMode` and `keepLocked` default to the Solve settings of the UI store.
 */
export function MeasureNext({ doc, surfaceMode, keepLocked, angles }: {
  doc: PlanDoc
  surfaceMode?: SurfaceMode
  keepLocked?: boolean
  /** Room angles of the solve ('Square' by default, or 'Free'). */
  angles?: RoomAngles
}) {
  const uiSurface = useUi((s) => s.solveSurfaceMode)
  const uiKeepLocked = useUi((s) => s.solveKeepLocked)
  const uiAngles = useUi((s) => s.solveAngles)
  const mode = surfaceMode ?? uiSurface
  const keep = keepLocked ?? uiKeepLocked
  const free = angles ?? uiAngles
  // The value will be typed with the source picked in Measuring Mode: it sets its accuracy.
  const source = useUi((s) => s.measureSource)
  // Same solve as "Solve whole plan", so the list follows every value and every setting.
  const { suggestions, remeasure } = useMemo(
    () => suggestMeasurements(doc, { keepLocked: keep, surfaceMode: mode, angles: free, sigmaCm: sourceSigmaCm(source) }),
    [doc, keep, mode, free, source],
  )
  return (
    <PanelSection id="solve-measure-next" title="Measure next" icon={<Crosshair size={16} />} collapsible>
      {remeasure.length > 0 && (
        <ul data-measure-remeasure className="flex flex-col">
          {remeasure.map((r) => <RemeasureRow key={r.label} doc={doc} r={r} />)}
        </ul>
      )}
      {suggestions.length > 0 && (
        <>
          <ul data-measure-list className="flex flex-col">
            {suggestions.map((s) => <SuggestionRow key={`${s.kind}-${s.label}`} doc={doc} s={s} />)}
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
