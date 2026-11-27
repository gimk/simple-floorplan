// Furniture of one artboard (artboard-local cm). Render inside <ArtboardContent>.
// Plan mode: drawn dimmed and not interactive. Design mode: select (single or group), move
// (Alt = duplicate, Alt mid-drag = no snap), resize from the 4 corners and the 4 edges
// (Shift = keep ratio) and rotate (15 deg, Shift 45, Alt 1).
import { memo, useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { useViewport } from '../../canvas/Viewport'
import type { Vec } from '../../model/geometry'
import { newId } from '../../model/schema'
import { useDoc } from '../../model/store'
import type { Artboard, FurnitureItem } from '../../model/types'
import { getModifiers, subscribeModifiers, syncModifiersFromEvent } from '../../shell/modifiers'
import { useUi } from '../../shell/uiStore'
import {
  duplicateFurnitureGroup,
  moveFurnitureGroup,
  rotateFurnitureGroup,
  setFurnitureSelection,
  updateFurnitureSilent,
} from './actions'
import type { FurnitureStart } from './actions'
import { expandToGroups, resolveFurnitureClick, resolveFurnitureDoubleClick } from './groups'
import { groupBounds } from './groupTransform'
import type { FurnitureTransformStart } from './groupTransform'
import {
  CORNER_HANDLES,
  EDGE_HANDLES,
  applyAxisLock,
  computeMeasureGuides,
  computeMeasureGuidesForBox,
  directionArrowGeometry,
  furnitureAxisBounds,
  furnitureCornerRadiusCm,
  pickMeasureTarget,
  resizeFurnitureFromHandle,
  snapRotation,
} from './geometry'
import type { CornerHandle, DistanceGuide, MeasureTarget, ResizeHandle } from './geometry'
import { resizeFurnitureGroupWithAlt, setDirectFurnitureSelection } from './pointerActions'
import { computeDragDistanceGuides, snapBoxMove } from './snapGuides'
import type { SnapGuideLine } from './snapGuides'
import { CANVAS_BG, CANVAS_SELECT } from '../../shell/canvasTokens'

const ORANGE = CANVAS_SELECT
const CYAN = '#22d3ee'
const SNAP_LINE_COLOR = '#f43f5e'
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

const CORNER_CURSOR = (c: CornerHandle) => (c.sx === c.sy ? 'nwse-resize' : 'nesw-resize')

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
  // Option/Alt measure, handles, resize, rotate and Alt-duplicate work for single and group selections.
  const selectedId = activeIds.length === 1 ? activeIds[0] : null
  const multiIds = activeIds.length > 1 ? activeIds : null
  const hasSelection = activeIds.length > 0
  const gesture = useRef<Gesture | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [guides, setGuides] = useState<DistanceGuide[]>([])
  const [snapLines, setSnapLines] = useState<SnapGuideLine[]>([])
  // Option/Alt measure overlay: display only, never touches the document.
  const [measure, setMeasure] = useState<{ guides: DistanceGuide[]; target: MeasureTarget } | null>(null)
  const lastPointer = useRef<Vec | null>(null)
  // Render-safe mirror of "a gesture is active" (a ref must not be read during render).
  const [gesturing, setGesturing] = useState(false)
  const [rotBadge, setRotBadge] = useState<{ x: number; y: number; deg: number } | null>(null)

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
    const ab = liveArtboard()
    if (selectedId) {
      const sel = ab.furniture.find((f) => f.id === selectedId)
      if (!sel) { hide(); return }
      const target = pickMeasureTarget(lastPointer.current, ab, sel.id, px(8))
      setMeasure({ guides: computeMeasureGuides(sel, target, ab), target })
      return
    }
    if (multiIds) {
      const idSet = new Set(multiIds)
      const items = ab.furniture.filter((f) => idSet.has(f.id))
      const box = groupBounds(items)
      if (!box) { hide(); return }
      const excluded = new Set(expandToGroups(ab, multiIds))
      const target = pickMeasureTarget(lastPointer.current, ab, excluded, px(8))
      setMeasure({ guides: computeMeasureGuidesForBox(box, target, ab), target })
      return
    }
    hide()
  }
  // The window listener reads the newest closures through this ref, so a pan or a zoom needs no resubscribe.
  const measureApi = useRef({ toLocal, recompute })
  useEffect(() => { measureApi.current = { toLocal, recompute } })

  useEffect(() => {
    if (!design || !hasSelection) return
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
  }, [design, hasSelection])

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
    setSnapLines([])
    setRotBadge(null)
  }
  const gp = { onPointerMove: move, onPointerUp: end, onPointerCancel: end }

  const patch = (id: string, p: Partial<Omit<FurnitureItem, 'id'>>) => updateFurnitureSilent(artboard.id, id, p)

  /**
   * Drag every item of the group by the delta of the grabbed one. `starts` holds the position each
   * item had when the pointer went down, so the whole drag is one undo step (beginDrag/endDrag) and
   * the snap of the grabbed item decides the delta of all of them. Alt at pointer down duplicates
   * the group at offset 0 and drags the copies (still one undo step).
   */
  const startGroupDrag = (e: ReactPointerEvent<SVGGElement>, item: FurnitureItem, ids: string[]) => {
    syncModifiersFromEvent(e)
    const duplicate = getModifiers().alt
    const p0 = toLocal(e.clientX, e.clientY)
    const grab = { x: p0.x - item.xCm, y: p0.y - item.yCm }
    let duplicated = false
    let grabbedId = item.id
    let dragIds = [...ids]
    let starts = new Map<string, FurnitureStart>()
    const startItems: FurnitureItem[] = []
    for (const f of liveArtboard().furniture) {
      if (ids.includes(f.id)) {
        starts.set(f.id, { xCm: f.xCm, yCm: f.yCm })
        startItems.push(f)
      }
    }
    let startBounds = groupBounds(startItems)
    start(e, (p) => {
      if (duplicate && !duplicated) {
        duplicated = true
        const newIds = duplicateFurnitureGroup(artboard.id, ids, 0, true)
        dragIds = newIds
        const list = liveArtboard().furniture
        const origIdx = list.findIndex((f) => f.id === item.id)
        const copyItem = origIdx >= 0 ? list[origIdx + 1] : undefined
        if (copyItem && newIds.includes(copyItem.id)) grabbedId = copyItem.id
        const nextStarts = new Map<string, FurnitureStart>()
        const nextItems: FurnitureItem[] = []
        for (const f of list) {
          if (newIds.includes(f.id)) {
            nextStarts.set(f.id, { xCm: f.xCm, yCm: f.yCm })
            nextItems.push(f)
          }
        }
        starts = nextStarts
        startBounds = groupBounds(nextItems)
      }
      setDraggingId(grabbedId)
      const cur = live(grabbedId)
      const startPos = starts.get(grabbedId)
      if (!cur || !startPos || !startBounds) return
      const mods = getModifiers()
      const rawTarget = { x: p.x - grab.x, y: p.y - grab.y }
      const { pos, lockedAxis } = applyAxisLock({ x: startPos.xCm, y: startPos.yCm }, rawTarget, mods.shift)
      const dx = pos.x - startPos.xCm
      const dy = pos.y - startPos.yCm
      const shiftedBounds = {
        minX: startBounds.minX + dx,
        minY: startBounds.minY + dy,
        maxX: startBounds.maxX + dx,
        maxY: startBounds.maxY + dy,
      }
      const ab = liveArtboard()
      const exclude = new Set(dragIds)
      const snap = snapBoxMove(shiftedBounds, ab, exclude, px(6), {
        disableSnap: mods.alt,
        lockAxis: lockedAxis ?? undefined,
        precisionCm: ab.precisionCm,
      })
      const finalDx = dx + snap.dx
      const finalDy = dy + snap.dy
      moveFurnitureGroup(artboard.id, starts, finalDx, finalDy)
      const finalBounds = {
        minX: startBounds.minX + finalDx,
        minY: startBounds.minY + finalDy,
        maxX: startBounds.maxX + finalDx,
        maxY: startBounds.maxY + finalDy,
      }
      setSnapLines(snap.snapLines)
      setGuides(computeDragDistanceGuides(finalBounds, ab, exclude))
    })
  }

  const onBodyDown = (e: ReactPointerEvent<SVGGElement>, item: FurnitureItem) => {
    if (e.button !== 0 || !design) return
    const curSelection = useUi.getState().selection
    const cmdKey = e.metaKey || e.ctrlKey
    // Shift-click adds/removes the item (or its whole group) in the selection and never starts a drag.
    if (e.shiftKey) {
      e.stopPropagation()
      const nextIds = resolveFurnitureClick(liveArtboard(), curSelection, item.id, { shiftKey: true, cmdKey })
      if (cmdKey) setDirectFurnitureSelection(artboard.id, nextIds)
      else setFurnitureSelection(artboard.id, nextIds)
      return
    }
    const nextIds = resolveFurnitureClick(liveArtboard(), curSelection, item.id, { shiftKey: false, cmdKey })
    if (nextIds.length > 1) {
      if (!multiIds || nextIds.length !== multiIds.length || nextIds.some((id, i) => multiIds[i] !== id)) {
        setFurnitureSelection(artboard.id, nextIds)
      }
      startGroupDrag(e, item, nextIds)
      return
    }
    select(item.id)
    // Read Alt from this very event before deciding to duplicate: a keydown that the tracker never
    // saw (key held during a focus change, synthetic events) must not swallow the duplicate.
    syncModifiersFromEvent(e)
    const p0 = toLocal(e.clientX, e.clientY)
    const startPos = { x: item.xCm, y: item.yCm }
    const grab = { x: p0.x - item.xCm, y: p0.y - item.yCm }
    const duplicate = getModifiers().alt
    let movingId = item.id
    start(e, (p) => {
      if (duplicate && movingId === item.id) {
        // Alt at drag start: the original stays, a copy follows the pointer.
        const src = live(item.id)
        if (!src) return
        const id = newId()
        const { groupId: _g, ...rest } = src
        useDoc.getState().updateSilent((d) => {
          d.artboards.find((a) => a.id === artboard.id)?.furniture.push({ ...rest, id })
        })
        movingId = id
        select(id)
      }
      setDraggingId(movingId)
      const cur = live(movingId)
      if (!cur) return
      const mods = getModifiers()
      const rawTarget = { x: p.x - grab.x, y: p.y - grab.y }
      const { pos, lockedAxis } = applyAxisLock(startPos, rawTarget, mods.shift)
      const ab = liveArtboard()
      const box = furnitureAxisBounds({ ...cur, xCm: pos.x, yCm: pos.y })
      const exclude = new Set([movingId])
      const snap = snapBoxMove(box, ab, exclude, px(6), {
        disableSnap: mods.alt,
        lockAxis: lockedAxis ?? undefined,
        precisionCm: ab.precisionCm,
      })
      const finalX = pos.x + snap.dx
      const finalY = pos.y + snap.dy
      patch(movingId, { xCm: finalX, yCm: finalY })
      const finalBox = furnitureAxisBounds({ ...cur, xCm: finalX, yCm: finalY })
      setSnapLines(snap.snapLines)
      setGuides(computeDragDistanceGuides(finalBox, ab, exclude))
    })
  }

  /**
   * Resize from one handle of the selection box: 4 corners, then 4 edges. The math lives in the pure
   * resizeFurnitureFromHandle (cm, degrees); Shift keeps the ratio, Alt resizes from center.
   */
  const onResizeDown = (e: ReactPointerEvent<SVGRectElement>, item: FurnitureItem, handle: ResizeHandle) => {
    if (e.button !== 0 || !design) return
    start(e, (p) => {
      const mods = getModifiers()
      patch(
        item.id,
        resizeFurnitureFromHandle(item, handle, p, {
          shift: mods.shift,
          alt: mods.alt,
          precisionCm: artboard.precisionCm,
        }),
      )
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
      setRotBadge({ x: item.xCm, y: item.yCm - Math.max(item.widthCm, item.depthCm) / 2 - px(46), deg })
    })
  }

  const collectTransformStarts = (ids: string[]) => {
    const starts = new Map<string, FurnitureTransformStart>()
    const items: FurnitureItem[] = []
    for (const f of liveArtboard().furniture) {
      if (!ids.includes(f.id)) continue
      starts.set(f.id, {
        xCm: f.xCm,
        yCm: f.yCm,
        widthCm: f.widthCm,
        depthCm: f.depthCm,
        rotationDeg: f.rotationDeg,
      })
      items.push(f)
    }
    return { starts, bounds: groupBounds(items) }
  }

  const onMultiResizeDown = (e: ReactPointerEvent<SVGRectElement>, ids: string[], handle: ResizeHandle) => {
    if (e.button !== 0 || !design) return
    const { starts, bounds } = collectTransformStarts(ids)
    if (!bounds || starts.size === 0) return
    const pad = px(4)
    start(e, (p) => {
      const mods = getModifiers()
      const adj = { x: p.x - handle.sx * pad, y: p.y - handle.sy * pad }
      resizeFurnitureGroupWithAlt(artboard.id, starts, bounds, handle, adj, {
        shift: mods.shift,
        alt: mods.alt,
        precisionCm: artboard.precisionCm,
      })
    })
  }

  const onMultiRotateDown = (e: ReactPointerEvent<SVGCircleElement>, ids: string[]) => {
    if (e.button !== 0 || !design) return
    const { starts, bounds } = collectTransformStarts(ids)
    if (!bounds || starts.size === 0) return
    const center = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 }
    const p0 = toLocal(e.clientX, e.clientY)
    const ang0 = Math.atan2(p0.y - center.y, p0.x - center.x) / RAD + 90
    const badgeY = bounds.minY - px(4) - px(46)
    start(e, (p) => {
      const mods = getModifiers()
      const ang = Math.atan2(p.y - center.y, p.x - center.x) / RAD + 90
      const step = mods.alt ? 1 : mods.shift ? 45 : 15
      const delta = snapRotation(ang - ang0, step)
      rotateFurnitureGroup(artboard.id, starts, center, delta)
      setRotBadge({ x: center.x, y: badgeY, deg: delta })
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
    const bounds = groupBounds(artboard.furniture.filter((f) => multiIds.includes(f.id)))
    if (!bounds) return null
    const pad = px(4)
    return {
      x: bounds.minX - pad,
      y: bounds.minY - pad,
      w: bounds.maxX - bounds.minX + 2 * pad,
      h: bounds.maxY - bounds.minY + 2 * pad,
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

  const renderHandleGroup = (
    testId: string,
    transform: string,
    w: number,
    d: number,
    rotationDeg: number,
    onResize: (e: ReactPointerEvent<SVGRectElement>, handle: ResizeHandle) => void,
    onRotate: (e: ReactPointerEvent<SVGCircleElement>) => void,
  ) => (
    <g data-testid={testId} transform={transform}>
      {/* Edge handles first, so the corner handles stay on top. Invisible hit strips: the
          selection outline already shows where the edge is. */}
      {EDGE_HANDLES.map((edge) => {
        const strip = px(10)
        const across = edge.sx !== 0 // left / right edge: the strip runs along the depth
        return (
          <rect
            key={`edge-${edge.sx}:${edge.sy}`}
            data-edge-handle={`${edge.sx}:${edge.sy}`}
            x={across ? (edge.sx * w) / 2 - strip / 2 : -w / 2}
            y={across ? -d / 2 : (edge.sy * d) / 2 - strip / 2}
            width={across ? strip : w}
            height={across ? d : strip}
            fill="transparent"
            style={{ cursor: EDGE_CURSOR(rotationDeg, edge) }}
            onPointerDown={(e) => onResize(e, edge)}
            {...gp}
          />
        )
      })}
      <line
        x1={0} y1={-d / 2} x2={0} y2={-d / 2 - px(22)}
        stroke={ORANGE} strokeWidth={px(1)} pointerEvents="none"
      />
      <circle
        cx={0} cy={-d / 2 - px(22)} r={px(5)} fill="#fff" stroke={ORANGE} strokeWidth={px(1.5)}
        style={{ cursor: 'grab' }} onPointerDown={onRotate} {...gp}
      />
      {CORNER_HANDLES.map((c) => (
        <rect
          key={`${c.sx}${c.sy}`}
          x={(c.sx * w) / 2 - hs / 2} y={(c.sy * d) / 2 - hs / 2}
          width={hs} height={hs} fill="#fff" stroke={ORANGE} strokeWidth={px(1.5)}
          style={{ cursor: CORNER_CURSOR(c) }} onPointerDown={(e) => onResize(e, c)} {...gp}
        />
      ))}
    </g>
  )

  return (
    <g
      data-testid={`furniture-layer-${artboard.id}`}
      opacity={design ? 1 : 0.32}
      pointerEvents={design ? undefined : 'none'}
    >
      {artboard.furniture.map((item) => (
        <g key={item.id} data-furniture-id={item.id} data-entity="furniture" data-id={item.id} aria-label={`${item.name} (${Math.round(item.widthCm)}×${Math.round(item.depthCm)} cm)`}>
          <g
            transform={`translate(${item.xCm} ${item.yCm}) rotate(${item.rotationDeg})${item.flipX || item.flipY ? ` scale(${item.flipX ? -1 : 1} ${item.flipY ? -1 : 1})` : ''}`}
            style={design ? { cursor: draggingId === item.id ? 'grabbing' : 'grab' } : undefined}
            onPointerDown={(e) => onBodyDown(e, item)}
            onDoubleClick={(e) => {
              if (!design || e.button !== 0) return
              e.stopPropagation()
              if (item.groupId) {
                const ids = resolveFurnitureDoubleClick(liveArtboard(), item.id)
                if (ids.length === 1) select(ids[0])
              }
            }}
            {...gp}
          >
            {renderShape(item, item.id === selectedId || !!multiIds?.includes(item.id))}
          </g>
          <g transform={`translate(${item.xCm} ${item.yCm})`} pointerEvents="none">{renderLabel(item)}</g>
        </g>
      ))}

      {design && multiBox && multiIds && (
        <>
          <rect
            data-testid="furniture-multi-outline"
            x={multiBox.x} y={multiBox.y} width={multiBox.w} height={multiBox.h}
            fill="none" stroke={ORANGE} strokeWidth={px(1)}
            strokeDasharray={`${px(4)} ${px(3)}`} pointerEvents="none"
          />
          {renderHandleGroup(
            'furniture-multi-handles',
            `translate(${multiBox.x + multiBox.w / 2} ${multiBox.y + multiBox.h / 2})`,
            multiBox.w,
            multiBox.h,
            0,
            (e, h) => onMultiResizeDown(e, multiIds, h),
            (e) => onMultiRotateDown(e, multiIds),
          )}
        </>
      )}

      {design && selected && renderHandleGroup(
        'furniture-handles',
        `translate(${selected.xCm} ${selected.yCm}) rotate(${selected.rotationDeg})`,
        selected.widthCm,
        selected.depthCm,
        selected.rotationDeg,
        (e, h) => onResizeDown(e, selected, h),
        (e) => onRotateDown(e, selected),
      )}

      {rotBadge && (
        <g pointerEvents="none">
          <rect x={rotBadge.x - px(18)} y={rotBadge.y - px(9)} width={px(36)} height={px(18)} rx={px(9)} fill={BG} stroke={ORANGE} strokeWidth={px(1)} />
          <text x={rotBadge.x} y={rotBadge.y} textAnchor="middle" dominantBaseline="central" fontSize={px(11)} fill={ORANGE}>
            {Math.round(rotBadge.deg)}°
          </text>
        </g>
      )}

      {snapLines.map((l, i) => (
        <line
          key={`snap-${i}`}
          data-testid="furniture-snap-guide"
          x1={l.axis === 'x' ? l.coord : l.from}
          y1={l.axis === 'x' ? l.from : l.coord}
          x2={l.axis === 'x' ? l.coord : l.to}
          y2={l.axis === 'x' ? l.to : l.coord}
          stroke={SNAP_LINE_COLOR}
          strokeWidth={px(1)}
          strokeDasharray={`${px(3)} ${px(3)}`}
          pointerEvents="none"
        />
      ))}

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
