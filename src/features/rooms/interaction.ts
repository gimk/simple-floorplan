// Pointer interactions of the select tool: vertex drag, corner resize, room drag, wall drag,
// selection, insert, delete.
import type { PointerEvent as ReactPointerEvent } from 'react'
import { dot, roomWalls } from '../../model/geometry'
import { beginDrag, endDrag, useDoc, useUi } from '../../model/store'
import type { PlanDoc, Room, Vec } from '../../model/types'
import { selfIntersects } from './crossing'
import { setDragInfo } from './draginfo'
import { useGuides } from './guides'
import { clearHoleSel, getActiveHole } from './holes'
import { notify } from './notice'
import {
  deleteRoom, insertVertex, moveHoleVertex, movableLinked, moveVertices, removeHole, removeHoleVertex, removeVertex,
  type VMove, type VRef,
} from './ops'
import { snapPoint } from './snap'
import {
  moveRoom, nearestVertex, oppositeVertex, roomHasLockedWall, scaleFactors, scaleRoomWithLinks, type Link,
} from './transform'
import { undoToast } from '../toast'

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

export function selectRoom(roomId: string) { useUi.getState().select({ kind: 'room', roomId }); clearHoleSel() }

const CROSS_MSG = 'Room would cross itself. Move cancelled.'

/** After a drag: did a room that was simple become self-intersecting? */
const newlyCrossing = (before: PlanDoc, after: PlanDoc, roomIds: string[]) =>
  roomIds.some((id) => {
    const a = before.rooms.find((r) => r.id === id), b = after.rooms.find((r) => r.id === id)
    return !!a && !!b && !selfIntersects(a.vertices) && selfIntersects(b.vertices)
  })

const refKey = (r: VRef) => r.roomId + ':' + r.vertexId

/**
 * Pointer down on a room fill (or its label): select it, then, without `vp`, nothing else
 * (old behaviour). With `vp`, a drag past the 4 px threshold moves the whole room.
 */
export function onRoomDown(e: ReactPointerEvent, roomId: string, vp?: Vp) {
  if (e.button !== 0 || !e.isPrimary) return
  selectRoom(roomId)
  if (!vp) return
  const room0 = findRoom(roomId)
  if (!room0) return
  const doc0 = useDoc.getState().doc
  const down = vp.toWorld(e.clientX, e.clientY)
  // The room vertex nearest the pointer is the one that snaps against other rooms.
  const near = nearestVertex(room0, down)
  if (!near) return
  // Shared corners of other rooms follow the translation, so neighbours stretch (Shift = this room only).
  const linked = e.shiftKey ? [] : room0.vertices.flatMap((v) => movableLinked(doc0, roomId, v.id))
  const linkedKeys = new Set(linked.map(refKey))
  const affected = [roomId, ...new Set(linked.map((l) => l.roomId))]
  let start: PlanDoc | null = null
  let last: Vec = near
  track(e, {
    onStart: () => {
      start = beginDrag()
      document.body.style.cursor = 'move'
    },
    onMove: (ev) => {
      if (!start) return
      const w = vp.toWorld(ev.clientX, ev.clientY)
      const raw = { x: near.x + (w.x - down.x), y: near.y + (w.y - down.y) }
      const ui = useUi.getState()
      const r = snapPoint(raw, {
        opts: ui.snap, tolCm: vp.px(10), disabled: ev.altKey,
        // Both the room and the shared corners that travel with it stay out of the snap set.
        vertices: otherVertices(start, (rid, vid) => rid === roomId || linkedKeys.has(rid + ':' + vid)),
      })
      useGuides.getState().set(r.guides)
      last = r.point
      const d = { x: r.point.x - near.x, y: r.point.y - near.y }
      // Always translate the drag-start document, so every move is independent of the last one.
      useDoc.getState().updateSilent(() => moveRoom(start as PlanDoc, roomId, d, linked))
    },
    onEnd: () => {
      document.body.style.cursor = ''
      if (!start) return
      if (newlyCrossing(start, useDoc.getState().doc, affected)) {
        useDoc.getState().updateSilent(() => start as PlanDoc)
        notify(CROSS_MSG, last)
        return
      }
      endDrag(start)
    },
  })
}

/** Is the wall starting at vertex index i locked? */
export const locked = (room: Room, i: number) => {
  const n = room.vertices.length
  return !!room.walls[room.vertices[((i % n) + n) % n].id]?.locked
}

/** Ctrl/Cmd + drag on a corner: resize the whole room, anchored on the opposite corner. */
const SCALE_LOCKED_MSG = 'Room has a locked wall. Resize cancelled.'

function resizeRoomFromCorner(e: ReactPointerEvent, vp: Vp, room: Room, vertexId: string) {
  const roomId = room.id
  const corner = room.vertices.find((v) => v.id === vertexId)
  const anchor = oppositeVertex(room, vertexId)
  const down = vp.toWorld(e.clientX, e.clientY)
  // Scaling changes wall lengths, so a locked wall forbids it (a translation does not).
  if (!corner || !anchor) return
  if (roomHasLockedWall(room)) {
    notify(SCALE_LOCKED_MSG, down)
    return
  }
  const doc0 = useDoc.getState().doc
  // Shared corners: every neighbour vertex on the linked spot follows the vertex it shares.
  const links: Link[] = room.vertices.flatMap((v) =>
    movableLinked(doc0, roomId, v.id).map((ref) => ({ ref, source: { roomId, vertexId: v.id } })))
  const linkedKeys = new Set(links.map((l) => refKey(l.ref)))
  const affected = [roomId, ...new Set(links.map((l) => l.ref.roomId))]
  let start: PlanDoc | null = null
  let last: Vec = corner
  track(e, {
    onStart: () => { start = beginDrag() },
    onMove: (ev) => {
      if (!start) return
      const w = vp.toWorld(ev.clientX, ev.clientY)
      const raw = { x: corner.x + (w.x - down.x), y: corner.y + (w.y - down.y) }
      const r = snapPoint(raw, {
        opts: { ...useUi.getState().snap, angles: false }, tolCm: vp.px(10), disabled: ev.altKey,
        // The room scales, so none of its own vertices (nor the linked ones) are snap targets.
        vertices: otherVertices(start, (rid, vid) => rid === roomId || linkedKeys.has(rid + ':' + vid)),
      })
      useGuides.getState().set(r.guides)
      const f = scaleFactors(anchor, corner, r.point, ev.shiftKey)
      last = { x: anchor.x + (corner.x - anchor.x) * f.sx, y: anchor.y + (corner.y - anchor.y) * f.sy }
      useDoc.getState().updateSilent(() => scaleRoomWithLinks(start as PlanDoc, roomId, anchor, f, links))
    },
    onEnd: () => {
      if (!start) return
      if (newlyCrossing(start, useDoc.getState().doc, affected)) {
        useDoc.getState().updateSilent(() => start as PlanDoc)
        notify(CROSS_MSG, last)
        return
      }
      endDrag(start)
    },
  })
}

export function onVertexDown(e: ReactPointerEvent, vp: Vp, roomId: string, vertexId: string) {
  if (e.button !== 0 || !e.isPrimary) return
  e.stopPropagation()
  useUi.getState().select({ kind: 'vertex', roomId, vertexId })
  const room0 = findRoom(roomId)
  if (!room0) return
  const i = room0.vertices.findIndex((v) => v.id === vertexId)
  if (i < 0) return
  // Ctrl/Cmd scales the whole room from the opposite corner instead of moving one point.
  if (e.ctrlKey || e.metaKey) {
    resizeRoomFromCorner(e, vp, room0, vertexId)
    return
  }
  // Locked walls cannot be resized: neither the wall starting here nor the one ending here.
  if (locked(room0, i) || locked(room0, i - 1)) return
  const n = room0.vertices.length
  const orig = room0.vertices[i]
  const prev = room0.vertices[(i - 1 + n) % n], next = room0.vertices[(i + 1) % n]
  const down = vp.toWorld(e.clientX, e.clientY)
  // Shared corners: vertices of other rooms at the same place move too (Shift = this room only).
  const linked = e.shiftKey ? [] : movableLinked(useDoc.getState().doc, roomId, vertexId)
  const linkedKeys = new Set(linked.map(refKey))
  const affected = [roomId, ...new Set(linked.map((l) => l.roomId))]
  let start: PlanDoc | null = null
  let last = orig as Vec
  track(e, {
    onStart: () => { start = beginDrag(); setDragInfo({ kind: 'vertex', roomId, vertexId }) },
    onMove: (ev) => {
      const w = vp.toWorld(ev.clientX, ev.clientY)
      const raw = { x: orig.x + (w.x - down.x), y: orig.y + (w.y - down.y) }
      const ui = useUi.getState()
      const doc = useDoc.getState().doc
      const r = snapPoint(raw, {
        opts: ui.snap, refs: [prev, next], tolCm: vp.px(10), disabled: ev.altKey,
        vertices: otherVertices(doc, (rid, vid) => (rid === roomId && vid === vertexId) || linkedKeys.has(rid + ':' + vid)),
      })
      useGuides.getState().set(r.guides)
      last = r.point
      const moves: VMove[] = [{ roomId, vertexId, ...r.point }, ...linked.map((l) => ({ ...l, ...r.point }))]
      useDoc.getState().updateSilent((d) => moveVertices(d, moves))
    },
    onEnd: () => {
      setDragInfo(null)
      if (!start) return
      if (newlyCrossing(start, useDoc.getState().doc, affected)) {
        useDoc.getState().updateSilent(() => start as PlanDoc)
        notify(CROSS_MSG, last)
        return
      }
      endDrag(start)
    },
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
  // Shared corners follow (Shift = this room only).
  const doc0 = useDoc.getState().doc
  const linkedA = e.shiftKey ? [] : movableLinked(doc0, roomId, aId)
  const linkedB = e.shiftKey ? [] : movableLinked(doc0, roomId, bId)
  const linkedKeys = new Set([...linkedA, ...linkedB].map(refKey))
  const affected = [roomId, ...new Set([...linkedA, ...linkedB].map((l) => l.roomId))]
  let start: PlanDoc | null = null
  let last: Vec = a0
  track(e, {
    onStart: () => { start = beginDrag(); setDragInfo({ kind: 'wall', roomId, wallStart }) },
    onMove: (ev) => {
      const w = vp.toWorld(ev.clientX, ev.clientY)
      let d = dot({ x: w.x - down.x, y: w.y - down.y }, normal)
      if (!ev.altKey) {
        const ui = useUi.getState()
        const doc = useDoc.getState().doc
        if (axisAligned) {
          const r = snapPoint({ x: a0.x + normal.x * d, y: a0.y + normal.y * d }, {
            opts: { ...ui.snap, angles: false }, tolCm: vp.px(10),
            vertices: otherVertices(doc, (rid, vid) => (rid === roomId && (vid === aId || vid === bId)) || linkedKeys.has(rid + ':' + vid)),
          })
          useGuides.getState().set(r.guides)
          d = dot({ x: r.point.x - a0.x, y: r.point.y - a0.y }, normal)
        } else if (ui.snap.grid && ui.snap.gridCm > 0) {
          d = Math.round(d / ui.snap.gridCm) * ui.snap.gridCm
        }
      } else useGuides.getState().set([])
      const pa = { x: a0.x + normal.x * d, y: a0.y + normal.y * d }
      const pb = { x: b0.x + normal.x * d, y: b0.y + normal.y * d }
      last = pa
      const moves: VMove[] = [
        { roomId, vertexId: aId, ...pa }, { roomId, vertexId: bId, ...pb },
        ...linkedA.map((l) => ({ ...l, ...pa })), ...linkedB.map((l) => ({ ...l, ...pb })),
      ]
      useDoc.getState().updateSilent((doc) => moveVertices(doc, moves))
    },
    onEnd: () => {
      setDragInfo(null)
      if (!start) return
      if (newlyCrossing(start, useDoc.getState().doc, affected)) {
        useDoc.getState().updateSilent(() => start as PlanDoc)
        notify(CROSS_MSG, last)
        return
      }
      endDrag(start)
    },
  })
}

/** Drag a vertex of a hole (cutout) of the selected room. */
export function onHoleVertexDown(e: ReactPointerEvent, vp: Vp, roomId: string, vertexId: string) {
  if (e.button !== 0 || !e.isPrimary) return
  e.stopPropagation()
  useUi.getState().select({ kind: 'vertex', roomId, vertexId })
  const room0 = findRoom(roomId)
  const ring = room0?.holes.find((h) => h.some((v) => v.id === vertexId))
  if (!room0 || !ring) return
  const i = ring.findIndex((v) => v.id === vertexId)
  const orig = ring[i], prev = ring[(i - 1 + ring.length) % ring.length], next = ring[(i + 1) % ring.length]
  const down = vp.toWorld(e.clientX, e.clientY)
  let start: PlanDoc | null = null
  let last: Vec = orig
  track(e, {
    onStart: () => { start = beginDrag() },
    onMove: (ev) => {
      const w = vp.toWorld(ev.clientX, ev.clientY)
      const raw = { x: orig.x + (w.x - down.x), y: orig.y + (w.y - down.y) }
      const doc = useDoc.getState().doc
      const r = snapPoint(raw, {
        opts: useUi.getState().snap, refs: [prev, next], tolCm: vp.px(10), disabled: ev.altKey,
        vertices: otherVertices(doc, (_rid, vid) => vid === vertexId),
      })
      useGuides.getState().set(r.guides)
      last = r.point
      useDoc.getState().updateSilent((d) => moveHoleVertex(d, roomId, vertexId, r.point))
    },
    onEnd: () => {
      if (!start) return
      const after = useDoc.getState().doc.rooms.find((r) => r.id === roomId)?.holes.find((h) => h.some((v) => v.id === vertexId))
      if (after && selfIntersects(after) && !selfIntersects(ring)) {
        useDoc.getState().updateSilent(() => start as PlanDoc)
        notify('Hole would cross itself. Move cancelled.', last)
        return
      }
      endDrag(start)
    },
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

/** Delete key: selected vertex (outline or hole), selected hole, or room. Walls and elements are ignored here. */
export function deleteSelection() {
  const sel = useUi.getState().selection
  if (!sel) return
  const doc = useDoc.getState().doc
  if (sel.kind === 'vertex') {
    const room = findRoom(sel.roomId)
    if (!room) return
    if (room.vertices.some((v) => v.id === sel.vertexId)) {
      if (room.vertices.length <= 3) return
      useDoc.getState().update((d) => removeVertex(d, sel.roomId, sel.vertexId))
    } else {
      const next = removeHoleVertex(doc, sel.roomId, sel.vertexId)
      if (next === doc) return
      useDoc.getState().update(() => next)
    }
    useUi.getState().select({ kind: 'room', roomId: sel.roomId })
  } else if (sel.kind === 'room') {
    const h = getActiveHole()
    if (h) {
      useDoc.getState().update((d) => removeHole(d, h.roomId, h.holeIndex))
      clearHoleSel()
      return
    }
    useDoc.getState().update((d) => deleteRoom(d, sel.roomId))
    useUi.getState().select(null)
    undoToast('Room deleted', () => useDoc.temporal.getState().undo())
  }
}
