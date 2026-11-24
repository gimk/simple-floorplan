// Pointer interactions of the select tool: vertex drag, corner resize, room drag, wall drag,
// selection, insert, delete.
import type { PointerEvent as ReactPointerEvent } from 'react'
import { dist, dot, projectOnSegment, roomWalls } from '../../model/geometry'
import { inGroup, selectedItems, type SelItem } from '../../model/selection'
import { beginDrag, endDrag, useDoc, useUi } from '../../model/store'
import type { PlanDoc, Room, Selection, Vec } from '../../model/types'
import { selfIntersects } from './crossing'
import { setDragInfo, type DragInfo } from './draginfo'
import { useGuides } from './guides'
import { clearHoleSel, getActiveHole } from './holes'
import { notify } from './notice'
import {
  deleteRoom, insertVertex, moveHoleVertex, movableLinked, moveVertices, removeHole, removeHoleVertex, removeVertex,
  type VMove, type VRef,
} from './ops'
import { snapPoint, snapTranslation } from './snap'
import { deleteTrace } from './traces'
import {
  moveRoom, nearestVertex, oppositeVertex, roomHasLockedWall, scaleFactors, scaleRoomWithLinks, type Link,
} from './transform'
import { undoToast } from '../toast'
import { moveNode, moveRoom as roomMove, moveWall } from '../../model/v2/drag'
import { isV2Doc } from '../../model/v2/targets'
import { deleteStoredWalls } from './cards'
import { storedWallLine } from './hoverTarget'
import { sideOfPoint, wallFaceAcross, wallFaceAt, wallFaceAtPoint } from './wallSides'

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

// ---------- the wall graph of a v2 document ----------
// In a v2 document the walls are the source (docs/walls-plan.md phase 5c), so a drag moves NODES of
// the graph and never a polygon: a corner is a node, a wall is a stored wall, a room is the set of
// the nodes of its walls. The doc rule (model/v2/syncRule.ts) calculates the polygons of every room
// from the graph, so the v1 code below is kept for v1 documents only.

/** Index of the face of a room cycle that starts at a corner, or -1. */
const faceAt = (room: Room, cornerId: string) => (room.cycle ?? []).findIndex((f) => f.cornerId === cornerId)

/**
 * Id of the stored NODE at a room corner: the node that the walls of the two faces at the corner
 * share. Null when the corner is not a node (two faces in line on one wall) or when the walls are
 * not in the graph: the drag then keeps the v1 path.
 */
function nodeAtCorner(doc: PlanDoc, room: Room, cornerId: string): string | null {
  const cycle = room.cycle ?? []
  const k = faceAt(room, cornerId)
  if (k < 0) return null
  const cur = cycle[k]
  const before = cycle[(k + cycle.length - 1) % cycle.length]
  if (cur.wallId === before.wallId) return null
  const walls = doc.walls ?? []
  const a = walls.find((w) => w.id === before.wallId)
  const b = walls.find((w) => w.id === cur.wallId)
  if (!a || !b) return null
  const ids = new Set([a.a, a.b])
  return [b.a, b.b].find((id) => ids.has(id)) ?? null
}

/** Rooms whose polygon follows when these nodes move: the rooms with a face on a wall at a node. */
function roomsOfNodes(doc: PlanDoc, nodeIds: Set<string>): string[] {
  const touching = new Set((doc.walls ?? []).filter((w) => nodeIds.has(w.a) || nodeIds.has(w.b)).map((w) => w.id))
  return doc.rooms.filter((r) => (r.cycle ?? []).some((f) => touching.has(f.wallId))).map((r) => r.id)
}

/** A T junction: a node that lies on a wall that it is not an end of. */
type Junction = { node: string; wall: string }

/** T junctions of a document: the nodes of one wall that end on another wall. */
function junctionsOf(doc: PlanDoc): Junction[] {
  const out: Junction[] = []
  const nodes = doc.nodes ?? []
  for (const wall of doc.walls ?? []) {
    const a = nodes.find((n) => n.id === wall.a)
    const b = nodes.find((n) => n.id === wall.b)
    if (!a || !b) continue
    for (const n of nodes) {
      if (n.id === wall.a || n.id === wall.b) continue
      if (projectOnSegment(n, a, b).distance > 1) continue
      out.push({ node: n.id, wall: wall.id })
    }
  }
  return out
}

/**
 * Put the T junctions back on their walls after a move of the graph: a wall of another room that
 * ends on a wall that moved follows it, so the room that is cut there keeps its corners. A junction
 * that is already on its wall (a translation, most of the time) is not moved: no useless rebuild.
 */
function repairJunctions(before: PlanDoc, after: PlanDoc): PlanDoc {
  let out = after
  for (const j of junctionsOf(before)) {
    const wall = (out.walls ?? []).find((w) => w.id === j.wall)
    const node = (out.nodes ?? []).find((n) => n.id === j.node)
    if (!wall || !node) continue
    const a = (out.nodes ?? []).find((n) => n.id === wall.a)
    const b = (out.nodes ?? []).find((n) => n.id === wall.b)
    if (!a || !b) continue
    const to = projectOnSegment(node, a, b).point
    if (dist(to, node) > 1) out = moveNode(out, j.node, to)
  }
  return out
}

/**
 * A corner drag on the graph of a v2 document: the NODE at the corner moves, so every wall that ends
 * there follows, and the T junctions of the other rooms on those walls slide with them.
 */
export function moveCornerNode(doc: PlanDoc, nodeId: string, to: Vec): PlanDoc {
  return repairJunctions(doc, moveNode(doc, nodeId, to))
}

/** A wall drag on the graph: the stored wall translates, with the T junctions of its other rooms. */
export function moveStoredWall(doc: PlanDoc, wallId: string, delta: Vec): PlanDoc {
  return repairJunctions(doc, moveWall(doc, wallId, delta))
}

/**
 * A room drag on the graph: the nodes of the walls of the rooms move, so the neighbours stretch.
 * `thisRoomOnly` (Shift) keeps the walls that another room also uses, and the room gets its own
 * copies of them; the T junctions of the walls that stay do not move either.
 */
export function moveGraphRooms(doc: PlanDoc, roomIds: string[], delta: Vec, thisRoomOnly: boolean): PlanDoc {
  const moved = roomIds.reduce((acc, id) => roomMove(acc, id, delta, { thisRoomOnly }), doc)
  return repairJunctions(doc, moved)
}

/**
 * Pointer down on a room fill (or its label): select it, then, without `vp`, nothing else
 * (old behaviour). With `vp`, a drag past the 4 px threshold moves the whole room.
 * Shift + click (no drag) adds or removes the room from the selection group; Shift + drag
 * still means "this room only" (in a v2 document it draws a selection box instead). Dragging a room of a group moves every room of the group;
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
  // A v2 document: Shift + drag that starts on a room floor draws a box that ADDS to the selection
  // (SelectTool in ./tools.tsx), so here Shift only toggles the room on a click, and never moves it.
  if (shift && isV2Doc(useDoc.getState().doc)) {
    track(e, {
      onMove: () => {},
      onEnd: (moved) => {
        if (!moved) { flip(); if (useUi.getState().selection) useUi.getState().openInspector() }
      },
    })
    return
  }
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
  // A v2 document: the walls are the source, so the room drag moves the nodes of its walls and the
  // T junctions of the other rooms on them follow (Shift = this room only).
  const graphDrag = isV2Doc(doc0)
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
      // A v2 document: the nodes of the walls of the room move, and the neighbours stretch (a wall
      // between two rooms is one wall). Shift = this room only: a shared wall stays and the room
      // gets its own copy of it.
      useDoc.getState().updateSilent(() =>
        graphDrag
          ? moveGraphRooms(base, ids, d, ev.shiftKey)
          : ids.slice(1).reduce((acc, id) => moveRoom(acc, id, d), moveRoom(base, ids[0], d, linked)))
    },
    onEnd: () => {
      document.body.style.cursor = ''
      // A click (no drag): Shift toggles the room in the group; a plain click on a room
      // of a group selects that room only.
      if (!start) {
        if (shift) flip(); else if (group) selectRoom(roomId)
        if (useUi.getState().selection) useUi.getState().openInspector()
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
  // A v2 document: the corner is a NODE of the wall graph, so the drag moves that node and the
  // walls at the corner follow (the two rooms of a shared wall stay on it). A corner that is not a
  // node (two faces in line on one wall), and Ctrl/Cmd + drag (the room resize), keep the v1 path:
  // the tool writes the polygon and the doc rule writes it into the wall graph.
  const resizing = e.ctrlKey || e.metaKey
  const nodeId = isV2Doc(doc0) && !resizing ? nodeAtCorner(doc0, room0, vertexId) : null
  if (nodeId) { dragCornerNode(e, vp, roomId, vertexId, nodeId, room0, doc0, shift, flip); return }
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

/**
 * Drag the NODE of one corner of a v2 document (docs/walls-plan.md phase 5c). Every wall that ends
 * at that node follows it, so the two rooms of a shared wall keep sharing it. One undo step per
 * drag; each pointer move starts again from the drag-start document.
 */
function dragCornerNode(
  e: ReactPointerEvent, vp: Vp, roomId: string, vertexId: string, nodeId: string, room0: Room, doc0: PlanDoc,
  shift: boolean, flip: () => void,
) {
  const i = room0.vertices.findIndex((v) => v.id === vertexId)
  const n = room0.vertices.length
  const orig = room0.vertices[i] as Vec
  const prev = room0.vertices[(i - 1 + n) % n], next = room0.vertices[(i + 1) % n]
  const down = vp.toWorld(e.clientX, e.clientY)
  // A locked wall at this corner keeps the node where it is.
  const pointLocked = locked(room0, i) || locked(room0, i - 1)
  // The rooms that follow the node: their polygons can become self-intersecting (refused below).
  // The rooms that follow the node: their polygons can become self-intersecting (refused below).
  const affected = roomsOfNodes(doc0, new Set([nodeId]))
  const near = (v: Vec) => dist(v, orig) <= 1
  let start: PlanDoc | null = null
  let last: Vec = orig
  let warned = ''
  const warn = (msg: string, at: Vec) => { if (warned !== msg) { warned = msg; notify(msg, at) } }
  track(e, {
    onStart: () => {
      if (shift) useUi.getState().select({ kind: 'vertex', roomId, vertexId })
      start = beginDrag(); setDragInfo({ kind: 'vertex', roomId, vertexId })
    },
    onMove: (ev) => {
      if (!start) return
      const base = start
      const w = vp.toWorld(ev.clientX, ev.clientY)
      const raw = { x: orig.x + (w.x - down.x), y: orig.y + (w.y - down.y) }
      if (pointLocked) {
        useGuides.getState().set([])
        useDoc.getState().updateSilent(() => base)
        warn(CORNER_LOCKED_MSG, raw)
        return
      }
      // Snap to the other rooms. No vertex on the dragged node itself (its copies in the rooms that
      // share it), and no wall of this room: those turn with the node.
      const r = snapPoint(raw, {
        opts: useUi.getState().snap, refs: [prev, next], tolCm: vp.px(10), disabled: ev.altKey,
        vertices: otherVertices(base).filter((v) => !near(v)),
        edges: otherEdges(base, (rid) => rid === roomId),
      })
      useGuides.getState().set(r.guides)
      last = r.point
      useDoc.getState().updateSilent(() => moveCornerNode(base, nodeId, r.point))
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

/** A length below this is zero on the plan (cm): the two ends of a wall are closer than this. */
const END_TOL_CM = 1

/** What stays the same from the pointer down to the pointer up of one drag of a stored wall. */
type StoredWallDrag = {
  /** The wall that moves. */
  wallId: string
  /** World point of node a at the start: the wall moves from it, along its normal. */
  a0: Vec
  /** World point of the pointer at the start. */
  down: Vec
  /** Unit normal of the wall: the wall slides along this line only. */
  normal: Vec
  /** True for a horizontal or vertical wall: it snaps to the other walls (any other wall: grid). */
  axisAligned: boolean
  /** Rooms whose vertices and edges are not snap targets (the rooms that use this wall). */
  excludeRooms: Set<string>
  /** The two ends of the wall: they move with it, so they are not snap targets. */
  excludePoints: Vec[]
  /** Dimension labels of the walls attached to the drag (see ./draginfo.ts). */
  info?: DragInfo
}

/** What a click on a stored wall does, at the end of the pointer sequence. */
type WallClickHooks = {
  /** Shift + drag: the wall is selected, and the drag starts. */
  onShiftDrag?: () => void
  /** Shift + click without a drag. */
  onShiftClick?: () => void
  /** Plain click without a drag. */
  onPlainClick?: () => void
}

/**
 * Drag one stored WALL of a v2 document: its two nodes move, so the rooms on both sides follow
 * (one wall, two faces) and the walls at its ends stretch. One undo step for the whole drag, and
 * the same snapping as a room wall drag. A wall that no room uses (a single wall, or a wall left
 * by a deleted room) takes the same path. Shift = this room only does not apply here: a stored
 * wall belongs to both of its rooms.
 */
function dragStoredWallOnGraph(e: ReactPointerEvent, vp: Vp, o: StoredWallDrag, shift: boolean, hooks: WallClickHooks) {
  const doc0 = useDoc.getState().doc
  const wall = (doc0.walls ?? []).find((w) => w.id === o.wallId)
  if (!wall) { if (shift) hooks.onShiftClick?.(); else hooks.onPlainClick?.(); return }
  const wallLocked = !!wall.locked
  const affected = roomsOfNodes(doc0, new Set([wall.a, wall.b]))
  const atEnd = (p: Vec) => o.excludePoints.some((q) => dist(p, q) <= END_TOL_CM)
  let start: PlanDoc | null = null
  let last: Vec = o.a0
  let warned = false
  track(e, {
    onStart: () => {
      if (shift) hooks.onShiftDrag?.()
      start = beginDrag()
      if (o.info) setDragInfo(o.info)
    },
    onMove: (ev) => {
      if (!start) return
      const base = start
      if (wallLocked) {
        useGuides.getState().set([])
        useDoc.getState().updateSilent(() => base)
        // Say it once per drag: a wall that does not move must not look broken.
        if (!warned) { warned = true; notify(`Wall ${o.wallId} is locked.`, o.a0) }
        return
      }
      const w = vp.toWorld(ev.clientX, ev.clientY)
      let d = dot({ x: w.x - o.down.x, y: w.y - o.down.y }, o.normal)
      if (!ev.altKey) {
        const ui = useUi.getState()
        if (o.axisAligned) {
          // Snap the wall to the walls of the other rooms (the same as a v1 wall drag).
          const r = snapPoint({ x: o.a0.x + o.normal.x * d, y: o.a0.y + o.normal.y * d }, {
            opts: { ...ui.snap, angles: false }, tolCm: vp.px(10),
            vertices: otherVertices(base).filter((p) => !atEnd(p)),
            edges: otherEdges(base, (rid) => o.excludeRooms.has(rid)),
          })
          useGuides.getState().set(r.guides)
          d = dot({ x: r.point.x - o.a0.x, y: r.point.y - o.a0.y }, o.normal)
        } else if (ui.snap.grid && ui.snap.gridCm > 0) {
          d = Math.round(d / ui.snap.gridCm) * ui.snap.gridCm
        }
      } else useGuides.getState().set([])
      last = { x: o.a0.x + o.normal.x * d, y: o.a0.y + o.normal.y * d }
      const delta = { x: o.normal.x * d, y: o.normal.y * d }
      useDoc.getState().updateSilent(() => moveStoredWall(base, o.wallId, delta))
    },
    onEnd: () => {
      setDragInfo(null)
      if (!start) {
        if (shift) hooks.onShiftClick?.(); else hooks.onPlainClick?.()
        if (useUi.getState().selection) useUi.getState().openInspector()
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

/** Rooms that have a face on one side of a stored wall (their walls are not snap targets). */
function roomsOnWall(doc: PlanDoc, wallId: string): Set<string> {
  const out = new Set<string>()
  for (const r of doc.rooms) for (const f of r.cycle ?? []) if (f.wallId === wallId) out.add(r.id)
  for (const f of (doc.walls ?? []).find((w) => w.id === wallId)?.faces ?? []) {
    if (f.roomId !== undefined) out.add(f.roomId)
  }
  return out
}

/**
 * What a pointer down on a stored wall does, before the drag. Pure (no store, no pointer
 * tracking), so the rule is tested alone:
 *   - a plain click selects the FACE under the pointer (a room face, or an outside span) with its
 *     side: a wall with 2 faces on each side gives 4 things to pick;
 *   - a plain click on the face that is already selected shows the face directly ACROSS, on the
 *     other side, at the same position along the wall (`flip`): that is how the user picks
 *     either side at will. A side with no face there (a single wall) selects the side alone;
 *   - Shift + click gives the WALL as a group item (`group`): the caller adds it to the selection
 *     group, or removes it when it is there already, the same as for rooms.
 */
export function storedWallDownAction(args: {
  doc: Pick<PlanDoc, 'rooms' | 'nodes' | 'walls' | 'measurements'>
  wallId: string
  side: 'L' | 'R'
  prev: Selection
  shift: boolean
  /** World point of the pointer: it gives the face under the click. */
  at: Vec
}): { select: Selection | null; group: SelItem | null; flip: boolean } {
  const { doc, wallId, side, prev, shift, at } = args
  if (shift) return { select: null, group: { kind: 'storedWall', wallId }, flip: false }
  const pick = wallFaceAtPoint(doc, wallId, at)
  const same = prev?.kind === 'storedWall' && prev.wallId === wallId
    && (pick ? prev.face === pick.key : prev.face === undefined && prev.side === side)
  const select: Selection = pick
    ? { kind: 'storedWall', wallId, side: pick.side, face: pick.key }
    : { kind: 'storedWall', wallId, side }
  return { select: same ? null : select, group: null, flip: same }
}

/**
 * Pointer down on ONE stored wall: the single hit area of the wall graph (features/rooms/
 * WallsLayer.tsx, docs/walls-plan.md "Walls in the interface"). The side comes from the half of
 * the wall under the pointer, so the user selects either side at will. Then the wall drags on the
 * graph, with one undo step per drag, also when no room uses the wall.
 */
export function onStoredWallDown(e: ReactPointerEvent, vp: Vp, wallId: string) {
  if (e.button !== 0 || !e.isPrimary) return
  e.stopPropagation()
  const doc0 = useDoc.getState().doc
  const line = storedWallLine(doc0, wallId)
  if (!line) return
  const down = vp.toWorld(e.clientX, e.clientY)
  const side = sideOfPoint(line.a, line.b, down) ?? 'L'
  const shift = e.shiftKey
  const action = storedWallDownAction({ doc: doc0, wallId, side, prev: useUi.getState().selection, shift, at: down })
  if (action.select) useUi.getState().select(action.select)
  const selectMe = () => useUi.getState().select({ kind: 'storedWall', wallId, side })
  // The face across the wall, at the position of the click: the second click on a face shows it.
  const across = () => {
    const pick = wallFaceAcross(doc0, wallId, down)
    useUi.getState().select(pick
      ? { kind: 'storedWall', wallId, side: pick.side, face: pick.key }
      : { kind: 'storedWall', wallId, side: side === 'L' ? 'R' : 'L' })
  }
  dragStoredWallOnGraph(
    e, vp,
    {
      wallId,
      a0: line.a,
      down,
      normal: normalOf(line.a, line.b),
      axisAligned: axisAlignedOf(line.a, line.b),
      excludeRooms: roomsOnWall(doc0, wallId),
      excludePoints: [line.a, line.b],
    },
    shift,
    {
      onShiftDrag: selectMe,
      // Shift + click: the wall joins the selection group, or leaves it.
      onShiftClick: () => (action.group ? toggle(action.group) : selectMe()),
      onPlainClick: () => { if (action.flip) across() },
    },
  )
}

/** Unit normal of a wall: the direction a wall drag moves it along. */
function normalOf(a: Vec, b: Vec): Vec {
  const len = dist(a, b)
  return len < 1e-6 ? { x: 0, y: -1 } : { x: -(b.y - a.y) / len, y: (b.x - a.x) / len }
}

/** True for a horizontal or vertical wall: it snaps to the other walls, like a room wall. */
function axisAlignedOf(a: Vec, b: Vec): boolean {
  const n = normalOf(a, b)
  return Math.abs(n.x) > 0.999 || Math.abs(n.y) > 0.999
}

/**
 * Pointer down on one END of a stored wall (the handle of a selected single wall): the NODE moves, so
 * the wall that ends there gets longer or shorter on the plan and the walls at that node stretch.
 * One undo step for the whole drag, with the snapping of a corner drag (docs/walls-plan.md, "Walls
 * in the interface"). A locked wall at the node keeps it where it is, and says so.
 */
export function onStoredNodeDown(e: ReactPointerEvent, vp: Vp, nodeId: string, wallId?: string) {
  if (e.button !== 0 || !e.isPrimary) return
  e.stopPropagation()
  const doc0 = useDoc.getState().doc
  const node = (doc0.nodes ?? []).find((n) => n.id === nodeId)
  if (!node) return
  const orig: Vec = { x: node.x, y: node.y }
  const wallsAtNode = (doc0.walls ?? []).filter((w) => w.a === nodeId || w.b === nodeId)
  // A locked wall at this node cannot change its length by a handle drag.
  const lockedWall = wallsAtNode.find((w) => w.locked)
    ?? (doc0.walls ?? []).find((w) => w.id === wallId && w.locked)
  const affected = roomsOfNodes(doc0, new Set([nodeId]))
  const down = vp.toWorld(e.clientX, e.clientY)
  // The other ends of the walls at this node: the directions that a drag can line up with.
  const refs: Vec[] = wallsAtNode.flatMap((w) => {
    const other = (doc0.nodes ?? []).find((n) => n.id === (w.a === nodeId ? w.b : w.a))
    return other ? [{ x: other.x, y: other.y }] : []
  })
  let start: PlanDoc | null = null
  let last: Vec = orig
  let warned = false
  track(e, {
    onStart: () => { start = beginDrag() },
    onMove: (ev) => {
      if (!start) return
      const base = start
      const w = vp.toWorld(ev.clientX, ev.clientY)
      const raw = { x: orig.x + (w.x - down.x), y: orig.y + (w.y - down.y) }
      if (lockedWall) {
        useGuides.getState().set([])
        useDoc.getState().updateSilent(() => base)
        if (!warned) { warned = true; notify(`Wall ${lockedWall.id} is locked.`, raw) }
        return
      }
      // Snap to the other rooms. The point itself is out of the snap set (its copies in the rooms
      // that share it are at the same place), and so are the walls of those rooms: they turn or
      // stretch with the node.
      const r = snapPoint(raw, {
        opts: useUi.getState().snap, refs, tolCm: vp.px(10), disabled: ev.altKey,
        vertices: otherVertices(base).filter((p) => dist(p, orig) > 1),
        edges: otherEdges(base, (rid) => affected.includes(rid)),
      })
      useGuides.getState().set(r.guides)
      last = r.point
      useDoc.getState().updateSilent(() => moveCornerNode(base, nodeId, r.point))
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

/**
 * Double click on a stored wall: add a vertex to the room of the clicked side, at the point of the
 * click. Nothing happens when that side has no room there (outside, or a wall that no room uses).
 */
export function onStoredWallDouble(e: { clientX: number; clientY: number }, vp: Vp, wallId: string) {
  const doc = useDoc.getState().doc
  const line = storedWallLine(doc, wallId)
  if (!line) return
  const w = vp.toWorld(e.clientX, e.clientY)
  const side = sideOfPoint(line.a, line.b, w) ?? 'L'
  const face = wallFaceAt(doc, wallId, side, w)
  if (!face) return
  onWallDouble(e, vp, face.roomId, face.wallStart)
}

/**
 * A v1 document: pointer down on a wall of a room (the per-room hit areas of RoomsLayer). A v2
 * document has ONE hit area per stored wall, so it uses `onStoredWallDown` instead.
 */
export function onWallDown(e: ReactPointerEvent, vp: Vp, roomId: string, wallStart: string) {
  if (e.button !== 0 || !e.isPrimary) return
  e.stopPropagation()
  const doc0 = useDoc.getState().doc
  const room0 = findRoom(roomId)
  // Shift + click (no drag) toggles the wall in the group; Shift + drag is still "this room only".
  const shift = e.shiftKey
  const flip = () => toggle({ kind: 'wall', roomId, wallStart })
  const selectMe = () => useUi.getState().select({ kind: 'wall', roomId, wallStart })
  if (!shift) selectMe()
  const i = room0 ? room0.vertices.findIndex((v) => v.id === wallStart) : -1
  // Moving a wall changes its neighbours' lengths: a locked neighbour blocks the drag.
  if (!room0 || i < 0 || locked(room0, i - 1) || locked(room0, i + 1)) { if (shift) flip(); return }
  const n = room0.vertices.length
  const aId = room0.vertices[i].id, bId = room0.vertices[(i + 1) % n].id
  const a0 = room0.vertices[i], b0 = room0.vertices[(i + 1) % n]
  const normal = roomWalls(room0)[i].inward
  const axisAligned = Math.abs(normal.x) > 0.999 || Math.abs(normal.y) > 0.999
  const down = vp.toWorld(e.clientX, e.clientY)
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
  if (items[0].kind === 'storedWall') {
    // Stored walls: one undo step. A wall that a room uses stays, and the toast says which.
    deleteStoredWalls(items.flatMap((s) => (s.kind === 'storedWall' ? [s.wallId] : [])))
    return true
  }
  // Room walls (a v1 document): nothing to delete (same as a single wall).
  return true
}

/** Delete key: selected vertex (outline or hole), selected hole, or room. Walls and elements are ignored here. */
export function deleteSelection() {
  if (deleteGroup()) return
  const sel = useUi.getState().selection
  if (!sel) return
  const doc = useDoc.getState().doc
  if (sel.kind === 'trace') {
    // A traced wall of the Wall tool (docs/walls-plan.md phase 6).
    if (!(doc.traces ?? []).some((t) => t.id === sel.id)) return
    useDoc.getState().update((d) => deleteTrace(d, sel.id))
    useUi.getState().select(null)
    undoToast('Traced wall deleted', () => useDoc.temporal.getState().undo())
  } else if (sel.kind === 'vertex') {
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
