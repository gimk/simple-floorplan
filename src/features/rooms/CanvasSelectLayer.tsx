// Canvas background hit target (select tool): click selects the artboard under the pointer or
// clears the selection; a drag draws a marquee that selects the rooms (Plan mode) or the furniture
// items (Design mode) it touches.
// `MarqueeOverlay` draws the live box. Render it ABOVE the rooms (Viewport overlay).
import { useEffect, useRef } from 'react'
import { useViewport } from '../../canvas/Viewport'
import type { Vec } from '../../model/geometry'
import { useDoc } from '../../model/store'
import type { Artboard, Selection } from '../../model/types'
import { useUi } from '../../shell/uiStore'
import { selectArtboard } from '../artboards/selection'
import { findFurnitureInBox } from '../furniture/geometry'
import { setFurnitureSelection } from '../furniture/actions'
import { boxFromPoints, findArtboardAtPoint, findRoomsInBox } from './boxSelect'
import type { Box } from './boxSelect'
import { useMarquee } from './marqueeStore'
import { CANVAS_MARQUEE_FILL, CANVAS_SELECT_STRONG } from '../../shell/canvasTokens'

export const DRAG_PX = 4

export type DesignMarqueeOptions = {
  toWorld: (clientX: number, clientY: number) => Vec
  artboardId: string | null
  onDone?: (marqueeRan: boolean) => void
}

/**
 * Pure computation for Design mode furniture marquee selection: shifts the world box into the
 * target artboard's local coordinates and merges with any existing furniture selection when Shift
 * is held. Returns null when nothing should be selected.
 */
export function computeDesignMarqueeSelection(
  world: Box,
  artboard: Artboard | undefined,
  currentSelection: Selection,
  shiftKey: boolean,
): { artboardId: string; ids: string[] } | null {
  if (!artboard) return null
  // The item bounds are artboard-local: shift the world box by the artboard origin.
  const local = {
    minX: world.minX - artboard.xCm,
    minY: world.minY - artboard.yCm,
    maxX: world.maxX - artboard.xCm,
    maxY: world.maxY - artboard.yCm,
  }
  const hits = findFurnitureInBox(local, artboard)
  const before =
    'artboardId' in currentSelection && currentSelection.artboardId === artboard.id
      ? currentSelection.kind === 'furniture'
        ? [currentSelection.furnitureId]
        : currentSelection.kind === 'furnitureMulti'
          ? currentSelection.furnitureIds
          : []
      : []
  const ids = shiftKey ? [...new Set([...before, ...hits])] : hits
  return ids.length > 0 ? { artboardId: artboard.id, ids } : null
}

/**
 * Starts a Design mode furniture selection marquee on pointer down. Tracks the pointer via window
 * listeners (plus pointer capture on `e.currentTarget` when available), draws the live box in
 * `useMarquee`, and on release selects the furniture items of `opts.artboardId` (or the active
 * artboard) whose bounds intersect the box. Returns a cancel function for unmount/tool-switch.
 */
export function startDesignMarquee(
  e: Pick<React.PointerEvent, 'pointerId' | 'clientX' | 'clientY' | 'currentTarget'>,
  opts: DesignMarqueeOptions,
): () => void {
  const { pointerId, clientX: startClientX, clientY: startClientY } = e
  const target = e.currentTarget as (EventTarget & {
    setPointerCapture?: (id: number) => void
    releasePointerCapture?: (id: number) => void
  }) | null
  const startWorld = opts.toWorld(startClientX, startClientY)
  let marquee = false
  let done = false

  const cleanup = () => {
    if (done) return
    done = true
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onCancel)
    try {
      target?.releasePointerCapture?.(pointerId)
    } catch {
      // Capture may already have been released by the browser.
    }
    useMarquee.getState().set(null)
  }

  const onMove = (ev: PointerEvent) => {
    if (ev.pointerId !== pointerId || done) return
    if (!marquee) {
      if (Math.hypot(ev.clientX - startClientX, ev.clientY - startClientY) < DRAG_PX) return
      marquee = true
    }
    useMarquee.getState().set(boxFromPoints(startWorld, opts.toWorld(ev.clientX, ev.clientY)))
  }

  const finish = (ev: PointerEvent, cancelled: boolean) => {
    if (ev.pointerId !== pointerId || done) return
    cleanup()
    if (cancelled) return
    if (marquee) {
      const ui = useUi.getState()
      const artboardId = opts.artboardId ?? ui.activeArtboardId
      const artboard = useDoc.getState().doc.artboards.find((a) => a.id === artboardId)
      const world = boxFromPoints(startWorld, opts.toWorld(ev.clientX, ev.clientY))
      const next = computeDesignMarqueeSelection(world, artboard, ui.selection, ev.shiftKey)
      if (!next) ui.set({ selection: { kind: 'none' } })
      else setFurnitureSelection(next.artboardId, next.ids)
    }
    opts.onDone?.(marquee)
  }

  const onUp = (ev: PointerEvent) => finish(ev, false)
  const onCancel = (ev: PointerEvent) => finish(ev, true)

  target?.setPointerCapture?.(pointerId)
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', onCancel)
  return cleanup
}

type Gesture = {
  pointerId: number
  startWorld: Vec
  startClientX: number
  startClientY: number
  startArtboardId: string | null
  marquee: boolean
}

/** Full-canvas transparent hit rect. Render it FIRST, under the grid and the rooms. */
export function CanvasSelectLayer() {
  const { toWorld } = useViewport()
  const tool = useUi((s) => s.tool)
  const gesture = useRef<Gesture | null>(null)
  const designMarqueeCancel = useRef<(() => void) | null>(null)

  // Switching tool (keyboard shortcut) or mode mid-drag unmounts the hit rect, so no pointerup or
  // pointercancel arrives: drop the gesture and the live box so no marquee is left on screen.
  useEffect(() => {
    if (tool !== 'select') {
      gesture.current = null
      designMarqueeCancel.current?.()
      designMarqueeCancel.current = null
      useMarquee.getState().set(null)
    }
  }, [tool])

  useEffect(() => () => {
    designMarqueeCancel.current?.()
    designMarqueeCancel.current = null
  }, [])

  if (tool !== 'select') return null

  const onPointerDown = (e: React.PointerEvent<SVGRectElement>) => {
    if (e.button !== 0) return
    const startWorld = toWorld(e.clientX, e.clientY)
    const hit = findArtboardAtPoint(startWorld, useDoc.getState().doc.artboards)
    if (useUi.getState().mode === 'design') {
      designMarqueeCancel.current?.()
      designMarqueeCancel.current = startDesignMarquee(e, {
        toWorld,
        artboardId: hit?.id ?? null,
        onDone: (marqueeRan) => {
          designMarqueeCancel.current = null
          if (marqueeRan) return
          const latest = findArtboardAtPoint(startWorld, useDoc.getState().doc.artboards)
          if (latest) selectArtboard(latest.id)
          else useUi.getState().set({ selection: { kind: 'none' } })
        },
      })
      return
    }
    gesture.current = {
      pointerId: e.pointerId,
      startWorld,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startArtboardId: hit?.id ?? null,
      marquee: false,
    }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent<SVGRectElement>) => {
    const g = gesture.current
    if (!g || g.pointerId !== e.pointerId) return
    if (!g.marquee) {
      if (Math.hypot(e.clientX - g.startClientX, e.clientY - g.startClientY) < DRAG_PX) return
      g.marquee = true
    }
    useMarquee.getState().set(boxFromPoints(g.startWorld, toWorld(e.clientX, e.clientY)))
  }

  const finish = (e: React.PointerEvent<SVGRectElement>, cancelled: boolean) => {
    const g = gesture.current
    if (!g || g.pointerId !== e.pointerId) return
    gesture.current = null
    e.currentTarget.releasePointerCapture?.(e.pointerId)
    useMarquee.getState().set(null)
    if (cancelled) return
    const artboards = useDoc.getState().doc.artboards
    const ui = useUi.getState()
    if (!g.marquee) {
      const hit = findArtboardAtPoint(g.startWorld, artboards)
      if (hit) selectArtboard(hit.id)
      else useUi.getState().set({ selection: { kind: 'none' } })
      return
    }
    const box = boxFromPoints(g.startWorld, toWorld(e.clientX, e.clientY))
    const match = findRoomsInBox(box, artboards, g.startArtboardId ?? ui.activeArtboardId)
    if (!match) {
      ui.set({ selection: { kind: 'none' } })
      return
    }
    const planSel = ui.selection
    const roomIds =
      e.shiftKey && planSel.kind === 'room' && planSel.artboardId === match.artboardId
        ? [...new Set([...planSel.roomIds, ...match.roomIds])]
        : match.roomIds
    ui.set({
      activeArtboardId: match.artboardId,
      selection: { kind: 'room', artboardId: match.artboardId, roomIds },
    })
  }

  return (
    <rect
      data-testid="canvas-background"
      x={-1e6}
      y={-1e6}
      width={2e6}
      height={2e6}
      fill="transparent"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => finish(e, false)}
      onPointerCancel={(e) => finish(e, true)}
    />
  )
}

/** The live marquee rectangle, crisp 1 px screen stroke. Never takes the pointer. */
export function MarqueeOverlay() {
  const box = useMarquee((s) => s.box)
  const { px } = useViewport()
  if (!box) return null
  return (
    <rect
      data-testid="marquee"
      x={box.minX}
      y={box.minY}
      width={box.maxX - box.minX}
      height={box.maxY - box.minY}
      fill={CANVAS_MARQUEE_FILL}
      stroke={CANVAS_SELECT_STRONG}
      strokeWidth={px(1)}
      strokeDasharray={`${px(4)} ${px(3)}`}
      pointerEvents="none"
    />
  )
}
