// Canvas background hit target (select tool): click selects the artboard under the pointer or
// clears the selection; a Plan-mode drag draws a marquee that selects the rooms it touches.
// Design mode: a click only selects the artboard (or clears the selection) — no marquee.
// `MarqueeOverlay` draws the live box. Render it ABOVE the rooms (Viewport overlay).
import { useEffect, useRef } from 'react'
import { useViewport } from '../../canvas/Viewport'
import type { Vec } from '../../model/geometry'
import { useDoc } from '../../model/store'
import { useUi } from '../../shell/uiStore'
import { selectArtboard } from '../artboards/selection'
import { boxFromPoints, findArtboardAtPoint, findRoomsInBox } from './boxSelect'
import { useMarquee } from './marqueeStore'
import { CANVAS_MARQUEE_FILL, CANVAS_SELECT_STRONG } from '../../shell/canvasTokens'

const DRAG_PX = 4

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

  // Switching tool (keyboard shortcut) or mode mid-drag unmounts the hit rect, so no pointerup or
  // pointercancel arrives: drop the gesture and the live box so no marquee is left on screen.
  useEffect(() => {
    if (tool !== 'select') {
      gesture.current = null
      useMarquee.getState().set(null)
    }
  }, [tool])

  if (tool !== 'select') return null

  const onPointerDown = (e: React.PointerEvent<SVGRectElement>) => {
    if (e.button !== 0) return
    const startWorld = toWorld(e.clientX, e.clientY)
    const hit = findArtboardAtPoint(startWorld, useDoc.getState().doc.artboards)
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
      if (useUi.getState().mode !== 'plan') return
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
    // Design mode edits no geometry: a click only selects the artboard under the pointer (or clears
    // the selection), and no marquee ever selects rooms.
    if (useUi.getState().mode === 'design') {
      const hit = findArtboardAtPoint(g.startWorld, artboards)
      if (hit) selectArtboard(hit.id)
      else useUi.getState().set({ selection: { kind: 'none' } })
      return
    }
    if (!g.marquee) {
      const hit = findArtboardAtPoint(g.startWorld, artboards)
      if (hit) selectArtboard(hit.id)
      else useUi.getState().set({ selection: { kind: 'none' } })
      return
    }
    const box = boxFromPoints(g.startWorld, toWorld(e.clientX, e.clientY))
    const ui = useUi.getState()
    const match = findRoomsInBox(box, artboards, g.startArtboardId ?? ui.activeArtboardId)
    if (!match) {
      ui.set({ selection: { kind: 'none' } })
      return
    }
    const sel = ui.selection
    const roomIds =
      e.shiftKey && sel.kind === 'room' && sel.artboardId === match.artboardId
        ? [...new Set([...sel.roomIds, ...match.roomIds])]
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
