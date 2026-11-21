// OWNER: annotations agent. Tape tool, note/photo pins (Edit Mode canvas + sidebar panels).
import { useEffect, useState } from 'react'
import { MapPin, Trash2 } from 'lucide-react'
import { CaptureRect, useViewport } from '../../canvas/Viewport'
import { fmtCm } from '../../model/geometry'
import { useDoc, useUi } from '../../model/store'
import type { Pin, TapeMeasure, Vec } from '../../model/types'
import { addPin, addTape, patchTape, removePin, removeTape } from './actions'
import { SNAP_PX, isUnplaced, placePin, snapToPlan, tapeLabel, tracedCm } from './logic'
import { PinEditor } from './PinEditor'
import { selectAnnot, useAnnotSel, type AnnotSel } from './selection'
import { parseCm } from '../measure/logic'

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement ||
  (t instanceof HTMLElement && t.isContentEditable)

const TAPE = '#0891b2'
const PIN = '#ea580c'

function DimLine({ a, b, label, selected, onDown }: { a: Vec; b: Vec; label: string; selected?: boolean; onDown?: (e: React.PointerEvent) => void }) {
  const { px } = useViewport()
  const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1
  const ux = dx / L, uy = dy / L, tick = px(6)
  let ang = (Math.atan2(dy, dx) * 180) / Math.PI
  if (ang > 90) ang -= 180
  if (ang <= -90) ang += 180
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2
  const nx = -uy, ny = ux
  return (
    <g onPointerDown={onDown} style={{ cursor: onDown ? 'pointer' : undefined }}>
      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth={px(16)} />
      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={TAPE} strokeWidth={px(selected ? 3 : 1.5)} />
      {[a, b].map((p, i) => (
        <line key={i} x1={p.x + nx * tick} y1={p.y + ny * tick} x2={p.x - nx * tick} y2={p.y - ny * tick} stroke={TAPE} strokeWidth={px(selected ? 3 : 1.5)} />
      ))}
      <text
        x={mx + nx * px(10)} y={my + ny * px(10)} transform={`rotate(${ang} ${mx + nx * px(10)} ${my + ny * px(10)})`}
        textAnchor="middle" dominantBaseline="central" fontSize={px(12)} fill={TAPE} stroke="white" strokeWidth={px(3)} paintOrder="stroke"
        pointerEvents="none" className="font-mono font-semibold"
      >{label}</text>
    </g>
  )
}

function PinIcon({ pin, n, selected, onDown }: { pin: Pin; n?: number; selected: boolean; onDown?: (e: React.PointerEvent) => void }) {
  const { px } = useViewport()
  const r = px(11)
  return (
    <g transform={`translate(${pin.at.x} ${pin.at.y})`} onPointerDown={onDown} style={{ cursor: onDown ? 'pointer' : undefined }}>
      <circle r={px(18)} fill="transparent" />
      <circle r={r} fill={PIN} stroke={selected ? '#1b2430' : 'white'} strokeWidth={px(selected ? 3 : 2)} />
      <text textAnchor="middle" dominantBaseline="central" fontSize={px(11)} fill="white" pointerEvents="none" className="font-semibold">
        {n ?? (pin.photoKeys.length > 0 ? '▣' : '•')}
      </text>
    </g>
  )
}

/** Draws tapes and pins (layer 'notes'). Click selects them with the select tool. Delete removes the selected one. */
export function AnnotationsLayer() {
  const doc = useDoc((s) => s.doc)
  const selection = useAnnotSel((s) => s.sel)
  const tool = useUi((s) => s.tool)
  const mode = useUi((s) => s.mode)
  const interactive = tool === 'select' && mode === 'edit'

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== 'Delete' && e.key !== 'Backspace') || isTyping(e.target)) return
      const sel = useAnnotSel.getState().sel
      if (sel?.kind === 'tape') removeTape(sel.id)
      else if (sel?.kind === 'pin') removePin(sel.id)
      else return
      e.preventDefault()
      selectAnnot(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const pick = (sel: NonNullable<AnnotSel>) => (e: React.PointerEvent) => {
    if (!interactive || e.button !== 0) return
    e.stopPropagation()
    selectAnnot(sel)
  }

  return (
    <g style={{ pointerEvents: interactive ? undefined : 'none' }}>
      {doc.tapes.filter((t) => !isUnplaced(t)).map((t) => (
        <DimLine key={t.id} a={t.a} b={t.b} label={tapeLabel(t)} selected={selection?.kind === 'tape' && selection.id === t.id} onDown={pick({ kind: 'tape', id: t.id })} />
      ))}
      {(doc.pins ?? []).map((p) => (
        <PinIcon key={p.id} pin={p} selected={selection?.kind === 'pin' && selection.id === p.id} onDown={pick({ kind: 'pin', id: p.id })} />
      ))}
    </g>
  )
}

/** Tool overlay for ui.tool === 'tape': click A, click B. */
export function TapeTool() {
  const { px, toWorld } = useViewport()
  const rooms = useDoc((s) => s.doc.rooms)
  const [a, setA] = useState<Vec | null>(null)
  const [hover, setHover] = useState<Vec | null>(null)
  const snap = (e: React.PointerEvent) => snapToPlan(toWorld(e.clientX, e.clientY), rooms, px(SNAP_PX))

  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    const hit = snap(e)
    if (!a) { setA(hit.point); setHover(hit.point); return }
    if (Math.hypot(hit.point.x - a.x, hit.point.y - a.y) < 1) return
    const id = addTape({ a, b: hit.point })
    setA(null); setHover(null)
    selectAnnot({ kind: 'tape', id })
  }

  return (
    <g>
      <CaptureRect onPointerDown={onDown} onPointerMove={(e) => setHover(snap(e).point)} onPointerLeave={() => setHover(null)} style={{ cursor: 'crosshair' }} />
      <g pointerEvents="none">
        {a && hover && <DimLine a={a} b={hover} label={fmtCm(tracedCm({ a, b: hover }))} />}
        {hover && <circle cx={hover.x} cy={hover.y} r={px(5)} fill="none" stroke={TAPE} strokeWidth={px(1.5)} />}
        {a && <circle cx={a.x} cy={a.y} r={px(4)} fill={TAPE} />}
      </g>
    </g>
  )
}

/** Tool overlay for ui.tool === 'pin': click adds a pin (or selects the one under the cursor). */
export function PinTool() {
  const { px, toWorld } = useViewport()
  const rooms = useDoc((s) => s.doc.rooms)
  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    const w = toWorld(e.clientX, e.clientY)
    const near = (useDoc.getState().doc.pins ?? []).find((p) => Math.hypot(p.at.x - w.x, p.at.y - w.y) <= px(14))
    if (near) { selectAnnot({ kind: 'pin', id: near.id }); return }
    const id = addPin(placePin(w, rooms, px(SNAP_PX)))
    selectAnnot({ kind: 'pin', id })
  }
  return <CaptureRect onPointerDown={onDown} style={{ cursor: 'copy' }} />
}

const box = 'flex flex-col gap-2 rounded-lg border border-black/10 p-2 text-sm dark:border-white/10'

/** Sidebar panel: the selected tape (real length + note). */
export function TapePanel() {
  const selection = useAnnotSel((s) => s.sel)
  const tape = useDoc((s): TapeMeasure | undefined => (selection?.kind === 'tape' ? s.doc.tapes.find((t) => t.id === selection.id) : undefined))
  const [draft, setDraft] = useState<string | null>(null)
  useEffect(() => setDraft(null), [tape?.id])
  if (!tape) return null
  const shown = draft ?? (tape.actualCm != null ? fmtCm(tape.actualCm) : '')
  const bad = draft != null && Number.isNaN(parseCm(draft))
  return (
    <div className={box}>
      <b className="flex items-center gap-1.5"><span className="inline-block h-0.5 w-4" style={{ background: TAPE }} /> Tape</b>
      <p className="font-mono">Traced {fmtCm(tracedCm(tape))} cm</p>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-slate-500">Real length (cm)</span>
        <input
          inputMode="decimal" aria-label="Real length" value={shown} aria-invalid={bad}
          onChange={(e) => {
            const t = e.target.value; setDraft(t)
            const n = parseCm(t)
            if (n == null) patchTape(tape.id, { actualCm: undefined }, false)
            else if (!Number.isNaN(n)) patchTape(tape.id, { actualCm: n }, false)
          }}
          onBlur={() => setDraft(null)}
          className={`h-9 rounded-md border bg-transparent px-2 font-mono ${bad ? 'border-red-500' : 'border-black/15 dark:border-white/20'}`}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-slate-500">Note</span>
        <input
          aria-label="Tape note" value={tape.note ?? ''} onChange={(e) => patchTape(tape.id, { note: e.target.value || undefined }, false)}
          className="h-9 rounded-md border border-black/15 bg-transparent px-2 dark:border-white/20"
        />
      </label>
      <button
        type="button" onClick={() => { removeTape(tape.id); selectAnnot(null) }}
        className="flex h-9 items-center justify-center gap-1.5 rounded-md border border-black/15 hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
      ><Trash2 size={14} /> Delete tape</button>
    </div>
  )
}

/** Sidebar panel: the selected pin (text, photos). */
export function PinPanel() {
  const selection = useAnnotSel((s) => s.sel)
  const pin = useDoc((s) => (selection?.kind === 'pin' ? (s.doc.pins ?? []).find((p) => p.id === selection.id) : undefined))
  if (!pin) return null
  return (
    <div className={box}>
      <b className="flex items-center gap-1.5"><MapPin size={14} style={{ color: PIN }} /> Pin</b>
      <PinEditor pin={pin} silent={false} onDeleted={() => selectAnnot(null)} />
    </div>
  )
}

export { PinEditor } from './PinEditor'
