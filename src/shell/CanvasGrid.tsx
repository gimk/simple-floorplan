// Subtle canvas grid drawn in world space . Spacing adapts to zoom so
// lines stay ~32 screen px apart. Rendered inside the world <g>, pointer-events off.
import { useEffect, useState } from 'react'
import { useViewport } from '../canvas/Viewport'
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

  const xs: number[] = []
  for (let x = Math.floor(x0 / step) * step; x <= x1; x += step) xs.push(x)
  const ys: number[] = []
  for (let y = Math.floor(y0 / step) * step; y <= y1; y += step) ys.push(y)

  const major = step * 5
  return (
    <g pointerEvents="none" aria-hidden="true">
      {xs.map((x) => (
        <line
          key={`x${x}`}
          x1={x} y1={y0} x2={x} y2={y1}
          strokeWidth={px(1)}
          className={Math.abs(x % major) < step / 2 ? 'stroke-black/[0.10] dark:stroke-white/[0.14]' : 'stroke-black/[0.045] dark:stroke-white/[0.07]'}
        />
      ))}
      {ys.map((y) => (
        <line
          key={`y${y}`}
          x1={x0} y1={y} x2={x1} y2={y}
          strokeWidth={px(1)}
          className={Math.abs(y % major) < step / 2 ? 'stroke-black/[0.10] dark:stroke-white/[0.14]' : 'stroke-black/[0.045] dark:stroke-white/[0.07]'}
        />
      ))}
    </g>
  )
}
