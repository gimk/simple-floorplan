// Drawing tools for rooms (Plan mode): rect, pen, cutout. Render in the Viewport `overlay` (world cm).
import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { CaptureRect, useViewport } from '../../canvas/Viewport'
import { ToolHint } from '../../canvas/ToolHint'
import { dist, fmtCm, signedArea } from '../../model/geometry'
import type { Vec } from '../../model/geometry'
import { newId } from '../../model/schema'
import { useDoc } from '../../model/store'
import { FREE_SNAP_LABEL, getModifiers, isFreeSnap, subscribeModifiers, syncModifiersFromEvent } from '../../shell/modifiers'
import type { Modifiers } from '../../shell/modifiers'
import { useUi } from '../../shell/uiStore'
import { toast } from '../toast'
import { measureSegment } from '../tape/geometry'
import { cutoutArtboardRooms, addRoom } from './actions'
import { MIN_ROOM_SIDE_CM, constrainAngle45, createRectRoom, nextRoomName } from './ops'
import { pickArtboard } from '../artboards/frame'
import { snapPoint } from './snap'
import type { SnapGuide } from './snap'

const ORANGE = '#fb923c'

export function RoomToolsOverlay() {
  const mode = useUi((s) => s.mode)
  const tool = useUi((s) => s.tool)
  const hasArtboard = useDoc((s) => s.doc.artboards.length > 0)
  if (mode !== 'plan' || !hasArtboard || (tool !== 'rect' && tool !== 'pen' && tool !== 'cutout')) return null
  return <ToolSurface key={tool} tool={tool} />
}

const toSelect = () => useUi.getState().set({ tool: 'select' })

/** Small label for the kind of snap, when it is known from the guides. */
function guideTag(guides: SnapGuide[]): { text: string; at: Vec } | null {
  if (guides.length === 0) return null
  const pts = guides.filter((g) => g.kind === 'point')
  const lines = guides.filter((g) => g.kind === 'line' && g.b)
  if (lines.length === 0 && pts.length === 1) return { text: 'corner', at: pts[0].a }
  if (lines.length === 1 && pts.length === 1) {
    const g = lines[0]
    const mid = { x: (g.a.x + g.b!.x) / 2, y: (g.a.y + g.b!.y) / 2 }
    return dist(pts[0].a, mid) < 1 ? { text: 'midpoint', at: pts[0].a } : null
  }
  if (lines.length > 0 && pts.length === 0) return { text: 'aligned', at: lines[lines.length - 1].b! }
  return null
}

function Guides({ guides }: { guides: SnapGuide[] }) {
  const { px } = useViewport()
  const tag = guideTag(guides)
  return (
    <>
      {tag && (
        <text
          x={tag.at.x + px(8)} y={tag.at.y - px(8)} fontSize={px(10)} fill="#fdba74" opacity={0.85}
          stroke="#12161b" strokeWidth={px(2.5)} paintOrder="stroke" pointerEvents="none"
        >
          {tag.text}
        </text>
      )}
      {guides.map((g, i) =>
        g.kind === 'line' && g.b ? (
          <line key={i} x1={g.a.x} y1={g.a.y} x2={g.b.x} y2={g.b.y} stroke={ORANGE} strokeWidth={px(1)} strokeDasharray={`${px(4)} ${px(3)}`} />
        ) : (
          <circle key={i} cx={g.a.x} cy={g.a.y} r={px(4)} fill="none" stroke={ORANGE} strokeWidth={px(1.5)} />
        ),
      )}
    </>
  )
}

function Tag({ x, y, text }: { x: number; y: number; text: string }) {
  const { px } = useViewport()
  return (
    <text
      x={x} y={y} textAnchor="middle" dominantBaseline="central" fontSize={px(12)} fill="#f1f5f9"
      stroke="#12161b" strokeWidth={px(3)} paintOrder="stroke" pointerEvents="none"
    >
      {text}
    </text>
  )
}

function ToolSurface({ tool }: { tool: 'rect' | 'pen' | 'cutout' }) {
  const { px, toWorld } = useViewport()
  const activeId = useUi((s) => s.activeArtboardId)
  // Target artboard: locked on the first click of a gesture to the artboard under the cursor.
  const [lockedId, setLockedId] = useState<string | null>(null)
  const artboard = useDoc((s) => {
    const list = s.doc.artboards
    return list.find((a) => a.id === lockedId) ?? list.find((a) => a.id === activeId) ?? list[0]
  })
  const artboardRef = useRef(artboard)
  useEffect(() => { artboardRef.current = artboard })
  const [start, setStart] = useState<Vec | null>(null)
  const [cursor, setCursor] = useState<Vec | null>(null)
  const [box, setBox] = useState<{ a: Vec; b: Vec } | null>(null)
  const rawRef = useRef<Vec | null>(null)
  const startRef = useRef<Vec | null>(null)
  useEffect(() => { startRef.current = start }, [start])
  const [points, setPoints] = useState<Vec[]>([])
  const [guides, setGuides] = useState<SnapGuide[]>([])
  const pointsRef = useRef<Vec[]>([])
  useEffect(() => { pointsRef.current = points }, [points])

  const local = (e: { clientX: number; clientY: number }): Vec => {
    const w = toWorld(e.clientX, e.clientY)
    const ab = artboardRef.current
    return { x: w.x - ab.xCm, y: w.y - ab.yCm }
  }
  /** First click of a gesture: choose the artboard under the cursor and make it active. */
  const lockTarget = (e: { clientX: number; clientY: number }) => {
    const list = useDoc.getState().doc.artboards
    if (list.length === 0) return
    const target = pickArtboard(list, toWorld(e.clientX, e.clientY), useUi.getState().activeArtboardId)
    artboardRef.current = target
    setLockedId(target.id)
    if (useUi.getState().activeArtboardId !== target.id) useUi.getState().set({ activeArtboardId: target.id })
  }
  const snap = (p: Vec, anchor: Vec | undefined, mods: Modifiers): Vec => {
    const ab = artboardRef.current
    const r = snapPoint(p, ab.rooms, { anchor, precisionCm: ab.precisionCm, disableSnap: isFreeSnap(mods), thresholdCm: px(10) })
    setGuides(r.guides)
    return r.point
  }
  /** Next pen point: Shift locks to 45° steps from the previous point, Cmd turns snapping off. */
  const penPoint = (raw: Vec, prev: Vec | undefined, mods: Modifiers): Vec => {
    if (mods.shift && prev) {
      const ab = artboardRef.current
      const r = snapPoint(constrainAngle45(prev, raw), ab.rooms, { precisionCm: ab.precisionCm, disableSnap: true, thresholdCm: px(10) })
      setGuides([])
      return r.point
    }
    return snap(raw, prev, mods)
  }
  /** Rect/cutout corners: Shift = square, Alt = from centre (start is the centre), Cmd = no snap. */
  const rectCorners = (from: Vec, raw: Vec, mods: Modifiers): { a: Vec; b: Vec } => {
    let e = snap(raw, undefined, mods)
    if (mods.shift) {
      const dx = e.x - from.x, dy = e.y - from.y
      const side = Math.max(Math.abs(dx), Math.abs(dy))
      e = { x: from.x + (dx < 0 ? -side : side), y: from.y + (dy < 0 ? -side : side) }
    }
    const a = mods.alt ? { x: 2 * from.x - e.x, y: 2 * from.y - e.y } : from
    return { a, b: e }
  }
  // Re-apply the preview when Shift/Alt/Cmd change mid-gesture (no pointer movement needed).
  const refreshRef = useRef<(m: Modifiers) => void>(() => {})
  useEffect(() => {
    refreshRef.current = (m) => {
      const raw = rawRef.current
      if (!raw) return
      if (tool === 'pen') {
        const pts = pointsRef.current
        if (pts.length > 0) setCursor(penPoint(raw, pts[pts.length - 1], m))
      } else if (start) setBox(rectCorners(start, raw, m))
    }
  })
  const gestureActive = start !== null || points.length > 0
  useEffect(() => {
    if (!gestureActive) return
    return subscribeModifiers((m) => refreshRef.current(m))
  }, [gestureActive])

  const closePen = () => {
    let pts = pointsRef.current
    if (pts.length < 3) return
    if (signedArea(pts) < 0) pts = [...pts].reverse()
    if (Math.abs(signedArea(pts)) < 1) return
    const room = { id: newId(), name: nextRoomName(artboardRef.current.rooms), vertices: pts }
    finishRoom(room)
  }
  /** The rect tool stays armed (draw several rooms in a row); the pen tool returns to Select. */
  const finishRoom = (room: { id: string; name: string; vertices: Vec[] }) => {
    addRoom(artboardRef.current.id, room)
    useUi.getState().set({
      activeArtboardId: artboardRef.current.id,
      selection: { kind: 'room', artboardId: artboardRef.current.id, roomIds: [room.id] },
      ...(tool === 'rect' ? {} : { tool: 'select' as const }),
    })
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable]')) return
      if (e.key === 'Escape') {
        // First Esc cancels the gesture in progress, Esc with nothing in progress exits the tool.
        const idle = tool === 'pen' ? pointsRef.current.length === 0 : startRef.current === null
        setStart(null); setBox(null); setPoints([]); setCursor(null); setGuides([]); setLockedId(null)
        rawRef.current = null
        if (idle) toSelect()
      } else if (e.key === 'Backspace' && tool === 'pen') {
        const pts = pointsRef.current
        if (pts.length === 0) return
        e.preventDefault()
        const next = pts.slice(0, -1)
        pointsRef.current = next
        setPoints(next)
        if (next.length === 0) { setCursor(null); setGuides([]); setLockedId(null); rawRef.current = null }
        else if (rawRef.current) setCursor(penPoint(rawRef.current, next[next.length - 1], getModifiers()))
      } else if (e.key === 'Enter' && tool === 'pen') {
        e.preventDefault()
        closePen()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const onDown = (e: ReactPointerEvent<SVGRectElement>) => {
    if (e.button !== 0) return
    e.stopPropagation()
    const mods = syncModifiersFromEvent(e)
    if (tool === 'pen') {
      if (pointsRef.current.length === 0) lockTarget(e)
      const pts = pointsRef.current
      if (e.detail >= 2) { closePen(); return }
      rawRef.current = local(e)
      const p = penPoint(local(e), pts[pts.length - 1], mods)
      if (pts.length >= 3 && dist(p, pts[0]) <= px(10)) { closePen(); return }
      if (pts.length && dist(p, pts[pts.length - 1]) < 1) return
      setPoints([...pts, p])
      return
    }
    e.currentTarget.setPointerCapture?.(e.pointerId)
    lockTarget(e)
    const p = snap(local(e), undefined, mods)
    rawRef.current = local(e)
    setStart(p)
    setBox({ a: p, b: p })
  }

  const onMove = (e: ReactPointerEvent<SVGRectElement>) => {
    const mods = syncModifiersFromEvent(e)
    const pts = pointsRef.current
    const raw = local(e)
    rawRef.current = raw
    if (tool === 'pen') {
      const near = pts.length >= 3 && dist(raw, pts[0]) <= px(10)
      setCursor(near ? pts[0] : penPoint(raw, pts[pts.length - 1], mods))
      return
    }
    if (start) setBox(rectCorners(start, raw, mods))
  }

  const onUp = (e: ReactPointerEvent<SVGRectElement>) => {
    if (tool === 'pen' || !start) return
    e.currentTarget.releasePointerCapture?.(e.pointerId)
    const { a, b: end } = rectCorners(start, local(e), syncModifiersFromEvent(e))
    setStart(null); setCursor(null); setBox(null); setGuides([]); setLockedId(null)
    rawRef.current = null
    if (tool === 'rect') {
      if (Math.abs(end.x - a.x) < MIN_ROOM_SIDE_CM || Math.abs(end.y - a.y) < MIN_ROOM_SIDE_CM) {
        // A plain click (no drag) is not an attempt to draw a room: stay silent for it.
        if (Math.abs(end.x - a.x) > 2 || Math.abs(end.y - a.y) > 2) toast(`Room too small · minimum side ${MIN_ROOM_SIDE_CM} cm`)
        return
      }
      finishRoom(createRectRoom(a, end, nextRoomName(artboardRef.current.rooms)))
    } else {
      if (Math.abs(end.x - a.x) < 1 || Math.abs(end.y - a.y) < 1) return
      const cutter = [a, { x: end.x, y: a.y }, end, { x: a.x, y: end.y }]
      const sel = useUi.getState().selection
      const ids = sel.kind === 'room' && sel.artboardId === artboardRef.current.id ? sel.roomIds : undefined
      cutoutArtboardRooms(artboardRef.current.id, cutter, ids)
      toSelect()
    }
  }

  const rectBox = start && box
    ? { x: Math.min(box.a.x, box.b.x), y: Math.min(box.a.y, box.b.y), w: Math.abs(box.b.x - box.a.x), h: Math.abs(box.b.y - box.a.y) }
    : null
  const tooSmall = tool === 'rect' && !!rectBox && (rectBox.w < MIN_ROOM_SIDE_CM || rectBox.h < MIN_ROOM_SIDE_CM)
  const color = tool === 'cutout' || tooSmall ? '#f87171' : ORANGE
  const last = points[points.length - 1]
  const nearClose = tool === 'pen' && points.length >= 3 && !!cursor && dist(cursor, points[0]) < 0.5
  const perimeter = points.reduce((sum, p, i) => (i === 0 ? 0 : sum + dist(points[i - 1], p)), 0) + (last && cursor ? dist(last, cursor) : 0)
  const seg = last && cursor ? measureSegment(last, cursor) : null
  // Cutout: rooms the cut will touch (selected rooms, or all rooms when none is selected).
  const sel = useUi.getState().selection
  const cutIds = sel.kind === 'room' && sel.artboardId === artboard.id ? sel.roomIds : undefined
  const cutTargets = tool === 'cutout' && rectBox
    ? artboard.rooms.filter((r) => {
        if (cutIds && !cutIds.includes(r.id)) return false
        const xs = r.vertices.map((v) => v.x), ys = r.vertices.map((v) => v.y)
        return Math.min(...xs) < rectBox.x + rectBox.w && Math.max(...xs) > rectBox.x
          && Math.min(...ys) < rectBox.y + rectBox.h && Math.max(...ys) > rectBox.y
      })
    : []
  const hint =
    tool === 'rect'
      ? `Rect: Drag to draw rooms · Shift square · Alt from centre · ${FREE_SNAP_LABEL} no snap · Esc exit`
      : tool === 'pen'
        ? `Pen: Click corners · Click first point or Enter to close · Shift 45° · ${FREE_SNAP_LABEL} no snap · Backspace undo point · Esc cancel`
        : `Cutout: Drag a box · Highlighted rooms are cut (select rooms to limit it) · Shift square · Alt from centre · ${FREE_SNAP_LABEL} no snap · Esc exit`

  return (
    <g data-testid="room-tools-overlay" transform={`translate(${artboard.xCm} ${artboard.yCm})`}>
      <CaptureRect
        style={{ cursor: 'crosshair' }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => { setStart(null); setCursor(null); setBox(null); setGuides([]) }}
      />
      <ToolHint text={hint} />
      <g pointerEvents="none">
        {cutTargets.map((r) => (
          <polygon
            key={r.id} data-testid="cutout-target"
            points={r.vertices.map((v) => `${v.x},${v.y}`).join(' ')}
            fill="rgba(248,113,113,0.18)" stroke="#f87171" strokeWidth={px(2)}
          />
        ))}
        {rectBox && (
          <>
            <rect
              x={rectBox.x} y={rectBox.y} width={rectBox.w} height={rectBox.h}
              fill={tool === 'cutout' ? 'rgba(248,113,113,0.15)' : 'rgba(251,146,60,0.12)'}
              stroke={color} strokeWidth={px(1)} strokeDasharray={tool === 'cutout' ? `${px(5)} ${px(3)}` : undefined}
            />
            <Tag x={rectBox.x + rectBox.w / 2} y={rectBox.y + rectBox.h + px(14)} text={`${fmtCm(rectBox.w)} × ${fmtCm(rectBox.h)} cm${tool === 'rect' ? ` · ${(rectBox.w * rectBox.h / 10000).toFixed(2).replace('.', ',')} m²` : ''}${tooSmall ? ` · min ${MIN_ROOM_SIDE_CM}` : ''}`} />
          </>
        )}
        {tool === 'pen' && points.length > 0 && (
          <>
            <polyline
              points={[...points, ...(cursor ? [cursor] : [])].map((p) => `${p.x},${p.y}`).join(' ')}
              fill="none" stroke={ORANGE} strokeWidth={px(1)} strokeLinejoin="round"
            />
            {points.map((p, i) => (
              <circle key={i} cx={p.x} cy={p.y} r={px(i === 0 && points.length >= 3 ? (nearClose ? 9 : 5) : 3)} fill={i === 0 && nearClose ? 'rgba(251,146,60,0.3)' : '#12161b'} stroke={ORANGE} strokeWidth={px(1.5)} />
            ))}
            {nearClose && <Tag x={points[0].x} y={points[0].y - px(18)} text="Close" />}
            {cursor && last && seg && seg.distCm > 0.5 && (
              <>
                <Tag x={(cursor.x + last.x) / 2} y={(cursor.y + last.y) / 2 - px(12)} text={`${fmtCm(seg.distCm)} cm · ${Math.round(seg.angleDeg)}°`} />
                <Tag x={cursor.x} y={cursor.y + px(18)} text={`Perimeter ${fmtCm(perimeter)} cm`} />
              </>
            )}
          </>
        )}
        <Guides guides={guides} />
      </g>
    </g>
  )
}
