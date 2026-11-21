// Bottom-left zoom pill + live metric scale bar (plan 7.2 #3). Fit (key 0) frames all
// rooms + the background. Rendered as HTML over the canvas, in screen space.
import { Maximize2, Minus, Plus } from 'lucide-react'
import { useUi } from '../model/store'
import { fitToDoc } from './fit'
import { clampZoom, fmtScale, scaleBarStep } from './viewMath'

/** Zoom centered on the canvas, keeping the world point at the center fixed. */
function zoomBy(factor: number) {
  const svg = document.querySelector('svg[data-testid="floorplan-canvas"]')
  const r = svg?.getBoundingClientRect()
  const cx = (r?.left ?? 0) + (r?.width ?? window.innerWidth) / 2
  const cy = (r?.top ?? 0) + (r?.height ?? window.innerHeight) / 2
  const v = useUi.getState().view
  const z = clampZoom(v.zoom * factor)
  const wx = v.x + (cx - (r?.left ?? 0)) / v.zoom
  const wy = v.y + (cy - (r?.top ?? 0)) / v.zoom
  useUi.getState().set({ view: { zoom: z, x: wx - (cx - (r?.left ?? 0)) / z, y: wy - (cy - (r?.top ?? 0)) / z } })
}

export function ZoomControls() {
  const zoom = useUi((s) => s.view.zoom)
  const stepCm = scaleBarStep(zoom)
  const barPx = Math.max(8, stepCm * zoom)
  const pct = `${Math.round(zoom * 100)}%`

  const btn = 'flex h-8 min-w-8 items-center justify-center rounded-md hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-40'
  return (
    <div className="absolute bottom-3 left-3 z-10 flex items-center gap-1 rounded-full border border-black/10 bg-white/95 px-2 py-1 shadow-md dark:border-white/15 dark:bg-[#1b2128]/95">
      <button type="button" className={btn} aria-label="Zoom out" onClick={() => zoomBy(1 / 1.25)}>
        <Minus size={16} />
      </button>
      <button
        type="button"
        className="h-8 min-w-12 rounded-md px-1 text-center text-xs tabular-nums hover:bg-black/5 dark:hover:bg-white/10"
        aria-label="Reset zoom to 100%"
        title="Reset zoom to 100%"
        onClick={() => useUi.getState().set({ view: { ...useUi.getState().view, zoom: 1 } })}
      >
        {pct}
      </button>
      <button type="button" className={btn} aria-label="Zoom in" onClick={() => zoomBy(1.25)}>
        <Plus size={16} />
      </button>
      <button type="button" className={`${btn} gap-1 px-2 text-xs`} aria-label="Fit plan to view (0)" title="Fit plan to view (0)" onClick={() => fitToDoc()}>
        <Maximize2 size={16} /> Fit
      </button>
      <div className="mx-1 h-5 w-px bg-black/10 dark:bg-white/15" aria-hidden="true" />
      <div className="flex flex-col items-center pr-1" aria-label={`Scale: ${fmtScale(stepCm)}`}>
        <span className="text-[10px] leading-3 tabular-nums">{fmtScale(stepCm)}</span>
        <span className="block border-b-2 border-l-2 border-r-2 border-current" style={{ width: barPx, height: 4 }} />
      </div>
    </div>
  )
}
