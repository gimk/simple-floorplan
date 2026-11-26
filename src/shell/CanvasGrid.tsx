// Subtle canvas grid drawn in world space . Spacing adapts to zoom so
// lines stay ~32 screen px apart. Rendered inside the world <g>, pointer-events off.
// The lines are aligned to the origin of the active artboard (falling back to the first artboard,
// then to the world origin), so a major line passes through that origin.
//
// The grid only shows at full contrast inside the active artboard: the crisp lines are clipped to
// `#active-artboard-grid-clip`, which holds the active artboard frame. A faint grid covers the whole
// viewport but is masked by `#outside-grid-mask`, whose black rects cut out EVERY artboard frame,
// so no grid at all is drawn inside the unselected artboards. With no artboard, only the crisp grid
// is drawn, over the whole viewport.
import { useEffect, useState } from 'react'
import { useViewport } from '../canvas/Viewport'
import { useDoc } from '../model/store'
import { artboardFrame } from '../features/artboards/frame'
import { useUi } from './uiStore'
import { gridStep } from './viewMath'

type Size = { w: number; h: number }

const FALLBACK: Size = { w: 800, h: 600 }

/** Opacity of the grid outside the artboards, relative to its normal contrast. */
const OUTSIDE_OPACITY = 0.28

/** Id of the clip path that keeps the crisp grid inside the active artboard frame. */
const ACTIVE_CLIP_ID = 'active-artboard-grid-clip'

/** Id of the mask that removes the faint grid from every artboard frame. */
const OUTSIDE_MASK_ID = 'outside-grid-mask'

/** Current size of the canvas element, in screen px, with a safe fallback. */
const readSize = (svg: SVGSVGElement | null): Size => ({
  w: svg?.clientWidth || FALLBACK.w,
  h: svg?.clientHeight || FALLBACK.h,
})

export function CanvasGrid() {
  const { zoom, px, svg } = useViewport()
  const view = useUi((s) => s.view)
  const activeArtboardId = useUi((s) => s.activeArtboardId)
  const artboards = useDoc((s) => s.doc.artboards)
  // The grid must cover the whole visible canvas after a window resize: keep the size in state and
  // follow the element with a ResizeObserver instead of reading clientWidth once per render.
  const [size, setSize] = useState<Size>(() => readSize(svg))

  useEffect(() => {
    if (!svg) return
    const update = () => {
      const next = readSize(svg)
      setSize((prev) => (prev.w === next.w && prev.h === next.h ? prev : next))
    }
    update()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update)
      return () => window.removeEventListener('resize', update)
    }
    const ro = new ResizeObserver(update)
    ro.observe(svg)
    return () => ro.disconnect()
  }, [svg])

  const step = gridStep(zoom)
  const { w, h } = size
  const x0 = view.x - step
  const y0 = view.y - step
  const x1 = view.x + w / zoom + step
  const y1 = view.y + h / zoom + step

  // Origin the grid hangs from: the active artboard, else the first one, else the world origin.
  const origin = artboards.find((a) => a.id === activeArtboardId) ?? artboards[0]
  const ox = origin?.xCm ?? 0
  const oy = origin?.yCm ?? 0

  // The active artboard gets the crisp grid; the other frames get no grid at all.
  const active = origin ?? null
  const activeFrame = active ? artboardFrame(active) : null

  // One line every `step` cm from the origin; every 5th line is a major one (integer count from
  // the origin avoids floating-point modulo tests).
  const xs: { x: number; major: boolean }[] = []
  for (let i = Math.floor((x0 - ox) / step); ox + i * step <= x1; i++) {
    xs.push({ x: ox + i * step, major: i % 5 === 0 })
  }
  const ys: { y: number; major: boolean }[] = []
  for (let i = Math.floor((y0 - oy) / step); oy + i * step <= y1; i++) {
    ys.push({ y: oy + i * step, major: i % 5 === 0 })
  }

  return (
    <g pointerEvents="none" aria-hidden="true">
      <defs>
        <clipPath id={ACTIVE_CLIP_ID} clipPathUnits="userSpaceOnUse">
          {activeFrame && (
            <rect
              x={activeFrame.x}
              y={activeFrame.y}
              width={activeFrame.width}
              height={activeFrame.height}
            />
          )}
        </clipPath>
        <mask
          id={OUTSIDE_MASK_ID}
          maskUnits="userSpaceOnUse"
          x={x0}
          y={y0}
          width={x1 - x0}
          height={y1 - y0}
        >
          {/* White shows the faint grid, the black artboard rects hide it inside every frame. */}
          <rect x={x0} y={y0} width={x1 - x0} height={y1 - y0} fill="white" />
          {artboards.map((a) => {
            const f = artboardFrame(a)
            return (
              <rect
                key={a.id}
                x={f.x}
                y={f.y}
                width={f.width}
                height={f.height}
                fill="black"
              />
            )
          })}
        </mask>
      </defs>
      {/* Faint grid outside the artboards only: the black rects of the mask cut the frames out. */}
      {artboards.length > 0 && (
        <g opacity={OUTSIDE_OPACITY} mask={`url(#${OUTSIDE_MASK_ID})`}>
          <GridLines xs={xs} ys={ys} x0={x0} y0={y0} x1={x1} y1={y1} unit={px(1)} />
        </g>
      )}
      {/* Crisp grid, inside the active artboard only (whole viewport when there is no artboard). */}
      <g clipPath={activeFrame ? `url(#${ACTIVE_CLIP_ID})` : undefined}>
        <GridLines xs={xs} ys={ys} x0={x0} y0={y0} x1={x1} y1={y1} unit={px(1)} />
      </g>
    </g>
  )
}

/** The grid lines themselves: one line per entry of `xs` / `ys`, `unit` is 1 screen px in cm. */
function GridLines({
  xs,
  ys,
  x0,
  y0,
  x1,
  y1,
  unit,
}: {
  xs: { x: number; major: boolean }[]
  ys: { y: number; major: boolean }[]
  x0: number
  y0: number
  x1: number
  y1: number
  unit: number
}) {
  return (
    <>
      {xs.map(({ x, major }) => (
        <line
          key={`x${x}`}
          x1={x} y1={y0} x2={x} y2={y1}
          strokeWidth={unit}
          className={major ? 'stroke-black/[0.10] dark:stroke-white/[0.14]' : 'stroke-black/[0.045] dark:stroke-white/[0.07]'}
        />
      ))}
      {ys.map(({ y, major }) => (
        <line
          key={`y${y}`}
          x1={x0} y1={y} x2={x1} y2={y}
          strokeWidth={unit}
          className={major ? 'stroke-black/[0.10] dark:stroke-white/[0.14]' : 'stroke-black/[0.045] dark:stroke-white/[0.07]'}
        />
      ))}
    </>
  )
}
