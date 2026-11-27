// Subtle canvas grid drawn in world space. Spacing adapts to zoom so lines stay ~32 screen px apart.
// Rendered inside the world <g>, pointer-events off.
//
// The grid is an SVG <pattern> in world units (one tile = 5 grid steps, so every 5th line is a major
// one). It is painted on ONE rect that is only as big as the visible viewport. Viewport tells us the
// live view on every pan frame and we move/resize that rect imperatively in the same rAF as the <g>
// transform. The pattern stays anchored in world space, so it never needs an update while panning.
// No giant coordinates, no even-odd path, no mask. The pattern hangs from the origin of the active
// artboard (else the first, else the world origin), so a major line passes through that origin.
//
// Crisp grid: over the active artboard frame only (whole viewport when there is no artboard).
// Faint grid: the viewport rect at low opacity, with an opaque canvas-colour cover over every artboard.
import { useEffect, useRef } from 'react'
import { useViewport } from '../canvas/Viewport'
import { useDoc } from '../model/store'
import { artboardFrame } from '../features/artboards/frame'
import { CANVAS_BG } from './canvasTokens'
import { useUi } from './uiStore'
import { gridStep } from './viewMath'

/** Opacity of the grid outside the artboards, relative to its normal contrast. */
const OUTSIDE_OPACITY = 0.42

const PATTERN_ID = 'canvas-grid-pattern'

/** Extra screen px painted past each viewport edge, so a sub-pixel move never shows a gap. */
const PAD_PX = 24

export function CanvasGrid() {
  const { zoom, px, svg, subscribeLive } = useViewport()
  const followRef = useRef<SVGRectElement>(null)
  const sizeRef = useRef({ w: 0, h: 0 })
  const activeArtboardId = useUi((s) => s.activeArtboardId)
  const mode = useUi((s) => s.mode)
  const showGrid = useUi((s) => s.showGrid)
  const artboards = useDoc((s) => s.doc.artboards)

  const step = gridStep(zoom)
  const tile = step * 5

  // Origin the grid hangs from: the active artboard, else the first one, else the world origin.
  const origin = artboards.find((a) => a.id === activeArtboardId) ?? artboards[0]
  const ox = origin?.xCm ?? 0
  const oy = origin?.yCm ?? 0
  const activeFrame = origin ? artboardFrame(origin) : null

  const unit = px(1)
  // Shift the tile by half a step so no line sits on the tile edge (it would be clipped in half).
  const half = step / 2
  const lines = [0, 1, 2, 3, 4]

  // Keep the viewport-sized rect on the visible world area, in the same frame as the <g> transform.
  useEffect(() => {
    if (!svg) return
    const place = (v: { x: number; y: number; zoom: number }) => {
      const r = followRef.current
      if (!r) return
      const { w, h } = sizeRef.current
      const pad = PAD_PX / v.zoom
      r.setAttribute('x', String(v.x - pad))
      r.setAttribute('y', String(v.y - pad))
      r.setAttribute('width', String(w / v.zoom + 2 * pad))
      r.setAttribute('height', String(h / v.zoom + 2 * pad))
    }
    const measure = () => {
      sizeRef.current = { w: svg.clientWidth, h: svg.clientHeight }
      place(useUi.getState().view)
    }
    measure()
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    ro?.observe(svg)
    const off = subscribeLive(place)
    return () => { ro?.disconnect(); off() }
  }, [svg, subscribeLive])

  // Design mode shows a clean canvas: no grid (hooks above must still run). Cmd/Ctrl+' hides it too.
  if (mode === 'design' || !showGrid) return null

  return (
    <g pointerEvents="none" aria-hidden="true">
      <defs>
        <pattern
          id={PATTERN_ID}
          patternUnits="userSpaceOnUse"
          x={ox - half}
          y={oy - half}
          width={tile}
          height={tile}
        >
          {lines.map((i) => {
            const at = half + i * step
            const cls = i === 0 ? 'stroke-white/[0.14]' : 'stroke-white/[0.07]'
            return (
              <g key={i}>
                <line x1={at} y1={0} x2={at} y2={tile} strokeWidth={unit} className={cls} />
                <line x1={0} y1={at} x2={tile} y2={at} strokeWidth={unit} className={cls} />
              </g>
            )
          })}
        </pattern>
      </defs>
      {/* Viewport-sized grid rect (position set imperatively): faint when artboards exist. */}
      <rect ref={followRef} fill={`url(#${PATTERN_ID})`} opacity={artboards.length > 0 ? OUTSIDE_OPACITY : 1} />
      {/* Artboards hide the faint grid; the active one gets the crisp grid back on top. */}
      {artboards.map((a) => {
        const f = artboardFrame(a)
        return <rect key={a.id} x={f.x} y={f.y} width={f.width} height={f.height} fill={CANVAS_BG} />
      })}
      {activeFrame && (
        <rect x={activeFrame.x} y={activeFrame.y} width={activeFrame.width} height={activeFrame.height} fill={`url(#${PATTERN_ID})`} />
      )}
    </g>
  )
}
