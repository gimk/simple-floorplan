// Quick Tape measure (tool 'tape', Plan AND Design mode). Render in the Viewport `overlay` (world cm).
//
// Gestures, both supported:
// - click-drag: pointer down sets the first point, the drag sets the second, pointer up locks it.
// - two clicks: the first click sets the first point, the second click locks the measurement.
// A locked measurement stays on screen until the next pointer down or Escape.
// Shift locks the second point to 45 degree steps from the first, Alt turns snapping off.
import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { CaptureRect, useViewport } from '../../canvas/Viewport'
import { dist } from '../../model/geometry'
import type { Vec } from '../../model/geometry'
import { useDoc } from '../../model/store'
import { subscribeModifiers, syncModifiersFromEvent } from '../../shell/modifiers'
import type { Modifiers } from '../../shell/modifiers'
import { useUi } from '../../shell/uiStore'
import { fmtTapeCm, measureSegment, snapTapePoint } from './geometry'
import type { TapeSnap } from './geometry'

const SKY = '#38bdf8'
const ORANGE = '#fb923c'
const HINT = 'Tape (M): Click or drag to measure · Shift 45° · Alt free · Esc exit'

/** Screen pixels of pointer travel that turn a click into a drag. */
const DRAG_PX = 5

/** Snap the second point of a measurement, from the live document and the current modifiers. */
const snapEndpoint = (raw: Vec, anchor: Vec, mods: Modifiers, thresholdCm: number): TapeSnap =>
  snapTapePoint(raw, useDoc.getState().doc.artboards, thresholdCm, {
    anchor,
    shift: mods.shift,
    disableSnap: mods.alt,
  })

export function TapeOverlay() {
  const tool = useUi((s) => s.tool)
  if (tool !== 'tape') return null
  return <Surface />
}

/** Dark rounded pill with a text label, drawn in world cm from screen-constant sizes. */
function WorldLabel({ cx, cy, text }: { cx: number; cy: number; text: string }) {
  const { px } = useViewport()
  const h = px(18)
  const w = px(text.length * 6.6 + 14)
  return (
    <g pointerEvents="none">
      <rect
        x={cx - w / 2} y={cy - h / 2} width={w} height={h} rx={h / 2}
        fill="#0d1216" fillOpacity={0.94} stroke={SKY} strokeOpacity={0.45} strokeWidth={px(1)}
      />
      <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central" fontSize={px(11)} fill="#e0f2fe">
        {text}
      </text>
    </g>
  )
}

/** Endpoint dot: a hollow orange ring when the point is snapped to something. */
function EndDot({ p, snapped }: { p: Vec; snapped: boolean }) {
  const { px } = useViewport()
  return snapped
    ? <circle cx={p.x} cy={p.y} r={px(4.5)} fill="none" stroke={ORANGE} strokeWidth={px(1.8)} />
    : <circle cx={p.x} cy={p.y} r={px(3)} fill={SKY} />
}

/** Top-centre hint pill. Drawn in a screen-space group, so the sizes are plain screen px. */
function HintPill({ cx, cy }: { cx: number; cy: number }) {
  const h = 22
  const w = HINT.length * 5.6 + 20
  return (
    <g pointerEvents="none">
      <rect
        x={cx - w / 2} y={cy - h / 2} width={w} height={h} rx={h / 2}
        fill="#0d1216" fillOpacity={0.9} stroke="#ffffff" strokeOpacity={0.12} strokeWidth={1}
      />
      <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central" fontSize={11} fill="#cbd5e1">
        {HINT}
      </text>
    </g>
  )
}

type Phase = 'idle' | 'measuring' | 'locked'

function Surface() {
  const { px, toWorld, svg } = useViewport()
  const view = useUi((s) => s.view)
  const [phase, setPhase] = useState<Phase>('idle')
  const [a, setA] = useState<TapeSnap | null>(null)
  const [b, setB] = useState<TapeSnap | null>(null)
  /** First point, readable from the pointer handlers and the modifier listener. */
  const aRef = useRef<TapeSnap | null>(null)
  /** Raw (unsnapped) world point under the pointer, to re-apply a modifier change mid-gesture. */
  const rawRef = useRef<Vec | null>(null)
  /** Screen position of the pointer down, to tell a click from a drag. */
  const downRef = useRef<{ x: number; y: number } | null>(null)
  /** True between the first click of a two-click measurement and the second click. */
  const awaitingRef = useRef(false)

  /** Second point for a raw pointer position: Shift = 45 degrees, Alt = no snap. */
  const endpoint = (raw: Vec, anchor: Vec, mods: Modifiers): TapeSnap => snapEndpoint(raw, anchor, mods, px(10))

  // Re-apply the preview when Shift/Alt change mid-gesture (no pointer movement needed).
  useEffect(() => {
    if (phase !== 'measuring') return
    return subscribeModifiers((m) => {
      const raw = rawRef.current
      const anchor = aRef.current
      if (!raw || !anchor) return
      setB(snapEndpoint(raw, anchor.point, m, px(10)))
    })
  }, [phase, px])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable]')) return
      if (e.key !== 'Escape') return
      setPhase('idle'); setA(null); setB(null)
      aRef.current = null; rawRef.current = null; downRef.current = null; awaitingRef.current = false
      useUi.getState().set({ tool: 'select' })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const reset = () => {
    setPhase('idle'); setA(null); setB(null)
    aRef.current = null; rawRef.current = null; downRef.current = null; awaitingRef.current = false
  }

  const onDown = (e: ReactPointerEvent<SVGRectElement>) => {
    if (e.button !== 0) return
    e.stopPropagation()
    const mods = syncModifiersFromEvent(e)
    const raw = toWorld(e.clientX, e.clientY)
    rawRef.current = raw
    // Second click of a two-click measurement: lock the measurement at this point.
    if (awaitingRef.current && aRef.current) {
      setB(endpoint(raw, aRef.current.point, mods))
      awaitingRef.current = false
      downRef.current = null
      setPhase('locked')
      return
    }
    e.currentTarget.setPointerCapture?.(e.pointerId)
    const first = snapTapePoint(raw, useDoc.getState().doc.artboards, px(10), { disableSnap: mods.alt })
    aRef.current = first
    setA(first); setB(null)
    setPhase('measuring')
    awaitingRef.current = false
    downRef.current = { x: e.clientX, y: e.clientY }
  }

  const onMove = (e: ReactPointerEvent<SVGRectElement>) => {
    const anchor = aRef.current
    const raw = toWorld(e.clientX, e.clientY)
    const mods = syncModifiersFromEvent(e)
    rawRef.current = raw
    if (!anchor || phase !== 'measuring') return
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
    setB(end)
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y) > DRAG_PX
    if (moved && dist(anchor.point, end.point) > 0) {
      // A drag: the measurement is complete and stays on screen.
      awaitingRef.current = false
      setPhase('locked')
      return
    }
    // A click: wait for the second click to lock the measurement.
    awaitingRef.current = true
    setPhase('measuring')
  }

  const seg = a && b ? measureSegment(a.point, b.point) : null
  const show = !!a && !!b && !!seg && seg.distCm > 0
  const midX = a && b ? (a.point.x + b.point.x) / 2 : 0
  const midY = a && b ? (a.point.y + b.point.y) / 2 : 0
  const wPx = svg?.clientWidth ?? 800

  return (
    <g data-testid="tape-overlay">
      <CaptureRect
        style={{ cursor: 'crosshair' }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={reset}
      />
      {show && a && b && seg && (
        <g pointerEvents="none">
          <line
            x1={a.point.x} y1={a.point.y} x2={b.point.x} y2={b.point.y}
            stroke={SKY} strokeWidth={px(1.5)} strokeDasharray={`${px(6)} ${px(4)}`} strokeLinecap="round"
          />
          <EndDot p={a.point} snapped={a.snapped} />
          <EndDot p={b.point} snapped={b.snapped} />
          <WorldLabel cx={midX} cy={midY - px(14)} text={fmtTapeCm(seg.distCm)} />
        </g>
      )}
      <g transform={`translate(${view.x} ${view.y}) scale(${1 / view.zoom})`}>
        <HintPill cx={wPx / 2} cy={20} />
      </g>
    </g>
  )
}
