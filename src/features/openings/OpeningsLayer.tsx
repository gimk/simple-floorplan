// Openings (doors, windows, gaps) of one artboard, drawn at 1px screen thickness (artboard-local cm).
// Render inside <ArtboardContent> after RoomsLayer. Plan + select tool: select, move along walls, resize.
// Design mode: drawn but not interactive.
import { useEffect, useRef } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { useViewport } from '../../canvas/Viewport'
import type { Vec } from '../../model/geometry'
import { newId } from '../../model/schema'
import { useDoc } from '../../model/store'
import type { Artboard, Opening } from '../../model/types'
import { getModifiers, subscribeModifiers, syncModifiersFromEvent } from '../../shell/modifiers'
import { useUi } from '../../shell/uiStore'
import { formatLengthCm, roundToPrecision } from '../rooms/ops'
import { doorArcGeometry, keepOpeningOrientation, openingEndpoints, resizeOpeningFromEnd, snapToWall } from './geometry'
import type { WallSnap } from './geometry'

export type { Opening }

const ORANGE = '#fb923c'
const BG = '#09090b'
const LINE = 'rgba(241,245,249,0.95)'
const SKY = '#7dd3fc'
const DRAG_THRESHOLD_PX = 3
const RAD = Math.PI / 180

/**
 * Snap position rounded along the wall (not across it) to the artboard precision, so a diagonal wall
 * keeps the opening on its line. `round` false (Cmd held) keeps the exact snap.
 */
function roundAlongWall(snap: WallSnap, widthCm: number, precisionCm: number, round: boolean): { xCm: number; yCm: number } {
  if (!round || !(precisionCm > 0)) return { xCm: snap.xCm, yCm: snap.yCm }
  const dx = Math.cos(snap.angleDeg * RAD), dy = Math.sin(snap.angleDeg * RAD)
  const along = roundToPrecision((snap.xCm - snap.a.x) * dx + (snap.yCm - snap.a.y) * dy, precisionCm)
  // Keep the whole opening on the wall (a wall shorter than the opening stays centred).
  const lo = Math.min(widthCm / 2, snap.wallLengthCm / 2)
  const hi = Math.max(snap.wallLengthCm - widthCm / 2, snap.wallLengthCm / 2)
  const pos = Math.min(hi, Math.max(lo, along))
  return { xCm: snap.a.x + dx * pos, yCm: snap.a.y + dy * pos }
}

type Gesture = {
  pointerId: number
  cx: number
  cy: number
  moved: boolean
  /** Last pointer position in artboard-local cm (replayed when a modifier changes mid-drag). */
  last: Vec | null
  onMove: (p: Vec) => void
  /** Called on pointerup/cancel after the drag is closed (for example to select a copy). */
  onEnd?: () => void
}

/** Pure drawing of one opening (no events). Reused by the placement overlay for previews. */
export function OpeningShape({ op, selected = false, ghost = false }: { op: Opening; selected?: boolean; ghost?: boolean }) {
  const { px } = useViewport()
  const { start, end } = openingEndpoints(op)
  const color = selected ? ORANGE : ghost ? ORANGE : LINE
  const sw = px(selected ? 1.5 : 1)
  const rad = (op.angleDeg * Math.PI) / 180
  const nx = -Math.sin(rad), ny = Math.cos(rad)
  const tick = px(4)
  const ticks = (c: string) => (
    <>
      <line x1={start.x - nx * tick} y1={start.y - ny * tick} x2={start.x + nx * tick} y2={start.y + ny * tick} stroke={c} strokeWidth={px(1)} />
      <line x1={end.x - nx * tick} y1={end.y - ny * tick} x2={end.x + nx * tick} y2={end.y + ny * tick} stroke={c} strokeWidth={px(1)} />
    </>
  )
  let body: React.ReactNode = null
  if (op.kind === 'door') {
    const g = doorArcGeometry(op)
    body = (
      <>
        <line x1={g.hingePt.x} y1={g.hingePt.y} x2={g.openTipPt.x} y2={g.openTipPt.y} stroke={color} strokeWidth={sw} />
        <path
          d={`M ${g.closedTipPt.x} ${g.closedTipPt.y} A ${g.radius} ${g.radius} 0 0 ${g.sweepFlag} ${g.openTipPt.x} ${g.openTipPt.y}`}
          fill="none" stroke={color} strokeWidth={px(1)} strokeDasharray={`${px(4)} ${px(3)}`} opacity={0.8}
        />
      </>
    )
  } else if (op.kind === 'window') {
    const wc = selected || ghost ? color : SKY
    const o = px(2.5)
    body = (
      <>
        <line x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke={wc} strokeWidth={sw} />
        <line x1={start.x + nx * o} y1={start.y + ny * o} x2={end.x + nx * o} y2={end.y + ny * o} stroke={wc} strokeWidth={px(1)} opacity={0.6} />
        <line x1={start.x - nx * o} y1={start.y - ny * o} x2={end.x - nx * o} y2={end.y - ny * o} stroke={wc} strokeWidth={px(1)} opacity={0.6} />
        {ticks(wc)}
      </>
    )
  } else {
    body = (
      <>
        <line x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke={color} strokeWidth={px(1)} strokeDasharray={`${px(3)} ${px(3)}`} opacity={0.7} />
        {ticks(color)}
      </>
    )
  }
  return (
    <g pointerEvents="none">
      <line x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke={BG} strokeWidth={px(3)} />
      {body}
      {op.kind === 'door' && ticks(color)}
    </g>
  )
}

export function OpeningsLayer({ artboard }: { artboard: Artboard }) {
  const { px, toWorld } = useViewport()
  const mode = useUi((s) => s.mode)
  const tool = useUi((s) => s.tool)
  const selection = useUi((s) => s.selection)
  const interactive = mode === 'plan' && tool === 'select'
  const selectedId = selection.kind === 'opening' && selection.artboardId === artboard.id ? selection.openingId : null
  const gesture = useRef<Gesture | null>(null)

  // Alt / Cmd can change while the pointer is down: replay the last pointer position at once.
  useEffect(() => subscribeModifiers(() => {
    const g = gesture.current
    if (g?.moved && g.last) g.onMove(g.last)
  }), [])

  const toLocal = (cx: number, cy: number): Vec => {
    const w = toWorld(cx, cy)
    return { x: w.x - artboard.xCm, y: w.y - artboard.yCm }
  }
  const live = (id: string): Opening | undefined =>
    useDoc.getState().doc.artboards.find((a) => a.id === artboard.id)?.openings.find((o) => o.id === id)
  const patch = (id: string, p: Partial<Opening>) =>
    useDoc.getState().updateSilent((d) => {
      const o = d.artboards.find((a) => a.id === artboard.id)?.openings.find((x) => x.id === id)
      if (o) Object.assign(o, p)
    })
  const insertCopy = (src: Opening, id: string) =>
    useDoc.getState().updateSilent((d) => {
      d.artboards.find((a) => a.id === artboard.id)?.openings.push({ ...src, id })
    })
  const remove = (id: string) =>
    useDoc.getState().updateSilent((d) => {
      const ab = d.artboards.find((a) => a.id === artboard.id)
      if (ab) ab.openings = ab.openings.filter((o) => o.id !== id)
    })
  const select = (id: string) =>
    useUi.getState().set({ activeArtboardId: artboard.id, selection: { kind: 'opening', artboardId: artboard.id, openingId: id } })

  const start = (e: ReactPointerEvent<Element>, onMove: (p: Vec) => void, onEnd?: () => void) => {
    e.stopPropagation()
    syncModifiersFromEvent(e)
    gesture.current = { pointerId: e.pointerId, cx: e.clientX, cy: e.clientY, moved: false, last: null, onMove, onEnd }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  const move = (e: ReactPointerEvent<Element>) => {
    const g = gesture.current
    if (!g || g.pointerId !== e.pointerId) return
    syncModifiersFromEvent(e)
    const p = toLocal(e.clientX, e.clientY)
    g.last = p
    if (!g.moved) {
      if (Math.hypot(e.clientX - g.cx, e.clientY - g.cy) < DRAG_THRESHOLD_PX) return
      g.moved = true
      useDoc.getState().beginDrag()
    }
    g.onMove(p)
  }
  const end = (e: ReactPointerEvent<Element>) => {
    const g = gesture.current
    if (!g || g.pointerId !== e.pointerId) return
    gesture.current = null
    syncModifiersFromEvent(e)
    e.currentTarget.releasePointerCapture?.(e.pointerId)
    if (g.moved) useDoc.getState().endDrag()
    if (g.moved) g.onEnd?.()
  }
  const gp = { onPointerMove: move, onPointerUp: end, onPointerCancel: end }

  const onBodyDown = (e: ReactPointerEvent<SVGLineElement>, op: Opening) => {
    if (e.button !== 0 || !interactive) return
    select(op.id)
    // Alt: the original stays where the drag started and a duplicate follows the pointer.
    const origin = { xCm: op.xCm, yCm: op.yCm, angleDeg: op.angleDeg, widthCm: op.widthCm }
    let dupId: string | null = null
    const ensureDup = (): string | null => {
      if (dupId) return dupId
      const src = live(op.id)
      patch(op.id, { xCm: origin.xCm, yCm: origin.yCm, angleDeg: origin.angleDeg })
      if (!src) return null
      const id = newId()
      insertCopy({ ...src, ...origin }, id)
      dupId = id
      return id
    }
    const dropDup = () => {
      if (!dupId) return
      remove(dupId)
      dupId = null
    }
    start(e, (p) => {
      const mods = getModifiers()
      // Pressing Alt leaves the original in place (dupId), releasing it drops the copy and moves the original.
      if (mods.alt) ensureDup()
      else dropDup()
      const movingId = mods.alt ? dupId : op.id
      if (!movingId) return
      const cur = live(movingId)
      if (!cur) return
      const s = snapToWall(p, artboard.rooms, cur.widthCm, px(22))
      if (!s) return
      const c = roundAlongWall(s, cur.widthCm, artboard.precisionCm, !mods.cmd)
      // The wall may be seen from its other end (shared wall of two rooms): keep the hinge/swing side.
      patch(movingId, { xCm: c.xCm, yCm: c.yCm, angleDeg: keepOpeningOrientation(s.angleDeg, cur.angleDeg) })
    }, () => {
      // The copy is kept on release: select it, as the original was left at its start position.
      if (dupId) select(dupId)
    })
  }
  const onHandleDown = (e: ReactPointerEvent<SVGCircleElement>, op: Opening, which: 'start' | 'end') => {
    if (e.button !== 0 || !interactive) return
    start(e, (p) => {
      const cur = live(op.id)
      if (!cur) return
      const r = resizeOpeningFromEnd(cur, which, p)
      const mods = getModifiers()
      const widthCm = mods.cmd ? r.widthCm : roundToPrecision(r.widthCm, artboard.precisionCm)
      // The opposite end is fixed: move the centre back along the axis by half the width change.
      const shift = ((r.widthCm - widthCm) / 2) * (which === 'end' ? -1 : 1)
      const dx = Math.cos(cur.angleDeg * RAD) * shift, dy = Math.sin(cur.angleDeg * RAD) * shift
      patch(op.id, { xCm: r.xCm + dx, yCm: r.yCm + dy, widthCm })
    })
  }

  return (
    <g data-testid={`openings-layer-${artboard.id}`} pointerEvents={interactive ? undefined : 'none'}>
      {artboard.openings.map((op) => {
        const { start: a, end: b } = openingEndpoints(op)
        const sel = op.id === selectedId
        return (
          <g key={op.id} data-opening-id={op.id}>
            <OpeningShape op={op} selected={sel} />
            {interactive && (
              <line
                x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                stroke="transparent" strokeWidth={px(12)} pointerEvents="stroke" style={{ cursor: 'move' }}
                onPointerDown={(e) => onBodyDown(e, op)} {...gp}
              />
            )}
          </g>
        )
      })}
      {interactive && artboard.openings.filter((o) => o.id === selectedId).map((op) => {
        const { start: a, end: b } = openingEndpoints(op)
        const rad = (op.angleDeg * Math.PI) / 180
        const lx = (a.x + b.x) / 2 + Math.sin(rad) * px(14), ly = (a.y + b.y) / 2 - Math.cos(rad) * px(14)
        return (
          <g key={`h-${op.id}`}>
            {([['start', a], ['end', b]] as const).map(([which, pt]) => (
              <circle
                key={which} cx={pt.x} cy={pt.y} r={px(5)} fill="#12161b" stroke={ORANGE} strokeWidth={px(1.5)}
                style={{ cursor: 'ew-resize' }} onPointerDown={(e) => onHandleDown(e, op, which)} {...gp}
              />
            ))}
            <text
              x={lx} y={ly} textAnchor="middle" dominantBaseline="central" fontSize={px(11)} fill={ORANGE}
              stroke="#12161b" strokeWidth={px(3)} paintOrder="stroke" pointerEvents="none"
            >
              {formatLengthCm(op.widthCm, artboard.precisionCm)} cm
            </text>
          </g>
        )
      })}
    </g>
  )
}
