// Furniture of one artboard (artboard-local cm). Render inside <ArtboardContent>.
// Plan mode: drawn dimmed and not interactive. Design mode: select, move (Alt = duplicate, Alt mid-drag =
// no snap), resize from the 4 corners (Shift = keep ratio) and rotate (15 deg, Shift 45, Alt 1).
import { memo, useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { useViewport } from '../../canvas/Viewport'
import type { Vec } from '../../model/geometry'
import { newId } from '../../model/schema'
import { useDoc } from '../../model/store'
import type { Artboard, FurnitureItem } from '../../model/types'
import { getModifiers, subscribeModifiers, syncModifiersFromEvent } from '../../shell/modifiers'
import { useUi } from '../../shell/uiStore'
import { roundToPrecision } from '../rooms/ops'
import { updateFurnitureSilent } from './actions'
import {
  MAX_FURNITURE_CM,
  MIN_FURNITURE_CM,
  computeDistanceGuides,
  directionArrowGeometry,
  furnitureCornerRadiusCm,
  snapFurnitureMove,
  snapRotation,
} from './geometry'
import type { DistanceGuide } from './geometry'
import { CANVAS_BG, CANVAS_SELECT } from '../../shell/canvasTokens'

const ORANGE = CANVAS_SELECT
const CYAN = '#22d3ee'
const BG = CANVAS_BG
const DRAG_THRESHOLD_PX = 3
const RAD = Math.PI / 180

type Gesture = {
  pointerId: number
  cx: number
  cy: number
  moved: boolean
  /** Last pointer position in artboard-local cm (replayed when a modifier changes mid-drag). */
  last: Vec | null
  onMove: (p: Vec) => void
}

type Corner = { sx: -1 | 1; sy: -1 | 1 }
const CORNERS: Corner[] = [
  { sx: -1, sy: -1 },
  { sx: 1, sy: -1 },
  { sx: 1, sy: 1 },
  { sx: -1, sy: 1 },
]
const CORNER_CURSOR = (c: Corner) => (c.sx === c.sy ? 'nwse-resize' : 'nesw-resize')

const fmtCm = (v: number): string => String(Math.round(v * 10) / 10)

function FurnitureLayerImpl({ artboard }: { artboard: Artboard }) {
  const { px, toWorld, zoom } = useViewport()
  const mode = useUi((s) => s.mode)
  const selection = useUi((s) => s.selection)
  const design = mode === 'design'
  const selectedId = selection.kind === 'furniture' && selection.artboardId === artboard.id ? selection.furnitureId : null
  const gesture = useRef<Gesture | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [guides, setGuides] = useState<DistanceGuide[]>([])
  const [rotBadge, setRotBadge] = useState<{ id: string; deg: number } | null>(null)

  // Shift / Alt can change while the pointer is down: replay the last pointer position at once.
  useEffect(() => subscribeModifiers(() => {
    const g = gesture.current
    if (g?.moved && g.last) g.onMove(g.last)
  }), [])

  const toLocal = (cx: number, cy: number): Vec => {
    const w = toWorld(cx, cy)
    return { x: w.x - artboard.xCm, y: w.y - artboard.yCm }
  }
  const liveArtboard = (): Artboard => useDoc.getState().doc.artboards.find((a) => a.id === artboard.id) ?? artboard
  const live = (id: string): FurnitureItem | undefined => liveArtboard().furniture.find((f) => f.id === id)
  const select = (id: string) =>
    useUi.getState().set({ activeArtboardId: artboard.id, selection: { kind: 'furniture', artboardId: artboard.id, furnitureId: id } })

  const start = (e: ReactPointerEvent<Element>, onMove: (p: Vec) => void) => {
    e.stopPropagation()
    syncModifiersFromEvent(e)
    gesture.current = { pointerId: e.pointerId, cx: e.clientX, cy: e.clientY, moved: false, last: null, onMove }
    try { e.currentTarget.setPointerCapture?.(e.pointerId) } catch { /* synthetic or missing pointer id */ }
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
    try { e.currentTarget.releasePointerCapture?.(e.pointerId) } catch { /* not captured */ }
    if (g.moved) useDoc.getState().endDrag()
    setDraggingId(null)
    setGuides([])
    setRotBadge(null)
  }
  const gp = { onPointerMove: move, onPointerUp: end, onPointerCancel: end }

  const patch = (id: string, p: Partial<Omit<FurnitureItem, 'id'>>) => updateFurnitureSilent(artboard.id, id, p)

  const onBodyDown = (e: ReactPointerEvent<SVGGElement>, item: FurnitureItem) => {
    if (e.button !== 0 || !design) return
    select(item.id)
    // Read Alt from this very event before deciding to duplicate: a keydown that the tracker never
    // saw (key held during a focus change, synthetic events) must not swallow the duplicate.
    syncModifiersFromEvent(e)
    const p0 = toLocal(e.clientX, e.clientY)
    const grab = { x: p0.x - item.xCm, y: p0.y - item.yCm }
    const duplicate = getModifiers().alt
    let movingId = item.id
    start(e, (p) => {
      if (duplicate && movingId === item.id) {
        // Alt at drag start: the original stays, a copy follows the pointer.
        const src = live(item.id)
        if (!src) return
        const id = newId()
        useDoc.getState().updateSilent((d) => {
          d.artboards.find((a) => a.id === artboard.id)?.furniture.push({ ...src, id })
        })
        movingId = id
        select(id)
      }
      setDraggingId(movingId)
      const cur = live(movingId)
      if (!cur) return
      const mods = getModifiers()
      const s = snapFurnitureMove(cur, p.x - grab.x, p.y - grab.y, liveArtboard(), px(10), { disableSnap: mods.alt })
      patch(movingId, { xCm: s.xCm, yCm: s.yCm })
      setGuides(computeDistanceGuides({ ...cur, xCm: s.xCm, yCm: s.yCm }, liveArtboard()))
    })
  }

  const onCornerDown = (e: ReactPointerEvent<SVGRectElement>, item: FurnitureItem, c: Corner) => {
    if (e.button !== 0 || !design) return
    const a = item.rotationDeg * RAD
    const cos = Math.cos(a), sin = Math.sin(a)
    const w0 = item.widthCm, d0 = item.depthCm
    const o = { x: -c.sx * w0 / 2, y: -c.sy * d0 / 2 } // opposite corner, item-local, stays fixed
    start(e, (p) => {
      const mods = getModifiers()
      const dx = p.x - item.xCm, dy = p.y - item.yCm
      // Pointer in the start frame of the item.
      const lx = dx * cos + dy * sin
      const ly = -dx * sin + dy * cos
      let w = (lx - o.x) * c.sx
      let d = (ly - o.y) * c.sy
      if (mods.shift) {
        const s = Math.max(w / w0, d / d0)
        const lo = Math.max(MIN_FURNITURE_CM / w0, MIN_FURNITURE_CM / d0)
        const hi = Math.min(MAX_FURNITURE_CM / w0, MAX_FURNITURE_CM / d0)
        const k = Math.min(hi, Math.max(lo, s))
        w = w0 * k
        d = d0 * k
      }
      const clamp = (v: number) => Math.min(MAX_FURNITURE_CM, Math.max(MIN_FURNITURE_CM, v))
      w = clamp(roundToPrecision(w, artboard.precisionCm))
      d = clamp(roundToPrecision(d, artboard.precisionCm))
      const cl = { x: o.x + c.sx * w / 2, y: o.y + c.sy * d / 2 }
      patch(item.id, {
        widthCm: w,
        depthCm: d,
        xCm: item.xCm + cl.x * cos - cl.y * sin,
        yCm: item.yCm + cl.x * sin + cl.y * cos,
      })
    })
  }

  const onRotateDown = (e: ReactPointerEvent<SVGCircleElement>, item: FurnitureItem) => {
    if (e.button !== 0 || !design) return
    start(e, (p) => {
      const mods = getModifiers()
      const ang = Math.atan2(p.y - item.yCm, p.x - item.xCm) / RAD + 90 // handle sits on local -Y
      const step = mods.alt ? 1 : mods.shift ? 45 : 15
      const deg = snapRotation(ang, step)
      patch(item.id, { rotationDeg: deg })
      setRotBadge({ id: item.id, deg })
    })
  }

  const renderShape = (item: FurnitureItem, selected: boolean) => {
    const w = item.widthCm, d = item.depthCm
    const common = {
      fill: item.color,
      fillOpacity: 0.78,
      stroke: selected ? ORANGE : '#e4e4e7',
      strokeOpacity: selected ? 1 : 0.45,
      strokeWidth: selected ? 2 : 1,
      vectorEffect: 'non-scaling-stroke' as const,
    }
    const rx = furnitureCornerRadiusCm(w, d, item.cornerRadiusCm)
    const arrow = item.showDirection ? directionArrowGeometry(w, d, px) : null
    return (
      <>
        {item.shape === 'circle'
          ? <ellipse cx={0} cy={0} rx={w / 2} ry={d / 2} {...common} />
          : <rect x={-w / 2} y={-d / 2} width={w} height={d} rx={rx} ry={rx} {...common} />}
        {arrow && (
          // Optional subtle front-direction chevron (local -Y), never bigger than the item.
          <path
            d={`M ${arrow.left.x} ${arrow.left.y} L ${arrow.tip.x} ${arrow.tip.y} L ${arrow.right.x} ${arrow.right.y}`}
            fill="none" stroke="#f4f4f5" strokeOpacity={0.55} strokeWidth={1.5}
            strokeLinecap="round" strokeLinejoin="round"
            vectorEffect="non-scaling-stroke" pointerEvents="none"
          />
        )}
      </>
    )
  }

  const renderLabel = (item: FurnitureItem) => {
    const minPx = Math.min(item.widthCm, item.depthCm) * zoom
    const wPx = item.widthCm * zoom
    if (minPx < 22 || wPx < 40) return null
    const showSize = minPx > 44 && wPx > 70
    return (
      <text
        x={0} y={0} textAnchor="middle" dominantBaseline="central" fontSize={px(12)} fill="rgba(250,250,250,0.95)"
        stroke={BG} strokeWidth={px(3)} paintOrder="stroke" strokeLinejoin="round" pointerEvents="none"
      >
        <tspan x={0} dy={showSize ? px(-6) : 0} fontWeight={600}>{item.name}</tspan>
        {showSize && (
          <tspan x={0} dy={px(14)} fontSize={px(10)} fill="rgba(228,228,231,0.75)">
            {fmtCm(item.widthCm)}×{fmtCm(item.depthCm)}
          </tspan>
        )}
      </text>
    )
  }

  const selected = selectedId ? artboard.furniture.find((f) => f.id === selectedId) : undefined
  const hs = px(8)

  return (
    <g
      data-testid={`furniture-layer-${artboard.id}`}
      opacity={design ? 1 : 0.32}
      pointerEvents={design ? undefined : 'none'}
    >
      {artboard.furniture.map((item) => (
        <g key={item.id} data-furniture-id={item.id} data-entity="furniture" data-id={item.id} aria-label={`${item.name} (${Math.round(item.widthCm)}×${Math.round(item.depthCm)} cm)`}>
          <g
            transform={`translate(${item.xCm} ${item.yCm}) rotate(${item.rotationDeg})`}
            style={design ? { cursor: draggingId === item.id ? 'grabbing' : 'grab' } : undefined}
            onPointerDown={(e) => onBodyDown(e, item)} {...gp}
          >
            {renderShape(item, item.id === selectedId)}
          </g>
          <g transform={`translate(${item.xCm} ${item.yCm})`} pointerEvents="none">{renderLabel(item)}</g>
        </g>
      ))}

      {design && selected && (
        <g
          data-testid="furniture-handles"
          transform={`translate(${selected.xCm} ${selected.yCm}) rotate(${selected.rotationDeg})`}
        >
          <line
            x1={0} y1={-selected.depthCm / 2} x2={0} y2={-selected.depthCm / 2 - px(22)}
            stroke={ORANGE} strokeWidth={px(1)} pointerEvents="none"
          />
          <circle
            cx={0} cy={-selected.depthCm / 2 - px(22)} r={px(5)} fill="#fff" stroke={ORANGE} strokeWidth={px(1.5)}
            style={{ cursor: 'grab' }} onPointerDown={(e) => onRotateDown(e, selected)} {...gp}
          />
          {CORNERS.map((c) => (
            <rect
              key={`${c.sx}${c.sy}`}
              x={c.sx * selected.widthCm / 2 - hs / 2} y={c.sy * selected.depthCm / 2 - hs / 2}
              width={hs} height={hs} fill="#fff" stroke={ORANGE} strokeWidth={px(1.5)}
              style={{ cursor: CORNER_CURSOR(c) }} onPointerDown={(e) => onCornerDown(e, selected, c)} {...gp}
            />
          ))}
        </g>
      )}

      {rotBadge && (() => {
        const it = live(rotBadge.id)
        if (!it) return null
        const bx = it.xCm, by = it.yCm - Math.max(it.widthCm, it.depthCm) / 2 - px(46)
        return (
          <g pointerEvents="none">
            <rect x={bx - px(18)} y={by - px(9)} width={px(36)} height={px(18)} rx={px(9)} fill={BG} stroke={ORANGE} strokeWidth={px(1)} />
            <text x={bx} y={by} textAnchor="middle" dominantBaseline="central" fontSize={px(11)} fill={ORANGE}>
              {Math.round(rotBadge.deg)}°
            </text>
          </g>
        )
      })()}

      {guides.map((g, i) => {
        const color = g.axis === 'x' ? CYAN : ORANGE
        const label = `${fmtCm(g.distCm)} cm`
        const mx = (g.x1 + g.x2) / 2, my = (g.y1 + g.y2) / 2
        const pw = px(label.length * 6.2 + 12)
        return (
          <g key={i} pointerEvents="none">
            <line
              x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2}
              stroke={color} strokeWidth={px(1)} strokeDasharray={`${px(4)} ${px(3)}`}
            />
            <circle cx={g.x2} cy={g.y2} r={px(2.5)} fill={color} />
            <rect x={mx - pw / 2} y={my - px(8)} width={pw} height={px(16)} rx={px(8)} fill={BG} stroke={color} strokeWidth={px(1)} />
            <text x={mx} y={my} textAnchor="middle" dominantBaseline="central" fontSize={px(10.5)} fill={color}>
              {label}
            </text>
          </g>
        )
      })}
    </g>
  )
}

export const FurnitureLayer = memo(FurnitureLayerImpl)
