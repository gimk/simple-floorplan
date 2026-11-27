// 2-point calibration of a reference image: click two points, type the real distance (cm), done.
// The two points can be dragged to fine-tune them. The form is an HTML portal clamped to the window.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useDoc } from '../../model/store'
import { useUi } from '../../shell/uiStore'
import { CaptureRect, useViewport } from '../../canvas/Viewport'
import { ToolHint } from '../../canvas/ToolHint'
import { parseCommaNumber } from './rotate'
import { calibrateScale, pixelAtWorld } from './calibrate'
import { computeCmPerPx } from './scale'
import { dist } from '../../model/geometry'
import type { Vec } from '../../model/geometry'
import { CANVAS_SELECT_DEEP } from '../../shell/canvasTokens'

const PAD = 8
const FORM_W = 256

export function CalibrateOverlay() {
  const tool = useUi((s) => s.tool)
  const imageId = useUi((s) => s.calibratingImageId)
  const view = useUi((s) => s.view)
  const img = useDoc((s) => s.doc.refImages.find((r) => r.id === imageId))
  const { toWorld, px, svg } = useViewport()
  const [pts, setPts] = useState<Vec[]>([])
  const [hover, setHover] = useState<Vec | null>(null)
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [drag, setDrag] = useState<number | null>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const [formPos, setFormPos] = useState({ left: 0, top: 0 })

  const active = tool === 'calibrate-image' && !!imageId && !!img
  const finish = () => {
    setPts([]); setHover(null); setText(''); setError(null)
    useUi.getState().set({ tool: 'select', calibratingImageId: null })
  }

  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setPts([]); setText(''); setError(null); useUi.getState().set({ tool: 'select', calibratingImageId: null }) } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active])

  // Place the form next to point B (screen coords), then clamp it inside the window.
  const second = pts.length === 2 ? pts[1] : null
  useLayoutEffect(() => {
    if (!second) return
    const r = svg?.getBoundingClientRect()
    const sx = (r?.left ?? 0) + (second.x - view.x) * view.zoom + 14
    const sy = (r?.top ?? 0) + (second.y - view.y) * view.zoom + 14
    const w = formRef.current?.offsetWidth ?? FORM_W
    const h = formRef.current?.offsetHeight ?? 150
    setFormPos({
      left: Math.max(PAD, Math.min(sx, window.innerWidth - PAD - w)),
      top: Math.max(PAD, Math.min(sy, window.innerHeight - PAD - h)),
    })
  }, [second, view.x, view.y, view.zoom, svg, error, text])

  if (!active || !img) return null

  const real = parseCommaNumber(text)
  const liveScale = pts.length === 2 ? computeCmPerPx(img, pts[0], pts[1], real) : null
  const measuredPx = pts.length === 2 ? dist(pixelAtWorld(img, pts[0]), pixelAtWorld(img, pts[1])) : 0

  const submit = () => {
    const next = computeCmPerPx(img, pts[0], pts[1], real)
    if (next === null) { setError('Type a distance above 0 cm.'); return }
    const r = calibrateScale(img, pts[0], pts[1], real)
    useDoc.getState().updateRefImage(img.id, { cmPerPx: r.cmPerPx, xCm: r.xCm, yCm: r.yCm })
    finish()
  }

  const dot = (p: Vec, k: number) => (
    <g key={k}>
      {pts.length === 2 && <circle cx={p.x} cy={p.y} r={px(12)} fill="transparent" style={{ cursor: 'move' }}
        onPointerDown={(e) => { if (e.button !== 0) return; e.stopPropagation(); e.currentTarget.setPointerCapture?.(e.pointerId); setDrag(k) }}
        onPointerMove={(e) => { if (drag === k) { const w = toWorld(e.clientX, e.clientY); setPts((cur) => cur.map((q, i) => (i === k ? w : q))) } }}
        onPointerUp={(e) => { e.currentTarget.releasePointerCapture?.(e.pointerId); setDrag(null) }}
        onPointerCancel={() => setDrag(null)}
      />}
      <circle cx={p.x} cy={p.y} r={px(5)} fill={CANVAS_SELECT_DEEP} stroke="#fff" strokeWidth={px(1.5)} pointerEvents="none" />
    </g>
  )
  const end = pts.length === 2 ? pts[1] : hover

  const hint = pts.length === 0
    ? 'Click point A of a known distance · Esc cancel'
    : pts.length === 1
      ? 'Click point B of the same distance · Esc cancel'
      : 'Drag a point to fine-tune · Type the real distance · Enter apply · Esc cancel'

  return (
    <g data-testid="calibrate-overlay">
      <ToolHint step={`${Math.min(pts.length + 1, 2)}/2`} text={hint} />
      <CaptureRect
        style={{ cursor: 'crosshair' }}
        onPointerMove={(e) => { if (pts.length === 1) setHover(toWorld(e.clientX, e.clientY)) }}
        onPointerDown={(e) => {
          if (e.button !== 0 || pts.length >= 2) return
          e.stopPropagation()
          setPts((p) => [...p, toWorld(e.clientX, e.clientY)])
        }}
      />
      {pts.length >= 1 && end && (
        <line x1={pts[0].x} y1={pts[0].y} x2={end.x} y2={end.y} stroke={CANVAS_SELECT_DEEP} strokeWidth={px(2)} strokeDasharray={`${px(6)} ${px(4)}`} pointerEvents="none" />
      )}
      {pts.map(dot)}
      {pts.length === 2 && createPortal(
        <form
          ref={formRef}
          data-testid="calibrate-form"
          className="fixed z-40 rounded-md border border-white/20 bg-surface-2 p-2 text-xs text-slate-100 shadow-lg"
          style={{ left: formPos.left, top: formPos.top, width: FORM_W }}
          onPointerDown={(e) => e.stopPropagation()}
          onSubmit={(e) => { e.preventDefault(); submit() }}
        >
          <label className="block">Real distance between the 2 points (cm)
            <input
              autoFocus
              inputMode="decimal"
              aria-label="Real distance in cm"
              value={text}
              onChange={(e) => { setText(e.target.value); setError(null) }}
              className={`mt-1 h-8 w-full rounded border bg-transparent px-2 text-sm ${error ? 'border-red-500' : 'border-white/20'}`}
            />
          </label>
          <p data-testid="calibrate-scale" className="mt-1 text-slate-400">
            Measured {Math.round(measuredPx * 10) / 10} px
            {liveScale !== null && <> · = {liveScale.toFixed(2)} cm/px</>}
          </p>
          {error && <p role="alert" className="mt-1 text-red-400">{error}</p>}
          <div className="mt-2 flex gap-2">
            <button type="submit" className="rounded bg-orange-700 px-2 py-1 text-white">Apply</button>
            <button type="button" className="rounded border border-white/20 px-2 py-1" onClick={() => { setPts([]); setText(''); setError(null) }}>Redo</button>
            <button type="button" className="rounded border border-white/20 px-2 py-1" onClick={finish}>Cancel</button>
          </div>
        </form>,
        document.body,
      )}
    </g>
  )
}
