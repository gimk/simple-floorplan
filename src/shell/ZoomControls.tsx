// Bottom-left zoom pill + live metric scale bar (plan 7.2 #3). Fit (key 0) frames all
// rooms + the background. Rendered as HTML over the canvas, in screen space.
import { useEffect, useState } from 'react'
import { Maximize2, Minus, Plus } from 'lucide-react'
import { useUi } from '../model/store'
import { fitToDoc } from './fit'
import { clampZoom, fmtScale, MAX_ZOOM, MIN_ZOOM, scaleBarStep } from './viewMath'

/** Zoom to `targetZoom` centered on the canvas, keeping the world point at the center fixed. */
function zoomTo(targetZoom: number) {
  const svg = document.querySelector('svg[data-testid="floorplan-canvas"]')
  const r = svg?.getBoundingClientRect()
  const cx = (r?.left ?? 0) + (r?.width ?? window.innerWidth) / 2
  const cy = (r?.top ?? 0) + (r?.height ?? window.innerHeight) / 2
  const v = useUi.getState().view
  const z = clampZoom(targetZoom)
  const wx = v.x + (cx - (r?.left ?? 0)) / v.zoom
  const wy = v.y + (cy - (r?.top ?? 0)) / v.zoom
  useUi.getState().set({ view: { zoom: z, x: wx - (cx - (r?.left ?? 0)) / z, y: wy - (cy - (r?.top ?? 0)) / z } })
}

const zoomBy = (factor: number) => zoomTo(useUi.getState().view.zoom * factor)

export function ZoomControls() {
  const zoom = useUi((s) => s.view.zoom)
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.innerWidth < 640)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(max-width: 639px)')
    const onChange = (e: MediaQueryListEvent) => setNarrow(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  const stepCm = narrow ? scaleBarStep(zoom, 50, 30, 75) : scaleBarStep(zoom)
  const barPx = Math.max(8, stepCm * zoom)
  const pct = `${Math.round(zoom * 100)}%`

  const btn = 'flex h-8 min-w-8 items-center justify-center rounded-md hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-40 max-md:h-11 max-md:min-w-11'
  return (
    <div className="pointer-events-auto flex shrink-0 items-center gap-1 rounded-full border border-black/10 bg-white/95 px-2 py-1 shadow-md dark:border-white/15 dark:bg-[#1b2128]/95 max-md:gap-0.5 max-md:px-1.5">
      <button type="button" className={btn} aria-label="Zoom out" disabled={zoom <= MIN_ZOOM} onClick={() => zoomBy(1 / 1.25)}>
        <Minus size={16} />
      </button>
      <button
        type="button"
        className="h-8 min-w-10 rounded-md px-1 text-center text-xs tabular-nums hover:bg-black/5 sm:min-w-12 max-md:h-11 dark:hover:bg-white/10"
        aria-label="Reset zoom to 100%"
        title="Reset zoom to 100%"
        onClick={() => zoomTo(1)}
      >
        {pct}
      </button>
      <button type="button" className={btn} aria-label="Zoom in" disabled={zoom >= MAX_ZOOM} onClick={() => zoomBy(1.25)}>
        <Plus size={16} />
      </button>
      <button type="button" className={`${btn} gap-1 px-2 text-xs max-sm:px-0`} aria-label="Fit plan to view (0)" title="Fit plan to view (0)" onClick={() => fitToDoc()}>
        <Maximize2 size={16} /> <span className="hidden sm:inline">Fit</span>
      </button>
      <div className="mx-0.5 h-5 w-px bg-black/10 sm:mx-1 dark:bg-white/15" aria-hidden="true" />
      <div className="flex flex-col items-center pr-1" aria-label={`Scale: ${fmtScale(stepCm)}`}>
        <span className="text-[10px] leading-3 tabular-nums">{fmtScale(stepCm)}</span>
        <span className="block border-b-2 border-l-2 border-r-2 border-current" style={{ width: barPx, height: 4 }} />
      </div>
    </div>
  )
}
