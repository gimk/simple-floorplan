// OWNER: annotations agent. Tape tool, note/photo pins (Edit Mode canvas + sidebar panels).
import { Fragment, useEffect, useRef, useState } from 'react'
import { MapPin, Trash2 } from 'lucide-react'
import { CaptureRect, useViewport } from '../../canvas/Viewport'
import { fmtCm } from '../../model/geometry'
import { useDoc, useUi } from '../../model/store'
import type { Pin, TapeMeasure, Vec } from '../../model/types'
import { FieldRow, IconButton, NumberField, PanelSection, StatGrid, TextField } from '../../shell/panel'
import { addPin, addTape, patchPin, patchTape, removePin, removeTape } from './actions'
import { SNAP_PX, isUnplaced, placePin, snapTapeAngle, snapToPlan, tapeLabel, tracedCm } from './logic'
import { PinPhotos } from './PinEditor'
import { PIN_FIELD_NAMES, TAPE_FIELD_NAMES, notePatch, pinTextPatch, realLengthPatch, tapeStats } from './panel'
import { selectAnnot, useAnnotSel, type AnnotSel } from './selection'
import { TAPE_LABEL_GAP_PX, tapeLabelPlacement } from './tapeLabel'
import { undoToast } from '../toast'

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement ||
  (t instanceof HTMLElement && t.isContentEditable)

const TAPE = '#0891b2'
const PIN = '#ea580c'

function DimLine({ a, b, label, selected, onDown }: { a: Vec; b: Vec; label: string; selected?: boolean; onDown?: (e: React.PointerEvent) => void }) {
  const { px } = useViewport()
  const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1
  const ux = dx / L, uy = dy / L, tick = px(6)
  const nx = -uy, ny = ux
  // The text above the line, with a halo like the texts of the dimension lines of the plan.
  const at = tapeLabelPlacement(a, b, px(TAPE_LABEL_GAP_PX))
  return (
    <g onPointerDown={onDown} style={{ cursor: onDown ? 'pointer' : undefined }}>
      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth={px(16)} />
      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={TAPE} strokeWidth={px(selected ? 3 : 1.5)} />
      {[a, b].map((p, i) => (
        <line key={i} x1={p.x + nx * tick} y1={p.y + ny * tick} x2={p.x - nx * tick} y2={p.y - ny * tick} stroke={TAPE} strokeWidth={px(selected ? 3 : 1.5)} />
      ))}
      <text
        x={at.p.x} y={at.p.y} transform={`rotate(${at.angle} ${at.p.x} ${at.p.y})`} data-tape-label=""
        textAnchor="middle" dominantBaseline="central" fontSize={px(12)} fill={TAPE} strokeWidth={px(3)} paintOrder="stroke"
        pointerEvents="none" className="font-mono font-semibold stroke-[#f6f7f5] dark:stroke-[#12161b]"
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
      <circle r={r} fill={PIN} stroke={selected ? '#f97316' : 'white'} strokeWidth={px(selected ? 3 : 2)} />
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
      if (sel?.kind === 'tape') {
        removeTape(sel.id)
        undoToast('Tape deleted', () => useDoc.temporal.getState().undo())
      } else if (sel?.kind === 'pin') {
        removePin(sel.id)
        undoToast('Pin deleted', () => useDoc.temporal.getState().undo())
      } else return
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

/** Tool overlay for ui.tool === 'tape': click A, click B. Shift locks the tape to 45° steps. */
export function TapeTool() {
  const { px, toWorld } = useViewport()
  const rooms = useDoc((s) => s.doc.rooms)
  const [a, setA] = useState<Vec | null>(null)
  const [hover, setHover] = useState<Vec | null>(null)
  // Last pointer position, so pressing or releasing Shift updates the preview without a move.
  const last = useRef<{ x: number; y: number } | null>(null)
  const snapAt = (cx: number, cy: number, shift: boolean) => {
    const w = toWorld(cx, cy)
    return a && shift ? snapTapeAngle(a, w, rooms, px(SNAP_PX)) : snapToPlan(w, rooms, px(SNAP_PX))
  }
  const snap = (e: React.PointerEvent) => { last.current = { x: e.clientX, y: e.clientY }; return snapAt(e.clientX, e.clientY, e.shiftKey) }

  useEffect(() => {
    if (!a) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && e.type === 'keydown') {
        e.preventDefault()
        e.stopPropagation()
        setA(null)
        setHover(null)
      } else if (e.key === 'Shift' && last.current) {
        setHover(snapAt(last.current.x, last.current.y, e.type === 'keydown').point)
      }
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('keyup', onKey, true)
    return () => { window.removeEventListener('keydown', onKey, true); window.removeEventListener('keyup', onKey, true) }
  })

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

/** Small colour chip in front of the tape section title. */
const tapeChip = <span aria-hidden="true" className="inline-block h-0.5 w-4 shrink-0" style={{ background: TAPE }} />

/** The tape inspector card. Pure: the store-connected wrapper is `TapePanel`. */
export function TapeCard({ tape, onPatch, onDelete }: { tape: TapeMeasure; onPatch: (p: Partial<TapeMeasure>) => void; onDelete: () => void }) {
  return (
    <PanelSection
      title="Tape"
      icon={tapeChip}
      actions={
        <IconButton
          label="Delete tape"
          variant="danger"
          icon={<Trash2 size={16} />}
          onClick={onDelete}
        />
      }
    >
      {/* A new key resets the drafts of the fields when another tape is selected. */}
      <Fragment key={tape.id}>
        <StatGrid items={tapeStats(tape)} columns={1} />
        <FieldRow label="Real length" htmlFor="tape-real-length">
          <NumberField
            id="tape-real-length"
            name={TAPE_FIELD_NAMES.realLength}
            ariaLabel="Real length"
            unit="cm"
            min={1}
            value={tape.actualCm ?? null}
            invalidMessage="Type a length in centimeters."
            onCommit={(v) => {
              onPatch(realLengthPatch(v))
            }}
          />
        </FieldRow>
        <FieldRow label="Note" htmlFor="tape-note">
          <TextField
            id="tape-note"
            name={TAPE_FIELD_NAMES.note}
            ariaLabel="Tape note"
            value={tape.note ?? ''}
            onCommit={(text) => {
              const p = notePatch(text)
              if (p.note !== (tape.note || undefined)) onPatch(p)
            }}
          />
        </FieldRow>
      </Fragment>
    </PanelSection>
  )
}

/** The pin inspector card. Pure: the store-connected wrapper is `PinPanel`. */
export function PinCard({ pin, onDelete }: { pin: Pin; onDelete: () => void }) {
  return (
    <PanelSection
      title="Pin"
      icon={<MapPin size={15} style={{ color: PIN }} />}
      actions={<IconButton label="Delete pin" variant="danger" icon={<Trash2 size={16} />} onClick={onDelete} />}
    >
      <div key={pin.id} data-pin={pin.id} className="flex flex-col gap-2">
        <TextField
          name={PIN_FIELD_NAMES.note}
          ariaLabel="Pin note"
          rows={3}
          placeholder="Note (radiator pipes here, panel 140 cm from floor…)"
          value={pin.text ?? ''}
          onCommit={(text) => {
            patchPin(pin.id, pinTextPatch(text))
          }}
        />
        <PinPhotos pin={pin} compact />
      </div>
    </PanelSection>
  )
}

/** Sidebar panel: the selected tape (drawn length, real length, note). */
export function TapePanel() {
  const selection = useAnnotSel((s) => s.sel)
  const tape = useDoc((s): TapeMeasure | undefined => (selection?.kind === 'tape' ? s.doc.tapes.find((t) => t.id === selection.id) : undefined))
  if (!tape) return null
  return (
    <TapeCard
      tape={tape}
      onPatch={(p) => {
        patchTape(tape.id, p, false)
      }}
      onDelete={() => {
        removeTape(tape.id)
        selectAnnot(null)
        undoToast('Tape deleted', () => useDoc.temporal.getState().undo())
      }}
    />
  )
}

/** Sidebar panel: the selected pin (text, photos). */
export function PinPanel() {
  const selection = useAnnotSel((s) => s.sel)
  const pin = useDoc((s) => (selection?.kind === 'pin' ? (s.doc.pins ?? []).find((p) => p.id === selection.id) : undefined))
  if (!pin) return null
  return (
    <PinCard
      pin={pin}
      onDelete={() => {
        removePin(pin.id)
        selectAnnot(null)
        undoToast('Pin deleted', () => useDoc.temporal.getState().undo())
      }}
    />
  )
}

export { PinEditor, PinPhotos } from './PinEditor'
