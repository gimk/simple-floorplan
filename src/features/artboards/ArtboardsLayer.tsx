// Artboard frames on the SVG canvas, drawn in world cm (docs/simple-floorplan-2.md §2.1).
//
// Each artboard is a clean Figma-style frame: a subtle 1 px border over the dark canvas,
// highlighted when it is the active artboard or the selection. A crisp, screen-sized header
// sits above the frame's top-left corner: the name selects the artboard and drags it in Plan
// mode (one undo step per drag), and a compact button duplicates it.
//
// In Plan mode with the select tool, three subtle hit zones on the right edge, the bottom edge
// and the bottom-right corner resize the frame (`a.widthCm` / `a.heightCm`).
//
// Draw the frame and the header OUTSIDE `ArtboardContent`; render the rooms, openings and
// furniture of the artboard INSIDE `ArtboardContent`, which applies the artboard offset.
import { useEffect, useRef, type ReactNode } from 'react'
import { useViewport } from '../../canvas/Viewport'
import { useDoc } from '../../model/store'
import type { Artboard } from '../../model/types'
import { getModifiers, subscribeModifiers, syncModifiersFromEvent } from '../../shell/modifiers'
import { useUi } from '../../shell/uiStore'
import { constrainAxis, roundToPrecision } from '../rooms/ops'
import {
  MIN_ARTBOARD_HEIGHT_CM,
  MIN_ARTBOARD_WIDTH_CM,
  artboardFrame,
  type ArtboardFrame,
} from './frame'
import { selectArtboard } from './selection'

/**
 * Wraps the children of one artboard in `<g transform="translate(xCm, yCm)">`, so they can be
 * drawn in artboard-local cm (rooms, openings and furniture all use local coordinates).
 */
export function ArtboardContent({ artboard, children }: { artboard: Artboard; children?: ReactNode }) {
  return (
    <g data-artboard-id={artboard.id} transform={`translate(${artboard.xCm} ${artboard.yCm})`}>
      {children}
    </g>
  )
}

/** Two overlapping squares, screen-constant size: the "duplicate this artboard" glyph. */
function DuplicateGlyph({ size }: { size: number }) {
  const u = size / 18
  return (
    <>
      <rect
        x={4 * u} y={2.5 * u} width={9 * u} height={11 * u} rx={1.6 * u}
        fill="none" strokeWidth={1.3 * u} className="stroke-slate-300"
      />
      <rect
        x={6.5 * u} y={5.5 * u} width={9 * u} height={11 * u} rx={1.6 * u}
        strokeWidth={1.3 * u} className="fill-[#12161b] stroke-slate-300"
      />
    </>
  )
}

/**
 * Replay `fn` whenever a keyboard modifier changes, so a drag in progress follows Shift / Cmd
 * without waiting for the next pointer move. `fn` may change on every render.
 */
function useModifierReplay(fn: () => void) {
  const latest = useRef(fn)
  useEffect(() => {
    latest.current = fn
  })
  useEffect(() => subscribeModifiers(() => latest.current()), [])
}

type DragState = {
  pointerId: number
  /** World point where the drag started. */
  wx: number
  wy: number
  /** Artboard origin when the drag started. */
  ax: number
  ay: number
  /** Latest pointer position in screen px (replayed when a modifier changes mid-drag). */
  clientX: number
  clientY: number
  /** Drawing precision of the artboard, captured at the drag start. */
  precisionCm: number
  moved: boolean
}

/** Screen-sized header of one artboard: name (select + drag) and a duplicate button. */
function ArtboardHeader({ artboard, frame, highlighted }: { artboard: Artboard; frame: ArtboardFrame; highlighted: boolean }) {
  const { px, toWorld } = useViewport()
  const mode = useUi((s) => s.mode)
  const drag = useRef<DragState | null>(null)

  const fontSize = px(12)
  const rowH = px(22)
  const top = frame.y - px(28)
  const label = artboard.name.trim() === '' ? 'Untitled artboard' : artboard.name
  // Hit area of the name: an estimate of the text width, in screen pixels.
  const nameW = px(Math.min(260, Math.max(48, label.length * 6.7 + 12)))
  const btn = px(20)
  const btnX = frame.x + nameW + px(6)
  const btnY = top + (rowH - btn) / 2

  const moveTo = (xCm: number, yCm: number) => {
    useDoc.getState().updateSilent((doc) => {
      const a = doc.artboards.find((x) => x.id === artboard.id)
      if (a) { a.xCm = xCm; a.yCm = yCm }
    })
  }

  /**
   * Move the artboard to the position under the last pointer event. Shift locks the drag to its
   * dominant axis (`constrainAxis`), Cmd skips the rounding to `a.precisionCm`.
   */
  const apply = () => {
    const d = drag.current
    if (!d) return
    const w = toWorld(d.clientX, d.clientY)
    let dx = w.x - d.wx
    let dy = w.y - d.wy
    const mods = getModifiers()
    if (mods.shift) {
      const c = constrainAxis(dx, dy)
      dx = c.x
      dy = c.y
    }
    if (!d.moved && Math.hypot(dx, dy) < px(2)) return
    d.moved = true
    const snap = (v: number) => (mods.cmd ? v : roundToPrecision(v, d.precisionCm))
    moveTo(snap(d.ax + dx), snap(d.ay + dy))
  }
  useModifierReplay(apply)

  const onPointerDown = (e: React.PointerEvent<SVGGElement>) => {
    if (e.button !== 0) return
    e.stopPropagation()
    selectArtboard(artboard.id)
    if (mode !== 'plan') return
    syncModifiersFromEvent(e)
    const w = toWorld(e.clientX, e.clientY)
    drag.current = {
      pointerId: e.pointerId,
      wx: w.x,
      wy: w.y,
      ax: artboard.xCm,
      ay: artboard.yCm,
      clientX: e.clientX,
      clientY: e.clientY,
      precisionCm: artboard.precisionCm,
      moved: false,
    }
    e.currentTarget.setPointerCapture?.(e.pointerId)
    useDoc.getState().beginDrag()
  }

  const onPointerMove = (e: React.PointerEvent<SVGGElement>) => {
    const d = drag.current
    if (!d || d.pointerId !== e.pointerId) return
    syncModifiersFromEvent(e)
    d.clientX = e.clientX
    d.clientY = e.clientY
    apply()
    if (d.moved) e.stopPropagation()
  }

  const onPointerUp = (e: React.PointerEvent<SVGGElement>) => {
    const d = drag.current
    if (!d || d.pointerId !== e.pointerId) return
    drag.current = null
    e.currentTarget.releasePointerCapture?.(e.pointerId)
    // One undo step for the whole drag (nothing is pushed when the artboard did not move).
    useDoc.getState().endDrag()
  }

  const duplicate = () => {
    const id = useDoc.getState().duplicateArtboard(artboard.id)
    if (id) selectArtboard(id)
  }

  return (
    <g data-testid={`artboard-header-${artboard.id}`}>
      <g
        role="button"
        tabIndex={0}
        aria-label={`Artboard ${label}`}
        style={{ cursor: mode === 'plan' ? 'grab' : 'pointer' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' && e.key !== ' ') return
          e.preventDefault()
          selectArtboard(artboard.id)
        }}
      >
        <rect x={frame.x} y={top} width={nameW} height={rowH} rx={px(5)} className="fill-transparent" />
        <text
          x={frame.x + px(4)}
          y={top + rowH / 2}
          dominantBaseline="central"
          fontSize={fontSize}
          fontWeight={highlighted ? 600 : 500}
          className={highlighted ? 'fill-orange-600 dark:fill-orange-400' : 'fill-slate-700 dark:fill-slate-200'}
        >
          {label}
        </text>
      </g>
      <g
        role="button"
        tabIndex={0}
        aria-label={`Duplicate artboard ${label}`}
        style={{ cursor: 'pointer' }}
        onClick={duplicate}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' && e.key !== ' ') return
          e.preventDefault()
          duplicate()
        }}
      >
        <rect
          x={btnX} y={btnY} width={btn} height={btn} rx={px(5)}
          strokeWidth={px(1)} className="fill-white/5 stroke-white/15 hover:fill-white/15 dark:fill-white/5"
        />
        <g transform={`translate(${btnX} ${btnY})`}>
          <DuplicateGlyph size={btn} />
        </g>
      </g>
    </g>
  )
}

/** Edges a resize drag moves: the right edge, the bottom edge, or both (bottom-right corner). */
type ResizeAxis = 'x' | 'y' | 'xy'

type ResizeState = {
  pointerId: number
  axis: ResizeAxis
  /** World point where the drag started. */
  wx: number
  wy: number
  /** Frame width and height (cm) when the drag started. */
  w0: number
  h0: number
  /** Latest pointer position in screen px (replayed when a modifier changes mid-drag). */
  clientX: number
  clientY: number
  /** Drawing precision of the artboard, captured at the drag start. */
  precisionCm: number
  moved: boolean
}

const HANDLE_CURSOR: Record<ResizeAxis, string> = {
  x: 'ew-resize',
  y: 'ns-resize',
  xy: 'nwse-resize',
}

/**
 * Subtle resize hit zones of one artboard frame, Plan mode with the select tool only: the right
 * edge, the bottom edge and the bottom-right corner. A drag raises `a.widthCm` / `a.heightCm`
 * (one undo step), clamped to the minimum frame size and rounded to `a.precisionCm` unless Cmd is
 * held. The frame never gets smaller than its content, so a shrink stops at the content extent.
 */
function ArtboardResizeHandles({ artboard, frame }: { artboard: Artboard; frame: ArtboardFrame }) {
  const { px, toWorld } = useViewport()
  const drag = useRef<ResizeState | null>(null)

  /** Write the size under the last pointer event. Cmd skips the precision rounding. */
  const apply = () => {
    const d = drag.current
    if (!d) return
    const w = toWorld(d.clientX, d.clientY)
    const dx = w.x - d.wx
    const dy = w.y - d.wy
    if (!d.moved && Math.hypot(dx, dy) < px(2)) return
    d.moved = true
    const { cmd } = getModifiers()
    const round = (v: number) => (cmd ? v : roundToPrecision(v, d.precisionCm))
    const width = d.axis === 'y' ? null : Math.max(MIN_ARTBOARD_WIDTH_CM, round(d.w0 + dx))
    const height = d.axis === 'x' ? null : Math.max(MIN_ARTBOARD_HEIGHT_CM, round(d.h0 + dy))
    useDoc.getState().updateSilent((doc) => {
      const a = doc.artboards.find((x) => x.id === artboard.id)
      if (!a) return
      if (width !== null) a.widthCm = width
      if (height !== null) a.heightCm = height
    })
  }
  useModifierReplay(apply)

  const start = (axis: ResizeAxis) => (e: React.PointerEvent<SVGRectElement>) => {
    if (e.button !== 0) return
    e.stopPropagation()
    selectArtboard(artboard.id)
    syncModifiersFromEvent(e)
    const w = toWorld(e.clientX, e.clientY)
    drag.current = {
      pointerId: e.pointerId,
      axis,
      wx: w.x,
      wy: w.y,
      w0: frame.width,
      h0: frame.height,
      clientX: e.clientX,
      clientY: e.clientY,
      precisionCm: artboard.precisionCm,
      moved: false,
    }
    e.currentTarget.setPointerCapture?.(e.pointerId)
    useDoc.getState().beginDrag()
  }

  const move = (e: React.PointerEvent<SVGRectElement>) => {
    const d = drag.current
    if (!d || d.pointerId !== e.pointerId) return
    syncModifiersFromEvent(e)
    d.clientX = e.clientX
    d.clientY = e.clientY
    apply()
    if (d.moved) e.stopPropagation()
  }

  const end = (e: React.PointerEvent<SVGRectElement>) => {
    const d = drag.current
    if (!d || d.pointerId !== e.pointerId) return
    drag.current = null
    e.currentTarget.releasePointerCapture?.(e.pointerId)
    // One undo step for the whole drag (nothing is pushed when the frame did not change).
    useDoc.getState().endDrag()
  }

  const t = px(7) // hit thickness along the frame edge
  const c = px(14) // size of the corner hit zone
  const corner = Math.min(c, frame.width, frame.height)
  const zones: { axis: ResizeAxis; x: number; y: number; width: number; height: number; test: string }[] = [
    {
      axis: 'x',
      x: frame.x + frame.width - t,
      y: frame.y + corner,
      width: t,
      height: Math.max(0, frame.height - 2 * corner),
      test: 'right',
    },
    {
      axis: 'y',
      x: frame.x + corner,
      y: frame.y + frame.height - t,
      width: Math.max(0, frame.width - 2 * corner),
      height: t,
      test: 'bottom',
    },
    {
      axis: 'xy',
      x: frame.x + frame.width - corner,
      y: frame.y + frame.height - corner,
      width: corner,
      height: corner,
      test: 'corner',
    },
  ]

  return (
    <g data-testid={`artboard-resize-${artboard.id}`}>
      {zones.map((z) => (
        <rect
          key={z.test}
          data-testid={`artboard-resize-${z.test}-${artboard.id}`}
          x={z.x}
          y={z.y}
          width={z.width}
          height={z.height}
          rx={px(2)}
          style={{ cursor: HANDLE_CURSOR[z.axis] }}
          className="fill-transparent hover:fill-orange-500/25"
          onPointerDown={start(z.axis)}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
        />
      ))}
    </g>
  )
}

/**
 * Every artboard of the document as a frame, with its header, duplicate button and (Plan mode,
 * select tool) its resize hit zones.
 * Render it inside the world `<g>` of the Viewport, under the rooms of the artboards.
 */
export function ArtboardsLayer() {
  const artboards = useDoc((s) => s.doc.artboards)
  const activeArtboardId = useUi((s) => s.activeArtboardId)
  const selection = useUi((s) => s.selection)
  const mode = useUi((s) => s.mode)
  const tool = useUi((s) => s.tool)
  const { px } = useViewport()
  const resizable = mode === 'plan' && tool === 'select'

  return (
    <g data-testid="artboards-layer">
      {artboards.map((a) => {
        const frame = artboardFrame(a)
        const highlighted =
          activeArtboardId === a.id || (selection.kind === 'artboard' && selection.artboardId === a.id)
        return (
          <g key={a.id} data-artboard-frame={a.id}>
            <rect
              x={frame.x}
              y={frame.y}
              width={frame.width}
              height={frame.height}
              rx={px(4)}
              strokeWidth={px(highlighted ? 1.5 : 1)}
              pointerEvents="none"
              className={
                highlighted
                  ? 'fill-transparent stroke-orange-500/80 dark:stroke-orange-400/80'
                  : 'fill-transparent stroke-black/15 dark:stroke-white/[0.14]'
              }
            />
            <ArtboardHeader artboard={a} frame={frame} highlighted={highlighted} />
            {resizable && <ArtboardResizeHandles artboard={a} frame={frame} />}
          </g>
        )
      })}
    </g>
  )
}
