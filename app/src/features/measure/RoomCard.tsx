import { useState } from 'react'
import { Check } from 'lucide-react'
import { fmtCm } from '../../model/geometry'
import { useDoc } from '../../model/store'
import { surveyIds } from '../../model/survey'
import type { PlanDoc, Room } from '../../model/types'
import { ItemsEditor } from './ItemsEditor'
import { discrepancy, fmtDiff, nextLabel, oppositeWallNotes, roomProgress, squarenessCheck } from './logic'
import { inputId, setMeasurement } from './actions'
import { MiniDrawing } from './MiniDrawing'
import { NumField } from './NumField'

const setNote = (code: string, text: string) =>
  useDoc.getState().updateSilent((d) => {
    const roomNotes = { ...d.roomNotes }
    if (text) roomNotes[code] = text; else delete roomNotes[code]
    return { ...d, roomNotes }
  })

export function RoomCard({ doc, room, allLabels }: { doc: PlanDoc; room: Room; allLabels: string[] }) {
  const [focused, setFocused] = useState<string | null>(null)
  const ids = surveyIds(room)
  const { done, total } = roomProgress(doc, room)
  const square = squarenessCheck(doc, room)
  const opposite = oppositeWallNotes(doc, room)

  const goNext = (label: string) => {
    const nx = nextLabel(allLabels, label)
    const el = nx && document.getElementById(inputId(nx))
    if (el) el.focus(); else (document.activeElement as HTMLElement | null)?.blur()
  }

  return (
    <section id={`room-${room.code}`} aria-label={room.name} className="flex scroll-mt-28 flex-col gap-3.5 rounded-xl border border-slate-300 bg-white p-4 dark:border-slate-700 dark:bg-[#1b2128]">
      <h2 className="flex items-baseline justify-between gap-2 text-[17px] font-semibold">
        <span>{room.name}</span>
        <small className="font-mono text-[13px] font-medium text-slate-500 dark:text-slate-400">{room.code} · {done}/{total}</small>
      </h2>

      <MiniDrawing doc={doc} room={room} focused={focused} />

      <div className="grid grid-cols-2 gap-2.5">
        {ids.map((sid) => {
          const m = doc.measurements[sid.label]
          const verified = m != null
          const dis = verified ? discrepancy(sid.plannedCm, m.actualCm) : null
          const title = sid.kind === 'diagonal' ? `${sid.label} · diagonal` : sid.kind === 'height' ? `${sid.label} · ${room.outdoor ? 'height' : 'ceiling height'}` : sid.label
          return (
            <div key={sid.label} className={`flex min-w-0 flex-col gap-1 ${sid.kind !== 'wall' ? 'col-span-1' : ''}`}>
              <label htmlFor={inputId(sid.label)} className={`flex items-center justify-between gap-1 font-mono text-[13px] font-semibold ${verified ? 'text-green-700 dark:text-green-400' : 'text-orange-700 dark:text-orange-400'}`}>
                <span>{title}</span>
                {verified
                  ? <span className="flex items-center gap-0.5 font-sans text-[11px] font-medium"><Check size={13} aria-hidden /> verified</span>
                  : <span className="font-sans text-[11px] font-medium text-slate-500 dark:text-slate-400">{sid.plannedCm != null ? 'estimated' : 'to measure'}</span>}
              </label>
              <NumField
                id={inputId(sid.label)}
                value={m?.actualCm}
                placeholder={sid.plannedCm != null ? `plan ${fmtCm(sid.plannedCm)}` : undefined}
                onValue={(n) => setMeasurement(sid.label, n)}
                onFocus={() => setFocused(sid.label)}
                onBlur={() => setFocused((f) => (f === sid.label ? null : f))}
                onEnter={() => goNext(sid.label)}
              />
              {verified && sid.plannedCm != null && dis && (
                <p className={`text-xs ${dis.flagged ? 'rounded bg-orange-100 px-1.5 py-0.5 font-semibold text-orange-800 dark:bg-orange-950 dark:text-orange-300' : 'text-slate-500 dark:text-slate-400'}`}>
                  Plan {fmtCm(sid.plannedCm)} · Real {fmtCm(m.actualCm)} ({fmtDiff(dis.diff)})
                </p>
              )}
            </div>
          )
        })}
      </div>

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

      <label htmlFor={`note-${room.code}`} className="text-[13px] font-semibold text-slate-500 dark:text-slate-400">Notes (doors, windows, radiators…)</label>
      <textarea
        id={`note-${room.code}`} rows={2} value={doc.roomNotes[room.code] ?? ''}
        onChange={(e) => setNote(room.code, e.target.value)}
        className="min-h-16 w-full resize-y rounded-lg border border-slate-300 bg-white p-2.5 text-[15px] dark:border-slate-600 dark:bg-[#12161b]"
      />
    </section>
  )
}
