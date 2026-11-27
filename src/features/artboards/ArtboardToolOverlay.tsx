// Artboard tool (Plan mode, key A): drag on the canvas to draw a new artboard frame, or click for a
// default-size one. Renders in the Viewport `overlay` (world cm). Esc cancels the drag, then exits.
import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { CaptureRect, useViewport } from '../../canvas/Viewport'
import { ToolHint } from '../../canvas/ToolHint'
import { fmtCm } from '../../model/geometry'
import type { Vec } from '../../model/geometry'
import { FREE_SNAP_LABEL, subscribeModifiers, syncModifiersFromEvent } from '../../shell/modifiers'
import type { Modifiers } from '../../shell/modifiers'
import { useUi } from '../../shell/uiStore'
import { addArtboardWithFrame, artboardRectFromDrag } from './draw'
import type { FrameRect } from './draw'
import { selectArtboard } from './selection'
import { CANVAS_HALO, CANVAS_LABEL, CANVAS_SELECT, CANVAS_SELECT_FILL } from '../../shell/canvasTokens'

const ORANGE = CANVAS_SELECT

export function ArtboardToolOverlay() {
  const mode = useUi((s) => s.mode)
  const tool = useUi((s) => s.tool)
  if (mode !== 'plan' || tool !== 'artboard') return null
  return <Surface />
}

function Surface() {
  const { px, toWorld } = useViewport()
  const [start, setStart] = useState<Vec | null>(null)
  const [rect, setRect] = useState<FrameRect | null>(null)
  const startRef = useRef<Vec | null>(null)
  const rawRef = useRef<Vec | null>(null)

  const cancel = () => { startRef.current = null; rawRef.current = null; setStart(null); setRect(null) }

  // Re-apply the preview when Shift/Alt/Cmd change mid-drag.
  const active = start !== null
  useEffect(() => {
    if (!active) return
    return subscribeModifiers((m: Modifiers) => {
      if (startRef.current && rawRef.current) setRect(artboardRectFromDrag(startRef.current, rawRef.current, m))
    })
  }, [active])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable]')) return
      // First Esc cancels a drag in progress; Esc with nothing in progress exits the tool.
      const idle = startRef.current === null
      cancel()
      if (idle) useUi.getState().set({ tool: 'select' })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const onDown = (e: ReactPointerEvent<SVGRectElement>) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    const p = toWorld(e.clientX, e.clientY)
    startRef.current = p; rawRef.current = p
    setStart(p)
    setRect(artboardRectFromDrag(p, p, syncModifiersFromEvent(e)))
  }
  const onMove = (e: ReactPointerEvent<SVGRectElement>) => {
    const mods = syncModifiersFromEvent(e)
    const p = toWorld(e.clientX, e.clientY)
    rawRef.current = p
    if (startRef.current) setRect(artboardRectFromDrag(startRef.current, p, mods))
  }
  const onUp = (e: ReactPointerEvent<SVGRectElement>) => {
    const s = startRef.current
    if (!s) return
    e.currentTarget.releasePointerCapture?.(e.pointerId)
    const r = artboardRectFromDrag(s, toWorld(e.clientX, e.clientY), syncModifiersFromEvent(e))
    cancel()
    const id = addArtboardWithFrame(r)
    selectArtboard(id)
    useUi.getState().set({ tool: 'select' })
  }

  return (
    <g data-testid="artboard-tool-overlay">
      <CaptureRect style={{ cursor: 'crosshair' }} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={cancel} />
      <ToolHint text={`Artboard: Drag to draw a frame · Click for default size · Shift square · Alt from centre · ${FREE_SNAP_LABEL} no snap · Esc cancel`} />
      {rect && (
        <g pointerEvents="none">
          <rect
            x={rect.x} y={rect.y} width={rect.w} height={rect.h}
            fill={CANVAS_SELECT_FILL} stroke={ORANGE} strokeWidth={px(1)} strokeDasharray={`${px(5)} ${px(3)}`}
          />
          <text
            x={rect.x + rect.w / 2} y={rect.y + rect.h + px(14)} textAnchor="middle" dominantBaseline="central"
            fontSize={px(12)} fill={CANVAS_LABEL} stroke={CANVAS_HALO} strokeWidth={px(3)} paintOrder="stroke"
          >
            {`${fmtCm(rect.w)} × ${fmtCm(rect.h)} cm`}
          </text>
        </g>
      )}
    </g>
  )
}
