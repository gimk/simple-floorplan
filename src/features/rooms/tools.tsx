import { useEffect, useMemo, useState, type PointerEvent as RPE } from 'react'
import { CaptureRect, useViewport } from '../../canvas/Viewport'
import { dist, fmtCm, norm, sub } from '../../model/geometry'
import { selectedItems, selectItems } from '../../model/selection'
import { useDoc, useUi } from '../../model/store'
import type { Vec } from '../../model/types'
import { isV2Doc } from '../../model/v2/targets'
import { newEdgeCrosses, selfIntersects } from './crossing'
import { boxOf, itemsInBox } from './boxSelect'
import { useGuides } from './guides'
import { deleteSelection, locked, onHoleVertexDown, onVertexDown, otherEdges, otherVertices } from './interaction'
import { NoticeLayer, notify } from './notice'
import { cutDoc, makeRoom, rectPoints, sliceDoc, validOutline } from './ops'
import { snapPoint, type SnapGuide } from './snap'

const inInput = (t: EventTarget | null) => t instanceof Element && !!t.closest('input, textarea, select, [contenteditable]')

// ---------- shared bits ----------

function GuidesLayer() {
  const guides = useGuides((s) => s.guides)
  const { px } = useViewport()
  useEffect(() => () => useGuides.getState().set([]), [])
  const line = (g: SnapGuide, i: number) => {
    if (g.kind === 'vertex') return <circle key={i} cx={g.at.x} cy={g.at.y} r={px(8)} fill="none" strokeWidth={px(2)} className="stroke-fuchsia-500" />
    if (g.kind === 'edge') {
      // The snapped wall, highlighted.
      return <line key={i} x1={g.from.x} y1={g.from.y} x2={g.to.x} y2={g.to.y} strokeWidth={px(4)} strokeLinecap="round" className="stroke-fuchsia-500" />
    }
    return (
      <line key={i} x1={g.from.x} y1={g.from.y} x2={g.to.x} y2={g.to.y} strokeWidth={px(1)} strokeDasharray={`${px(4)} ${px(3)}`}
        className="stroke-fuchsia-500" />
    )
  }
  return <g pointerEvents="none">{guides.map(line)}</g>
}

function Len({ a, b }: { a: Vec; b: Vec }) {
  const { px } = useViewport()
  const l = dist(a, b)
  if (l < 1) return null
  const d = norm(sub(b, a))
  const mx = (a.x + b.x) / 2 - d.y * px(12), my = (a.y + b.y) / 2 + d.x * px(12)
  return (
    <text x={mx} y={my} textAnchor="middle" dominantBaseline="middle" fontSize={px(12)} pointerEvents="none" paintOrder="stroke"
      strokeWidth={px(3)} className="fill-orange-700 stroke-[#f6f7f5] dark:fill-orange-300 dark:stroke-[#12161b]">
      {fmtCm(l)}
    </text>
  )
}

function useVertexPool() {
  const rooms = useDoc((s) => s.doc.rooms)
  return useMemo(() => otherVertices({ rooms }), [rooms])
}

function useEdgePool() {
  const rooms = useDoc((s) => s.doc.rooms)
  return useMemo(() => otherEdges({ rooms }), [rooms])
}

const addRoom = (pts: Vec[]) => {
  if (!validOutline(pts)) return
  let id = ''
  useDoc.getState().update((d) => { const r = makeRoom(d, pts); id = r.id; return { ...d, rooms: [...d.rooms, r] } })
  useUi.getState().select({ kind: 'room', roomId: id })
}

// ---------- rectangle drag ----------

function RectDraw({ onDone, onShift }: { onDone: (a: Vec, b: Vec) => void; onShift?: (p: Vec) => void }) {
  const vp = useViewport()
  const pool = useVertexPool()
  const edges = useEdgePool()
  const snapOpts = useUi((s) => s.snap)
  const [drag, setDrag] = useState<{ a: Vec; b: Vec } | null>(null)
  const set = useGuides((s) => s.set)

  const snap = (e: RPE) => {
    const r = snapPoint(vp.toWorld(e.clientX, e.clientY), {
      opts: { ...snapOpts, angles: false }, vertices: pool, edges, tolCm: vp.px(10), disabled: e.altKey,
    })
    set(r.guides)
    return r.point
  }
  // Capture phase: cancel an in-progress drag on Escape and keep the tool active
  // (the shell's Escape handler must not fire — docs/plan.md 7.2 #13).
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !drag) return
      e.preventDefault()
      e.stopPropagation()
      setDrag(null)
    }
    window.addEventListener('keydown', k, true)
    return () => window.removeEventListener('keydown', k, true)
  })

  return (
    <g>
      <CaptureRect
        style={{ cursor: 'crosshair' }}
        onPointerDown={(e) => {
          if (e.button !== 0 || !e.isPrimary) return
          const p = snap(e)
          if (e.shiftKey && onShift) { onShift(p); return }
          e.currentTarget.setPointerCapture(e.pointerId)
          setDrag({ a: p, b: p })
        }}
        onPointerMove={(e) => { const p = snap(e); setDrag((d) => (d ? { ...d, b: p } : d)) }}
        onPointerUp={(e) => {
          if (drag && Math.abs(drag.b.x - drag.a.x) >= 10 && Math.abs(drag.b.y - drag.a.y) >= 10) onDone(drag.a, drag.b)
          setDrag(null)
          set([])
          e.currentTarget.releasePointerCapture?.(e.pointerId)
        }}
        onPointerCancel={() => setDrag(null)}
      />
      {drag && (
        <g pointerEvents="none">
          <rect x={Math.min(drag.a.x, drag.b.x)} y={Math.min(drag.a.y, drag.b.y)} width={Math.abs(drag.b.x - drag.a.x)} height={Math.abs(drag.b.y - drag.a.y)}
            fill="rgba(249,115,22,0.12)" strokeWidth={vp.px(2)} strokeDasharray={`${vp.px(6)} ${vp.px(4)}`} className="stroke-orange-500" />
          <Len a={{ x: drag.a.x, y: drag.a.y }} b={{ x: drag.b.x, y: drag.a.y }} />
          <Len a={{ x: drag.b.x, y: drag.a.y }} b={{ x: drag.b.x, y: drag.b.y }} />
        </g>
      )}
      <GuidesLayer />
    </g>
  )
}

// ---------- polygon drawing ----------

function PolyDraw({ initial, onDone, onCancel }: { initial?: Vec[]; onDone: (pts: Vec[]) => void; onCancel?: () => void }) {
  const vp = useViewport()
  const pool = useVertexPool()
  const edges = useEdgePool()
  const snapOpts = useUi((s) => s.snap)
  const [pts, setPts] = useState<Vec[]>(initial ?? [])
  const [hover, setHover] = useState<Vec | null>(null)
  const set = useGuides((s) => s.set)
  const near = hover && pts.length >= 3 && dist(hover, pts[0]) < vp.px(14)
  // Refuse a closing or a new point that makes edges cross.
  const CROSS_TXT = 'Edges would cross'
  const bad = !!hover && pts.length >= 2 && (near ? selfIntersects(pts) : newEdgeCrosses(pts, hover))

  const snap = (e: RPE) => {
    const raw = vp.toWorld(e.clientX, e.clientY)
    const r = snapPoint(raw, {
      opts: snapOpts, refs: pts.length ? [pts[pts.length - 1]] : [], vertices: [...pool, ...pts], edges, tolCm: vp.px(10), disabled: e.altKey,
    })
    set(r.guides)
    return { raw, point: r.point }
  }

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (inInput(e.target)) return
      if (e.key === 'Enter' && pts.length >= 3) {
        e.preventDefault()
        if (selfIntersects(pts)) { notify(CROSS_TXT, pts[pts.length - 1]); return }
        onDone(pts)
      }
      else if (e.key === 'Backspace') { e.preventDefault(); if (pts.length <= 1) { setPts([]); onCancel?.() } else setPts(pts.slice(0, -1)) }
      else if (e.key === 'Escape') {
        // Cancel in-progress points and keep the tool (7.2 #13): capture phase + preventDefault.
        if (pts.length > 0) { e.preventDefault(); e.stopPropagation(); setPts([]); onCancel?.() }
      }
    }
    window.addEventListener('keydown', k, true)
    return () => window.removeEventListener('keydown', k, true)
  })

  const preview = hover && pts.length ? [...pts, near ? pts[0] : hover] : pts
  return (
    <g>
      <CaptureRect
        style={{ cursor: 'crosshair' }}
        onPointerMove={(e) => setHover(snap(e).point)}
        onPointerDown={(e) => {
          if (e.button !== 0 || !e.isPrimary) return
          const { raw, point } = snap(e)
          if (pts.length >= 3 && dist(raw, pts[0]) < vp.px(14)) {
            if (selfIntersects(pts)) { notify(CROSS_TXT, point); return }
            onDone(pts)
            return
          }
          if (pts.length && dist(point, pts[pts.length - 1]) < 1) return
          if (newEdgeCrosses(pts, point)) { notify(CROSS_TXT, point); return }
          setPts([...pts, point]); setHover(point)
        }}
      />
      {pts.length > 0 && (
        <g pointerEvents="none">
          {pts.length >= 3 && <path d={'M' + pts.map((p) => `${p.x} ${p.y}`).join('L') + 'Z'} fill="rgba(249,115,22,0.10)" />}
          <polyline points={preview.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" strokeWidth={vp.px(2)}
            className={bad ? 'stroke-red-500' : 'stroke-orange-500'} />
          {bad && hover && <circle cx={hover.x} cy={hover.y} r={vp.px(9)} fill="none" strokeWidth={vp.px(2)} className="stroke-red-500" />}
          {bad && hover && (
            <text x={hover.x} y={hover.y - vp.px(22)} textAnchor="middle" fontSize={vp.px(13)} fontWeight={600} paintOrder="stroke"
              strokeWidth={vp.px(4)} strokeLinejoin="round" className="fill-red-600 stroke-[#f6f7f5] dark:fill-red-400 dark:stroke-[#12161b]">
              {CROSS_TXT}
            </text>
          )}
          {preview.slice(1).map((p, i) => <Len key={i} a={preview[i]} b={p} />)}
          {pts.map((p, i) => (
            <circle key={i} cx={p.x} cy={p.y} r={vp.px(i === 0 && near ? 9 : 4.5)}
              className={i === 0 && near ? 'fill-emerald-500 stroke-white' : 'fill-orange-500 stroke-white'} strokeWidth={vp.px(1.5)} />
          ))}
        </g>
      )}
      <GuidesLayer />
      <NoticeLayer />
    </g>
  )
}

// ---------- tools ----------

function RectTool() {
  return <RectDraw onDone={(a, b) => addRoom(rectPoints(a, b))} />
}

function PolygonTool() {
  return <PolyDraw onDone={addRoom} />
}

function SliceTool() {
  const vp = useViewport()
  const pool = useVertexPool()
  const edges = useEdgePool()
  const snapOpts = useUi((s) => s.snap)
  const rooms = useDoc((s) => s.doc.rooms)
  const [a, setA] = useState<Vec | null>(null)
  const [hover, setHover] = useState<Vec | null>(null)
  const set = useGuides((s) => s.set)

  const valid = useMemo(
    () => !!a && !!hover && dist(a, hover) >= 1 && !!sliceDoc({ ...useDoc.getState().doc, rooms }, a, hover),
    [a, hover, rooms],
  )

  // Capture phase (7.2 #13): Escape/Backspace cancel the in-progress slice line and
  // preventDefault so the shell keeps the slice tool instead of switching to select.
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (inInput(e.target)) return
      if ((e.key === 'Escape' || e.key === 'Backspace') && a) {
        e.preventDefault()
        e.stopPropagation()
        setA(null)
      }
    }
    window.addEventListener('keydown', k, true)
    return () => window.removeEventListener('keydown', k, true)
  }, [a])

  const snap = (e: RPE) => {
    const r = snapPoint(vp.toWorld(e.clientX, e.clientY), {
      opts: snapOpts, refs: a ? [a] : [], vertices: pool, edges, tolCm: vp.px(10), disabled: e.altKey,
    })
    set(r.guides)
    return r.point
  }
  const dir = a && hover && dist(a, hover) >= 1 ? norm(sub(hover, a)) : null
  const color = valid ? 'stroke-orange-500' : 'stroke-slate-400'
  return (
    <g>
      <CaptureRect
        style={{ cursor: 'crosshair' }}
        onPointerMove={(e) => setHover(snap(e))}
        onPointerDown={(e) => {
          if (e.button !== 0 || !e.isPrimary) return
          const p = snap(e)
          setHover(p)
          if (!a) { setA(p); return }
          const r = sliceDoc(useDoc.getState().doc, a, p)
          if (!r) return
          useDoc.getState().update(() => r.doc)
          useUi.getState().select({ kind: 'room', roomId: r.roomIds[0] })
          setA(null)
        }}
      />
      {a && (
        <g pointerEvents="none">
          {dir && <line x1={a.x - dir.x * 1e5} y1={a.y - dir.y * 1e5} x2={a.x + dir.x * 1e5} y2={a.y + dir.y * 1e5}
            strokeWidth={vp.px(1)} strokeDasharray={`${vp.px(5)} ${vp.px(5)}`} strokeOpacity={0.5} className={color} />}
          {hover && <line x1={a.x} y1={a.y} x2={hover.x} y2={hover.y} strokeWidth={vp.px(2.5)} className={color} />}
          <circle cx={a.x} cy={a.y} r={vp.px(5)} className="fill-orange-500 stroke-white" strokeWidth={vp.px(1.5)} />
          {hover && <Len a={a} b={hover} />}
        </g>
      )}
      <GuidesLayer />
    </g>
  )
}

function CutoutTool() {
  const [poly, setPoly] = useState<Vec[] | null>(null)
  const apply = (ring: Vec[]) => {
    const r = cutDoc(useDoc.getState().doc, ring)
    if (!r) return
    useDoc.getState().update(() => r.doc)
    useUi.getState().select({ kind: 'room', roomId: r.roomIds[0] })
  }
  if (poly) return <PolyDraw initial={poly} onDone={(pts) => { apply(pts); setPoly(null) }} onCancel={() => setPoly(null)} />
  return <RectDraw onDone={(a, b) => apply(rectPoints(a, b))} onShift={(p) => setPoly([p])} />
}

// ---------- select ----------

function SelectTool() {
  const vp = useViewport()
  const { px } = vp
  const selection = useUi((s) => s.selection)
  const multi = useUi((s) => s.multi)
  const items = useMemo(() => selectedItems({ selection, multi }), [selection, multi])
  const allRooms = useDoc((s) => s.doc.rooms)
  // Points are shown for the selected room(s). While points are selected, every room shows its
  // points, so Shift + click can add a point of another room.
  const rooms = useMemo(() => {
    if (!selection || selection.kind === 'element') return []
    if (selection.kind === 'vertex') return allRooms
    const ids = new Set(items.flatMap((s) => (s.kind === 'element' ? [] : [s.roomId])))
    return allRooms.filter((r) => ids.has(r.id))
  }, [selection, items, allRooms])
  const selVerts = new Set(items.flatMap((s) => (s.kind === 'vertex' ? [s.vertexId] : [])))

  // Delete / Backspace on selected vertex or room.
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.key !== 'Delete' && e.key !== 'Backspace') || inInput(e.target)) return
      if (useUi.getState().mode !== 'edit') return
      e.preventDefault()
      deleteSelection()
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [])

  // Click on empty space (svg root or background image) clears the selection.
  // Mouse drag there draws a box: rooms fully inside, else walls, else points (Shift adds). In a
  // v2 document the walls are stored walls (both nodes inside).
  // Rule for the start of the box: a drag that starts on empty canvas draws it. A plain drag that
  // starts on a room floor still moves the room. In a v2 document, Shift + drag that starts on a
  // room floor (or its name) draws the box too and ADDS to the selection; the room handler only
  // toggles the room on a Shift + click (see onRoomDown). Walls and elements are never a start.
  const [band, setBand] = useState<{ a: Vec; b: Vec } | null>(null)
  const toWorld = vp.toWorld
  useEffect(() => {
    const svg = vp.svg
    if (!svg) return
    const down = (e: PointerEvent) => {
      if (e.button !== 0 || !e.isPrimary) return
      const v2 = isV2Doc(useDoc.getState().doc)
      const onFloor = v2 && e.shiftKey && e.target instanceof Element && !!e.target.closest('[data-room-id], [data-room-label]')
      if (!(e.target === svg || e.target instanceof SVGImageElement || onFloor)) return
      if (svg.hasAttribute('data-pan-ready')) return
      const add = e.shiftKey
      if (!add) useUi.getState().select(null)
      if (e.pointerType === 'touch') return
      const sx = e.clientX, sy = e.clientY
      const a = toWorld(sx, sy)
      let moved = false
      const move = (ev: PointerEvent) => {
        if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) return
        moved = true
        setBand({ a, b: toWorld(ev.clientX, ev.clientY) })
      }
      const stop = () => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        window.removeEventListener('pointercancel', stop)
        window.removeEventListener('keydown', key)
        setBand(null)
      }
      const up = (ev: PointerEvent) => {
        stop()
        if (!moved) return
        const doc = useDoc.getState().doc
        const found = itemsInBox(doc.rooms, boxOf(a, toWorld(ev.clientX, ev.clientY)), isV2Doc(doc) ? doc : undefined)
        const ui = useUi.getState()
        ui.set(selectItems(ui, found, add))
      }
      const key = (ev: KeyboardEvent) => { if (ev.key === 'Escape') stop() }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
      window.addEventListener('pointercancel', stop)
      window.addEventListener('keydown', key)
    }
    svg.addEventListener('pointerdown', down)
    return () => svg.removeEventListener('pointerdown', down)
  }, [vp.svg, toWorld])

  return (
    <g>
      {rooms.map((room) => room.vertices.map((v, i) => {
        const sel = selVerts.has(v.id)
        // Locked adjacent walls block the drag (7.2 #21): show not-allowed.
        const blocked = locked(room, i) || locked(room, i - 1)
        return (
          <g key={room.id + v.id} style={{ cursor: blocked ? 'not-allowed' : 'move' }} data-vertex={room.id + ':' + v.id}
            data-selected={sel ? 'true' : undefined} onPointerDown={(e) => onVertexDown(e, vp, room.id, v.id)}>
            <circle cx={v.x} cy={v.y} r={px(18)} fill="transparent" />
            <circle cx={v.x} cy={v.y} r={px(sel ? 8 : 6)} strokeWidth={px(2)}
              className={sel ? 'fill-orange-500 stroke-white' : 'fill-white stroke-orange-500 dark:fill-slate-900'} />
          </g>
        )
      }))}
      {rooms.map((room) => room.holes.map((h) => h.map((v) => {
        const sel = selVerts.has(v.id)
        return (
          <g key={v.id} style={{ cursor: 'move' }} onPointerDown={(e) => onHoleVertexDown(e, vp, room.id, v.id)}>
            <circle cx={v.x} cy={v.y} r={px(18)} fill="transparent" />
            <rect x={v.x - px(sel ? 7 : 5.5)} y={v.y - px(sel ? 7 : 5.5)} width={px(sel ? 14 : 11)} height={px(sel ? 14 : 11)}
              strokeWidth={px(2)}
              className={sel ? 'fill-orange-500 stroke-white' : 'fill-white stroke-orange-500 dark:fill-slate-900'} />
          </g>
        )
      })))}
      {band && (() => {
        const b = boxOf(band.a, band.b)
        return (
          <rect data-select-box="" x={b.x0} y={b.y0} width={b.x1 - b.x0} height={b.y1 - b.y0} pointerEvents="none"
            strokeWidth={px(1)} strokeDasharray={`${px(4)} ${px(3)}`} className="fill-orange-500/10 stroke-orange-500" />
        )
      })()}
      <GuidesLayer />
      <NoticeLayer />
    </g>
  )
}

export const roomTools = { select: SelectTool, rect: RectTool, polygon: PolygonTool, slice: SliceTool, cutout: CutoutTool }
