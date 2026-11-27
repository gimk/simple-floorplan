// Furniture of one artboard (artboard-local cm). Render inside <ArtboardContent>.
// Plan mode: drawn dimmed and not interactive. Design mode: select, move (Alt = duplicate, Alt mid-drag =
// no snap), resize from the 4 corners and the 4 edges (Shift = keep ratio) and rotate
// (15 deg, Shift 45, Alt 1).
import { memo, useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { useViewport } from '../../canvas/Viewport'
import type { Vec } from '../../model/geometry'
import { newId } from '../../model/schema'
import { useDoc } from '../../model/store'
import type { Artboard, FurnitureItem } from '../../model/types'
import { getModifiers, subscribeModifiers, syncModifiersFromEvent } from '../../shell/modifiers'
import { useUi } from '../../shell/uiStore'
import { moveFurnitureGroup, setFurnitureSelection, updateFurnitureSilent } from './actions'
import type { FurnitureStart } from './actions'
import {
  CORNER_HANDLES,
  EDGE_HANDLES,
  computeDistanceGuides,
  computeMeasureGuides,
  directionArrowGeometry,
  furnitureAxisBounds,
  furnitureCornerRadiusCm,
  pickMeasureTarget,
  resizeFurnitureFromHandle,
  snapFurnitureMove,
  snapRotation,
} from './geometry'
import type { CornerHandle, DistanceGuide, MeasureTarget, ResizeHandle } from './geometry'
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

type Corner = CornerHandle
const CORNER_CURSOR = (c: Corner) => (c.sx === c.sy ? 'nwse-resize' : 'nesw-resize')

/**
 * Cursor of an edge handle: resize across the edge. A quarter turn (45..135 deg) swaps the two axes,
 * because the item's local X then runs down the screen.
 */
const EDGE_CURSOR = (rotationDeg: number, edge: ResizeHandle): string => {
  const n = ((rotationDeg % 360) + 360) % 360
  const fold = n > 180 ? n - 180 : n // 0..180: the box looks the same after a half turn
  const swapped = fold > 45 && fold < 135
  const horizontal = edge.sx !== 0 // left / right edge: its normal is the local X axis
  return horizontal !== swapped ? 'ew-resize' : 'ns-resize'
}

const fmtCm = (v: number): string => String(Math.round(v * 10) / 10)

function FurnitureLayerImpl({ artboard }: { artboard: Artboard }) {
  const { px, toWorld, zoom } = useViewport()
  const mode = useUi((s) => s.mode)
  const selection = useUi((s) => s.selection)
  const design = mode === 'design'
  // Ids of the selected items of THIS artboard: one id for a single selection, 2+ for a group.
  const selIds =
    (selection.kind === 'furniture' || selection.kind === 'furnitureMulti') && selection.artboardId === artboard.id
      ? selection.kind === 'furniture'
        ? [selection.furnitureId]
        : selection.furnitureIds
      : []
  // A group that lost items (undo, a delete elsewhere) is stale: draw nothing until the next click.
  const activeIds = selection.kind === 'furnitureMulti' && selIds.length < 2 ? [] : selIds
  // Handles, resize, rotate and the Option/Alt measure stay single-selection only.
  const selectedId = activeIds.length === 1 ? activeIds[0] : null
  const multiIds = activeIds.length > 1 ? activeIds : null
  const gesture = useRef<Gesture | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [guides, setGuides] = useState<DistanceGuide[]>([])
  // Option/Alt measure overlay: display only, never touches the document.
  const [measure, setMeasure] = useState<{ guides: DistanceGuide[]; target: MeasureTarget } | null>(null)
  const lastPointer = useRef<Vec | null>(null)
  // Render-safe mirror of "a gesture is active" (a ref must not be read during render).
  const [gesturing, setGesturing] = useState(false)
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

  // Recompute the Option/Alt measure overlay from the last pointer position of the live document.
  const recompute = () => {
    const hide = () => setMeasure((m) => (m === null ? m : null))
    if (!getModifiers().alt || gesture.current || !lastPointer.current) { hide(); return }
    const sel = selectedId ? live(selectedId) : undefined
    if (!sel) { hide(); return }
    const ab = liveArtboard()
    const target = pickMeasureTarget(lastPointer.current, ab, sel.id, px(8))
    setMeasure({ guides: computeMeasureGuides(sel, target, ab), target })
  }
  // The window listener reads the newest closures through this ref, so a pan or a zoom needs no resubscribe.
  const measureApi = useRef({ toLocal, recompute })
  useEffect(() => { measureApi.current = { toLocal, recompute } })

  useEffect(() => {
    if (!design || !selectedId) return
    const onPointerMove = (e: PointerEvent) => {
      lastPointer.current = measureApi.current.toLocal(e.clientX, e.clientY)
      syncModifiersFromEvent(e)
      measureApi.current.recompute()
    }
    window.addEventListener('pointermove', onPointerMove, { passive: true })
    const unsubscribe = subscribeModifiers(() => measureApi.current.recompute())
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      unsubscribe()
      setMeasure(null)
    }
  }, [design, selectedId])

  const start = (e: ReactPointerEvent<Element>, onMove: (p: Vec) => void) => {
    e.stopPropagation()
    syncModifiersFromEvent(e)
    // A gesture owns the screen: the measure overlay goes away at once.
    setMeasure(null)
    setGesturing(true)
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
    setGesturing(false)
    syncModifiersFromEvent(e)
    try { e.currentTarget.releasePointerCapture?.(e.pointerId) } catch { /* not captured */ }
    if (g.moved) useDoc.getState().endDrag()
    setDraggingId(null)
    setGuides([])
    setRotBadge(null)
  }
  const gp = { onPointerMove: move, onPointerUp: end, onPointerCancel: end }

  const patch = (id: string, p: Partial<Omit<FurnitureItem, 'id'>>) => updateFurnitureSilent(artboard.id, id, p)

  /**
   * Drag every item of the group by the delta of the grabbed one. `starts` holds the position each
   * item had when the pointer went down, so the whole drag is one undo step (beginDrag/endDrag) and
   * the snap of the grabbed item decides the delta of all of them. No Alt-duplicate for a group.
   */
  const startGroupDrag = (e: ReactPointerEvent<SVGGElement>, item: FurnitureItem, ids: string[]) => {
    const p0 = toLocal(e.clientX, e.clientY)
    const grab = { x: p0.x - item.xCm, y: p0.y - item.yCm }
    const starts = new Map<string, FurnitureStart>()
    for (const f of liveArtboard().furniture) {
      if (ids.includes(f.id)) starts.set(f.id, { xCm: f.xCm, yCm: f.yCm })
    }
    start(e, (p) => {
      setDraggingId(item.id)
      const cur = live(item.id)
      const startPos = starts.get(item.id)
      if (!cur || !startPos) return
      const mods = getModifiers()
      const s = snapFurnitureMove(cur, p.x - grab.x, p.y - grab.y, liveArtboard(), px(10), { disableSnap: mods.alt })
      moveFurnitureGroup(artboard.id, starts, s.xCm - startPos.xCm, s.yCm - startPos.yCm)
      setGuides(computeDistanceGuides({ ...cur, xCm: s.xCm, yCm: s.yCm }, liveArtboard()))
    })
  }

  const onBodyDown = (e: ReactPointerEvent<SVGGElement>, item: FurnitureItem) => {
    if (e.button !== 0 || !design) return
    // Shift-click toggles the item in the group selection of this artboard and never starts a drag.
    if (e.shiftKey) {
      e.stopPropagation()
      setFurnitureSelection(
        artboard.id,
        activeIds.includes(item.id) ? activeIds.filter((id) => id !== item.id) : [...activeIds, item.id],
      )
      return
    }
    // An item of the group keeps the group: the pointer drags all of them together.
    if (multiIds && multiIds.includes(item.id)) {
      startGroupDrag(e, item, multiIds)
      return
    }
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

  /**
   * Resize from one handle of the selection box: 4 corners, then 4 edges. The math lives in the pure
   * resizeFurnitureFromHandle (cm, degrees); Shift keeps the ratio, Alt changes nothing here.
   */
  const onResizeDown = (e: ReactPointerEvent<SVGRectElement>, item: FurnitureItem, handle: ResizeHandle) => {
    if (e.button !== 0 || !design) return
    start(e, (p) => {
      const mods = getModifiers()
      patch(item.id, resizeFurnitureFromHandle(item, handle, p, { shift: mods.shift, precisionCm: artboard.precisionCm }))
    })
  }

  const onCornerDown = (e: ReactPointerEvent<SVGRectElement>, item: FurnitureItem, c: Corner) =>
    onResizeDown(e, item, c)

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

  /** One distance guide. Shared by the drag guides and the Option/Alt measure guides. */
  const renderGuide = (g: DistanceGuide, key: number) => {
    const color = g.axis === 'x' ? CYAN : ORANGE
    const label = `${fmtCm(g.distCm)} cm`
    const mx = (g.x1 + g.x2) / 2, my = (g.y1 + g.y2) / 2
    const pw = px(label.length * 6.2 + 12)
    return (
      <g key={key} pointerEvents="none">
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
  }

  const selected = selectedId ? artboard.furniture.find((f) => f.id === selectedId) : undefined
  const hs = px(8)

  // One dashed orange rectangle around the union of the bounds of every item of the group.
  const multiBox = (() => {
    if (!multiIds) return null
    const boxes = artboard.furniture.filter((f) => multiIds.includes(f.id)).map((f) => furnitureAxisBounds(f))
    if (boxes.length === 0) return null
    const pad = px(4)
    return {
      x: Math.min(...boxes.map((b) => b.minX)) - pad,
      y: Math.min(...boxes.map((b) => b.minY)) - pad,
      w: Math.max(...boxes.map((b) => b.maxX)) - Math.min(...boxes.map((b) => b.minX)) + 2 * pad,
      h: Math.max(...boxes.map((b) => b.maxY)) - Math.min(...boxes.map((b) => b.minY)) + 2 * pad,
    }
  })()

  // Option/Alt measure overlay: the hovered target outline, then its distance guides.
  const measureView = measure && !gesturing ? measure : null
  const measureOutline = (() => {
    if (!measureView) return null
    const t = measureView.target
    if (t.kind === 'furniture') {
      const it = t.item
      const w = it.widthCm, d = it.depthCm
      const rx = furnitureCornerRadiusCm(w, d, it.cornerRadiusCm)
      return (
        <g transform={`translate(${it.xCm} ${it.yCm}) rotate(${it.rotationDeg})`}>
          {it.shape === 'circle'
            ? <ellipse cx={0} cy={0} rx={w / 2} ry={d / 2} fill="none" stroke={CYAN} strokeWidth={px(1.5)} />
            : <rect x={-w / 2} y={-d / 2} width={w} height={d} rx={rx} ry={rx} fill="none" stroke={CYAN} strokeWidth={px(1.5)} />}
        </g>
      )
    }
    if (t.kind === 'wall') {
      return <line x1={t.a.x} y1={t.a.y} x2={t.b.x} y2={t.b.y} stroke={CYAN} strokeWidth={px(3)} strokeOpacity={0.6} />
    }
    return null
  })()

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
            {renderShape(item, item.id === selectedId || !!multiIds?.includes(item.id))}
          </g>
          <g transform={`translate(${item.xCm} ${item.yCm})`} pointerEvents="none">{renderLabel(item)}</g>
        </g>
      ))}

      {design && multiBox && (
        <rect
          data-testid="furniture-multi-outline"
          x={multiBox.x} y={multiBox.y} width={multiBox.w} height={multiBox.h}
          fill="none" stroke={ORANGE} strokeWidth={px(1)}
          strokeDasharray={`${px(4)} ${px(3)}`} pointerEvents="none"
        />
      )}

      {design && selected && (
        <g
          data-testid="furniture-handles"
          transform={`translate(${selected.xCm} ${selected.yCm}) rotate(${selected.rotationDeg})`}
        >
          {/* Edge handles first, so the corner handles stay on top. Invisible hit strips: the
              selection outline already shows where the edge is. */}
          {EDGE_HANDLES.map((edge) => {
            const strip = px(10)
            const across = edge.sx !== 0 // left / right edge: the strip runs along the depth
            return (
              <rect
                key={`edge-${edge.sx}:${edge.sy}`}
                data-edge-handle={`${edge.sx}:${edge.sy}`}
                x={across ? (edge.sx * selected.widthCm) / 2 - strip / 2 : -selected.widthCm / 2}
                y={across ? -selected.depthCm / 2 : (edge.sy * selected.depthCm) / 2 - strip / 2}
                width={across ? strip : selected.widthCm}
                height={across ? selected.depthCm : strip}
                fill="transparent"
                style={{ cursor: EDGE_CURSOR(selected.rotationDeg, edge) }}
                onPointerDown={(e) => onResizeDown(e, selected, edge)}
                {...gp}
              />
            )
          })}
          <line
            x1={0} y1={-selected.depthCm / 2} x2={0} y2={-selected.depthCm / 2 - px(22)}
            stroke={ORANGE} strokeWidth={px(1)} pointerEvents="none"
          />
          <circle
            cx={0} cy={-selected.depthCm / 2 - px(22)} r={px(5)} fill="#fff" stroke={ORANGE} strokeWidth={px(1.5)}
            style={{ cursor: 'grab' }} onPointerDown={(e) => onRotateDown(e, selected)} {...gp}
          />
          {CORNER_HANDLES.map((c) => (
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

      {guides.map(renderGuide)}

      {measureView && (
        <g data-testid="furniture-measure" pointerEvents="none">
          {measureOutline}
          {measureView.guides.map(renderGuide)}
        </g>
      )}
    </g>
  )
}

export const FurnitureLayer = memo(FurnitureLayerImpl)
