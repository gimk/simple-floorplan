// Pointer interactions of the select tool: vertex drag, corner resize, room drag, wall drag,
// selection, insert, delete.
import type { PointerEvent as ReactPointerEvent } from 'react'
import { dot, roomWalls } from '../../model/geometry'
import { inGroup, selectedItems, type SelItem } from '../../model/selection'
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
import { snapPoint, snapTranslation } from './snap'
import {
  moveRoom, nearestVertex, oppositeVertex, roomHasLockedWall, scaleFactors, scaleRoomWithLinks, type Link,
} from './transform'
import { undoToast } from '../toast'

export type Vp = { toWorld: (x: number, y: number) => Vec; px: (n: number) => number }

const THRESHOLD_PX = 4

type PointerLike = Pick<ReactPointerEvent, 'clientX' | 'clientY' | 'pointerId'>

/** Pointer position + modifier keys. Modifiers are read live, so they can be pressed after the click. */
export type DragEv = { clientX: number; clientY: number; shiftKey: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean }

const MOD_KEYS = new Set(['Shift', 'Alt', 'Control', 'Meta'])

function track(
  e: PointerLike,
  h: { onStart?: () => void; onMove: (ev: DragEv) => void; onEnd: (moved: boolean) => void },
) {
  const { clientX: sx, clientY: sy, pointerId } = e
  let moved = false
  let last: DragEv | null = null
  const move = (ev: PointerEvent) => {
    if (ev.pointerId !== pointerId) return
    if (!moved) {
      if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < THRESHOLD_PX) return
      moved = true
      h.onStart?.()
    }
    last = { clientX: ev.clientX, clientY: ev.clientY, shiftKey: ev.shiftKey, altKey: ev.altKey, ctrlKey: ev.ctrlKey, metaKey: ev.metaKey }
    h.onMove(last)
  }
  // A modifier pressed or released during the drag re-runs the last move at once.
  const key = (ev: KeyboardEvent) => {
    if (!moved || !last || !MOD_KEYS.has(ev.key)) return
    ev.preventDefault()
    last = { ...last, shiftKey: ev.shiftKey, altKey: ev.altKey, ctrlKey: ev.ctrlKey, metaKey: ev.metaKey }
    h.onMove(last)
  }
  const up = (ev: PointerEvent) => {
    if (ev.pointerId !== pointerId) return
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('pointercancel', up)
    window.removeEventListener('keydown', key)
    window.removeEventListener('keyup', key)
    useGuides.getState().set([])
    h.onEnd(moved)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
  window.addEventListener('pointercancel', up)
  window.addEventListener('keydown', key)
  window.addEventListener('keyup', key)
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

/** Outline walls of a room, as segments [start, end], in vertex order. */
export function outlineEdges(room: Pick<Room, 'vertices'>): [Vec, Vec][] {
  const n = room.vertices.length
  return room.vertices.map((v, i) => [v, room.vertices[(i + 1) % n]] as [Vec, Vec])
}

/** Outline walls of every room, except the rooms for which `skip` returns true (holes are not wall targets). */
export function otherEdges(doc: Pick<PlanDoc, 'rooms'>, skip?: (roomId: string) => boolean): [Vec, Vec][] {
  return doc.rooms.flatMap((r) => (skip?.(r.id) ? [] : outlineEdges(r)))
}

export function selectRoom(roomId: string) { useUi.getState().select({ kind: 'room', roomId }); clearHoleSel() }

/** Shift + click: add the item to the selection group, or remove it. */
function toggle(item: SelItem) { useUi.getState().toggleSelect(item); clearHoleSel() }

/** Selected rooms, when this room is part of a group of two or more; else null. */
function roomGroup(roomId: string): string[] | null {
  const ui = useUi.getState()
  if (!inGroup(ui, { kind: 'room', roomId })) return null
  return selectedItems(ui).flatMap((s) => (s.kind === 'room' ? [s.roomId] : []))
}

/** Selected points, when this point is part of a group of two or more; else null. */
function vertexGroup(roomId: string, vertexId: string): VRef[] | null {
  const ui = useUi.getState()
  if (!inGroup(ui, { kind: 'vertex', roomId, vertexId })) return null
  return selectedItems(ui).flatMap((s) => (s.kind === 'vertex' ? [{ roomId: s.roomId, vertexId: s.vertexId }] : []))
}

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
 * Shift + click (no drag) adds or removes the room from the selection group; Shift + drag
 * still means "this room only". Dragging a room of a group moves every room of the group;
 * a click without Shift and without a drag selects this room only.
 */
export function onRoomDown(e: ReactPointerEvent, roomId: string, vp?: Vp) {
  if (e.button !== 0 || !e.isPrimary) return
  const shift = e.shiftKey
  const flip = () => toggle({ kind: 'room', roomId })
  const group = roomGroup(roomId)
  const ids = group ?? [roomId]
  if (!group && !shift) selectRoom(roomId)
  if (!vp) { if (shift) flip(); return }
  const room0 = findRoom(roomId)
  const doc0 = useDoc.getState().doc
  const down = vp.toWorld(e.clientX, e.clientY)
  // The room vertex nearest the pointer is the one that snaps against other rooms.
  const near = room0 && nearestVertex(room0, down)
  if (!near) { if (shift) flip(); return }
  // Shared corners of other rooms follow the translation, so neighbours stretch (Shift = these rooms only,
  // read on every move so it can be pressed during the drag). Corners of rooms in the group move with their room.
  const idSet = new Set(ids)
  const linkedAll = [...new Map(ids.flatMap((id) => (findRoom(id)?.vertices ?? []).flatMap((v) => movableLinked(doc0, id, v.id)))
    .filter((l) => !idSet.has(l.roomId)).map((l) => [refKey(l), l] as const)).values()]
  const linkedKeysAll = new Set(linkedAll.map(refKey))
  const affected = [...ids, ...new Set(linkedAll.map((l) => l.roomId))]
  let start: PlanDoc | null = null
  let last: Vec = near
  track(e, {
    onStart: () => {
      // Shift + drag of a room outside the group: select it, as a plain drag does.
      if (shift && !group) selectRoom(roomId)
      start = beginDrag()
      document.body.style.cursor = 'move'
    },
    onMove: (ev) => {
      if (!start) return
      const base = start
      const linked = ev.shiftKey ? [] : linkedAll
      const w = vp.toWorld(ev.clientX, ev.clientY)
      const ui = useUi.getState()
      const movingRooms = ids.flatMap((id) => base.rooms.filter((r) => r.id === id))
      const r = snapTranslation(
        movingRooms.flatMap((m) => [...m.vertices, ...m.holes.flat()]),
        { x: w.x - down.x, y: w.y - down.y },
        {
          opts: ui.snap, tolCm: vp.px(10), disabled: ev.altKey,
          // The moving rooms and the shared corners that travel with them stay out of the snap set.
          vertices: otherVertices(base, (rid, vid) => idSet.has(rid) || (!ev.shiftKey && linkedKeysAll.has(rid + ':' + vid))),
          // Walls of other rooms, except walls whose two corners travel with the dragged rooms
          // (shared corners): those walls move too, so they are not a target.
          edges: base.rooms.filter((r) => !idSet.has(r.id)).flatMap((r) => outlineEdges(r).filter((_, i) =>
            ev.shiftKey || !(linkedKeysAll.has(r.id + ':' + r.vertices[i].id) && linkedKeysAll.has(r.id + ':' + r.vertices[(i + 1) % r.vertices.length].id)))),
          movingEdges: movingRooms.flatMap((m) => outlineEdges(m)),
        },
      )
      useGuides.getState().set(r.guides)
      const d = r.d
      last = { x: near.x + d.x, y: near.y + d.y }
      // Always translate the drag-start document, so every move is independent of the last one.
      // The linked corners are read from the drag-start document by the first moveRoom call.
      useDoc.getState().updateSilent(() =>
        ids.slice(1).reduce((acc, id) => moveRoom(acc, id, d), moveRoom(base, ids[0], d, linked)))
    },
    onEnd: () => {
      document.body.style.cursor = ''
      // A click (no drag): Shift toggles the room in the group; a plain click on a room
      // of a group selects that room only.
      if (!start) { if (shift) flip(); else if (group) selectRoom(roomId); return }
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

const SCALE_LOCKED_MSG = 'Room has a locked wall. Resize cancelled.'
const CORNER_LOCKED_MSG = 'A wall at this corner is locked.'

/**
 * Drag a corner. Plain drag moves one point (Shift = this room only). Ctrl/Cmd resizes the whole
 * room from the opposite corner (+Shift = uniform). Modifiers are read on every move, so they can be
 * pressed or released during the drag; each move starts again from the drag-start document.
 */
export function onVertexDown(e: ReactPointerEvent, vp: Vp, roomId: string, vertexId: string) {
  if (e.button !== 0 || !e.isPrimary) return
  e.stopPropagation()
  // Shift + click (no drag) toggles the point in the group; Shift + drag is still "this room only".
  const shift = e.shiftKey
  const flip = () => toggle({ kind: 'vertex', roomId, vertexId })
  const group = vertexGroup(roomId, vertexId)
  if (group) { dragVertexGroup(e, vp, roomId, vertexId, group, shift); return }
  const selectMe = () => useUi.getState().select({ kind: 'vertex', roomId, vertexId })
  if (!shift) selectMe()
  const room0 = findRoom(roomId)
  const i = room0 ? room0.vertices.findIndex((v) => v.id === vertexId) : -1
  if (!room0 || i < 0) { if (shift) flip(); return }
  const n = room0.vertices.length
  const orig = room0.vertices[i]
  const prev = room0.vertices[(i - 1 + n) % n], next = room0.vertices[(i + 1) % n]
  const anchor = oppositeVertex(room0, vertexId)
  const down = vp.toWorld(e.clientX, e.clientY)
  const doc0 = useDoc.getState().doc
  // Locked walls: a single point cannot move if a wall at this corner is locked; a resize is
  // refused if any wall of the room is locked (a resize changes every length).
  const pointLocked = locked(room0, i) || locked(room0, i - 1)
  const scaleLocked = roomHasLockedWall(room0)
  // Single point: shared corners at the same place follow.
  const linked = movableLinked(doc0, roomId, vertexId)
  const linkedKeys = new Set(linked.map(refKey))
  // Resize: every neighbour vertex on a linked spot follows the vertex it shares.
  const links: Link[] = room0.vertices.flatMap((v) =>
    movableLinked(doc0, roomId, v.id).map((ref) => ({ ref, source: { roomId, vertexId: v.id } })))
  const linksKeys = new Set(links.map((l) => refKey(l.ref)))
  const affected = [roomId, ...new Set([...linked, ...links.map((l) => l.ref)].map((l) => l.roomId))]
  let start: PlanDoc | null = null
  let last = orig as Vec
  let warned = ''
  const warn = (msg: string, at: Vec) => { if (warned !== msg) { warned = msg; notify(msg, at) } }
  track(e, {
    onStart: () => { if (shift) selectMe(); start = beginDrag(); setDragInfo({ kind: 'vertex', roomId, vertexId }) },
    onMove: (ev) => {
      if (!start) return
      const base = start
      const w = vp.toWorld(ev.clientX, ev.clientY)
      const raw = { x: orig.x + (w.x - down.x), y: orig.y + (w.y - down.y) }
      const ui = useUi.getState()
      if (ev.ctrlKey || ev.metaKey) {
        if (!anchor || scaleLocked) {
          useGuides.getState().set([])
          useDoc.getState().updateSilent(() => base)
          if (scaleLocked) warn(SCALE_LOCKED_MSG, raw)
          return
        }
        const r = snapPoint(raw, {
          opts: { ...ui.snap, angles: false }, tolCm: vp.px(10), disabled: ev.altKey,
          // The room scales, so none of its own vertices (nor the linked ones) are snap targets.
          vertices: otherVertices(base, (rid, vid) => rid === roomId || linksKeys.has(rid + ':' + vid)),
        })
        useGuides.getState().set(r.guides)
        const f = scaleFactors(anchor, orig, r.point, ev.shiftKey)
        last = { x: anchor.x + (orig.x - anchor.x) * f.sx, y: anchor.y + (orig.y - anchor.y) * f.sy }
        useDoc.getState().updateSilent(() => scaleRoomWithLinks(base, roomId, anchor, f, links))
        return
      }
      if (pointLocked) {
        useGuides.getState().set([])
        useDoc.getState().updateSilent(() => base)
        warn(CORNER_LOCKED_MSG, raw)
        return
      }
      const follow = ev.shiftKey ? [] : linked
      const r = snapPoint(raw, {
        opts: ui.snap, refs: [prev, next], tolCm: vp.px(10), disabled: ev.altKey,
        vertices: otherVertices(base, (rid, vid) => (rid === roomId && vid === vertexId) || (!ev.shiftKey && linkedKeys.has(rid + ':' + vid))),
        edges: otherEdges(base, (rid) => rid === roomId),
      })
      useGuides.getState().set(r.guides)
      last = r.point
      const moves: VMove[] = [{ roomId, vertexId, ...r.point }, ...follow.map((l) => ({ ...l, ...r.point }))]
      useDoc.getState().updateSilent(() => moveVertices(base, moves))
    },
    onEnd: () => {
      setDragInfo(null)
      if (!start) { if (shift) flip(); return }
      if (newlyCrossing(start, useDoc.getState().doc, affected)) {
        useDoc.getState().updateSilent(() => start as PlanDoc)
        notify(CROSS_MSG, last)
        return
      }
      endDrag(start)
    },
  })
}

/**
 * Drag one point of a selection group: every selected point moves by the same offset. The
 * dragged point snaps. Shared corners of other points follow (Shift = no followers).
 * A click without a drag selects this point only; Shift + click removes it from the group.
 */
function dragVertexGroup(e: ReactPointerEvent, vp: Vp, roomId: string, vertexId: string, group: VRef[], shift: boolean) {
  const doc0 = useDoc.getState().doc
  const room0 = findRoom(roomId)
  const i = room0?.vertices.findIndex((v) => v.id === vertexId) ?? -1
  if (!room0 || i < 0) return
  const n = room0.vertices.length
  const orig = room0.vertices[i] as Vec
  const prev = room0.vertices[(i - 1 + n) % n], next = room0.vertices[(i + 1) % n]
  // Outline points only, with their start position.
  const pts = group.flatMap((g) => {
    const r = doc0.rooms.find((x) => x.id === g.roomId)
    const k = r ? r.vertices.findIndex((v) => v.id === g.vertexId) : -1
    return r && k >= 0 ? [{ ...g, at: r.vertices[k] as Vec, locked: locked(r, k) || locked(r, k - 1) }] : []
  })
  const anyLocked = pts.some((p) => p.locked)
  const ownKeys = new Set(pts.map(refKey))
  const followersAll = pts.flatMap((p) =>
    movableLinked(doc0, p.roomId, p.vertexId).filter((l) => !ownKeys.has(refKey(l))).map((l) => ({ ref: l, at: p.at })))
  const followKeys = new Set(followersAll.map((f) => refKey(f.ref)))
  const affected = [...new Set([...pts, ...followersAll.map((f) => f.ref)].map((p) => p.roomId))]
  const groupRooms = new Set(pts.map((p) => p.roomId))
  const down = vp.toWorld(e.clientX, e.clientY)
  let start: PlanDoc | null = null
  let last = orig
  let warned = false
  track(e, {
    onStart: () => { start = beginDrag(); setDragInfo({ kind: 'vertex', roomId, vertexId }) },
    onMove: (ev) => {
      if (!start) return
      const base = start
      const w = vp.toWorld(ev.clientX, ev.clientY)
      const raw = { x: orig.x + (w.x - down.x), y: orig.y + (w.y - down.y) }
      if (anyLocked) {
        useDoc.getState().updateSilent(() => base)
        if (!warned) { warned = true; notify(CORNER_LOCKED_MSG, raw) }
        return
      }
      const r = snapPoint(raw, {
        opts: useUi.getState().snap, refs: [prev, next], tolCm: vp.px(10), disabled: ev.altKey,
        vertices: otherVertices(base, (rid, vid) => ownKeys.has(rid + ':' + vid) || (!ev.shiftKey && followKeys.has(rid + ':' + vid))),
        edges: otherEdges(base, (rid) => groupRooms.has(rid)),
      })
      useGuides.getState().set(r.guides)
      last = r.point
      const d = { x: r.point.x - orig.x, y: r.point.y - orig.y }
      const moves: VMove[] = [
        ...pts.map((p) => ({ roomId: p.roomId, vertexId: p.vertexId, x: p.at.x + d.x, y: p.at.y + d.y })),
        ...(ev.shiftKey ? [] : followersAll.map((f) => ({ ...f.ref, x: f.at.x + d.x, y: f.at.y + d.y }))),
      ]
      useDoc.getState().updateSilent(() => moveVertices(base, moves))
    },
    onEnd: () => {
      setDragInfo(null)
      if (!start) {
        if (shift) toggle({ kind: 'vertex', roomId, vertexId })
        else useUi.getState().select({ kind: 'vertex', roomId, vertexId })
        return
      }
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
  // Shift + click (no drag) toggles the wall in the group; Shift + drag is still "this room only".
  const shift = e.shiftKey
  const flip = () => toggle({ kind: 'wall', roomId, wallStart })
  const selectMe = () => useUi.getState().select({ kind: 'wall', roomId, wallStart })
  if (!shift) selectMe()
  const room0 = findRoom(roomId)
  const i = room0 ? room0.vertices.findIndex((v) => v.id === wallStart) : -1
  // Moving a wall changes its neighbours' lengths: a locked neighbour blocks the drag.
  if (!room0 || i < 0 || locked(room0, i - 1) || locked(room0, i + 1)) { if (shift) flip(); return }
  const n = room0.vertices.length
  const aId = room0.vertices[i].id, bId = room0.vertices[(i + 1) % n].id
  const a0 = room0.vertices[i], b0 = room0.vertices[(i + 1) % n]
  const normal = roomWalls(room0)[i].inward
  const axisAligned = Math.abs(normal.x) > 0.999 || Math.abs(normal.y) > 0.999
  const down = vp.toWorld(e.clientX, e.clientY)
  // Shared corners follow (Shift = this room only).
  const doc0 = useDoc.getState().doc
  const linkedAAll = movableLinked(doc0, roomId, aId)
  const linkedBAll = movableLinked(doc0, roomId, bId)
  const linkedKeysAll = new Set([...linkedAAll, ...linkedBAll].map(refKey))
  const affected = [roomId, ...new Set([...linkedAAll, ...linkedBAll].map((l) => l.roomId))]
  let start: PlanDoc | null = null
  let last: Vec = a0
  track(e, {
    onStart: () => { if (shift) selectMe(); start = beginDrag(); setDragInfo({ kind: 'wall', roomId, wallStart }) },
    onMove: (ev) => {
      if (!start) return
      const base = start
      // Shift (this room only) is read on every move, so it can be pressed during the drag.
      const linkedA = ev.shiftKey ? [] : linkedAAll, linkedB = ev.shiftKey ? [] : linkedBAll
      const linkedKeys = ev.shiftKey ? new Set<string>() : linkedKeysAll
      const w = vp.toWorld(ev.clientX, ev.clientY)
      let d = dot({ x: w.x - down.x, y: w.y - down.y }, normal)
      if (!ev.altKey) {
        const ui = useUi.getState()
        const doc = base
        if (axisAligned) {
          const r = snapPoint({ x: a0.x + normal.x * d, y: a0.y + normal.y * d }, {
            opts: { ...ui.snap, angles: false }, tolCm: vp.px(10),
            vertices: otherVertices(doc, (rid, vid) => (rid === roomId && (vid === aId || vid === bId)) || linkedKeys.has(rid + ':' + vid)),
            edges: otherEdges(doc, (rid) => rid === roomId),
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
      useDoc.getState().updateSilent(() => moveVertices(base, moves))
    },
    onEnd: () => {
      setDragInfo(null)
      if (!start) { if (shift) flip(); return }
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
        edges: otherEdges(doc, (rid) => rid === roomId),
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

/**
 * Delete all the rooms or points of a selection group in one undo step. A room keeps at
 * least 3 outline points. Returns false when the selection is not a group.
 */
export function deleteGroup(): boolean {
  const items = selectedItems(useUi.getState())
  if (items.length < 2) return false
  const doc = useDoc.getState().doc
  if (items[0].kind === 'room') {
    const ids = items.flatMap((s) => (s.kind === 'room' ? [s.roomId] : []))
    useDoc.getState().update((d) => ids.reduce((acc, id) => deleteRoom(acc, id), d))
    useUi.getState().select(null)
    undoToast(`${ids.length} rooms deleted`, () => useDoc.temporal.getState().undo())
    return true
  }
  if (items[0].kind === 'vertex') {
    let next = doc
    for (const s of items) {
      if (s.kind !== 'vertex') continue
      const room = next.rooms.find((r) => r.id === s.roomId)
      if (!room) continue
      if (room.vertices.some((v) => v.id === s.vertexId)) {
        if (room.vertices.length > 3) next = removeVertex(next, s.roomId, s.vertexId)
      } else next = removeHoleVertex(next, s.roomId, s.vertexId)
    }
    if (next !== doc) useDoc.getState().update(() => next)
    const primary = useUi.getState().selection
    useUi.getState().select(primary && primary.kind === 'vertex' ? { kind: 'room', roomId: primary.roomId } : null)
    return true
  }
  // Walls: nothing to delete (same as a single wall).
  return true
}

/** Delete key: selected vertex (outline or hole), selected hole, or room. Walls and elements are ignored here. */
export function deleteSelection() {
  if (deleteGroup()) return
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
