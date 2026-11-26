// Drawing tools for rooms (Plan mode): rect, pen, cutout. Render in the Viewport `overlay` (world cm).
import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { CaptureRect, useViewport } from '../../canvas/Viewport'
import { dist, fmtCm, signedArea } from '../../model/geometry'
import type { Vec } from '../../model/geometry'
import { newId } from '../../model/schema'
import { useDoc } from '../../model/store'
import { subscribeModifiers, syncModifiersFromEvent } from '../../shell/modifiers'
import type { Modifiers } from '../../shell/modifiers'
import { useUi } from '../../shell/uiStore'
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

function Guides({ guides }: { guides: SnapGuide[] }) {
  const { px } = useViewport()
  return (
    <>
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
    const r = snapPoint(p, ab.rooms, { anchor, precisionCm: ab.precisionCm, disableSnap: mods.cmd, thresholdCm: px(10) })
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
  const finishRoom = (room: { id: string; name: string; vertices: Vec[] }) => {
    addRoom(artboardRef.current.id, room)
    useUi.getState().set({
      activeArtboardId: artboardRef.current.id,
      selection: { kind: 'room', artboardId: artboardRef.current.id, roomIds: [room.id] },
      tool: 'select',
    })
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable]')) return
      if (e.key === 'Escape') {
        setStart(null); setBox(null); setPoints([]); setGuides([]); setLockedId(null)
        if (tool === 'pen' && pointsRef.current.length === 0) toSelect()
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
      if (Math.abs(end.x - a.x) < MIN_ROOM_SIDE_CM || Math.abs(end.y - a.y) < MIN_ROOM_SIDE_CM) return
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
  const color = tool === 'cutout' ? '#f87171' : ORANGE
  const last = points[points.length - 1]

  return (
    <g data-testid="room-tools-overlay" transform={`translate(${artboard.xCm} ${artboard.yCm})`}>
      <CaptureRect
        style={{ cursor: 'crosshair' }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => { setStart(null); setCursor(null); setBox(null); setGuides([]) }}
      />
      <g pointerEvents="none">
        {rectBox && (
          <>
            <rect
              x={rectBox.x} y={rectBox.y} width={rectBox.w} height={rectBox.h}
              fill={tool === 'cutout' ? 'rgba(248,113,113,0.15)' : 'rgba(251,146,60,0.12)'}
              stroke={color} strokeWidth={px(1)} strokeDasharray={tool === 'cutout' ? `${px(5)} ${px(3)}` : undefined}
            />
            <Tag x={rectBox.x + rectBox.w / 2} y={rectBox.y + rectBox.h + px(14)} text={`${fmtCm(rectBox.w)} × ${fmtCm(rectBox.h)} cm`} />
          </>
        )}
        {tool === 'pen' && points.length > 0 && (
          <>
            <polyline
              points={[...points, ...(cursor ? [cursor] : [])].map((p) => `${p.x},${p.y}`).join(' ')}
              fill="none" stroke={ORANGE} strokeWidth={px(1)} strokeLinejoin="round"
            />
            {points.map((p, i) => (
              <circle key={i} cx={p.x} cy={p.y} r={px(i === 0 && points.length >= 3 ? 5 : 3)} fill="#12161b" stroke={ORANGE} strokeWidth={px(1.5)} />
            ))}
            {cursor && last && dist(cursor, last) > 0.5 && (
              <Tag x={(cursor.x + last.x) / 2} y={(cursor.y + last.y) / 2 - px(12)} text={`${fmtCm(dist(cursor, last))} cm`} />
            )}
          </>
        )}
        <Guides guides={guides} />
      </g>
    </g>
  )
}
