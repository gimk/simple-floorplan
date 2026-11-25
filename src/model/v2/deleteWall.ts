// Delete one wall of a v2 document and let the plan solve the result (pure, cm, y points down).
//
//   1. A locked wall is refused.
//   2. A wall that two rooms share: the two rooms become ONE room (the `merge_rooms` command).
//   3. A wall of one room only: the wall before it and the wall after it are extended on their own
//      lines until they meet at a new corner X. The room is then ...P, X, N... The wall and its two
//      corners go away unless another wall uses a corner (that wall keeps its end).
//      Refused: a locked neighbour, neighbours that are (almost) parallel or meet farther than 10 m,
//      a room with fewer than 3 corners, an outline that crosses itself.
//   4. The doors and windows on the wall go with it. The ones on the two neighbours keep their place.
//   5. A neighbour whose length changed loses its measured value (it goes to the old values).
//   6. A wall that no room uses is removed with the nodes that no wall uses.
//   7. `repairGraph` runs at the end.
// The function does not touch the store: the caller makes ONE undo step with the result.
import { apply } from '../../core/commands'
import { selfIntersects } from '../../features/rooms/crossing'
import { cross, dist, dot, sub } from '../geometry'
import { appendOld } from '../oldMeasurements'
import type { DroppedValue } from '../relabel'
import type { PlanDoc, Room, RoomFace, StoredNode, StoredWall, Vec, WallElement } from '../types'
import { parseWallValueLabel } from '../wallValues'
import { attachElements, syncElements } from './elements'
import { deriveWallFaces, materializeRooms } from './materialize'
import { relabelByTarget } from './relabelV2'
import { repairGraph } from './repair'
import { frameOf, idMaker, nodeMap } from './spans'
import { attachTargets } from './targets'
import { removeWall } from './write'

export type DeleteWallResult = { doc: PlanDoc; message?: string } | { error: string }

/** The two lines meet closer to parallel than this (|sin of the angle|): refused. */
const PARALLEL_SIN = 0.02
/** The new corner is farther than this from the old ones (cm): refused. */
const MAX_REACH_CM = 1000
const PARALLEL_MSG = 'Cannot delete: the walls next to it are parallel. Move the wall or delete the room.'
const END_TOL = 0.01

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** Number of doors, windows and other elements on a wall. */
function elementsOn(doc: PlanDoc, wallId: string, hostRoom?: Room): WallElement[] {
  const cornerIds = new Set((hostRoom?.cycle ?? []).filter((f) => f.wallId === wallId).map((f) => f.cornerId))
  return doc.elements.filter(
    (e) => e.wallId === wallId || (e.wallId === undefined && hostRoom !== undefined && e.roomId === hostRoom.id && cornerIds.has(e.wallStart)),
  )
}

const sharedNode = (a: StoredWall, b: StoredWall): string[] => [a.a, a.b].filter((id) => id === b.a || id === b.b)

export function deleteWall(input: PlanDoc, wallId: string): DeleteWallResult {
  let doc = input
  if (doc.schemaVersion !== 2 || !Array.isArray(doc.nodes) || !Array.isArray(doc.walls)) {
    return { error: 'Cannot delete: this plan has no wall graph yet.' }
  }
  // Every element knows its stored wall (a tool may have placed it with the room view only).
  doc = attachElements(doc)
  const allWalls = doc.walls ?? []
  const allNodes = doc.nodes ?? []
  const wall = allWalls.find((w) => w.id === wallId)
  if (!wall) return { error: 'Cannot delete: the wall is not on the plan.' }
  if (wall.locked) return { error: 'This wall is locked' }

  const users = doc.rooms.filter((r) => (r.cycle ?? []).some((f) => f.wallId === wallId))

  // ---- 6. a wall that no room uses ----
  if (!users.length) {
    const gone = elementsOn(doc, wallId)
    const res = removeWall({ ...doc, elements: doc.elements.filter((e) => !gone.includes(e)) }, wallId)
    if (res.refusedBy.length) return { error: 'Cannot delete this wall.' }
    const out = repairGraph(res.doc).doc
    return { doc: out, message: gone.length ? `Deleted wall and ${plural(gone.length, 'door/window', 'doors/windows')}` : undefined }
  }

  // ---- 2. a wall of two rooms: merge them ----
  if (users.length >= 2) {
    try {
      const res = apply(doc, { type: 'merge_rooms', roomIds: [users[0].id, users[1].id], allowBearingRemoval: true })
      const removed = (res.result as { elementsRemovedOnSharedWall?: unknown[] } | undefined)?.elementsRemovedOnSharedWall?.length ?? 0
      const out = repairGraph(res.doc as PlanDoc).doc
      return { doc: out, message: removed ? `Merged the rooms and deleted ${plural(removed, 'door/window', 'doors/windows')}` : undefined }
    } catch (e) {
      return { error: `Cannot delete: ${e instanceof Error ? e.message : 'the rooms cannot be merged.'}` }
    }
  }

  // ---- 3. a wall of one room ----
  const room = users[0]
  const cycle = room.cycle!
  const n = cycle.length
  const idx = cycle.findIndex((f) => f.wallId === wallId)
  if (cycle.filter((f) => f.wallId === wallId).length !== 1) return { error: 'Cannot delete this wall: the room uses it more than once.' }
  if (n < 4) return { error: 'Cannot delete: the room needs at least 3 corners. Delete the room instead.' }
  const pf = cycle[(idx - 1 + n) % n]
  const nf = cycle[(idx + 1) % n]
  if (pf.wallId === wallId || nf.wallId === wallId || pf.wallId === nf.wallId) return { error: 'Cannot delete this wall: its neighbours are not two other walls.' }
  const PA = allWalls.find((w) => w.id === pf.wallId)
  const BN = allWalls.find((w) => w.id === nf.wallId)
  if (!PA || !BN) return { error: 'Cannot delete this wall: a neighbour is missing.' }
  if (PA.locked || BN.locked) return { error: 'A wall next to it is locked' }
  const sharedA = sharedNode(PA, wall)
  const sharedB = sharedNode(BN, wall)
  const nodeA = sharedA.find((id) => !sharedB.includes(id))
  const nodeB = sharedB.find((id) => id !== nodeA)
  if (!nodeA || !nodeB) return { error: 'Cannot delete this wall: it does not end at two corners.' }

  const pos = nodeMap(allNodes)
  const A = pos.get(nodeA)!
  const B = pos.get(nodeB)!
  const P = pos.get(PA.a === nodeA ? PA.b : PA.a)!
  const N = pos.get(BN.a === nodeB ? BN.b : BN.a)!
  const lenPA = dist(P, A)
  const lenBN = dist(B, N)
  if (lenPA < 1e-6 || lenBN < 1e-6) return { error: PARALLEL_MSG }
  const d1: Vec = { x: (A.x - P.x) / lenPA, y: (A.y - P.y) / lenPA }
  const d2: Vec = { x: (N.x - B.x) / lenBN, y: (N.y - B.y) / lenBN }
  const c = cross(d1, d2)
  if (Math.abs(c) < PARALLEL_SIN) return { error: PARALLEL_MSG }
  const t = cross(sub(B, P), d2) / c
  const X: Vec = { x: P.x + d1.x * t, y: P.y + d1.y * t }
  if (dist(X, A) > MAX_REACH_CM || dist(X, B) > MAX_REACH_CM) return { error: PARALLEL_MSG }
  // The corner must be ahead of P on its wall and before N on the other one.
  const s = dot(sub(X, B), d2)
  if (t < 1e-3 || s > lenBN - 1e-3) return { error: 'Cannot delete: the walls next to it do not meet in front of the room.' }

  const newId = idMaker(doc)
  const nx: StoredNode = { id: newId('N'), x: X.x, y: X.y }
  const moveEnd = (w: StoredWall, from: string): StoredWall => ({ ...w, a: w.a === from ? nx.id : w.a, b: w.b === from ? nx.id : w.b, faces: [] })
  const PA2 = moveEnd(PA, nodeA)
  const BN2 = moveEnd(BN, nodeB)
  const walls = allWalls.filter((w) => w.id !== wallId).map((w) => (w.id === PA.id ? PA2 : w.id === BN.id ? BN2 : w))
  const used = new Set(walls.flatMap((w) => [w.a, w.b]))
  const nodes = [...allNodes, nx].filter((nd) => used.has(nd.id))
  const newPos = nodeMap(nodes)

  // Map a coordinate along a changed wall (old frame -> new frame).
  const remapper = (oldW: StoredWall, newW: StoredWall, replaced: 'a' | 'b') => {
    const f0 = frameOf(pos, oldW)!
    const f1 = frameOf(newPos, newW)!
    return (u: number) => {
      if (replaced === 'a' && Math.abs(u) < END_TOL) return 0
      if (replaced === 'b' && Math.abs(u - f0.length) < END_TOL) return f1.length
      const world = { x: f0.a.x + f0.d.x * u, y: f0.a.y + f0.d.y * u }
      return Math.min(Math.max(dot(sub(world, f1.a), f1.d), 0), f1.length)
    }
  }
  const maps = new Map<string, (u: number) => number>([
    [PA.id, remapper(PA, PA2, PA.a === nodeA ? 'a' : 'b')],
    [BN.id, remapper(BN, BN2, BN.a === nodeB ? 'a' : 'b')],
  ])
  const mapFace = (f: RoomFace): RoomFace => {
    const m = maps.get(f.wallId)
    return m ? { ...f, from: m(f.from), to: m(f.to) } : f
  }
  const rooms = doc.rooms.map((r) => {
    if (!r.cycle) return r
    let cyc = r.cycle.map(mapFace)
    if (r.id === room.id) cyc = cyc.filter((f) => f.wallId !== wallId)
    const ids = cyc.map((f) => f.cornerId)
    const d = r.diagonal
    const a = d && r.vertices[d[0]] ? ids.indexOf(r.vertices[d[0]].id) : -1
    const b = d && r.vertices[d[1]] ? ids.indexOf(r.vertices[d[1]].id) : -1
    return { ...r, cycle: cyc, diagonal: a >= 0 && b >= 0 && a !== b ? ([a, b] as [number, number]) : undefined }
  })
  const gone = elementsOn(doc, wallId, room)
  const elements = doc.elements
    .filter((e) => !gone.includes(e))
    .map((e) => {
      const m = e.wallId ? maps.get(e.wallId) : undefined
      if (!m || e.alongCm === undefined) return e
      const from = m(e.alongCm)
      return { ...e, alongCm: from }
    })

  // The values of a neighbour whose length changed leave the plan (never lost: the old values).
  const now = new Date().toISOString()
  const withT = attachTargets(doc)
  const m: PlanDoc['measurements'] = { ...withT.measurements }
  const dropped: DroppedValue[] = []
  const changed: string[] = []
  for (const [label, v] of Object.entries(m)) {
    const wid = v.target?.wallId ?? parseWallValueLabel(label)?.wallId
    if (wid !== PA.id && wid !== BN.id) continue
    dropped.push({ roomCode: doc.rooms.find((r) => r.id === v.target?.roomId)?.code ?? '', reason: 'wall-split', measurement: v })
    changed.push(label)
    delete m[label]
  }

  const draft: PlanDoc = { ...doc, nodes, walls, rooms, elements, measurements: m }
  const withFaces: PlanDoc = { ...draft, walls: deriveWallFaces(draft) }
  const materialized: PlanDoc = { ...withFaces, rooms: materializeRooms(withFaces) }
  // No room may cross itself now (a room that was simple before).
  for (const r of materialized.rooms) {
    const was = doc.rooms.find((x) => x.id === r.id)
    if (was && !selfIntersects(was.vertices) && selfIntersects(r.vertices)) {
      return { error: 'Cannot delete: the new outline would cross itself.' }
    }
  }
  const synced = syncElements(doc, materialized)
  const relabel = relabelByTarget({ ...doc, measurements: m }, { ...synced, measurements: m }, now, { rawMeasurements: m })
  const measurements = relabel ? relabel.measurements : m
  if (relabel) dropped.push(...relabel.droppedValues)
  const old = appendOld(doc.oldMeasurements, dropped, now)
  const out = attachTargets({ ...synced, measurements, ...(old ? { oldMeasurements: old } : {}) })
  const repaired = repairGraph(out).doc

  const parts: string[] = []
  if (gone.length) parts.push(`Deleted wall and ${plural(gone.length, 'door/window', 'doors/windows')}`)
  if (changed.length) parts.push(`${parts.length ? '' : 'Deleted wall; '}measured lengths changed: ${changed.join(', ')}`)
  return { doc: repaired, message: parts.length ? parts.join('; ') : undefined }
}
