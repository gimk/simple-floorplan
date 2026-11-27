// SVG viewport with pan/zoom. World units = cm. Children are drawn in world coordinates.
//
// Pan:  wheel/trackpad scroll, middle or right mouse drag, space + drag, or two-finger touch.
// Zoom: ctrl/cmd + wheel (trackpad pinch; a mouse notch is capped to a small step), or two-finger pinch on touch.
// The browser context menu is blocked on the canvas.
//
// Features use `useViewport()` to convert pointer events to world coords and to size
// handles in screen pixels (divide by zoom).
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Vec } from '../model/geometry'
import { useUi } from '../shell/uiStore'
import { wheelZoomFactor } from '../shell/viewMath'
import { useCanvasKeyboard } from './useCanvasKeyboard'

type Ctx = {
  /** Screen px per cm. */
  zoom: number
  /** Convert a client (screen) point to world cm. Stable: reads the live view, so pan does not change it. */
  toWorld: (clientX: number, clientY: number) => Vec
  /** Size in world units of `px` screen pixels (for handles, stroke widths). */
  px: (px: number) => number
  svg: SVGSVGElement | null
  /** Call `fn` with the live view on every imperative view change (pan frames included). Returns unsubscribe. */
  subscribeLive: (fn: (v: View) => void) => () => void
}

const ViewportCtx = createContext<Ctx>({ zoom: 1, toWorld: (x, y) => ({ x, y }), px: (p) => p, svg: null, subscribeLive: () => () => {} })
export const useViewport = () => useContext(ViewportCtx)

export type View = { x: number; y: number; zoom: number }

const MIN_ZOOM = 0.05
const MAX_ZOOM = 40
/** Wheel-pan stops this long before the final view is committed to the store. */
const WHEEL_COMMIT_MS = 120

const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))
const transformOf = (v: View) => `scale(${v.zoom}) translate(${-v.x} ${-v.y})`

export function Viewport({ children, overlay }: { children: ReactNode; overlay?: ReactNode }) {
  const ref = useRef<SVGSVGElement>(null)
  const gRef = useRef<SVGGElement>(null)
  const view = useUi((s) => s.view)
  const setUi = useUi((s) => s.set)
  const [svg, setSvg] = useState<SVGSVGElement | null>(null)
  const [space, setSpace] = useState(false)
  /** True from pointer down to pointer up of a pan drag (middle, right, Space + left). */
  const [panning, setPanning] = useState(false)
  /** True when the last right-button drag moved: its context menu event must not reach a tool. */
  const rightMoved = useRef(false)
  const pointers = useRef(new Map<number, Vec>())
  const panStart = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null)
  const pinch = useRef<{ d: number; zoom: number; world: Vec } | null>(null)

  /** Exact live view, even mid-pan (the store only gets it when the gesture settles). */
  const live = useRef<View>(useUi.getState().view)
  /** Cached canvas rect: avoids a forced layout on every pointer/wheel event. */
  const rectRef = useRef<DOMRect | null>(null)
  const raf = useRef(0)
  const commitTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  /** Input gathered since the last frame; applied in one rAF. */
  const pending = useRef({
    wheelDx: 0, wheelDy: 0,
    zoom: null as null | { cx: number; cy: number; factor: number },
    pointer: null as null | { x: number; y: number },
    pinch: null as null | { mid: Vec; ratio: number },
  })

  const { onKeyDown, announcement } = useCanvasKeyboard()

  useEffect(() => setSvg(ref.current), [])

  const getRect = useCallback((): DOMRect | null => {
    if (!rectRef.current && ref.current) rectRef.current = ref.current.getBoundingClientRect()
    return rectRef.current
  }, [])

  // Keep the cached rect fresh.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const invalidate = () => { rectRef.current = null }
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(invalidate)
    ro?.observe(el)
    window.addEventListener('resize', invalidate)
    window.addEventListener('scroll', invalidate, true)
    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', invalidate)
      window.removeEventListener('scroll', invalidate, true)
    }
  }, [])

  const liveSubs = useRef(new Set<(v: View) => void>())
  const subscribeLive = useCallback((fn: (v: View) => void) => {
    liveSubs.current.add(fn)
    return () => { liveSubs.current.delete(fn) }
  }, [])

  /** `data-panning` on the <svg> is imperative (no React render): CSS drops hit-testing and text halos while it is set. */
  const setPanningAttr = useCallback((on: boolean) => {
    const el = ref.current
    if (!el) return
    if (on) { if (el.dataset.panning !== 'true') el.dataset.panning = 'true' }
    else if (el.dataset.panning) delete el.dataset.panning
  }, [])

  const applyLive = useCallback((v: View) => {
    live.current = v
    gRef.current?.setAttribute('transform', transformOf(v))
    liveSubs.current.forEach((fn) => fn(v))
  }, [])

  /** Write the live view to the store (store subscribers see it only now). */
  const commit = useCallback(() => {
    clearTimeout(commitTimer.current)
    commitTimer.current = undefined
    if (!panStart.current) setPanningAttr(false)
    const v = live.current
    const s = useUi.getState().view
    if (s.x !== v.x || s.y !== v.y || s.zoom !== v.zoom) setUi({ view: v })
  }, [setUi, setPanningAttr])

  // External view changes (fit to plan, zoom buttons, shortcuts) move the live view and the <g> at once.
  useEffect(() => {
    applyLive(useUi.getState().view)
    return useUi.subscribe((s) => {
      const v = s.view
      const l = live.current
      if (v.x !== l.x || v.y !== l.y || v.zoom !== l.zoom) applyLive(v)
    })
  }, [applyLive])

  const flush = useCallback(() => {
    raf.current = 0
    const p = pending.current
    const p0 = p.pointer
    let v = live.current
    let zoomed = false
    let panned = false
    const r = getRect()
    if (p.zoom && r) {
      const { cx, cy, factor } = p.zoom
      const z = clampZoom(v.zoom * factor)
      const wx = v.x + (cx - r.left) / v.zoom
      const wy = v.y + (cy - r.top) / v.zoom
      v = { zoom: z, x: wx - (cx - r.left) / z, y: wy - (cy - r.top) / z }
      zoomed = true
    }
    if (p.pinch && pinch.current && r) {
      const z = clampZoom(pinch.current.zoom * p.pinch.ratio)
      v = {
        zoom: z,
        x: pinch.current.world.x - (p.pinch.mid.x - r.left) / z,
        y: pinch.current.world.y - (p.pinch.mid.y - r.top) / z,
      }
      zoomed = true
    }
    if (p.wheelDx || p.wheelDy) {
      v = { ...v, x: v.x + p.wheelDx / v.zoom, y: v.y + p.wheelDy / v.zoom }
      panned = true
    }
    if (p.pointer && panStart.current) {
      const s = panStart.current
      v = { zoom: v.zoom, x: s.vx - (p.pointer.x - s.x) / v.zoom, y: s.vy - (p.pointer.y - s.y) / v.zoom }
    }
    p.wheelDx = 0; p.wheelDy = 0; p.zoom = null; p.pointer = null; p.pinch = null
    if (v === live.current) return
    if (panned || (p0 && panStart.current)) setPanningAttr(true)
    applyLive(v)
    // Zoom changes stroke widths and the zoom controls: commit right away. Pure pan stays imperative.
    if (zoomed) commit()
    else if (panned) {
      clearTimeout(commitTimer.current)
      commitTimer.current = setTimeout(commit, WHEEL_COMMIT_MS)
    }
  }, [applyLive, commit, getRect, setPanningAttr])

  const schedule = useCallback(() => {
    if (!raf.current) raf.current = requestAnimationFrame(flush)
  }, [flush])

  /** Apply everything gathered so far now (gesture end). */
  const flushNow = useCallback(() => {
    if (raf.current) { cancelAnimationFrame(raf.current); flush() }
  }, [flush])

  useEffect(() => () => {
    cancelAnimationFrame(raf.current)
    clearTimeout(commitTimer.current)
  }, [])

  const toWorld = useCallback((cx: number, cy: number): Vec => {
    const r = getRect()
    const v = live.current
    return { x: v.x + (cx - (r?.left ?? 0)) / v.zoom, y: v.y + (cy - (r?.top ?? 0)) / v.zoom }
  }, [getRect])

  // Wheel needs a non-passive listener to prevent page zoom.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const p = pending.current
      if (e.ctrlKey || e.metaKey) {
        const f = wheelZoomFactor(e.deltaY, e.deltaMode)
        p.zoom = { cx: e.clientX, cy: e.clientY, factor: (p.zoom?.factor ?? 1) * f }
      } else {
        p.wheelDx += e.deltaX
        p.wheelDy += e.deltaY
      }
      schedule()
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [schedule])

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
    rectRef.current = null // one fresh measure per gesture, in case the canvas moved without resizing
    // Only touch pointers count for pinch: a mouse released outside the canvas never sends
    // pointerup here, and a stale entry would turn the next mouse drag into a pinch.
    if (e.pointerType === 'touch') pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const v = live.current
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom: v.zoom, world: toWorld(mid.x, mid.y) }
      panStart.current = null
      e.stopPropagation()
      return
    }
    // Middle or right mouse button always pans (tools only use the left button).
    if (e.button === 1 || e.button === 2 || space) {
      if (e.button === 2) rightMoved.current = false
      setPanning(true)
      setPanningAttr(true)
      panStart.current = { x: e.clientX, y: e.clientY, vx: v.x, vy: v.y }
      ref.current?.setPointerCapture(e.pointerId)
      e.stopPropagation()
    }
  }
  const onPointerMoveCapture = (e: React.PointerEvent) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      pending.current.pinch = {
        mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        ratio: Math.hypot(a.x - b.x, a.y - b.y) / pinch.current.d,
      }
      schedule()
      e.stopPropagation()
      return
    }
    const p = panStart.current
    if (p) {
      if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > 3) rightMoved.current = true
      pending.current.pointer = { x: e.clientX, y: e.clientY }
      schedule()
      e.stopPropagation()
    }
  }
  const onPointerUpCapture = (e: React.PointerEvent) => {
    flushNow()
    pointers.current.delete(e.pointerId)
    const wasPinch = !!pinch.current
    if (pointers.current.size < 2) pinch.current = null
    if (wasPinch && !pinch.current) { flushNow(); commit() }
    if (panStart.current) {
      panStart.current = null
      commit()
      setPanning(false)
      setPanningAttr(false)
      e.stopPropagation()
    }
  }

  const px = useCallback((p: number) => p / view.zoom, [view.zoom])
  const ctx = useMemo<Ctx>(() => ({ zoom: view.zoom, toWorld, px, svg, subscribeLive }), [view.zoom, toWorld, px, svg, subscribeLive])
  const cursor = panning ? 'grabbing' : space ? 'grab' : undefined

  return (
    <ViewportCtx.Provider value={ctx}>
      <svg
        ref={ref}
        role="application"
        aria-label="Floor plan canvas"
        aria-describedby="canvas-keyboard-help"
        tabIndex={0}
        onKeyDown={onKeyDown}
        data-testid="floorplan-canvas"
        data-pan-ready={space ? '' : undefined}
        className="h-full w-full touch-none select-none outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-bright"
        style={{ cursor }}
        onPointerDownCapture={onPointerDownCapture}
        onPointerMoveCapture={onPointerMoveCapture}
        onPointerUpCapture={onPointerUpCapture}
        onPointerCancelCapture={onPointerUpCapture}
        onContextMenuCapture={(e) => {
          e.preventDefault()
          // A right-drag pan ends with a context menu event: keep it away from tool cancel handlers.
          if (rightMoved.current) { rightMoved.current = false; e.stopPropagation() }
        }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <g ref={gRef} transform={transformOf(view)}>
          {children}
          {overlay}
        </g>
      </svg>
      <div id="canvas-keyboard-help" className="sr-only">
        Tab selects the next room, opening or furniture. Arrow keys move the selection by 1 centimeter, or 10 with Shift.
      </div>
      <div data-testid="canvas-live" role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </div>
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
