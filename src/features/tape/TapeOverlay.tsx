// Quick Tape measure (tool 'tape', Plan AND Design mode). Render in the Viewport `overlay` (world cm).
//
// Gestures, both supported:
// - click-drag: pointer down sets the first point, the drag sets the second, pointer up locks it.
// - two clicks: the first click sets the first point, the second click locks the measurement.
// A locked measurement is PINNED: it moves to `uiStore.pinnedTape` and stays on the canvas after the
// Tape tool is left (Select, Escape, the M / V keys, a mode switch), in Plan and Design mode, until its
// x button is pressed. There is only one pinned measurement at a time: the first pointer down of a new
// measurement replaces it.
// Shift (or the 45° toggle button, for touch) locks the second point to 45 degree steps from the first.
// The no-snap key (see FREE_SNAP_LABEL) turns snapping off. The pinned measurement has a solid line,
// filled dots, a dismiss button, and a label you can click to copy the distance. The Surface (tool
// 'tape' only) draws just the in-progress, dashed segment.
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { CaptureRect, useViewport } from '../../canvas/Viewport'
import { ToolHint } from '../../canvas/ToolHint'
import { dist } from '../../model/geometry'
import type { Vec } from '../../model/geometry'
import { useDoc } from '../../model/store'
import { FREE_SNAP_LABEL, getModifiers, isFreeSnap, subscribeModifiers, syncModifiersFromEvent } from '../../shell/modifiers'
import type { Modifiers } from '../../shell/modifiers'
import { useUi, clearPinnedTape, pinTape } from '../../shell/uiStore'
import { toast } from '../toast'
import { fmtTapeCm, measureSegment, snapTapePoint, tapeLabelOffset } from './geometry'
import type { TapeSnap } from './geometry'

const SKY = '#38bdf8'
const ORANGE = '#fb923c'

/** Screen pixels of pointer travel that turn a click into a drag. */
const DRAG_PX = 5

/** A finished measurement, as kept in `uiStore.pinnedTape`. */
type PinnedTapeState = { a: TapeSnap; b: TapeSnap }

/** Snap the second point of a measurement, from the live document and the current modifiers. */
const snapEndpoint = (raw: Vec, anchor: Vec, mods: Modifiers, thresholdCm: number, lock45 = false): TapeSnap =>
  snapTapePoint(raw, useDoc.getState().doc.artboards, thresholdCm, {
    anchor,
    shift: mods.shift || lock45,
    disableSnap: isFreeSnap(mods),
  })

/** The in-progress measurement. Only draws while the Tape tool is the active tool. */
export function TapeOverlay() {
  const tool = useUi((s) => s.tool)
  if (tool !== 'tape') return null
  return <Surface />
}

/** The pinned (locked) measurement. Rendered whatever the active tool and mode: it outlives the Tape tool. */
export function PinnedTape() {
  const pinned = useUi((s) => s.pinnedTape)
  return <PinnedMeasurement pinned={pinned} />
}

/** Compact dark pill with one text line (the distance), drawn in world cm from screen-constant sizes. */
function WorldLabel({ cx, cy, w, h, text, onClick }: { cx: number; cy: number; w: number; h: number; text: string; onClick?: () => void }) {
  const { px } = useViewport()
  return (
    <g
      pointerEvents={onClick ? 'all' : 'none'}
      style={onClick ? { cursor: 'copy' } : undefined}
      data-testid="tape-label"
      onPointerDown={onClick ? (e) => e.stopPropagation() : undefined}
      onClick={onClick}
    >
      <title>{onClick ? 'Click to copy the distance' : ''}</title>
      <rect
        x={cx - w / 2} y={cy - h / 2} width={w} height={h} rx={Math.min(h / 2, px(12))}
        fill="#0d1216" fillOpacity={0.94} stroke={SKY} strokeOpacity={0.45} strokeWidth={px(1)}
      />
      <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central" fontSize={px(11)} fill="#e0f2fe">
        {text}
      </text>
    </g>
  )
}

/** Endpoint dot: a hollow orange ring when the point is snapped to something. */
function EndDot({ p, snapped, locked }: { p: Vec; snapped: boolean; locked: boolean }) {
  const { px } = useViewport()
  if (locked) return <circle cx={p.x} cy={p.y} r={px(4.5)} fill={snapped ? ORANGE : SKY} stroke="#0d1216" strokeWidth={px(1.2)} />
  return snapped
    ? <circle cx={p.x} cy={p.y} r={px(4.5)} fill="none" stroke={ORANGE} strokeWidth={px(1.8)} />
    : <circle cx={p.x} cy={p.y} r={px(3)} fill={SKY} />
}

/** Locked look of one measurement: solid line, filled dots, copyable label and the x dismiss button. */
export function PinnedMeasurement({ pinned }: { pinned: PinnedTapeState | null }) {
  const { px } = useViewport()
  if (!pinned) return null
  const seg = measureSegment(pinned.a.point, pinned.b.point)
  if (seg.distCm <= 0) return null
  /** The canvas pill shows the distance only: one compact line, never two. */
  const labelText = fmtTapeCm(seg.distCm)
  const labelH = px(20)
  const labelW = px(labelText.length * 6.6 + 12)
  /** Label centre, pushed clear of the line so the pill never covers it at any angle. */
  const labelPos = tapeLabelOffset(pinned.a.point, pinned.b.point, labelW, labelH, px(10))

  const copyDistance = () => {
    const text = fmtTapeCm(seg.distCm)
    const done = () => toast(`Copied ${text}`, { kind: 'success' })
    const fail = () => toast('Copy not available', { kind: 'error' })
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, fail)
    else fail()
  }

  return (
    <g data-testid="tape-pinned">
      {/* The line and the dots never take pointer events: canvas clicks must reach the tools. */}
      <g pointerEvents="none" data-testid="tape-measure" data-locked="">
        <line
          x1={pinned.a.point.x} y1={pinned.a.point.y} x2={pinned.b.point.x} y2={pinned.b.point.y}
          stroke={SKY} strokeWidth={px(2)} strokeLinecap="round"
        />
        <EndDot p={pinned.a.point} snapped={pinned.a.snapped} locked />
        <EndDot p={pinned.b.point} snapped={pinned.b.snapped} locked />
      </g>
      <WorldLabel
        cx={labelPos.x} cy={labelPos.y}
        w={labelW} h={labelH}
        text={labelText}
        onClick={copyDistance}
      />
      <g
        data-testid="tape-dismiss"
        role="button"
        aria-label="Dismiss measurement"
        style={{ cursor: 'pointer' }}
        onPointerDown={(e) => { e.stopPropagation(); clearPinnedTape() }}
      >
        <circle cx={pinned.b.point.x + px(14)} cy={pinned.b.point.y - px(14)} r={px(9)} fill="#0d1216" stroke={SKY} strokeOpacity={0.6} strokeWidth={px(1)} />
        <path
          d={`M${pinned.b.point.x + px(11)} ${pinned.b.point.y - px(17)} l${px(6)} ${px(6)} m${-px(6)} 0 l${px(6)} ${-px(6)}`}
          stroke="#e0f2fe" strokeWidth={px(1.5)} strokeLinecap="round" fill="none"
        />
      </g>
    </g>
  )
}

function Surface() {
  const { px, toWorld } = useViewport()
  const [lock45, setLock45] = useState(false)
  const lockRef = useRef(false)
  useEffect(() => { lockRef.current = lock45 }, [lock45])
  const [measuring, setMeasuring] = useState(false)
  const [a, setA] = useState<TapeSnap | null>(null)
  const [b, setB] = useState<TapeSnap | null>(null)
  /** True when a pinned measurement exists somewhere on the canvas (hint only). */
  const hasPinned = useUi((s) => s.pinnedTape !== null)
  /** First point, readable from the pointer handlers and the modifier listener. */
  const aRef = useRef<TapeSnap | null>(null)
  /** Raw (unsnapped) world point under the pointer, to re-apply a modifier change mid-gesture. */
  const rawRef = useRef<Vec | null>(null)
  /** Screen position of the pointer down, to tell a click from a drag. */
  const downRef = useRef<{ x: number; y: number } | null>(null)
  /** True between the first click of a two-click measurement and the second click. */
  const awaitingRef = useRef(false)

  /** Second point for a raw pointer position: Shift = 45 degrees, Alt = no snap. */
  const endpoint = (raw: Vec, anchor: Vec, mods: Modifiers): TapeSnap => snapEndpoint(raw, anchor, mods, px(10), lockRef.current)

  // Re-apply the preview when Shift/no-snap change mid-gesture (no pointer movement needed).
  useEffect(() => {
    if (!measuring) return
    return subscribeModifiers((m) => {
      const raw = rawRef.current
      const anchor = aRef.current
      if (!raw || !anchor) return
      setB(snapEndpoint(raw, anchor.point, m, px(10), lockRef.current))
    })
  }, [measuring, px])

  // Re-apply the preview when the 45° toggle changes.
  useEffect(() => {
    const raw = rawRef.current
    const anchor = aRef.current
    if (!measuring || !raw || !anchor) return
    setB(snapEndpoint(raw, anchor.point, getModifiers(), px(10), lock45))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lock45])

  const reset = () => {
    setMeasuring(false); setA(null); setB(null)
    aRef.current = null; rawRef.current = null; downRef.current = null; awaitingRef.current = false
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable]')) return
      if (e.key !== 'Escape') return
      // Escape leaves the tool but keeps the pinned measurement (only its x button removes it).
      reset()
      useUi.getState().set({ tool: 'select' })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  /** Finish the measurement: pin it on the canvas, then go back to idle so the Surface draws nothing. */
  const lockMeasurement = (from: TapeSnap, to: TapeSnap) => {
    reset()
    if (dist(from.point, to.point) > 0) pinTape(from, to)
  }

  const onDown = (e: ReactPointerEvent<SVGRectElement>) => {
    if (e.button !== 0) return
    e.stopPropagation()
    const mods = syncModifiersFromEvent(e)
    const raw = toWorld(e.clientX, e.clientY)
    rawRef.current = raw
    // Second click of a two-click measurement: lock the measurement at this point.
    if (awaitingRef.current && aRef.current) {
      lockMeasurement(aRef.current, endpoint(raw, aRef.current.point, mods))
      return
    }
    // A new measurement: there is only one at a time, so the pinned one goes now.
    clearPinnedTape()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    const first = snapTapePoint(raw, useDoc.getState().doc.artboards, px(10), { disableSnap: isFreeSnap(mods) })
    aRef.current = first
    setA(first); setB(null)
    setMeasuring(true)
    awaitingRef.current = false
    downRef.current = { x: e.clientX, y: e.clientY }
  }

  const onMove = (e: ReactPointerEvent<SVGRectElement>) => {
    const anchor = aRef.current
    const raw = toWorld(e.clientX, e.clientY)
    const mods = syncModifiersFromEvent(e)
    rawRef.current = raw
    if (!anchor || !measuring) return
    setB(endpoint(raw, anchor.point, mods))
  }

  const onUp = (e: ReactPointerEvent<SVGRectElement>) => {
    const anchor = aRef.current
    const down = downRef.current
    if (!anchor || !down) return
    e.currentTarget.releasePointerCapture?.(e.pointerId)
    const mods = syncModifiersFromEvent(e)
    const end = endpoint(toWorld(e.clientX, e.clientY), anchor.point, mods)
    rawRef.current = null
    downRef.current = null
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y) > DRAG_PX
    if (moved && dist(anchor.point, end.point) > 0) {
      // A drag: the measurement is complete and gets pinned.
      lockMeasurement(anchor, end)
      return
    }
    // A click: wait for the second click to lock the measurement.
    setB(end)
    awaitingRef.current = true
    setMeasuring(true)
  }

  const seg = a && b ? measureSegment(a.point, b.point) : null
  const show = !!a && !!b && !!seg && seg.distCm > 0

  /** Full readout, kept in the hint bar so it never sits on the drawing. */
  const readout = show && seg
    ? `${fmtTapeCm(seg.distCm)} · Δx ${fmtTapeCm(Math.abs(seg.dxCm))} · Δy ${fmtTapeCm(Math.abs(seg.dyCm))} · ${Math.round(seg.angleDeg * 10) / 10}°`
    : null

  const hint =
    !measuring
      ? (hasPinned
        ? `Tape (M): Click or drag to measure (replaces the pinned one) · Shift 45° · ${FREE_SNAP_LABEL} no snap · Esc exit`
        : `Tape (M): Click or drag to measure · Shift 45° · ${FREE_SNAP_LABEL} no snap · Esc exit`)
      : (
        <>
          {readout && <span data-testid="tape-readout" className="font-semibold text-sky-200">{readout}</span>}
          {readout ? ' · ' : ''}
          {`Click or drag the second point · Shift 45° · ${FREE_SNAP_LABEL} no snap · Esc exit`}
        </>
      )

  return (
    <g data-testid="tape-overlay">
      <ToolHint text={hint} />
      {createPortal(
        <button
          type="button"
          data-testid="tape-lock45"
          aria-pressed={lock45}
          className={`pointer-events-auto fixed bottom-24 right-3 z-30 hidden h-11 min-w-11 items-center justify-center rounded-full border px-3 text-xs font-semibold shadow-lg pointer-coarse:flex ${
            lock45 ? 'border-sky-400 bg-sky-500 text-white' : 'border-white/20 bg-surface-2 text-slate-200'
          }`}
          onClick={() => setLock45((v) => !v)}
        >
          45°
        </button>,
        document.body,
      )}
      <CaptureRect
        style={{ cursor: 'crosshair' }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={reset}
      />
      {show && a && b && (
        <g pointerEvents="none" data-testid="tape-measure">
          <line
            x1={a.point.x} y1={a.point.y} x2={b.point.x} y2={b.point.y}
            stroke={SKY} strokeWidth={px(1.5)} strokeDasharray={`${px(6)} ${px(4)}`} strokeLinecap="round"
          />
          <EndDot p={a.point} snapped={a.snapped} locked={false} />
          <EndDot p={b.point} snapped={b.snapped} locked={false} />
        </g>
      )}
    </g>
  )
}
