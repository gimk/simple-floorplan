// Full-screen editor for the dimension marks drawn on one pin photo (docs/plan.md 7.4).
// Tap A then B to draw a double-headed arrow, then type the measured cm or link one of the
// pin room's survey IDs. Every mark change is ONE undo step in the doc store.
import { useEffect, useRef, useState } from 'react'
import { Ruler, Trash2, Undo2, X } from 'lucide-react'
import { uid, useDoc } from '../../model/store'
import type { PhotoMark, Pin } from '../../model/types'
import { FieldRow, IconButton, NumberField, SelectField, TextField } from '../../shell/panel'
import { usePhotoUrl } from '../../sync/photos'
import { patchPin } from '../annotations/actions'
import {
  markIsMeasured,
  markLabelText,
  markMiddle,
  markSummary,
  marksOf,
  normPoint,
  photoIndexOf,
  pxPoint,
  surveyOptionsForPin,
  withMark,
  withPatchedMark,
  withPhotoMarks,
  withoutMark,
  type PhotoBox,
  type PhotoPoint,
} from './logic'

/** Arrow colour: readable on a pale wall and on a dark cellar photo (dark halo under it). */
const MARK = '#f59e0b'
const HALO = 'rgba(0, 0, 0, 0.72)'

/** One arrow, its two tips and the value label at its middle, in photo pixels. */
function MarkGlyph({ mark, box, label, selected }: { mark: PhotoMark; box: PhotoBox; label: string; selected: boolean }) {
  const a = pxPoint(mark.a, box)
  const b = pxPoint(mark.b, box)
  const stroke = selected ? '#ffffff' : MARK
  const width = selected ? 3 : 2.5
  const ang = Math.atan2(b.y - a.y, b.x - a.x)
  const barbs: { x1: number; y1: number; x2: number; y2: number }[] = []
  for (const [tip, away] of [[a, ang], [b, ang + Math.PI]] as const) {
    for (const t of [away - 0.45, away + 0.45]) {
      barbs.push({ x1: tip.x, y1: tip.y, x2: tip.x + Math.cos(t) * 12, y2: tip.y + Math.sin(t) * 12 })
    }
  }
  // Push the label off the line, so a flat arrow keeps a readable label.
  const mid = markMiddle(mark, box)
  const lx = mid.x - Math.sin(ang) * 14
  const ly = mid.y + Math.cos(ang) * 14
  return (
    <g>
      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={HALO} strokeWidth={selected ? 6 : 5} strokeLinecap="round" />
      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={stroke} strokeWidth={width} strokeLinecap="round" />
      {barbs.map((l, i) => (
        <line key={i} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke={HALO} strokeWidth={5} strokeLinecap="round" />
      ))}
      {barbs.map((l, i) => (
        <line key={`c${i}`} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke={stroke} strokeWidth={width} strokeLinecap="round" />
      ))}
      {[a, b].map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={4} fill={MARK} stroke="#ffffff" strokeWidth={1.5} />
      ))}
      {label && (
        <text
          x={lx}
          y={ly}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={15}
          fontWeight={600}
          fill="#ffffff"
          stroke={HALO}
          strokeWidth={3.5}
          strokeLinejoin="round"
          paintOrder="stroke"
          style={{ fontVariantNumeric: 'tabular-nums' }}
        >
          {label}
        </text>
      )}
    </g>
  )
}

/**
 * Full-screen dialog over one pin photo: draw dimension arrows, set the cm value or link a
 * survey ID, delete and undo. Escape closes it (or cancels the pending first point).
 */
export function PhotoSketch({ pin, photoKey, onClose }: { pin: Pin; photoKey: string; onClose: () => void }) {
  const doc = useDoc((s) => s.doc)
  // Read the live pin: every change goes through the store, so the dialog stays fresh.
  const live = useDoc((s) => (s.doc.pins ?? []).find((p) => p.id === pin.id))
  const current = live ?? pin
  const url = usePhotoUrl(photoKey)
  const marks = marksOf(current, photoKey)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [pending, setPending] = useState<PhotoPoint | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [box, setBox] = useState<{ w: number; h: number; left: number; top: number }>({ w: 0, h: 0, left: 0, top: 0 })
  const wrap = useRef<HTMLDivElement | null>(null)
  const img = useRef<HTMLImageElement | null>(null)
  const svg = useRef<SVGSVGElement | null>(null)
  const selected = marks.find((m) => m.id === selectedId) ?? null
  const options = surveyOptionsForPin(current, doc)
  const index = photoIndexOf(current, photoKey)

  // The drawn photo is the <img> layout box (max-h/max-w keep its aspect ratio), centred in
  // the wrapper: the SVG is laid exactly on top of it.
  useEffect(() => {
    const measure = () => {
      const i = img.current, w = wrap.current
      if (!i || !w) return
      const ir = i.getBoundingClientRect(), wr = w.getBoundingClientRect()
      if (ir.width > 0 && ir.height > 0) setBox({ w: ir.width, h: ir.height, left: ir.left - wr.left, top: ir.top - wr.top })
    }
    measure()
    window.addEventListener('resize', measure)
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    if (ro && wrap.current) ro.observe(wrap.current)
    return () => {
      window.removeEventListener('resize', measure)
      ro?.disconnect()
    }
  }, [url, loaded])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      if (pending) setPending(null)
      else onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [pending, onClose])

  /** One undo step per mark change. */
  const save = (next: PhotoMark[]) => patchPin(current.id, { sketches: withPhotoMarks(current, photoKey, next) }, false)

  const onPhotoDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return
    const el = svg.current
    if (!el) return
    const r = el.getBoundingClientRect()
    if (!(r.width > 0 && r.height > 0)) return
    const pt = normPoint(e.clientX - r.left, e.clientY - r.top, { w: r.width, h: r.height })
    if (!pending) {
      setPending(pt)
      return
    }
    if (Math.hypot((pt.x - pending.x) * r.width, (pt.y - pending.y) * r.height) < 8) {
      setPending(null)
      return
    }
    const mark: PhotoMark = { id: uid('mk'), a: pending, b: pt }
    save(withMark(marks, mark))
    setPending(null)
    setSelectedId(mark.id)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-[#0b0f13] text-slate-100"
      role="dialog"
      aria-modal="true"
      aria-label={`Annotate photo ${index + 1}`}
      data-photosketch="open"
    >
      <header className="flex items-center gap-1 border-b border-white/10 px-2 py-1.5">
        <Ruler size={16} aria-hidden className="shrink-0 text-amber-400" />
        <b className="min-w-0 flex-1 truncate text-sm">
          Photo {index + 1} · {marks.length === 1 ? '1 mark' : `${marks.length} marks`}
        </b>
        <IconButton
          label="Undo mark change"
          icon={<Undo2 size={16} />}
          onClick={() => useDoc.temporal.getState().undo()}
          className="text-slate-200 hover:bg-white/10"
        />
        <button
          type="button"
          onClick={onClose}
          className="flex min-h-11 items-center gap-1 rounded-lg bg-orange-700 px-3 text-sm font-semibold text-white"
        >
          <X size={16} /> Close
        </button>
      </header>

      <div ref={wrap} className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-black">
        {url ? (
          <img
            ref={img}
            src={url}
            alt={`Photo ${index + 1}`}
            onLoad={() => setLoaded(true)}
            className="block max-h-full max-w-full touch-none select-none"
          />
        ) : (
          <p className="p-4 text-sm text-slate-400">Loading photo…</p>
        )}
        {url && box.w > 0 && (
          <svg
            ref={svg}
            className="absolute touch-none"
            style={{ left: box.left, top: box.top, width: box.w, height: box.h }}
            onPointerDown={onPhotoDown}
            role="application"
            aria-label="Photo with dimension marks"
          >
            <rect x={0} y={0} width="100%" height="100%" fill="transparent" />
            {marks.map((m) => {
              const a = pxPoint(m.a, box), b = pxPoint(m.b, box)
              return (
                <g
                  key={m.id}
                  onPointerDown={(e) => {
                    e.stopPropagation()
                    setSelectedId(m.id)
                  }}
                  style={{ cursor: 'pointer' }}
                >
                  <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth={22} />
                  <MarkGlyph mark={m} box={box} label={markLabelText(m, doc)} selected={m.id === selected?.id} />
                </g>
              )
            })}
            {pending && (
              <g pointerEvents="none">
                <circle cx={pxPoint(pending, box).x} cy={pxPoint(pending, box).y} r={9} fill="none" stroke="#ffffff" strokeWidth={2.5} />
                <circle cx={pxPoint(pending, box).x} cy={pxPoint(pending, box).y} r={2.5} fill="#ffffff" />
              </g>
            )}
          </svg>
        )}
      </div>

      <div className="max-h-[46vh] shrink-0 overflow-auto border-t border-white/10 bg-white p-2.5 pb-[calc(0.625rem+env(safe-area-inset-bottom))] text-slate-900 dark:bg-[#1b2128] dark:text-slate-100">
        <p className="text-[13px] text-slate-500 dark:text-slate-400">
          {pending ? 'Tap the second point of the dimension.' : 'Tap two points on the photo to draw an arrow.'}
        </p>
        {marks.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {marks.map((m, i) => (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(m.id)}
                  aria-pressed={m.id === selected?.id}
                  className={`flex min-h-9 items-center gap-1.5 rounded-md border px-2 text-xs font-semibold pointer-coarse:min-h-11 ${
                    m.id === selected?.id
                      ? 'border-orange-700 bg-orange-700 text-white'
                      : 'border-black/15 text-slate-700 hover:bg-black/5 dark:border-white/20 dark:text-slate-200 dark:hover:bg-white/10'
                  }`}
                >
                  <span className="tabular-nums">{i + 1}</span>
                  {markSummary(m, doc) || 'no value'}
                </button>
              </li>
            ))}
          </ul>
        )}
        {selected && (
          <div className="mt-2.5 flex flex-col gap-2" data-mark={selected.id}>
            <FieldRow label="Value" htmlFor={selected.label ? undefined : 'mark-value'}>
              {selected.label ? (
                <p className="min-w-0 text-sm">
                  {markLabelText(selected, doc) || 'no value yet'}{' '}
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    from {selected.label} ({markIsMeasured(selected, doc) ? 'measured' : 'planned'})
                  </span>
                </p>
              ) : (
                <NumberField
                  id="mark-value"
                  name="markValue"
                  ariaLabel="Mark value"
                  unit="cm"
                  min={1}
                  value={selected.valueCm ?? null}
                  invalidMessage="Type a length in centimeters."
                  onCommit={(v) => save(withPatchedMark(marks, selected.id, { valueCm: v ?? undefined }))}
                />
              )}
            </FieldRow>
            <FieldRow label="Survey ID" htmlFor="mark-label">
              <SelectField
                id="mark-label"
                name="markLabel"
                ariaLabel="Survey ID"
                value={selected.label ?? ''}
                options={[{ value: '', label: options.length ? '— none —' : 'No room' }, ...options]}
                onChange={(v) => save(withPatchedMark(marks, selected.id, { label: v || undefined }))}
              />
            </FieldRow>
            <FieldRow label="Note" htmlFor="mark-note">
              <TextField
                id="mark-note"
                name="markNote"
                ariaLabel="Mark note"
                value={selected.note ?? ''}
                onCommit={(text) => {
                  const note = text.trim() || undefined
                  if (note !== selected.note) save(withPatchedMark(marks, selected.id, { note }))
                }}
              />
            </FieldRow>
            <div className="flex items-center justify-end">
              <button
                type="button"
                onClick={() => {
                  save(withoutMark(marks, selected.id))
                  setSelectedId(null)
                }}
                className="flex min-h-9 items-center gap-1.5 rounded-md border border-red-600/40 px-2 text-sm font-semibold text-red-700 hover:bg-red-500/10 pointer-coarse:min-h-11 dark:border-red-400/40 dark:text-red-400"
              >
                <Trash2 size={16} /> Delete mark
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/** Light overlay of the marks of one photo, for thumbnails. */
export function PhotoMarksOverlay({ marks, className }: { marks: PhotoMark[]; className?: string }) {
  if (!marks.length) return null
  return (
    <svg
      viewBox="0 0 1 1"
      preserveAspectRatio="none"
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 size-full ${className ?? ''}`}
    >
      {marks.map((m) => (
        <g key={m.id}>
          <line x1={m.a.x} y1={m.a.y} x2={m.b.x} y2={m.b.y} stroke="rgba(0,0,0,0.55)" strokeWidth={3} vectorEffect="non-scaling-stroke" />
          <line x1={m.a.x} y1={m.a.y} x2={m.b.x} y2={m.b.y} stroke={MARK} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        </g>
      ))}
    </svg>
  )
}

/** Small "N marks" badge of a photo thumbnail. */
export function MarksBadge({ count }: { count: number }) {
  if (!count) return null
  return (
    <span
      title={`${count} dimension ${count === 1 ? 'mark' : 'marks'}`}
      data-marks={count}
      className="pointer-events-none absolute bottom-0.5 left-0.5 flex items-center gap-0.5 rounded-full bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold text-white"
    >
      <Ruler size={10} aria-hidden />
      {count}
    </span>
  )
}
