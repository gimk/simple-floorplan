// Rooms of one artboard on the canvas (artboard-local cm). Render inside <ArtboardContent>.
// Plan mode + select tool: select, move, edit walls and vertices. Design mode: geometry is locked,
// a room click only selects it (the Inspect panel then edits its floor colour).
import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { useViewport } from '../../canvas/Viewport'
import { add, area, fmtCm, labelPoint, projectOnSegment, signedArea } from '../../model/geometry'
import type { Vec } from '../../model/geometry'
import { newId } from '../../model/schema'
import { useDoc } from '../../model/store'
import type { Artboard, Opening, Room, Selection } from '../../model/types'
import { syncOpeningsForRoomChange } from '../openings/sync'
import { subscribeModifiers, syncModifiersFromEvent } from '../../shell/modifiers'
import type { Modifiers } from '../../shell/modifiers'
import { useUi } from '../../shell/uiStore'
import {
  constrainAxis, constrainWallPerpendicular, deleteVertex, formatLengthCm, insertVertexOnEdge, moveEdge, moveRoom, moveVertex,
  roomWalls, roundToPrecision, scaleRoomFromVertex, wallResizeCursor,
} from './ops'
import { snapPoint, snapRoomDelta } from './snap'
import type { SnapGuide } from './snap'

export type EditWallRequest = {
  artboardId: string
  roomId: string
  edgeIndex: number
  clientX: number
  clientY: number
  currentCm: number
}

export type RoomsLayerProps = {
  artboard: Artboard
  onEditWall?: (req: EditWallRequest) => void
}

const ORANGE = '#fb923c'
const STROKE = 'rgba(226,232,240,0.85)'
const DRAG_THRESHOLD_PX = 3

type Gesture = {
  pointerId: number
  clientX: number
  clientY: number
  start: Vec
  moved: boolean
  /** Last pointer position (artboard-local cm), used to re-apply the drag when a modifier changes. */
  last: Vec
  unsub?: () => void
  onMove: (local: Vec, delta: Vec, mods: Modifiers) => void
  onEnd?: (moved: boolean) => void
}

export function RoomsLayer({ artboard, onEditWall }: RoomsLayerProps) {
  const { px, toWorld, zoom } = useViewport()
  const mode = useUi((s) => s.mode)
  const tool = useUi((s) => s.tool)
  const selection = useUi((s) => s.selection)
  const [guides, setGuides] = useState<SnapGuide[]>([])
  const gesture = useRef<Gesture | null>(null)
  useEffect(() => () => { gesture.current?.unsub?.() }, [])

  const interactive = mode === 'plan' && tool === 'select'
  // Design mode keeps every geometric handle out of reach: a room only takes the pointer there, so a
  // click can pick the room whose floor colour the Inspect panel edits.
  const design = mode === 'design'
  const selectable = interactive || design
  const inArtboard = (s: Selection) => 'artboardId' in s && s.artboardId === artboard.id
  const selectedIds = selection.kind === 'room' && inArtboard(selection) ? selection.roomIds : []
  const selectedWall = selection.kind === 'wall' && inArtboard(selection) ? selection : null
  const selectedVertex = selection.kind === 'vertex' && inArtboard(selection) ? selection : null

  const toLocal = (cx: number, cy: number): Vec => {
    const w = toWorld(cx, cy)
    return { x: w.x - artboard.xCm, y: w.y - artboard.yCm }
  }
  const setSelection = (s: Selection) => useUi.getState().set({ activeArtboardId: artboard.id, selection: s })
  const liveRoom = (id: string): Room | undefined =>
    useDoc.getState().doc.artboards.find((a) => a.id === artboard.id)?.rooms.find((r) => r.id === id)
  // `origin` (gesture start rooms + openings) makes openings follow their walls: they are
  // recomputed from the start state on every move, so no drift builds up.
  const writeVertices = (updates: Map<string, Vec[]>, silent: boolean, origin?: { rooms: Room[]; openings: Opening[] }) => {
    const fn = (doc: { artboards: Artboard[] }) => {
      const ab = doc.artboards.find((a) => a.id === artboard.id)
      if (!ab) return
      for (const r of ab.rooms) { const v = updates.get(r.id); if (v) r.vertices = v }
      if (origin) ab.openings = syncOpeningsForRoomChange(origin.openings, origin.rooms, ab.rooms)
    }
    const st = useDoc.getState()
    if (silent) st.updateSilent(fn)
    else st.update(fn)
  }

  const startGesture = (e: ReactPointerEvent<Element>, onMove: Gesture['onMove'], onEnd?: Gesture['onEnd']) => {
    syncModifiersFromEvent(e)
    gesture.current?.unsub?.()
    const start = toLocal(e.clientX, e.clientY)
    const g: Gesture = { pointerId: e.pointerId, clientX: e.clientX, clientY: e.clientY, start, moved: false, last: start, onMove, onEnd }
    // Pressing or releasing Shift/Alt/Cmd mid-drag re-applies the preview without pointer movement.
    g.unsub = subscribeModifiers((m) => {
      if (gesture.current === g && g.moved) g.onMove(g.last, { x: g.last.x - g.start.x, y: g.last.y - g.start.y }, m)
    })
    gesture.current = g
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  const gestureMove = (e: ReactPointerEvent<Element>) => {
    const g = gesture.current
    if (!g || g.pointerId !== e.pointerId) return
    const mods = syncModifiersFromEvent(e)
    if (!g.moved) {
      if (Math.hypot(e.clientX - g.clientX, e.clientY - g.clientY) < DRAG_THRESHOLD_PX) return
      g.moved = true
      useDoc.getState().beginDrag()
    }
    const p = toLocal(e.clientX, e.clientY)
    g.last = p
    g.onMove(p, { x: p.x - g.start.x, y: p.y - g.start.y }, mods)
  }
  const gestureEnd = (e: ReactPointerEvent<Element>) => {
    const g = gesture.current
    if (!g || g.pointerId !== e.pointerId) return
    gesture.current = null
    g.unsub?.()
    e.currentTarget.releasePointerCapture?.(e.pointerId)
    if (g.moved) useDoc.getState().endDrag()
    setGuides([])
    g.onEnd?.(g.moved)
  }
  const gestureProps = { onPointerMove: gestureMove, onPointerUp: gestureEnd, onPointerCancel: gestureEnd }

  /** Design mode: a click picks the room so the Inspect panel can edit its floor colour. */
  const onRoomClick = (e: React.MouseEvent, room: Room) => {
    if (!design) return
    e.stopPropagation()
    useUi.getState().set({
      selection: { kind: 'room', artboardId: artboard.id, roomIds: [room.id] },
      activeArtboardId: artboard.id,
    })
  }

  const onRoomDown = (e: ReactPointerEvent<SVGPolygonElement>, room: Room) => {
    if (e.button !== 0) return
    // Always swallow the pointer. In Design mode this keeps the canvas background hit rect
    // (CanvasSelectLayer) from receiving the press and clearing the selection; `onRoomClick` then
    // picks this room for the Inspect panel.
    e.stopPropagation()
    if (!interactive) return
    let ids = selectedIds
    if (e.shiftKey) {
      ids = ids.includes(room.id) ? ids.filter((i) => i !== room.id) : [...ids, room.id]
      setSelection(ids.length ? { kind: 'room', artboardId: artboard.id, roomIds: ids } : { kind: 'none' })
      if (!ids.includes(room.id)) return
    } else if (!ids.includes(room.id)) {
      ids = [room.id]
      setSelection({ kind: 'room', artboardId: artboard.id, roomIds: ids })
    }
    const origs = new Map(artboard.rooms.filter((r) => ids.includes(r.id)).map((r) => [r.id, r] as const))
    const primary = origs.get(room.id)!
    const others = artboard.rooms.filter((r) => !origs.has(r.id))
    const origin = { rooms: artboard.rooms, openings: artboard.openings }
    // Alt: originals stay in place and a copy (stable ids for this drag) follows the pointer.
    const dupIds = new Map([...origs.keys()].map((id) => [id, newId()] as const))
    const cloneIds = new Map<string, string>()
    const cloneId = (id: string) => { let c = cloneIds.get(id); if (!c) { c = newId(); cloneIds.set(id, c) } return c }
    let dupActive = false
    const write = (moved: Map<string, Vec[]>, alt: boolean) => {
      const fn = (doc: { artboards: Artboard[] }) => {
        const ab = doc.artboards.find((a) => a.id === artboard.id)
        if (!ab) return
        const nextRooms = origin.rooms.map((r) => { const v = moved.get(r.id); return v ? { ...r, vertices: v } : r })
        const synced = syncOpeningsForRoomChange(origin.openings, origin.rooms, nextRooms)
        if (!alt) { ab.rooms = nextRooms; ab.openings = synced; return }
        const dups = [...moved].map(([id, v]) => ({ ...origs.get(id)!, id: dupIds.get(id)!, vertices: v }))
        const byId = new Map(origin.openings.map((o) => [o.id, o] as const))
        const clones = synced
          .filter((o) => { const b = byId.get(o.id); return !!b && (b.xCm !== o.xCm || b.yCm !== o.yCm || b.angleDeg !== o.angleDeg) })
          .map((o) => ({ ...o, id: cloneId(o.id) }))
        ab.rooms = [...origin.rooms, ...dups]
        ab.openings = [...origin.openings, ...clones]
      }
      useDoc.getState().updateSilent(fn)
    }
    startGesture(e, (_, d0, mods) => {
      const d = mods.shift ? constrainAxis(d0.x, d0.y) : d0
      const s = snapRoomDelta(primary, d.x, d.y, mods.alt ? artboard.rooms : others, px(10), { disableSnap: mods.cmd, precisionCm: artboard.precisionCm })
      setGuides(s.guides)
      dupActive = mods.alt
      write(new Map([...origs].map(([id, r]) => [id, moveRoom(r, s.dx, s.dy).vertices])), mods.alt)
    }, (moved) => {
      if (moved && dupActive) setSelection({ kind: 'room', artboardId: artboard.id, roomIds: [...dupIds.values()] })
    })
  }

  const onWallDown = (e: ReactPointerEvent<SVGLineElement>, room: Room, edgeIndex: number) => {
    if (e.button !== 0 || !interactive) return
    e.stopPropagation()
    setSelection({ kind: 'wall', artboardId: artboard.id, roomId: room.id, edgeIndex })
    const others = artboard.rooms.filter((r) => r.id !== room.id)
    const a = room.vertices[edgeIndex]
    const b = room.vertices[(edgeIndex + 1) % room.vertices.length]
    const origin = { rooms: artboard.rooms, openings: artboard.openings }
    startGesture(e, (_, d, mods) => {
      let delta: Vec
      if (mods.shift) {
        const c = constrainWallPerpendicular(a, b, d.x, d.y)
        delta = mods.cmd ? c : { x: roundToPrecision(c.x, artboard.precisionCm), y: roundToPrecision(c.y, artboard.precisionCm) }
        setGuides([])
      } else {
        const snap = snapPoint(add(a, d), others, { precisionCm: artboard.precisionCm, disableSnap: mods.cmd, thresholdCm: px(10) })
        setGuides(snap.guides)
        delta = { x: snap.point.x - a.x, y: snap.point.y - a.y }
      }
      writeVertices(new Map([[room.id, moveEdge(room, edgeIndex, delta).vertices]]), true, origin)
    })
  }

  const onWallDouble = (e: React.MouseEvent, roomId: string, edgeIndex: number) => {
    if (!interactive) return
    e.stopPropagation()
    const room = liveRoom(roomId)
    if (!room) return
    const a = room.vertices[edgeIndex], b = room.vertices[(edgeIndex + 1) % room.vertices.length]
    const p = projectOnSegment(toLocal(e.clientX, e.clientY), a, b).point
    writeVertices(new Map([[roomId, insertVertexOnEdge(room, edgeIndex, p).vertices]]), false)
  }

  const onVertexDown = (e: ReactPointerEvent<SVGCircleElement>, room: Room, idx: number) => {
    if (e.button !== 0 || !interactive) return
    e.stopPropagation()
    setSelection({ kind: 'vertex', artboardId: artboard.id, roomId: room.id, vertexIndex: idx })
    if (e.altKey) {
      const live = liveRoom(room.id)
      const next = live && deleteVertex(live, idx)
      if (next) writeVertices(new Map([[room.id, next.vertices]]), false)
      // The index no longer means the same point after the delete: keep only the room selected,
      // so a later Delete key cannot remove a vertex the user did not pick.
      if (next) setSelection({ kind: 'room', artboardId: artboard.id, roomIds: [room.id] })
      return
    }
    const others = artboard.rooms.filter((r) => r.id !== room.id)
    const n = room.vertices.length
    const anchor = room.vertices[(idx + n - 1) % n]
    const origin = { rooms: artboard.rooms, openings: artboard.openings }
    startGesture(e, (p, _d, mods) => {
      if (mods.shift) {
        setGuides([])
        writeVertices(new Map([[room.id, scaleRoomFromVertex(room, idx, p, mods.cmd ? 0 : artboard.precisionCm).vertices]]), true, origin)
        return
      }
      const snap = snapPoint(p, others, { anchor, precisionCm: artboard.precisionCm, disableSnap: mods.cmd, thresholdCm: px(10) })
      setGuides(snap.guides)
      writeVertices(new Map([[room.id, moveVertex(room, idx, snap.point).vertices]]), true, origin)
    })
  }

  const handleRooms = artboard.rooms.filter((r) => selectedIds.includes(r.id) || r.id === selectedWall?.roomId || r.id === selectedVertex?.roomId)

  return (
    <g data-testid={`rooms-layer-${artboard.id}`}>
      {artboard.rooms.map((room) => {
        const selected = selectedIds.includes(room.id) || selectedWall?.roomId === room.id || selectedVertex?.roomId === room.id
        const pts = room.vertices.map((v) => `${v.x},${v.y}`).join(' ')
        const label = room.vertices.length >= 3 ? labelPoint([room.vertices]) : null
        return (
          <g key={room.id} data-room-id={room.id}>
            <polygon
              points={pts}
              fill={room.fill ?? 'rgba(255,255,255,0.04)'}
              fillOpacity={room.fill ? 0.28 : undefined}
              stroke={selected ? ORANGE : STROKE}
              strokeWidth={px(design && selected ? 1.5 : 1)}
              strokeLinejoin="round"
              pointerEvents={selectable ? 'all' : 'none'}
              style={{ cursor: interactive ? 'move' : design ? 'pointer' : undefined }}
              onPointerDown={(e) => onRoomDown(e, room)}
              onClick={(e) => onRoomClick(e, room)}
              {...gestureProps}
            />
            {label && (
              <text
                x={label.x} y={label.y} textAnchor="middle" pointerEvents="none"
                fontSize={px(13)} fill="rgba(241,245,249,0.9)"
              >
                <tspan x={label.x} dy={px(-2)} fontWeight={600}>{room.name}</tspan>
                <tspan x={label.x} dy={px(15)} fontSize={px(11)} fill="rgba(203,213,225,0.7)">
                  {fmtCm(Math.round((area(room.vertices) / 10000) * 100) / 100)} m²
                </tspan>
              </text>
            )}
          </g>
        )
      })}

      {artboard.rooms.map((room) => {
        const s = signedArea(room.vertices) >= 0 ? 1 : -1
        return roomWalls(room).map((w) => {
          const isSel = selectedWall?.roomId === room.id && selectedWall.edgeIndex === w.index
          const dx = (w.b.x - w.a.x) / (w.lengthCm || 1), dy = (w.b.y - w.a.y) / (w.lengthCm || 1)
          const off = px(10)
          const lx = w.mid.x - dy * s * off, ly = w.mid.y + dx * s * off
          const flip = w.angleDeg > 90 || w.angleDeg <= -90
          const rot = flip ? w.angleDeg + 180 : w.angleDeg
          const showLabel = w.lengthCm * zoom >= 36
          return (
            <g key={`${room.id}-${w.index}`} data-wall={`${room.id}:${w.index}`}>
              {isSel && <line x1={w.a.x} y1={w.a.y} x2={w.b.x} y2={w.b.y} stroke={ORANGE} strokeWidth={px(2)} strokeLinecap="round" pointerEvents="none" />}
              {interactive && (
                <line
                  x1={w.a.x} y1={w.a.y} x2={w.b.x} y2={w.b.y}
                  stroke="transparent" strokeWidth={px(10)} pointerEvents="stroke"
                  style={{ cursor: wallResizeCursor(w.a, w.b) }}
                  onPointerDown={(e) => onWallDown(e, room, w.index)}
                  onDoubleClick={(e) => onWallDouble(e, room.id, w.index)}
                  {...gestureProps}
                />
              )}
              {showLabel && (
                <g
                  transform={`translate(${lx} ${ly}) rotate(${rot})`}
                  pointerEvents={interactive ? 'all' : 'none'}
                  style={{ cursor: interactive ? 'text' : undefined }}
                  onPointerDown={(e) => { if (interactive && e.button === 0) e.stopPropagation() }}
                  onClick={(e) => {
                    if (!interactive) return
                    e.stopPropagation()
                    setSelection({ kind: 'wall', artboardId: artboard.id, roomId: room.id, edgeIndex: w.index })
                    onEditWall?.({ artboardId: artboard.id, roomId: room.id, edgeIndex: w.index, clientX: e.clientX, clientY: e.clientY, currentCm: w.lengthCm })
                  }}
                >
                  <text
                    textAnchor="middle" dominantBaseline="central" fontSize={px(11)}
                    fill={isSel ? ORANGE : 'rgba(226,232,240,0.9)'}
                    stroke="#12161b" strokeWidth={px(3)} paintOrder="stroke" strokeLinejoin="round"
                  >
                    {formatLengthCm(w.lengthCm, artboard.precisionCm)}
                  </text>
                </g>
              )}
            </g>
          )
        })
      })}

      {interactive && handleRooms.map((room) =>
        room.vertices.map((v, i) => {
          const isSel = selectedVertex?.roomId === room.id && selectedVertex.vertexIndex === i
          return (
          <circle
            key={`${room.id}-v${i}`}
            cx={v.x} cy={v.y} r={px(5)}
            fill={isSel ? ORANGE : '#12161b'} stroke={ORANGE} strokeWidth={px(1.5)}
            style={{ cursor: 'grab' }}
            onPointerDown={(e) => onVertexDown(e, room, i)}
            {...gestureProps}
          />
          )
        }),
      )}

      <g pointerEvents="none" data-testid="snap-guides">
        {guides.map((g, i) =>
          g.kind === 'line' && g.b ? (
            <line key={i} x1={g.a.x} y1={g.a.y} x2={g.b.x} y2={g.b.y} stroke={ORANGE} strokeWidth={px(1)} strokeDasharray={`${px(4)} ${px(3)}`} />
          ) : (
            <circle key={i} cx={g.a.x} cy={g.a.y} r={px(4)} fill="none" stroke={ORANGE} strokeWidth={px(1.5)} />
          ),
        )}
      </g>
    </g>
  )
}
