// 2-point calibration of a reference image: click two points, type the real distance (cm), done.
import { useEffect, useState } from 'react'
import { useDoc } from '../../model/store'
import { useUi } from '../../shell/uiStore'
import { CaptureRect, useViewport } from '../../canvas/Viewport'
import { parseCommaNumber } from './rotate'
import { calibrateScale } from './calibrate'
import { computeCmPerPx } from './scale'
import type { Vec } from '../../model/geometry'

export function CalibrateOverlay() {
  const tool = useUi((s) => s.tool)
  const imageId = useUi((s) => s.calibratingImageId)
  const img = useDoc((s) => s.doc.refImages.find((r) => r.id === imageId))
  const { toWorld, px, zoom } = useViewport()
  const [pts, setPts] = useState<Vec[]>([])
  const [hover, setHover] = useState<Vec | null>(null)
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)

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

  if (!active || !img) return null

  const submit = () => {
    const real = parseCommaNumber(text)
    const next = computeCmPerPx(img, pts[0], pts[1], real)
    if (next === null) { setError('Type a distance above 0 cm.'); return }
    const r = calibrateScale(img, pts[0], pts[1], real)
    useDoc.getState().updateRefImage(img.id, { cmPerPx: r.cmPerPx, xCm: r.xCm, yCm: r.yCm })
    finish()
  }

  const dot = (p: Vec, k: number) => <circle key={k} cx={p.x} cy={p.y} r={px(5)} fill="#ea580c" stroke="#fff" strokeWidth={px(1.5)} pointerEvents="none" />
  const end = pts.length === 2 ? pts[1] : hover

  return (
    <g data-testid="calibrate-overlay">
      <CaptureRect
        style={{ cursor: 'crosshair' }}
        onPointerMove={(e) => { if (pts.length === 1) setHover(toWorld(e.clientX, e.clientY)) }}
        onPointerDown={(e) => {
          if (e.button !== 0 || pts.length >= 2) return
          e.stopPropagation()
          setPts((p) => [...p, toWorld(e.clientX, e.clientY)])
        }}
      />
      {pts.map(dot)}
      {pts.length >= 1 && end && (
        <line x1={pts[0].x} y1={pts[0].y} x2={end.x} y2={end.y} stroke="#ea580c" strokeWidth={px(2)} strokeDasharray={`${px(6)} ${px(4)}`} pointerEvents="none" />
      )}
      {pts.length === 2 && (
        <g transform={`translate(${pts[1].x + px(12)} ${pts[1].y + px(12)}) scale(${1 / zoom})`}>
          <foreignObject width={240} height={110}>
            <form
              className="rounded-md border border-white/10 bg-[#12161b] p-2 text-xs text-slate-100 shadow-lg"
              onSubmit={(e) => { e.preventDefault(); submit() }}
            >
              <label className="block">Real distance between the 2 points (cm)
                <input
                  autoFocus
                  inputMode="decimal"
                  aria-label="Real distance in cm"
                  value={text}
                  onChange={(e) => { setText(e.target.value); setError(null) }}
                  className="mt-1 h-8 w-full rounded border border-white/15 bg-transparent px-2 text-sm"
                />
              </label>
              {error && <p role="alert" className="mt-1 text-red-400">{error}</p>}
              <div className="mt-2 flex gap-2">
                <button type="submit" className="rounded bg-orange-700 px-2 py-1 text-white">Apply</button>
                <button type="button" className="rounded border border-white/15 px-2 py-1" onClick={() => { setPts([]); setText(''); setError(null) }}>Redo</button>
                <button type="button" className="rounded border border-white/15 px-2 py-1" onClick={finish}>Cancel</button>
              </div>
            </form>
          </foreignObject>
        </g>
      )}
    </g>
  )
}
