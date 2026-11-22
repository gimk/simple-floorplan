import { useEffect, useRef, useState } from 'react'
import { addTape, patchTape, removeTape } from '../annotations/actions'
import { isUnplaced, tapeLabel } from '../annotations/logic'
import type { PlanDoc, Room, TapeMeasure, Vec } from '../../model/types'
import { MiniDrawing } from './MiniDrawing'
import { NumField } from './NumField'

const Z: Vec = { x: 0, y: 0 }
const roomTapes = (doc: PlanDoc, room: Room) => doc.tapes.filter((t) => t.roomId === room.id)
const text = 'min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-[15px] dark:border-slate-600 dark:bg-[#1b2128]'

function MarkSheet({ doc, room, tape, onClose }: { doc: PlanDoc; room: Room; tape: TapeMeasure; onClose: () => void }) {
  const [a, setA] = useState<Vec | null>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose() }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/50 sm:items-center" role="dialog" aria-modal="true" aria-label="Mark tape points" onClick={onClose}>
      <div className="flex max-h-[92vh] w-full max-w-[560px] flex-col gap-3 overflow-auto rounded-t-2xl border border-black/10 bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] dark:border-white/15 dark:bg-[#1b2128] sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <b className="text-base">{tape.label || 'Tape'} · {a ? 'tap point B' : 'tap point A'}</b>
          <button type="button" onClick={onClose} className="min-h-11 rounded-lg border border-slate-300 px-4 text-sm font-semibold dark:border-slate-600">Cancel</button>
        </div>
        <MiniDrawing
          doc={doc} room={room} focused={null} marks={a ? [a] : []}
          onPick={(p) => {
            if (!a) { setA(p); return }
            patchTape(tape.id, { a, b: p })
            onClose()
          }}
        />
      </div>
    </div>
  )
}

function TapeRow({ doc, room, tape }: { doc: PlanDoc; room: Room; tape: TapeMeasure }) {
  const [armed, setArmed] = useState(false)
  const [marking, setMarking] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const placed = !isUnplaced(tape)
  const onDelete = () => {
    if (!armed) { setArmed(true); timer.current = window.setTimeout(() => setArmed(false), 3000); return }
    window.clearTimeout(timer.current)
    removeTape(tape.id, true)
  }
  return (
    <div className="flex flex-col gap-2.5 rounded-lg border border-slate-300 bg-slate-50 p-2.5 dark:border-slate-700 dark:bg-[#12161b]" data-tape={tape.id}>
      <div className="grid grid-cols-2 gap-2.5">
        <input name="tapeLabel" aria-label="Tape label" autoComplete="off" placeholder="Label (wall to column…)" value={tape.label ?? ''} onChange={(e) => patchTape(tape.id, { label: e.target.value || undefined })} className={text} />
        <NumField ariaLabel="Tape value" value={tape.actualCm} onValue={(n) => patchTape(tape.id, { actualCm: n ?? undefined })} enterKeyHint="done" />
      </div>
      <input name="tapeNote" aria-label="Tape note" autoComplete="off" placeholder="Note" value={tape.note ?? ''} onChange={(e) => patchTape(tape.id, { note: e.target.value || undefined })} className={text} />
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setMarking(true)} className="min-h-11 rounded-lg border border-cyan-700 px-3 text-sm font-semibold text-cyan-800 dark:border-cyan-400 dark:text-cyan-300">
          {placed ? 'Move points' : 'Mark on drawing'}
        </button>
        {placed && <>
          <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{tapeLabel(tape)}</span>
          <button type="button" onClick={() => patchTape(tape.id, { a: Z, b: Z })} className="min-h-11 px-2 text-sm text-slate-500 underline dark:text-slate-400">Unmark</button>
        </>}
        <span className="flex-1" />
        <button type="button" onClick={onDelete} className={`min-h-11 rounded-lg border px-3 text-sm font-semibold ${armed ? 'border-orange-600 bg-orange-600 text-white' : 'border-slate-300 text-slate-500 dark:border-slate-600 dark:text-slate-400'}`}>
          {armed ? 'Tap to confirm' : 'Delete'}
        </button>
      </div>
      {marking && <MarkSheet doc={doc} room={room} tape={tape} onClose={() => setMarking(false)} />}
    </div>
  )
}

/** "Tape" section of a room card: ad-hoc measurements (label, value, note, optional two points). */
export function TapeSection({ doc, room }: { doc: PlanDoc; room: Room }) {
  const mine = roomTapes(doc, room)
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-2">
        <b className="text-sm">Tape</b>
        <button type="button" onClick={() => addTape({ a: Z, b: Z, roomId: room.id, label: '' }, true)} className="min-h-11 rounded-lg border border-orange-600 px-3 text-sm font-semibold text-orange-700 dark:border-orange-400 dark:text-orange-400">+ Tape</button>
      </div>
      {mine.length === 0 && <p className="text-[13px] text-slate-500 dark:text-slate-400">Extra distances: wall to column, window to corner…</p>}
      {mine.map((t) => <TapeRow key={t.id} doc={doc} room={room} tape={t} />)}
    </div>
  )
}
