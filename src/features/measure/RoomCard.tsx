import { useState } from 'react'
import { Check } from 'lucide-react'
import { fmtCm } from '../../model/geometry'
import { useDoc, useUi } from '../../model/store'
import { parseThicknessLabel, thicknessIds } from '../../model/survey'
import type { PlanDoc, Room } from '../../model/types'
import { ItemsEditor } from './ItemsEditor'
import { StorageEditor } from './StorageEditor'
import { discrepancy, fmtDiff, measureRows, nextLabel, oppositeWallNotes, roomProgress, rowValue, squarenessCheck, thicknessRow, type MeasureRow } from './logic'
import { inputId, setMeasurement, setRunMeasurement } from './actions'
import { flushAutoApply, wallLabelRoom } from '../rooms/measureRules'
import { MiniDrawing } from './MiniDrawing'
import { NumField } from './NumField'
import { RoomOldValues } from './OldValues'
import { PinsSection } from './PinsSection'
import { TapeSection } from './TapeSection'
import { roomPins, isUnplaced, tapeLabel } from '../annotations/logic'

const setNote = (code: string, text: string) =>
  useDoc.getState().updateSilent((d) => {
    const roomNotes = { ...d.roomNotes }
    if (text) roomNotes[code] = text; else delete roomNotes[code]
    return { ...d, roomNotes }
  })

/** Survey label under the pointer or focus: the canvas draws it, and the matching field gets a ring. */
const setHover = (label: string) => useUi.getState().set({ hoverLabel: label })
/** Clear the hover label, but only if it is still this label. */
const clearHover = (label: string) => {
  if (useUi.getState().hoverLabel === label) useUi.getState().set({ hoverLabel: null })
}

type Props = {
  doc: PlanDoc; room: Room; allLabels: string[]
  /** Hide the small room drawing (desktop: the canvas shows the room). */
  hideDrawing?: boolean
}

export function RoomCard({ doc, room, allLabels, hideDrawing }: Props) {
  const [focused, setFocused] = useState<string | null>(null)
  const hoverLabel = useUi((s) => s.hoverLabel)
  // Source saved with the values typed in this card. The picker is gone, so it stays tape.
  const measureSource = useUi((s) => s.measureSource)
  const ids = measureRows(room, doc.apartment?.defaultCeilingCm)
  const thick = thicknessIds(doc, room).map(thicknessRow)
  const thickDone = thick.filter((s) => doc.measurements[s.label] != null).length
  const { done, total } = roomProgress(doc, room)
  const square = squarenessCheck(doc, room)
  const opposite = oppositeWallNotes(doc, room)

  const goNext = (label: string) => {
    const nx = nextLabel(allLabels, label)
    const el = nx && document.getElementById(inputId(nx))
    if (el) el.focus(); else (document.activeElement as HTMLElement | null)?.blur()
  }

  const field = (sid: MeasureRow) => {
    const m = doc.measurements[sid.label]
    // A grouped wall (one visible wall stored as 2+ faces) shows the TOTAL: the sum of its pieces.
    const grouped = sid.labels.length > 1
    const value = grouped ? rowValue(doc, sid) : m?.actualCm
    const verified = value != null
    const dis = verified ? discrepancy(sid.plannedCm, value) : null
    const ringed = hoverLabel != null && sid.labels.includes(hoverLabel)
    // A thickness that differs from the plan is new data, not an error: never flagged.
    const flagged = !!dis?.flagged && !sid.optional
    const title = sid.kind === 'diagonal' ? `${sid.label} · diagonal`
      : sid.kind === 'height' ? `${sid.label} · ${room.outdoor ? 'height' : 'ceiling height'}`
      : sid.kind === 'thickness' ? `${sid.label} · thickness`
      : sid.text
    const applyRoom = wallLabelRoom(sid.label) ?? parseThicknessLabel(sid.label)?.code
    return (
      <div
        key={sid.label}
        className={`flex min-w-0 flex-col gap-1 rounded-lg ${ringed ? 'ring-2 ring-orange-500 ring-offset-2 ring-offset-white dark:ring-orange-400 dark:ring-offset-[#1b2128]' : ''}`}
        data-field-highlight={ringed ? sid.label : undefined}
        onPointerEnter={() => setHover(sid.label)}
        onPointerLeave={() => { if (focused !== sid.label) clearHover(sid.label) }}
      >
        <label htmlFor={inputId(sid.label)} className={`flex items-center justify-between gap-1 font-mono text-[13px] font-semibold ${verified ? 'text-emerald-700 dark:text-emerald-400' : sid.optional ? 'text-slate-600 dark:text-slate-300' : 'text-orange-700 dark:text-orange-400'}`}>
          <span className="truncate">{title}</span>
          {verified
            ? <span className="flex items-center gap-0.5 font-sans text-[11px] font-medium"><Check size={13} aria-hidden /> measured</span>
            : <span className="font-sans text-[11px] font-medium text-slate-500 dark:text-slate-400">{sid.plannedCm != null ? 'estimated' : 'to measure'}</span>}
        </label>
        <NumField
          id={inputId(sid.label)}
          value={value}
          placeholder={sid.plannedCm != null ? (hideDrawing ? fmtCm(sid.plannedCm) : `plan ${fmtCm(sid.plannedCm)}`) : undefined}
          onValue={(n) => (grouped ? setRunMeasurement(sid, n, measureSource) : setMeasurement(sid.label, n, measureSource))}
          onFocus={() => { setFocused(sid.label); setHover(sid.label) }}
          onBlur={() => { setFocused((f) => (f === sid.label ? null : f)); clearHover(sid.label); if (applyRoom) flushAutoApply(applyRoom) }}
          onEnter={() => goNext(sid.label)}
        />
        {verified && sid.plannedCm != null && dis && (
          <p className={`text-xs ${flagged ? 'rounded bg-orange-100 px-1.5 py-0.5 font-semibold text-orange-800 dark:bg-orange-950 dark:text-orange-300' : 'text-slate-500 dark:text-slate-400'}`}>
            {/* The measured value is never changed by the solver: the plan follows it. "Solved" is
                the length that the plan has now, after the solve. */}
            Measured {fmtCm(value)} · Solved {fmtCm(sid.plannedCm)} ({fmtDiff(dis.diff)})
          </p>
        )}
      </div>
    )
  }

  return (
    <section id={`room-${room.code}`} aria-label={room.name} className="flex scroll-mt-28 flex-col gap-3.5 rounded-xl border border-slate-300 bg-white p-4 dark:border-slate-700 dark:bg-[#1b2128]">
      <h2 className="flex items-baseline justify-between gap-2 text-[17px] font-semibold">
        <span>{room.name}</span>
        <small className="font-mono text-[13px] font-medium text-slate-500 dark:text-slate-400">{room.code} · {done}/{total}</small>
      </h2>

      {!hideDrawing && (
        <MiniDrawing
          doc={doc} room={room} focused={focused}
          pins={roomPins(doc, room.id).map((p, i) => ({ n: i + 1, at: p.at }))}
          tapes={doc.tapes.filter((t) => t.roomId === room.id && !isUnplaced(t)).map((t) => ({ a: t.a, b: t.b, label: t.actualCm != null ? fmtCm(t.actualCm) : tapeLabel(t) }))}
        />
      )}

      <div className="grid grid-cols-2 gap-2.5">
        {ids.map(field)}
      </div>

      {thick.length > 0 && (
        <details className="rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700">
          <summary className="flex min-h-9 cursor-pointer items-center text-[13px] font-semibold text-slate-600 pointer-coarse:min-h-11 dark:text-slate-300">
            Wall thickness (optional) · {thickDone}/{thick.length}
          </summary>
          <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
            Measure at a door or window frame, from one face of the wall to the other. Each wall has one ID: a wall between two rooms is in the room you measure first.
          </p>
          <div className="mt-2 grid grid-cols-2 gap-2.5">
            {thick.map(field)}
          </div>
        </details>
      )}

      <RoomOldValues doc={doc} room={room} />

      {square && (
        <p role="status" className={`rounded-lg px-3 py-2 text-sm ${square.ok ? 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300' : 'bg-orange-100 text-orange-900 dark:bg-orange-950 dark:text-orange-200'}`}>
          {square.ok
            ? `Square: ${room.code}-D ${fmtCm(square.actual)} matches the expected ${fmtCm(square.expected)}.`
            : `Not square: ${room.code}-D is ${fmtCm(square.actual)}, expected ${fmtCm(square.expected)} (${fmtDiff(square.diff)}). Check the walls and the diagonal.`}
        </p>
      )}
      {opposite.map((o) => (
        <p key={o.a} role="status" className="rounded-lg bg-orange-100 px-3 py-2 text-sm text-orange-900 dark:bg-orange-950 dark:text-orange-200">
          Opposite walls {o.a} and {o.b} differ by {fmtCm(Math.abs(o.diff))} cm.
        </p>
      ))}

      <ItemsEditor room={room} elements={doc.elements} />

      <StorageEditor doc={doc} room={room} />

      <PinsSection doc={doc} room={room} />

      <TapeSection doc={doc} room={room} />

      <label htmlFor={`note-${room.code}`} className="text-[13px] font-semibold text-slate-500 dark:text-slate-400">Notes (doors, windows, radiators…)</label>
      <textarea
        id={`note-${room.code}`} rows={2} value={doc.roomNotes[room.code] ?? ''}
        onChange={(e) => setNote(room.code, e.target.value)}
        className="min-h-16 w-full resize-y rounded-lg border border-slate-300 bg-white p-2.5 text-[15px] dark:border-slate-600 dark:bg-[#12161b]"
      />
    </section>
  )
}
