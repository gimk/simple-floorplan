// Bottom-left zoom pill + live metric scale bar (plan 7.2 #3).
// Fit resets the view to the origin. Rendered as HTML over the canvas, in screen space.
// The zoom actions themselves live in ./zoom.
import { Maximize2, Minus, Plus } from 'lucide-react'
import { useMediaQuery } from './useDesktop'
import { useUi } from './uiStore'
import { fitAll, zoomIn, zoomOut, zoomReset } from './zoom'
import { fmtScale, MAX_ZOOM, MIN_ZOOM, scaleBarStep } from './viewMath'

export function ZoomControls() {
  const zoom = useUi((s) => s.view.zoom)
  const narrow = useMediaQuery('(max-width: 639px)')
  const stepCm = narrow ? scaleBarStep(zoom, 50, 30, 75) : scaleBarStep(zoom)
  const barPx = Math.max(8, stepCm * zoom)
  const pct = `${Math.round(zoom * 100)}%`

  // 36 px targets on a fine pointer, 44 px on a coarse one (phone, tablet).
  const btn =
    'flex h-9 min-w-9 items-center justify-center rounded-md hover:bg-white/10 pointer-coarse:h-11 pointer-coarse:w-11 pointer-coarse:min-w-11 disabled:opacity-40 disabled:hover:bg-transparent'
  return (
    <div className="pointer-events-auto flex shrink-0 items-center gap-1 rounded-full border border-white/15 bg-surface-2/95 px-2 py-1 text-slate-200 shadow-md max-md:gap-0.5 max-md:px-1.5">
      <button type="button" className={btn} aria-label="Zoom out" title="Zoom out (-)" disabled={zoom <= MIN_ZOOM} onClick={zoomOut}>
        <Minus size={16} />
      </button>
      <button
        type="button"
        className="h-9 min-w-10 rounded-md px-1 text-center text-xs tabular-nums hover:bg-white/10 pointer-coarse:h-11 pointer-coarse:min-w-12 sm:min-w-12"
        aria-label="Reset zoom to 100%"
        title="Reset zoom to 100% (0)"
        onClick={zoomReset}
      >
        {pct}
      </button>
      <button type="button" className={btn} aria-label="Zoom in" title="Zoom in (+)" disabled={zoom >= MAX_ZOOM} onClick={zoomIn}>
        <Plus size={16} />
      </button>
      <button type="button" className={`${btn} gap-1 px-2 text-xs max-sm:px-0`} aria-label="Fit all" title="Fit all (F or Shift+1)" onClick={fitAll}>
        <Maximize2 size={16} /> <span className="hidden sm:inline">Fit</span>
      </button>
      <div className="mx-0.5 h-5 w-px bg-white/15 sm:mx-1" aria-hidden="true" />
      <div className="flex flex-col items-center pr-1" role="img" title="Scale bar" aria-label={`Scale bar: ${fmtScale(stepCm)}`}>
        <span className="text-xs leading-3 tabular-nums">{fmtScale(stepCm)}</span>
        <span className="block border-b-2 border-l-2 border-r-2 border-current" style={{ width: barPx, height: 4 }} />
      </div>
    </div>
  )
}
