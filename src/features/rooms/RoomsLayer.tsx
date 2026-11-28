// Rooms of one artboard on the canvas (artboard-local cm). Render inside <ArtboardContent>.
// Plan mode + select tool: select, move, edit walls and vertices. Design mode: geometry is locked,
// a room click only selects it (the Inspect panel then edits its floor colour).
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { useViewport } from '../../canvas/Viewport'
import { area, fmtCm, labelPoint, projectOnSegment, signedArea } from '../../model/geometry'
import type { Vec } from '../../model/geometry'
import { newId } from '../../model/schema'
import { useDoc } from '../../model/store'
import type { Artboard, Opening, Room, Selection } from '../../model/types'
import { syncOpeningsForRoomChange } from '../openings/sync'
import { furnitureIdsInRooms, translateFurnitureByIds } from '../furniture/roomSync'
import { subscribeModifiers, syncModifiersFromEvent } from '../../shell/modifiers'
import type { Modifiers } from '../../shell/modifiers'
import { useUi } from '../../shell/uiStore'
import {
  constrainAxis, constrainWallPerpendicular, deleteVertex, insertVertexOnEdge, moveEdge, moveRoom, moveVertex, moveVertexOrtho,
  roomWalls, scaleRoomFromVertex, wallResizeCursor,
} from './ops'
import {
  DEFAULT_PATTERN_FILL, DESIGN_FLOOR_BASE, DESIGN_FLOOR_TINT_OPACITY, PATTERN_DEFS, PLAN_FLOOR_OPACITY,
  isPatterned, patternId, patternTransformOf,
} from './floorPatterns'
import { snapPoint, snapRoomDelta, snapWallDelta } from './snap'
import type { SnapGuide } from './snap'
import { computeTextLod } from './textLod'
import type { TextLod } from './textLod'
import {
  FENCE_COLOR, FENCE_THICKNESS_CM, WALL_COLOR, edgeOutwardNormal, isFenceWall,
  roomDoorThresholds, wallMaskModel, wallStrokeMaskModel, wallThicknessOf,
} from './walls'
import { CANVAS_BG, CANVAS_HALO, CANVAS_SELECT } from '../../shell/canvasTokens'
import { startDesignMarquee } from './CanvasSelectLayer'

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

const ORANGE = CANVAS_SELECT
const STROKE = 'rgba(226,232,240,0.85)'
const DRAG_THRESHOLD_PX = 3
const NO_IDS: string[] = []

/** Inclusive cyclic range of edge indices holding one contiguous run of solid ('wall') edges. */
type EdgeRun = { from: number; to: number }

/** True when at least one wall of `room` is a fence (low railing) instead of a solid wall. */
function roomHasFence(room: Room): boolean {
  return room.vertices.some((_, i) => isFenceWall(room, i))
}

/**
 * Contiguous runs of solid ('wall') edges of `room`: a fence edge breaks a run, so no run crosses
 * one. Empty when every edge is a fence (the room then has no thick wall body at all).
 */
function solidWallRuns(room: Room): EdgeRun[] {
  const n = room.vertices.length
  const fence = room.vertices.map((_, i) => isFenceWall(room, i))
  const firstFence = fence.indexOf(true)
  if (firstFence < 0) return []
  const runs: EdgeRun[] = []
  let run: EdgeRun | null = null
  // Start right after a fence edge, so a run never wraps around the end of the vertex list.
  for (let k = 0; k < n; k++) {
    const i = (firstFence + 1 + k) % n
    if (fence[i]) { run = null; continue }
    if (run) run.to = i
    else { run = { from: i, to: i }; runs.push(run) }
  }
  return runs
}

/** Points attribute of the polyline of one edge run: every vertex it walks, end point included. */
function runPoints(room: Room, run: EdgeRun): string {
  const n = room.vertices.length
  const points: string[] = []
  for (let i = run.from; i <= run.to + 1; i++) {
    const v = room.vertices[i % n]
    points.push(`${v.x},${v.y}`)
  }
  return points.join(' ')
}

/** Posts of a fence: start, end and evenly spaced steps of about 60 cm (at least one interval). */
const fencePostCount = (lengthCm: number) => Math.max(1, Math.round(lengthCm / 60))

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

function RoomsLayerImpl({ artboard, onEditWall }: RoomsLayerProps) {
  const { px, toWorld, zoom } = useViewport()
  const mode = useUi((s) => s.mode)
  const tool = useUi((s) => s.tool)
  const selection = useUi((s) => s.selection)
  const [guides, setGuides] = useState<SnapGuide[]>([])
  const gesture = useRef<Gesture | null>(null)
  const suppressRoomClick = useRef(false)
  const designMarqueeCancel = useRef<(() => void) | null>(null)
  useEffect(() => () => {
    gesture.current?.unsub?.()
    designMarqueeCancel.current?.()
    designMarqueeCancel.current = null
  }, [])

  const thickness = wallThicknessOf(artboard)
  // Wall geometry depends on rooms, openings and thickness only: pan/zoom never recomputes it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const maskModel = useMemo(() => wallMaskModel(artboard, thickness), [artboard.rooms, artboard.openings, thickness])
  const maskId = `wall-mask-${artboard.id}`
  // A second mask hides the room border strokes and the wall paint lines inside every opening that
  // crosses a thick wall, so both room borders vanish there instead of crossing the gap.
  const strokeBandPx = Math.max(px(3), 1.5)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const strokeMaskModel = useMemo(() => wallStrokeMaskModel(artboard, thickness, strokeBandPx), [artboard.rooms, artboard.openings, thickness, strokeBandPx])
  const strokeMaskId = `wall-stroke-mask-${artboard.id}`
  // Floor quads that fill each door / open passage across a thick wall, with the floor of their room.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const doorThresholds = useMemo(() => roomDoorThresholds(artboard.rooms, artboard.openings, thickness), [artboard.rooms, artboard.openings, thickness])

  // Per-room polygon data: only changes when the rooms change, not on zoom.
  const roomGeo = useMemo(() => artboard.rooms.map((room) => ({
    room,
    pts: room.vertices.map((v) => `${v.x},${v.y}`).join(' '),
    label: room.vertices.length >= 3 ? labelPoint([room.vertices]) : null,
    areaText: fmtCm(Math.round((area(room.vertices) / 10000) * 100) / 100),
    walls: roomWalls(room),
    s: signedArea(room.vertices) >= 0 ? 1 : -1,
  })), [artboard.rooms])

  const interactive = mode === 'plan' && tool === 'select'
  // Design mode keeps every geometric handle out of reach: a room only takes the pointer there, so a
  // click can pick the room whose floor colour the Inspect panel edits.
  const design = mode === 'design'
  const selectable = interactive || design
  useEffect(() => {
    if (!design || tool !== 'select') {
      designMarqueeCancel.current?.()
      designMarqueeCancel.current = null
    }
  }, [design, tool])
  const inArtboard = (s: Selection) => 'artboardId' in s && s.artboardId === artboard.id
  const selectedIds = selection.kind === 'room' && inArtboard(selection) ? selection.roomIds : NO_IDS
  const selectedWall = selection.kind === 'wall' && inArtboard(selection) ? selection : null
  const selectedVertex = selection.kind === 'vertex' && inArtboard(selection) ? selection : null

  // Text level of detail: depends on zoom and selection, never on pan.
  // Design mode draws no room or wall label at all, so the computation is skipped there.
  const textLod = useMemo<TextLod>(() => (design ? { rooms: new Map(), walls: new Map() } : computeTextLod({
    rooms: roomGeo, zoom, wallThicknessCm: thickness, precisionCm: artboard.precisionCm,
    selectedRoomIds: selectedIds, selectedWall, selectedVertex,
  })), [design, roomGeo, zoom, thickness, selectedIds, selectedWall, selectedVertex, artboard.precisionCm])

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
    if (suppressRoomClick.current) {
      suppressRoomClick.current = false
      return
    }
    // Shift-click adds or removes the room, so one floor card can paint several rooms at once.
    const sel = useUi.getState().selection
    let roomIds = [room.id]
    if (e.shiftKey && sel.kind === 'room' && sel.artboardId === artboard.id) {
      roomIds = sel.roomIds.includes(room.id) ? sel.roomIds.filter((id) => id !== room.id) : [...sel.roomIds, room.id]
    }
    if (roomIds.length === 0) {
      useUi.getState().set({ selection: { kind: 'none' } })
      return
    }
    useUi.getState().set({
      selection: { kind: 'room', artboardId: artboard.id, roomIds },
      activeArtboardId: artboard.id,
    })
  }

  const onRoomDown = (e: ReactPointerEvent<SVGPolygonElement>, room: Room) => {
    if (e.button !== 0) return
    // Always swallow the pointer. In Design mode this keeps the canvas background hit rect
    // (CanvasSelectLayer) from receiving the press and clearing the selection; dragging starts a
    // furniture marquee on this artboard, while a plain click still selects the room.
    e.stopPropagation()
    suppressRoomClick.current = false
    if (design) {
      if (tool !== 'select') return
      designMarqueeCancel.current?.()
      designMarqueeCancel.current = startDesignMarquee(e, {
        toWorld,
        artboardId: artboard.id,
        onDone: (marqueeRan) => {
          designMarqueeCancel.current = null
          if (marqueeRan) suppressRoomClick.current = true
        },
      })
      return
    }
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
    // Furniture of the moved rooms follows the drag. The items and their positions are captured
    // once here, so every move recomputes them from the start state (no drift, no double move).
    const furnitureOrigin = artboard.furniture
    const movedFurnitureIds = furnitureIdsInRooms(artboard, ids)
    const movedFurniture = (dx: number, dy: number) =>
      translateFurnitureByIds(furnitureOrigin, movedFurnitureIds, dx, dy)
    // `dx`/`dy` are the deltas applied to the rooms: the furniture gets exactly the same ones.
    const write = (moved: Map<string, Vec[]>, alt: boolean, dx = 0, dy = 0) => {
      const fn = (doc: { artboards: Artboard[] }) => {
        const ab = doc.artboards.find((a) => a.id === artboard.id)
        if (!ab) return
        const nextRooms = origin.rooms.map((r) => { const v = moved.get(r.id); return v ? { ...r, vertices: v } : r })
        const synced = syncOpeningsForRoomChange(origin.openings, origin.rooms, nextRooms)
        if (!alt) {
          ab.rooms = nextRooms
          ab.openings = synced
          // Only the translation of whole rooms moves furniture: wall, vertex and delete paths below
          // do not touch it.
          if (movedFurnitureIds.size > 0) ab.furniture = movedFurniture(dx, dy)
          return
        }
        const dups = [...moved].map(([id, v]) => ({ ...origs.get(id)!, id: dupIds.get(id)!, vertices: v }))
        const byId = new Map(origin.openings.map((o) => [o.id, o] as const))
        // A clone follows a duplicated room: its `roomId` must be the new id of that room.
        const clones = synced
          .filter((o) => { const b = byId.get(o.id); return !!b && (b.xCm !== o.xCm || b.yCm !== o.yCm || b.angleDeg !== o.angleDeg) })
          .map((o) => {
            const roomId = o.roomId ? dupIds.get(o.roomId) ?? o.roomId : o.roomId
            return { ...o, id: cloneId(o.id), roomId }
          })
        ab.rooms = [...origin.rooms, ...dups]
        ab.openings = [...origin.openings, ...clones]
        // The originals did not move, so their furniture stays where it was: a mode switch mid-drag
        // (back from Alt) puts the items back where they started too.
        if (movedFurnitureIds.size > 0) ab.furniture = furnitureOrigin
      }
      useDoc.getState().updateSilent(fn)
    }
    startGesture(e, (_, d0, mods) => {
      const d = mods.shift ? constrainAxis(d0.x, d0.y) : d0
      const s = snapRoomDelta(primary, d.x, d.y, mods.alt ? artboard.rooms : others, px(10), { disableSnap: mods.cmd, precisionCm: artboard.precisionCm, wallThicknessCm: thickness })
      setGuides(s.guides)
      dupActive = mods.alt
      write(new Map([...origs].map(([id, r]) => [id, moveRoom(r, s.dx, s.dy).vertices])), mods.alt, s.dx, s.dy)
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
      // The wall is a line: it snaps like a moved room, onto the walls that face it (snapWallDelta).
      const snapOpts = { precisionCm: artboard.precisionCm, disableSnap: mods.cmd, wallThicknessCm: thickness }
      let delta: Vec
      if (useUi.getState().ortho && !mods.shift) {
        // 90° lock: the wall moves only along its normal, so adjacent 90° walls never skew.
        const c = constrainWallPerpendicular(a, b, d.x, d.y)
        const snap = snapWallDelta(a, b, c, others, px(10), { ...snapOpts, perpendicularOnly: true })
        setGuides(snap.guides)
        delta = constrainWallPerpendicular(a, b, snap.delta.x, snap.delta.y)
      } else if (mods.shift) {
        // Shift: still only along the normal, but the wall line now snaps onto the parallel walls.
        const c = constrainWallPerpendicular(a, b, d.x, d.y)
        const snap = snapWallDelta(a, b, c, others, px(10), { ...snapOpts, perpendicularOnly: true })
        setGuides(snap.guides)
        delta = constrainWallPerpendicular(a, b, snap.delta.x, snap.delta.y)
      } else {
        const snap = snapWallDelta(a, b, d, others, px(10), snapOpts)
        setGuides(snap.guides)
        delta = snap.delta
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
    // Both connected vertices of the edited room: each axis snaps to whichever one is closer,
    // so the moved point always keeps straight lines with its neighbours.
    const prev = room.vertices[(idx + n - 1) % n]
    const next = room.vertices[(idx + 1) % n]
    const anchors = prev === next ? [prev] : [prev, next]
    const origin = { rooms: artboard.rooms, openings: artboard.openings }
    startGesture(e, (p, _d, mods) => {
      if (mods.shift) {
        setGuides([])
        writeVertices(new Map([[room.id, scaleRoomFromVertex(room, idx, p, mods.cmd ? 0 : artboard.precisionCm).vertices]]), true, origin)
        return
      }
      const snap = snapPoint(p, others, { anchors, precisionCm: artboard.precisionCm, disableSnap: mods.cmd, thresholdCm: px(10), wallThicknessCm: thickness })
      setGuides(snap.guides)
      const moved = useUi.getState().ortho ? moveVertexOrtho(room, idx, snap.point) : moveVertex(room, idx, snap.point)
      writeVertices(new Map([[room.id, moved.vertices]]), true, origin)
    })
  }

  const handleRooms = artboard.rooms.filter((r) => selectedIds.includes(r.id) || r.id === selectedWall?.roomId || r.id === selectedVertex?.roomId)

  /** Black butt-capped cutout bands of a wall (or wall stroke) mask. */
  const cutoutLines = (cutouts: { x1: number; y1: number; x2: number; y2: number; width: number }[]) =>
    cutouts.map((c, i) => (
      <line key={`c${i}`} x1={c.x1} y1={c.y1} x2={c.x2} y2={c.y2} stroke="#000" strokeWidth={c.width} strokeLinecap="butt" />
    ))

  /** Painted wall lines of a room (one per edge that has a wall colour). */
  const paintLines = (room: Room) =>
    room.vertices.length < 3 ? null : room.vertices.map((a, i) => {
      const color = room.wallColors?.[String(i)]
      if (!color) return null
      const b = room.vertices[(i + 1) % room.vertices.length]
      return (
        <line
          key={`paint-${i}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
          stroke={color} strokeWidth={px(3)} strokeLinecap="butt" pointerEvents="none"
          data-wall-paint={`${room.id}:${i}`}
        />
      )
    })

  /**
   * Architectural railing of one fence edge: a dashed inner line on the room border, a solid outer
   * line FENCE_THICKNESS_CM away from it, and perpendicular posts (start, end, every ~60 cm).
   */
  const fenceRail = (room: Room, edgeIndex: number, a: Vec, b: Vec, lengthCm: number) => {
    const normal = edgeOutwardNormal(room, edgeIndex)
    const out = normal ? { x: normal.x * FENCE_THICKNESS_CM, y: normal.y * FENCE_THICKNESS_CM } : null
    const posts = fencePostCount(lengthCm)
    return (
      <g key={`fence-${edgeIndex}`} data-wall-kind="fence" data-fence={`${room.id}:${edgeIndex}`}>
        <line
          x1={a.x} y1={a.y} x2={b.x} y2={b.y}
          stroke={FENCE_COLOR} strokeWidth={px(1.5)} strokeDasharray={`${px(6)} ${px(4)}`}
        />
        {out && (
          <line
            x1={a.x + out.x} y1={a.y + out.y} x2={b.x + out.x} y2={b.y + out.y}
            stroke={FENCE_COLOR} strokeWidth={px(1.25)}
          />
        )}
        {out && Array.from({ length: posts + 1 }, (_, k) => {
          const t = k / posts
          const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
          return (
            <line
              key={`post-${k}`} x1={p.x} y1={p.y} x2={p.x + out.x} y2={p.y + out.y}
              stroke={FENCE_COLOR} strokeWidth={px(1.5)}
            />
          )
        })}
      </g>
    )
  }

  /**
   * Border stroke and wall paint of one room. A room without fence keeps the closed border polygon;
   * a room with fences strokes one polyline per solid run and draws a railing on every fence edge.
   */
  const roomStrokes = (room: Room, pts: string, sel: boolean, key: string) => {
    const stroke = sel ? ORANGE : STROKE
    const strokeWidth = px(design && sel ? 1.5 : 1)
    return (
      <g key={key} data-room-stroke={room.id}>
        {roomHasFence(room) ? solidWallRuns(room).map((run) => (
          <polyline
            key={`border-${run.from}`} points={runPoints(room, run)} fill="none"
            stroke={stroke} strokeWidth={strokeWidth} strokeLinejoin="round"
          />
        )) : (
          <polygon
            points={pts} fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeLinejoin="round" pointerEvents="none"
          />
        )}
        {paintLines(room)}
        {room.vertices.map((a, i) => {
          if (!isFenceWall(room, i)) return null
          const b = room.vertices[(i + 1) % room.vertices.length]
          return fenceRail(room, i, a, b, Math.hypot(b.x - a.x, b.y - a.y))
        })}
      </g>
    )
  }

  return (
    <g data-testid={`rooms-layer-${artboard.id}`}>
      {maskModel && (
        // Thick outward walls, behind every room fill. Two masks: one keeps the wall body out of the
        // room interiors (translucent fills, reference images below stay untouched), the other hides
        // the room border strokes and the wall paint lines inside each opening.
        <g pointerEvents="none" data-testid={`wall-layer-${artboard.id}`}>
          <defs>
            <mask
              id={maskId} maskUnits="userSpaceOnUse"
              x={maskModel.x} y={maskModel.y} width={maskModel.width} height={maskModel.height}
            >
              <rect x={maskModel.x} y={maskModel.y} width={maskModel.width} height={maskModel.height} fill="#fff" />
              {maskModel.roomPoints.map((p, i) => <polygon key={`r${i}`} points={p} fill="#000" />)}
              {cutoutLines(maskModel.cutouts)}
            </mask>
          </defs>
          <g mask={`url(#${maskId})`}>
            {roomGeo.filter((g) => g.room.vertices.length >= 3).map(({ room, pts }) => {
              // No fence: the plain closed wall body, unchanged.
              if (!roomHasFence(room)) {
                return (
                  <polygon
                    key={room.id}
                    points={pts}
                    fill="none" stroke={WALL_COLOR} strokeWidth={thickness * 2}
                    strokeLinejoin="miter" strokeMiterlimit={4}
                  />
                )
              }
              // A fence is no thick wall: only the solid runs get a wall body, as open polylines.
              return solidWallRuns(room).map((run) => (
                <polyline
                  key={`${room.id}-run${run.from}`}
                  points={runPoints(room, run)}
                  fill="none" stroke={WALL_COLOR} strokeWidth={thickness * 2}
                  strokeLinejoin="miter" strokeMiterlimit={4} strokeLinecap="butt"
                />
              ))
            })}
          </g>
        </g>
      )}
      {strokeMaskModel && (
        <defs>
          <mask
            id={strokeMaskId} maskUnits="userSpaceOnUse"
            x={strokeMaskModel.x} y={strokeMaskModel.y} width={strokeMaskModel.width} height={strokeMaskModel.height}
          >
            <rect
              x={strokeMaskModel.x} y={strokeMaskModel.y}
              width={strokeMaskModel.width} height={strokeMaskModel.height} fill="#fff"
            />
            {cutoutLines(strokeMaskModel.cutouts)}
          </mask>
        </defs>
      )}
      {roomGeo.map(({ room, pts, label, areaText }) => {
        const selected = selectedIds.includes(room.id) || selectedWall?.roomId === room.id || selectedVertex?.roomId === room.id
        const pattern = isPatterned(room.floorPattern) ? room.floorPattern : null
        const pid = patternId(room.id)
        const def = pattern ? PATTERN_DEFS[pattern] : null
        const floorFill = pattern ? `url(#${pid})` : (room.fill ?? 'rgba(255,255,255,0.04)')
        const floorOpacity = !pattern && room.fill ? (design ? DESIGN_FLOOR_TINT_OPACITY : PLAN_FLOOR_OPACITY) : undefined
        // Solid colour floors in Design mode sit on an opaque base, so they are opaque but muted.
        const opaqueBase = design && !pattern && !!room.fill
        const quads = doorThresholds.get(room.id) ?? []
        const quadPts = (q: Vec[]) => q.map((v) => `${v.x},${v.y}`).join(' ')
        return (
          <g key={room.id} data-room-id={room.id} data-entity="room" data-id={room.id} aria-label={`${room.name} (${areaText} m²)`}>
            {pattern && def && (
              <defs>
                <pattern id={pid} width={def.w} height={def.h} patternUnits="userSpaceOnUse" patternTransform={patternTransformOf(room.floorPatternAngleDeg)}>
                  {design ? (
                    <>
                      <rect width={def.w} height={def.h} fill={DESIGN_FLOOR_BASE} />
                      <rect width={def.w} height={def.h} fill={room.fill ?? DEFAULT_PATTERN_FILL} fillOpacity={DESIGN_FLOOR_TINT_OPACITY} />
                    </>
                  ) : (
                    <rect width={def.w} height={def.h} fill={room.fill ?? DEFAULT_PATTERN_FILL} fillOpacity={PLAN_FLOOR_OPACITY} />
                  )}
                  <g dangerouslySetInnerHTML={{ __html: def.inner(px(1)) }} />
                </pattern>
              </defs>
            )}
            {opaqueBase && <polygon points={pts} fill={DESIGN_FLOOR_BASE} pointerEvents="none" />}
            <polygon
              points={pts}
              fill={floorFill}
              fillOpacity={floorOpacity}
              // Thick walls: the border stroke moves to a masked outline below, so it cannot cross
              // an opening. A room with fences also moves it, so a fence edge can show a railing.
              // Thin walls without fences keep the old single polygon.
              stroke={strokeMaskModel || roomHasFence(room) ? 'none' : selected ? ORANGE : STROKE}
              strokeWidth={strokeMaskModel || roomHasFence(room) ? undefined : px(design && selected ? 1.5 : 1)}
              strokeLinejoin="round"
              pointerEvents={selectable ? 'all' : 'none'}
              style={{ cursor: interactive ? 'move' : design ? 'pointer' : undefined }}
              onPointerDown={(e) => onRoomDown(e, room)}
              onClick={(e) => onRoomClick(e, room)}
              {...gestureProps}
            />
            {quads.map((q, i) => (
              <g key={`thr-${i}`}>
                {opaqueBase && <polygon points={quadPts(q)} fill={DESIGN_FLOOR_BASE} pointerEvents="none" />}
                <polygon
                  data-door-threshold={room.id} points={quadPts(q)}
                  fill={floorFill} fillOpacity={floorOpacity} stroke="none" pointerEvents="none"
                />
              </g>
            ))}
            {(() => {
              // Design mode shows no room name and no area on the canvas (the aria-label stays).
              if (design) return null
              const lod = textLod.rooms.get(room.id)
              if (!label || !lod || lod.tier === 'hidden') return null
              const { p, vertical } = lod
              return (
                <text
                  x={p.x} y={p.y} textAnchor="middle" pointerEvents="none"
                  transform={vertical ? `rotate(-90 ${p.x} ${p.y})` : undefined}
                  dominantBaseline={lod.showArea ? undefined : 'central'}
                  fontSize={px(lod.nameFontPx)} fill="rgba(241,245,249,0.9)"
                  stroke={CANVAS_HALO} strokeWidth={px(2.5)} paintOrder="stroke" strokeLinejoin="round"
                  data-lod={lod.tier}
                >
                  <tspan x={p.x} dy={lod.showArea ? px(-2) : undefined} fontWeight={600}>{room.name}</tspan>
                  {lod.showArea && (
                    <tspan x={p.x} dy={px(15)} fontSize={px(lod.areaFontPx)} fill="rgba(203,213,225,0.7)">
                      {areaText} m²
                    </tspan>
                  )}
                </text>
              )
            })()}
          </g>
        )
      })}

      {strokeMaskModel && (
        // Border strokes and wall paint of ALL rooms in ONE masked group (one offscreen mask pass,
        // not one per room), hidden inside every opening of a thick wall. Selected rooms draw last.
        <g mask={`url(#${strokeMaskId})`} pointerEvents="none" data-testid={`room-strokes-${artboard.id}`}>
          {[false, true].map((pass) => roomGeo.map(({ room, pts }) => {
            const sel = selectedIds.includes(room.id) || selectedWall?.roomId === room.id || selectedVertex?.roomId === room.id
            if (sel !== pass) return null
            return roomStrokes(room, pts, sel, `${room.id}-${pass}`)
          }))}
        </g>
      )}

      {!strokeMaskModel && roomGeo.some((g) => roomHasFence(g.room)) && (
        // Thin walls: no stroke mask, so the fence rooms alone draw their border and railings in a
        // group of their own (an unmasked one: nothing has to be cut away here).
        <g pointerEvents="none" data-testid={`room-strokes-${artboard.id}`}>
          {roomGeo.map(({ room, pts }) => {
            if (!roomHasFence(room)) return null
            const sel = selectedIds.includes(room.id) || selectedWall?.roomId === room.id || selectedVertex?.roomId === room.id
            return roomStrokes(room, pts, sel, room.id)
          })}
        </g>
      )}

      {roomGeo.map(({ room, walls }) => {
        return walls.map((w) => {
          const isSel = selectedWall?.roomId === room.id && selectedWall.edgeIndex === w.index
          // Design mode shows no wall length on the canvas (the aria-label stays).
          const wl = design ? undefined : textLod.walls.get(`${room.id}:${w.index}`)
          return (
            <g key={`${room.id}-${w.index}`} data-wall={`${room.id}:${w.index}`} data-entity="wall" data-id={room.id} data-edge={w.index} aria-label={`Wall ${w.index + 1} of ${room.name}, ${Math.round(w.lengthCm)} cm`}>
              {/* Thick walls paint the wall lines inside the room group above, behind the stroke mask. */}
              {!strokeMaskModel && paintLines(room)?.[w.index]}
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
              {wl && (
                <g
                  transform={`translate(${wl.x} ${wl.y}) rotate(${wl.rotDeg})`}
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
                    stroke={CANVAS_HALO} strokeWidth={px(3)} paintOrder="stroke" strokeLinejoin="round"
                  >
                    {wl.text}
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
            fill={isSel ? ORANGE : CANVAS_BG} stroke={ORANGE} strokeWidth={px(1.5)}
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

export const RoomsLayer = memo(RoomsLayerImpl)
