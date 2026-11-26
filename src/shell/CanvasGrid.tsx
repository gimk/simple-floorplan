// Subtle canvas grid drawn in world space . Spacing adapts to zoom so
// lines stay ~32 screen px apart. Rendered inside the world <g>, pointer-events off.
// The lines are aligned to the origin of the active artboard (falling back to the first artboard,
// then to the world origin), so a major line passes through that origin.
import { useEffect, useState } from 'react'
import { useViewport } from '../canvas/Viewport'
import { useDoc } from '../model/store'
import { useUi } from './uiStore'
import { gridStep } from './viewMath'

type Size = { w: number; h: number }

const FALLBACK: Size = { w: 800, h: 600 }

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
      {xs.map(({ x, major }) => (
        <line
          key={`x${x}`}
          x1={x} y1={y0} x2={x} y2={y1}
          strokeWidth={px(1)}
          className={major ? 'stroke-black/[0.10] dark:stroke-white/[0.14]' : 'stroke-black/[0.045] dark:stroke-white/[0.07]'}
        />
      ))}
      {ys.map(({ y, major }) => (
        <line
          key={`y${y}`}
          x1={x0} y1={y} x2={x1} y2={y}
          strokeWidth={px(1)}
          className={major ? 'stroke-black/[0.10] dark:stroke-white/[0.14]' : 'stroke-black/[0.045] dark:stroke-white/[0.07]'}
        />
      ))}
    </g>
  )
}
