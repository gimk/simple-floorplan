// Two-way sync rule of the v2 model (docs/walls-plan.md, phase 5c step 4). Pure, cm, y down.
//
// In a v2 document the walls are the source and `room.vertices` is a CALCULATED view. The tools
// and the commands keep their logic: they build the polygon of a room. This rule joins the two:
//   - rooms changed and walls not -> the polygon of each changed room goes into the wall graph
//     (`applyRoomPolygon`), a removed room goes away with the walls that no other room uses
//     (`removeRoom`), then the survey view is calculated again;
//   - walls or nodes changed       -> the WALLS win: the polygons are calculated again from the
//     graph, and the rooms that a tool wrote are ignored;
//   - both changed                -> the walls win (a drag on the graph moves nodes, and the
//     polygons of every room follow).
// A v1 document is given back unchanged: there the rooms are the source and the stored graph
// follows them (model/graphRule.ts). A document is `schemaVersion: 2` after `ensureV2` on load.
//
// The rule is safe to run twice: `applyRoomPolygon` gives the same document back when the polygon
// and the wall properties did not change, and `materializeDoc` keeps the previous arrays and room
// objects when nothing moved.

import type { PlanDoc, Room } from '../types'
import { deriveWallFaces, materializeRooms } from './materialize'
import { applyRoomPolygon, removeRoom } from './write'

/** Same content, whatever the object (a room that a drag already calculated is not rebuilt). */
const sameRoom = (a: Room, b: Room) => JSON.stringify(a) === JSON.stringify(b)

/**
 * The survey view of a v2 document calculated again from the walls: the faces of each wall come
 * from the room cycles, and the polygon of each room comes from the walls. Gives the same document
 * back when nothing changed, so a drag does not make a new document on every pointer move.
 */
export function materializeDoc(doc: PlanDoc): PlanDoc {
  const walls = deriveWallFaces(doc)
  const withFaces: PlanDoc = walls === doc.walls ? doc : { ...doc, walls }
  const rooms = materializeRooms(withFaces)
  const same = rooms.length === withFaces.rooms.length && rooms.every((r, i) => r === withFaces.rooms[i] || sameRoom(r, withFaces.rooms[i]))
  return same ? withFaces : { ...withFaces, rooms }
}

/**
 * The polygon and the wall properties of a room changed since `was`: the only part that the write
 * path reads. A change of the name, the code or the cycle alone is not a polygon write (the cycle
 * is source data of the graph, and a drag that writes it calculates the view itself).
 */
function polygonChanged(was: Room, now: Room): boolean {
  if (was.vertices === now.vertices && was.walls === now.walls && was.holes === now.holes) return false
  return JSON.stringify([was.vertices, was.walls, was.holes]) !== JSON.stringify([now.vertices, now.walls, now.holes])
}

/** True when the document holds a wall graph (a v2 document always has one after a load). */
const hasGraph = (doc: PlanDoc) => Array.isArray(doc.walls) && Array.isArray(doc.nodes)

/**
 * Keep the walls and the rooms of a v2 document in step (docs/walls-plan.md phase 5c).
 * `prev` is the document before the edit, `next` the edited document. A v1 document, and a
 * document without a wall graph, are given back as they are.
 */
export function v2SyncRule(prev: PlanDoc, next: PlanDoc): PlanDoc {
  if (next === prev) return next
  if (next.schemaVersion !== 2) return next
  if (!hasGraph(next)) return next
  const roomsChanged = next.rooms !== prev.rooms
  const graphChanged = next.walls !== prev.walls || next.nodes !== prev.nodes
  if (!roomsChanged && !graphChanged) return next
  // The walls win: the polygons are a view of the graph.
  if (graphChanged) return materializeDoc(next)

  // ---- rooms changed, walls not: write the polygons into the graph ----
  let doc = next
  const before = new Map(prev.rooms.map((r) => [r.id, r]))
  const nextIds = new Set(next.rooms.map((r) => r.id))
  // A room that is gone: its faces go, and its walls that no other room uses go with it. The write
  // path needs the room (its cycle holds the walls that may go away), so it is put back for that
  // one step.
  for (const r of prev.rooms) {
    if (nextIds.has(r.id)) continue
    const known = doc.rooms.some((x) => x.id === r.id) ? doc : { ...doc, rooms: [...doc.rooms, r] }
    doc = removeRoom(known, r.id)
  }
  // A new room, and a room whose polygon or wall properties changed, go into the graph.
  for (const r of next.rooms) {
    const was = before.get(r.id)
    if (was === r) continue
    if (was && !polygonChanged(was, r)) continue
    doc = applyRoomPolygon(doc, r.id, r)
  }
  return doc
}
