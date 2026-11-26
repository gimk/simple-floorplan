// SVG viewport with pan/zoom. World units = cm. Children are drawn in world coordinates.
//
// Pan:  wheel/trackpad scroll, middle or right mouse drag, space + drag, 'pan' tool, or two-finger touch.
// Zoom: ctrl/cmd + wheel (trackpad pinch; a mouse notch is capped to a small step), or two-finger pinch on touch.
// The browser context menu is blocked on the canvas.
//
// Features use `useViewport()` to convert pointer events to world coords and to size
// handles in screen pixels (divide by zoom).
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { Vec } from '../model/geometry'
import { useUi } from '../shell/uiStore'
import { wheelZoomFactor } from '../shell/viewMath'

type Ctx = {
  /** Screen px per cm. */
  zoom: number
  /** Convert a client (screen) point to world cm. */
  toWorld: (clientX: number, clientY: number) => Vec
  /** Size in world units of `px` screen pixels (for handles, stroke widths). */
  px: (px: number) => number
  svg: SVGSVGElement | null
}

const ViewportCtx = createContext<Ctx>({ zoom: 1, toWorld: (x, y) => ({ x, y }), px: (p) => p, svg: null })
export const useViewport = () => useContext(ViewportCtx)

export function Viewport({ children, overlay }: { children: ReactNode; overlay?: ReactNode }) {
  const ref = useRef<SVGSVGElement>(null)
  const view = useUi((s) => s.view)
  const tool = useUi((s) => s.tool)
  const setUi = useUi((s) => s.set)
  const [svg, setSvg] = useState<SVGSVGElement | null>(null)
  const [space, setSpace] = useState(false)
  const pointers = useRef(new Map<number, Vec>())
  const panStart = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null)
  const pinch = useRef<{ d: number; zoom: number; world: Vec } | null>(null)

  useEffect(() => setSvg(ref.current), [])

  const toWorld = (cx: number, cy: number): Vec => {
    const r = ref.current?.getBoundingClientRect()
    const v = useUi.getState().view
    return { x: v.x + (cx - (r?.left ?? 0)) / v.zoom, y: v.y + (cy - (r?.top ?? 0)) / v.zoom }
  }

  const zoomAt = (cx: number, cy: number, zoom: number) => {
    const r = ref.current!.getBoundingClientRect()
    const v = useUi.getState().view
    const z = Math.min(40, Math.max(0.05, zoom))
    const w = { x: v.x + (cx - r.left) / v.zoom, y: v.y + (cy - r.top) / v.zoom }
    setUi({ view: { zoom: z, x: w.x - (cx - r.left) / z, y: w.y - (cy - r.top) / z } })
  }

  // Wheel needs a non-passive listener to prevent page zoom.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const v = useUi.getState().view
      if (e.ctrlKey || e.metaKey) zoomAt(e.clientX, e.clientY, v.zoom * wheelZoomFactor(e.deltaY, e.deltaMode))
      else setUi({ view: { ...v, x: v.x + e.deltaX / v.zoom, y: v.y + e.deltaY / v.zoom } })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return
      if (e.target instanceof Element && e.target.closest('input, textarea, select, button, [contenteditable]')) return
      e.preventDefault()
      setSpace(true)
    }
    const up = (e: KeyboardEvent) => { if (e.code === 'Space') setSpace(false) }
    const blur = () => setSpace(false)
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', blur)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur) }
  }, [])

  // Pan / pinch handled in CAPTURE phase so they win over tools when appropriate.
  const onPointerDownCapture = (e: React.PointerEvent) => {
    // Only touch pointers count for pinch: a mouse released outside the canvas never sends
    // pointerup here, and a stale entry would turn the next mouse drag into a pinch.
    if (e.pointerType === 'touch') pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const v = useUi.getState().view
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom: v.zoom, world: toWorld(mid.x, mid.y) }
      panStart.current = null
      e.stopPropagation()
      return
    }
    // Middle or right mouse button always pans (tools only use the left button).
    if (e.button === 1 || e.button === 2 || space || tool === 'pan') {
      panStart.current = { x: e.clientX, y: e.clientY, vx: v.x, vy: v.y }
      ref.current?.setPointerCapture(e.pointerId)
      e.stopPropagation()
    }
  }
  const onPointerMoveCapture = (e: React.PointerEvent) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      const r = ref.current!.getBoundingClientRect()
      const mid = { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top }
      const z = Math.min(40, Math.max(0.05, pinch.current.zoom * Math.hypot(a.x - b.x, a.y - b.y) / pinch.current.d))
      setUi({ view: { zoom: z, x: pinch.current.world.x - mid.x / z, y: pinch.current.world.y - mid.y / z } })
      e.stopPropagation()
      return
    }
    const p = panStart.current
    if (p) {
      const z = useUi.getState().view.zoom
      setUi({ view: { zoom: z, x: p.vx - (e.clientX - p.x) / z, y: p.vy - (e.clientY - p.y) / z } })
      e.stopPropagation()
    }
  }
  const onPointerUpCapture = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) pinch.current = null
    if (panStart.current) { panStart.current = null; e.stopPropagation() }
  }

  const ctx: Ctx = { zoom: view.zoom, toWorld, px: (p) => p / view.zoom, svg }
  const cursor = space || tool === 'pan' ? (panStart.current ? 'grabbing' : 'grab') : undefined

  return (
    <ViewportCtx.Provider value={ctx}>
      <svg
        ref={ref}
        data-testid="floorplan-canvas"
        data-pan-ready={space || tool === 'pan' ? '' : undefined}
        className="h-full w-full touch-none select-none"
        style={{ cursor }}
        onPointerDownCapture={onPointerDownCapture}
        onPointerMoveCapture={onPointerMoveCapture}
        onPointerUpCapture={onPointerUpCapture}
        onPointerCancelCapture={onPointerUpCapture}
        onContextMenu={(e) => e.preventDefault()}
      >
        <g transform={`scale(${view.zoom}) translate(${-view.x} ${-view.y})`}>
          {children}
          {overlay}
        </g>
      </svg>
    </ViewportCtx.Provider>
  )
}

/**
 * Full-viewport transparent rect in world space that catches pointer events for a tool.
 * Render it FIRST inside a tool overlay so the tool's own handles stay on top.
 */
export function CaptureRect(props: React.SVGProps<SVGRectElement>) {
  return <rect x={-1e6} y={-1e6} width={2e6} height={2e6} fill="transparent" {...props} />
}
