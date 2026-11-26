// Drawing tools for rooms (Plan mode): rect, pen, cutout. Render in the Viewport `overlay` (world cm).
import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { CaptureRect, useViewport } from '../../canvas/Viewport'
import { dist, fmtCm, signedArea } from '../../model/geometry'
import type { Vec } from '../../model/geometry'
import { newId } from '../../model/schema'
import { useDoc } from '../../model/store'
import type { Artboard } from '../../model/types'
import { useUi } from '../../shell/uiStore'
import { cutoutArtboardRooms, addRoom } from './actions'
import { MIN_ROOM_SIDE_CM, createRectRoom, nextRoomName } from './ops'
import { snapPoint } from './snap'
import type { SnapGuide } from './snap'

const ORANGE = '#fb923c'

export function RoomToolsOverlay() {
  const mode = useUi((s) => s.mode)
  const tool = useUi((s) => s.tool)
  const activeId = useUi((s) => s.activeArtboardId)
  // Same fallback as the Artboard card: with no active artboard the first one is the target, so
  // the tools work on a fresh document (activeArtboardId starts as null).
  const artboard = useDoc(
    (s) => s.doc.artboards.find((a) => a.id === activeId) ?? s.doc.artboards[0],
  )
  if (mode !== 'plan' || !artboard || (tool !== 'rect' && tool !== 'pen' && tool !== 'cutout')) return null
  return <ToolSurface key={`${artboard.id}-${tool}`} artboard={artboard} tool={tool} />
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

function ToolSurface({ artboard, tool }: { artboard: Artboard; tool: 'rect' | 'pen' | 'cutout' }) {
  const { px, toWorld } = useViewport()
  const [start, setStart] = useState<Vec | null>(null)
  const [cursor, setCursor] = useState<Vec | null>(null)
  const [points, setPoints] = useState<Vec[]>([])
  const [guides, setGuides] = useState<SnapGuide[]>([])
  const pointsRef = useRef<Vec[]>([])
  useEffect(() => { pointsRef.current = points }, [points])

  const local = (e: { clientX: number; clientY: number }): Vec => {
    const w = toWorld(e.clientX, e.clientY)
    return { x: w.x - artboard.xCm, y: w.y - artboard.yCm }
  }
  const snap = (p: Vec, anchor?: Vec): Vec => {
    const r = snapPoint(p, artboard.rooms, { anchor })
    setGuides(r.guides)
    return r.point
  }

  const closePen = () => {
    let pts = pointsRef.current
    if (pts.length < 3) return
    if (signedArea(pts) < 0) pts = [...pts].reverse()
    if (Math.abs(signedArea(pts)) < 1) return
    const room = { id: newId(), name: nextRoomName(artboard.rooms), vertices: pts }
    finishRoom(room)
  }
  const finishRoom = (room: { id: string; name: string; vertices: Vec[] }) => {
    addRoom(artboard.id, room)
    useUi.getState().set({
      activeArtboardId: artboard.id,
      selection: { kind: 'room', artboardId: artboard.id, roomIds: [room.id] },
      tool: 'select',
    })
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable]')) return
      if (e.key === 'Escape') {
        setStart(null); setPoints([]); setGuides([])
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
    if (tool === 'pen') {
      const pts = pointsRef.current
      if (e.detail >= 2) { closePen(); return }
      const p = snap(local(e), pts[pts.length - 1])
      if (pts.length >= 3 && dist(p, pts[0]) <= px(10)) { closePen(); return }
      if (pts.length && dist(p, pts[pts.length - 1]) < 1) return
      setPoints([...pts, p])
      return
    }
    e.currentTarget.setPointerCapture?.(e.pointerId)
    const p = snap(local(e))
    setStart(p)
    setCursor(p)
  }

  const onMove = (e: ReactPointerEvent<SVGRectElement>) => {
    const pts = pointsRef.current
    const raw = local(e)
    if (tool === 'pen') {
      const near = pts.length >= 3 && dist(raw, pts[0]) <= px(10)
      setCursor(near ? pts[0] : snap(raw, pts[pts.length - 1]))
      return
    }
    if (start) setCursor(snap(raw))
  }

  const onUp = (e: ReactPointerEvent<SVGRectElement>) => {
    if (tool === 'pen' || !start) return
    e.currentTarget.releasePointerCapture?.(e.pointerId)
    const end = snap(local(e))
    const a = start
    setStart(null); setCursor(null); setGuides([])
    if (tool === 'rect') {
      if (Math.abs(end.x - a.x) < MIN_ROOM_SIDE_CM || Math.abs(end.y - a.y) < MIN_ROOM_SIDE_CM) return
      finishRoom(createRectRoom(a, end, nextRoomName(artboard.rooms)))
    } else {
      if (Math.abs(end.x - a.x) < 1 || Math.abs(end.y - a.y) < 1) return
      const cutter = [a, { x: end.x, y: a.y }, end, { x: a.x, y: end.y }]
      const sel = useUi.getState().selection
      const ids = sel.kind === 'room' && sel.artboardId === artboard.id ? sel.roomIds : undefined
      cutoutArtboardRooms(artboard.id, cutter, ids)
      toSelect()
    }
  }

  const rectBox = start && cursor
    ? { x: Math.min(start.x, cursor.x), y: Math.min(start.y, cursor.y), w: Math.abs(cursor.x - start.x), h: Math.abs(cursor.y - start.y) }
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
        onPointerCancel={() => { setStart(null); setCursor(null); setGuides([]) }}
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
