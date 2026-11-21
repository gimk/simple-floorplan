// Pointer interactions of the select tool: vertex drag, wall drag, selection, insert, delete.
import type { PointerEvent as ReactPointerEvent } from 'react'
import { dot, roomWalls } from '../../model/geometry'
import { beginDrag, endDrag, useDoc, useUi } from '../../model/store'
import type { PlanDoc, Room, Vec } from '../../model/types'
import { useGuides } from './guides'
import { deleteRoom, insertVertex, removeVertex } from './ops'
import { snapPoint } from './snap'

export type Vp = { toWorld: (x: number, y: number) => Vec; px: (n: number) => number }

const THRESHOLD_PX = 4

type PointerLike = Pick<ReactPointerEvent, 'clientX' | 'clientY' | 'pointerId'>

function track(
  e: PointerLike,
  h: { onStart?: () => void; onMove: (ev: PointerEvent) => void; onEnd: (moved: boolean) => void },
) {
  const { clientX: sx, clientY: sy, pointerId } = e
  let moved = false
  const move = (ev: PointerEvent) => {
    if (ev.pointerId !== pointerId) return
    if (!moved) {
      if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < THRESHOLD_PX) return
      moved = true
      h.onStart?.()
    }
    h.onMove(ev)
  }
  const up = (ev: PointerEvent) => {
    if (ev.pointerId !== pointerId) return
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('pointercancel', up)
    useGuides.getState().set([])
    h.onEnd(moved)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
  window.addEventListener('pointercancel', up)
}

const findRoom = (roomId: string): Room | undefined => useDoc.getState().doc.rooms.find((r) => r.id === roomId)

/** All outline + hole vertices of every room, except the ones for which `skip` returns true. */
export function otherVertices(doc: Pick<PlanDoc, 'rooms'>, skip?: (roomId: string, vertexId: string) => boolean): Vec[] {
  const out: Vec[] = []
  for (const r of doc.rooms) {
    for (const v of r.vertices) if (!skip?.(r.id, v.id)) out.push(v)
    for (const h of r.holes) for (const v of h) out.push(v)
  }
  return out
}

export function selectRoom(roomId: string) { useUi.getState().select({ kind: 'room', roomId }) }

export function onRoomDown(e: ReactPointerEvent, roomId: string) {
  if (e.button !== 0 || !e.isPrimary) return
  selectRoom(roomId)
}

/** Is the wall starting at vertex index i locked? */
const locked = (room: Room, i: number) => {
  const n = room.vertices.length
  return !!room.walls[room.vertices[((i % n) + n) % n].id]?.locked
}

export function onVertexDown(e: ReactPointerEvent, vp: Vp, roomId: string, vertexId: string) {
  if (e.button !== 0 || !e.isPrimary) return
  e.stopPropagation()
  useUi.getState().select({ kind: 'vertex', roomId, vertexId })
  const room0 = findRoom(roomId)
  if (!room0) return
  const i = room0.vertices.findIndex((v) => v.id === vertexId)
  // Locked walls cannot be resized: neither the wall starting here nor the one ending here.
  if (i < 0 || locked(room0, i) || locked(room0, i - 1)) return
  const n = room0.vertices.length
  const orig = room0.vertices[i]
  const prev = room0.vertices[(i - 1 + n) % n], next = room0.vertices[(i + 1) % n]
  const down = vp.toWorld(e.clientX, e.clientY)
  let start: PlanDoc | null = null
  track(e, {
    onStart: () => { start = beginDrag() },
    onMove: (ev) => {
      const w = vp.toWorld(ev.clientX, ev.clientY)
      const raw = { x: orig.x + (w.x - down.x), y: orig.y + (w.y - down.y) }
      const ui = useUi.getState()
      const doc = useDoc.getState().doc
      const r = snapPoint(raw, {
        opts: ui.snap, refs: [prev, next], tolCm: vp.px(10), disabled: ev.altKey,
        vertices: otherVertices(doc, (rid, vid) => rid === roomId && vid === vertexId),
      })
      useGuides.getState().set(r.guides)
      useDoc.getState().updateSilent((d) => ({
        ...d,
        rooms: d.rooms.map((rm) => rm.id !== roomId ? rm : {
          ...rm, vertices: rm.vertices.map((v) => (v.id === vertexId ? { ...v, x: r.point.x, y: r.point.y } : v)),
        }),
      }))
    },
    onEnd: () => { if (start) endDrag(start) },
  })
}

export function onWallDown(e: ReactPointerEvent, vp: Vp, roomId: string, wallStart: string) {
  if (e.button !== 0 || !e.isPrimary) return
  e.stopPropagation()
  useUi.getState().select({ kind: 'wall', roomId, wallStart })
  const room0 = findRoom(roomId)
  if (!room0) return
  const i = room0.vertices.findIndex((v) => v.id === wallStart)
  if (i < 0) return
  // Moving a wall changes its neighbours' lengths.
  if (locked(room0, i - 1) || locked(room0, i + 1)) return
  const n = room0.vertices.length
  const aId = room0.vertices[i].id, bId = room0.vertices[(i + 1) % n].id
  const a0 = room0.vertices[i], b0 = room0.vertices[(i + 1) % n]
  const normal = roomWalls(room0)[i].inward
  const axisAligned = Math.abs(normal.x) > 0.999 || Math.abs(normal.y) > 0.999
  const down = vp.toWorld(e.clientX, e.clientY)
  let start: PlanDoc | null = null
  track(e, {
    onStart: () => { start = beginDrag() },
    onMove: (ev) => {
      const w = vp.toWorld(ev.clientX, ev.clientY)
      let d = dot({ x: w.x - down.x, y: w.y - down.y }, normal)
      if (!ev.altKey) {
        const ui = useUi.getState()
        const doc = useDoc.getState().doc
        if (axisAligned) {
          const r = snapPoint({ x: a0.x + normal.x * d, y: a0.y + normal.y * d }, {
            opts: { ...ui.snap, angles: false }, tolCm: vp.px(10),
            vertices: otherVertices(doc, (rid, vid) => rid === roomId && (vid === aId || vid === bId)),
          })
          useGuides.getState().set(r.guides)
          d = dot({ x: r.point.x - a0.x, y: r.point.y - a0.y }, normal)
        } else if (ui.snap.grid && ui.snap.gridCm > 0) {
          d = Math.round(d / ui.snap.gridCm) * ui.snap.gridCm
        }
      } else useGuides.getState().set([])
      useDoc.getState().updateSilent((doc) => ({
        ...doc,
        rooms: doc.rooms.map((rm) => rm.id !== roomId ? rm : {
          ...rm,
          vertices: rm.vertices.map((v) =>
            v.id === aId ? { ...v, x: a0.x + normal.x * d, y: a0.y + normal.y * d }
              : v.id === bId ? { ...v, x: b0.x + normal.x * d, y: b0.y + normal.y * d } : v),
        }),
      }))
    },
    onEnd: () => { if (start) endDrag(start) },
  })
}

/** Double click on a wall: insert a vertex there. */
export function onWallDouble(e: { clientX: number; clientY: number }, vp: Vp, roomId: string, wallStart: string) {
  const w = vp.toWorld(e.clientX, e.clientY)
  const r = insertVertex(useDoc.getState().doc, roomId, wallStart, w)
  if (!r) return
  useDoc.getState().update(() => r.doc)
  useUi.getState().select({ kind: 'vertex', roomId, vertexId: r.vertexId })
}

/** Delete key: selected vertex or room. Walls and elements are ignored here. */
export function deleteSelection() {
  const sel = useUi.getState().selection
  if (!sel) return
  if (sel.kind === 'vertex') {
    const room = findRoom(sel.roomId)
    if (!room || room.vertices.length <= 3) return
    useDoc.getState().update((d) => removeVertex(d, sel.roomId, sel.vertexId))
    useUi.getState().select({ kind: 'room', roomId: sel.roomId })
  } else if (sel.kind === 'room') {
    useDoc.getState().update((d) => deleteRoom(d, sel.roomId))
    useUi.getState().select(null)
  }
}
