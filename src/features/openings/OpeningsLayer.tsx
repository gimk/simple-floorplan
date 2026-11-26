// Openings (doors, windows, gaps) of one artboard, drawn at 1px screen thickness (artboard-local cm).
// Render inside <ArtboardContent> after RoomsLayer. Plan + select tool: select, move along walls, resize.
// Design mode: drawn but not interactive.
import { useRef } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { useViewport } from '../../canvas/Viewport'
import { fmtCm } from '../../model/geometry'
import type { Vec } from '../../model/geometry'
import { useDoc } from '../../model/store'
import type { Artboard, Opening } from '../../model/types'
import { useUi } from '../../shell/uiStore'
import { doorArcGeometry, keepOpeningOrientation, openingEndpoints, resizeOpeningFromEnd, snapToWall } from './geometry'

export type { Opening }

const ORANGE = '#fb923c'
const BG = '#09090b'
const LINE = 'rgba(241,245,249,0.95)'
const SKY = '#7dd3fc'
const DRAG_THRESHOLD_PX = 3

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
  const gesture = useRef<{ pointerId: number; cx: number; cy: number; moved: boolean; onMove: (p: Vec) => void } | null>(null)

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
  const select = (id: string) =>
    useUi.getState().set({ activeArtboardId: artboard.id, selection: { kind: 'opening', artboardId: artboard.id, openingId: id } })

  const start = (e: ReactPointerEvent<Element>, onMove: (p: Vec) => void) => {
    e.stopPropagation()
    gesture.current = { pointerId: e.pointerId, cx: e.clientX, cy: e.clientY, moved: false, onMove }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  const move = (e: ReactPointerEvent<Element>) => {
    const g = gesture.current
    if (!g || g.pointerId !== e.pointerId) return
    if (!g.moved) {
      if (Math.hypot(e.clientX - g.cx, e.clientY - g.cy) < DRAG_THRESHOLD_PX) return
      g.moved = true
      useDoc.getState().beginDrag()
    }
    g.onMove(toLocal(e.clientX, e.clientY))
  }
  const end = (e: ReactPointerEvent<Element>) => {
    const g = gesture.current
    if (!g || g.pointerId !== e.pointerId) return
    gesture.current = null
    e.currentTarget.releasePointerCapture?.(e.pointerId)
    if (g.moved) useDoc.getState().endDrag()
  }
  const gp = { onPointerMove: move, onPointerUp: end, onPointerCancel: end }

  const onBodyDown = (e: ReactPointerEvent<SVGLineElement>, op: Opening) => {
    if (e.button !== 0 || !interactive) return
    select(op.id)
    start(e, (p) => {
      const cur = live(op.id)
      if (!cur) return
      const s = snapToWall(p, artboard.rooms, cur.widthCm)
      // The wall may be seen from its other end (shared wall of two rooms): keep the hinge/swing side.
      if (s) patch(op.id, { xCm: s.xCm, yCm: s.yCm, angleDeg: keepOpeningOrientation(s.angleDeg, cur.angleDeg) })
    })
  }
  const onHandleDown = (e: ReactPointerEvent<SVGCircleElement>, op: Opening, which: 'start' | 'end') => {
    if (e.button !== 0 || !interactive) return
    start(e, (p) => {
      const cur = live(op.id)
      if (cur) patch(op.id, resizeOpeningFromEnd(cur, which, p))
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
              {fmtCm(op.widthCm)} cm
            </text>
          </g>
        )
      })}
    </g>
  )
}
