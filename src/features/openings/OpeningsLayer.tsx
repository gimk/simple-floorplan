// Openings (doors, windows, gaps) of one artboard, drawn at 1px screen thickness (artboard-local cm).
// Render inside <ArtboardContent> after RoomsLayer. Plan + select tool: select, move along walls, resize.
// Design mode: drawn but not interactive.
import { memo, useEffect, useMemo, useRef } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { useViewport } from '../../canvas/Viewport'
import type { Vec } from '../../model/geometry'
import { newId } from '../../model/schema'
import { useDoc } from '../../model/store'
import type { Artboard, Opening } from '../../model/types'
import { getModifiers, subscribeModifiers, syncModifiersFromEvent } from '../../shell/modifiers'
import { useUi } from '../../shell/uiStore'
import { selectedOpeningIds, toggleMultiTarget } from '../selection/multiSelect'
import { formatLengthCm, roundToPrecision } from '../rooms/ops'
import { jambSegment, openingSymbolShift, openingWall, wallThicknessOf } from '../rooms/walls'
import type { OpeningWall } from '../rooms/walls'
import { keepOpeningOrientation, openingEndpoints, openingSymbol, resizeOpeningFromEnd, snapToWall } from './geometry'
import type { OpeningSymbolArc, OpeningSymbolPath, WallSnap } from './geometry'
import { openingHitEndpoints, openingHitWidth } from './hit'
import { hostWallIn } from './sync'

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

/** SVG path of one 1px symbol stroke (open polyline or closed panel outline). */
function pathD(p: OpeningSymbolPath): string {
  const head = `M ${p.pts.map((q) => `${q.x} ${q.y}`).join(' L ')}`
  return p.closed ? `${head} Z` : head
}

/** SVG path of one quarter-circle swing arc: `M from A r r 0 0 sweep to`. */
function arcD(a: OpeningSymbolArc): string {
  return `M ${a.from.x} ${a.from.y} A ${a.radius} ${a.radius} 0 0 ${a.sweepFlag} ${a.to.x} ${a.to.y}`
}

/**
 * Pure drawing of one opening (no events). Reused by the placement overlay for previews.
 * `strokeMasked` tells that the artboard has a thick-wall stroke mask (wallThicknessCm > 0): that mask
 * already cuts the room border lines out of the opening, even when this opening sits on a flush wall
 * and `wall` is null (effective thickness 0). Default: the wall frame itself.
 */
function OpeningShapeImpl({ op, selected = false, ghost = false, wall = null, strokeMasked }: { op: Opening; selected?: boolean; ghost?: boolean; wall?: OpeningWall | null; strokeMasked?: boolean }) {
  const { px } = useViewport()
  const { start, end } = openingEndpoints(op)
  const color = selected ? ORANGE : ghost ? ORANGE : LINE
  const line = op.kind === 'window' && !selected && !ghost ? SKY : color
  const rad = (op.angleDeg * Math.PI) / 180
  const nx = -Math.sin(rad), ny = Math.cos(rad)
  const tick = px(4)
  const symbol = openingSymbol(op, px)
  // A selected opening gets every stroke a bit heavier, so it stands out of the plan.
  const weight = (m: number) => px(m * (selected ? 1.5 : 1))
  // Thick wall: the jambs span the wall thickness (outward from the room edge) and the symbol sits across it.
  const jambs = wall ? [jambSegment(start, wall), jambSegment(end, wall)] : null
  const shift = wall ? openingSymbolShift(op, wall) : null
  const ticks = (c: string) => (
    <>
      {(jambs ?? [
        { a: { x: start.x - nx * tick, y: start.y - ny * tick }, b: { x: start.x + nx * tick, y: start.y + ny * tick } },
        { a: { x: end.x - nx * tick, y: end.y - ny * tick }, b: { x: end.x + nx * tick, y: end.y + ny * tick } },
      ]).map((j, i) => (
        <line key={i} x1={j.a.x} y1={j.a.y} x2={j.b.x} y2={j.b.y} stroke={c} strokeWidth={px(1)} />
      ))}
    </>
  )
  // Thick wall: the SVG masks of RoomsLayer already cut the wall body and both room border lines out
  // of the opening, so the page below (grid, reference images) shows through. A dark eraser line
  // there would paint a black bar over that page: it is only needed for thin walls. The masks work by
  // artboard, so a flush opening (effective thickness 0) on a thick-wall artboard needs no eraser.
  const eraseGap = ghost || !(strokeMasked ?? (wall !== null && wall.thicknessCm > 0))
  return (
    <g pointerEvents="none">
      {eraseGap && <line x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke={BG} strokeWidth={px(3)} />}
      <g transform={shift ? `translate(${shift.x} ${shift.y})` : undefined}>
      {symbol.wallLine && (
        <line x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke={line} strokeWidth={px(1)} />
      )}
      {symbol.paths.map((p, i) => (
        <path
          key={`p${i}`}
          d={pathD(p)}
          fill="none"
          stroke={line}
          strokeWidth={weight(p.weight ?? 1)}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={p.dashed ? `${px(3)} ${px(3)}` : undefined}
          opacity={p.opacity}
        />
      ))}
      {symbol.arcs.map((a, i) => (
        <path
          key={`a${i}`}
          d={arcD(a)}
          fill="none"
          stroke={color}
          strokeWidth={px(1)}
          strokeDasharray={`${px(4)} ${px(3)}`}
          opacity={0.8}
        />
      ))}
      </g>
      {ticks(op.kind === 'window' && !selected && !ghost ? SKY : color)}
    </g>
  )
}

function OpeningsLayerImpl({ artboard }: { artboard: Artboard }) {
  const { px, toWorld } = useViewport()
  const mode = useUi((s) => s.mode)
  const tool = useUi((s) => s.tool)
  const selection = useUi((s) => s.selection)
  const interactive = mode === 'plan' && tool === 'select'
  const thickness = wallThicknessOf(artboard)
  // Host wall + endpoints per opening: independent of zoom, so pan/zoom does not re-scan the rooms.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const openingGeo = useMemo(() => artboard.openings.map((op) => ({ op, ends: openingEndpoints(op), wall: openingWall(artboard.rooms, op, thickness) })), [artboard.openings, artboard.rooms, thickness])
  // Every selected opening of this artboard is drawn selected, including inside a mixed 'multi'
  // selection. The resize handles stay for a single opening only.
  const selectedIds = selectedOpeningIds(selection, artboard.id)
  const selectedId = selectedIds.size === 1 ? [...selectedIds][0] : null
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
    // Shift-click toggles the opening in the selection (mixed with rooms and walls) and never starts
    // a drag. A plain click always replaces the selection with that one opening.
    if (e.shiftKey) {
      e.stopPropagation()
      useUi.getState().set({
        activeArtboardId: artboard.id,
        selection: toggleMultiTarget(useUi.getState().selection, artboard.id, { kind: 'opening', openingId: op.id }),
      })
      return
    }
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
      // The host room follows the pointer: sliding along a flush wall shared with another room must
      // not move the opening to that room. The current room wins a tie (see `hostWallIn`), otherwise
      // the room of the snap hosts the opening.
      const roomId = hostWallIn(artboard.rooms, { ...cur, xCm: c.xCm, yCm: c.yCm })?.room.id ?? s.roomId
      // The wall may be seen from its other end (shared wall of two rooms): keep the hinge/swing side.
      patch(movingId, { roomId, xCm: c.xCm, yCm: c.yCm, angleDeg: keepOpeningOrientation(s.angleDeg, cur.angleDeg) })
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
    // Design mode: the arcs stay visible above the furniture but never take the pointer, so drags
    // and clicks reach the furniture drawn underneath them.
    <g data-testid={`openings-layer-${artboard.id}`} pointerEvents={interactive ? undefined : 'none'}>
      {openingGeo.map(({ op, ends, wall }) => {
        const { start, end } = ends
        const sel = selectedIds.has(op.id)
        // Thick wall: the hit band sits on the wall centreline, across the whole wall thickness.
        // A null frame (thin artboard, or a flush wall whose body is masked away) keeps it on the line.
        const hit = openingHitEndpoints(start, end, wall)
        return (
          <g key={op.id} data-opening-id={op.id} data-entity="opening" data-id={op.id} aria-label={`${op.kind} (${Math.round(op.widthCm)} cm)`}>
            <OpeningShape op={op} selected={sel} wall={wall} strokeMasked={thickness > 0} />
            {interactive && (
              <line
                x1={hit.start.x} y1={hit.start.y} x2={hit.end.x} y2={hit.end.y}
                stroke="transparent" strokeWidth={openingHitWidth(wall, px)} pointerEvents="stroke" style={{ cursor: 'move' }}
                onPointerDown={(e) => onBodyDown(e, op)} {...gp}
              />
            )}
          </g>
        )
      })}
      {interactive && openingGeo.filter((g) => g.op.id === selectedId).map(({ op, ends, wall: selWall }) => {
        // The end handles sit on the middle of the jambs: same wall-centred line as the hit band.
        const { start: a, end: b } = openingHitEndpoints(ends.start, ends.end, selWall)
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

export const OpeningShape = memo(OpeningShapeImpl)
export const OpeningsLayer = memo(OpeningsLayerImpl)
