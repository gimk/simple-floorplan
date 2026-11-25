// Pure document actions for built-in storage rooms (docs/storage-plan.md).
// Works for both v1 (room polygons as source) and v2 (nodes, walls, room.cycle as source).
import polygonClipping from 'polygon-clipping'
import {
  DEFAULT_WALL_CM, area, cross, dist, dot, norm, projectOnSegment, roomWalls, signedArea, sub, wallByStart,
} from '../../model/geometry'
import { nowIso, uid } from '../../model/store'
import { nextRoomCode } from '../../model/survey'
import type { PlanDoc, Room, RoomFace, StoredNode, StoredWall, Vec, WallElement, WallProps } from '../../model/types'
import { syncElements } from '../../model/v2/elements'
import { deriveWallFaces, materializeRooms, roomFaceForward, roundStored, storedWallProps } from '../../model/v2/materialize'
import { maxWalkOrder } from '../rooms/ops'
import { readStorageParams, storageCorners, type StorageDoor, type StorageParams } from './geometry'

export type { StorageDoor, StorageParams }

const FIT_TOL_CM = 0.01
const NODE_SNAP_CM = 0.5
const OVERLAP_AREA_TOL_CM2 = 1

const isV2 = (doc: Pick<PlanDoc, 'rooms' | 'schemaVersion'>) =>
  doc.schemaVersion === 2 || doc.rooms.some((r) => (r.cycle?.length ?? 0) > 0)

function validateParams(p: StorageParams): string | null {
  if (
    !Number.isFinite(p.offsetCm) ||
    !Number.isFinite(p.widthCm) ||
    !Number.isFinite(p.depthCm) ||
    !Number.isFinite(p.sideCm) ||
    !Number.isFinite(p.backCm)
  ) {
    return 'Invalid storage dimensions'
  }
  if (p.widthCm <= 0 || p.depthCm <= 0 || p.sideCm <= 0 || p.backCm <= 0 || p.offsetCm < 0) {
    return 'Storage width and depth must be positive'
  }
  return null
}

function toClipRing(pts: Vec[]): [number, number][] {
  return pts.map((p) => [p.x, p.y])
}

function overlapsAnyRoom(doc: PlanDoc, poly: Vec[], excludeRoomId?: string): boolean {
  const ring = toClipRing(poly)
  for (const r of doc.rooms) {
    if (r.id === excludeRoomId || r.vertices.length < 3) continue
    try {
      const inter = polygonClipping.intersection([ring], [toClipRing(r.vertices)])
      for (const p of inter) {
        const outer = p[0]?.slice(0, -1).map(([x, y]) => ({ x, y })) ?? []
        if (outer.length >= 3 && area(outer) > OVERLAP_AREA_TOL_CM2) return true
      }
    } catch {
      // Ignore degenerate polygon clipping errors
    }
  }
  return false
}

function makeIdGenerator(doc: Pick<PlanDoc, 'nodes' | 'walls' | 'rooms'>): (prefix: string) => string {
  const used = new Set<string>()
  for (const n of doc.nodes ?? []) used.add(n.id)
  for (const w of doc.walls ?? []) used.add(w.id)
  for (const r of doc.rooms) {
    used.add(r.id)
    for (const v of r.vertices) used.add(v.id)
    for (const f of r.cycle ?? []) used.add(f.cornerId)
  }
  const counters = new Map<string, number>()
  return (prefix: string) => {
    let k = counters.get(prefix) ?? 0
    let id = ''
    do {
      k++
      id = `${prefix}${k}`
    } while (used.has(id))
    counters.set(prefix, k)
    used.add(id)
    return id
  }
}

function remapDiagonal(old: Room, newIds: string[], oldCornerIds: string[]): [number, number] | undefined {
  if (!old.diagonal) return undefined
  const [i, j] = old.diagonal
  const aId = oldCornerIds[i]
  const bId = oldCornerIds[j]
  const na = aId ? newIds.indexOf(aId) : -1
  const nb = bId ? newIds.indexOf(bId) : -1
  return na >= 0 && nb >= 0 && na !== nb ? [na, nb] : undefined
}

function findV1HostWall(doc: PlanDoc, storageRoom: Room): string | null {
  const parent = doc.rooms.find((r) => r.id === storageRoom.storage?.parentRoomId)
  if (!parent || storageRoom.vertices.length < 2) return null
  const [A, B] = storageRoom.vertices
  const dir = norm(sub(B, A))
  for (const w of roomWalls(parent)) {
    if (dot(w.dir, dir) < 0.99) continue
    if (projectOnSegment(A, w.start, w.end).distance < 1 && projectOnSegment(B, w.start, w.end).distance < 1) {
      return w.start.id
    }
  }
  return null
}

function findFrontDoor(doc: PlanDoc, storageRoom: Room): WallElement | undefined {
  const parentId = storageRoom.storage?.parentRoomId
  if (!parentId) return undefined
  if (isV2(doc) && storageRoom.cycle?.length) {
    const frontWallId = storageRoom.cycle[0].wallId
    return doc.elements.find(
      (e) => e.roomId === parentId && e.wallId === frontWallId && (e.kind === 'door' || e.kind === 'opening'),
    )
  }
  const wallStart = findV1HostWall(doc, storageRoom)
  const params = readStorageParams(doc, storageRoom)
  if (!wallStart || !params) return undefined
  return doc.elements.find(
    (e) =>
      e.roomId === parentId &&
      e.wallStart === wallStart &&
      (e.kind === 'door' || e.kind === 'opening') &&
      Math.abs(e.offsetCm - params.offsetCm) < 1 &&
      Math.abs(e.widthCm - params.widthCm) < 1,
  )
}

type PreserveMeta = {
  id: string
  code: string
  name: string
  walkOrder: number
}

function addStorageImpl(
  doc: PlanDoc,
  parentRoomId: string,
  hostWall: string,
  params: StorageParams,
  door: StorageDoor,
  preserve?: PreserveMeta,
): { doc: PlanDoc; storageRoomId: string } | { error: string } {
  const err = validateParams(params)
  if (err) return { error: err }

  const parent = doc.rooms.find((r) => r.id === parentRoomId)
  if (!parent) return { error: 'Parent room not found' }

  if (!isV2(doc)) {
    return addStorageV1(doc, parent, hostWall, params, door, preserve)
  }
  return addStorageV2(doc, parent, hostWall, params, door, preserve)
}

function addStorageV1(
  doc: PlanDoc,
  parent: Room,
  hostWall: string,
  p: StorageParams,
  door: StorageDoor,
  preserve?: PreserveMeta,
): { doc: PlanDoc; storageRoomId: string } | { error: string } {
  const w = wallByStart(parent, hostWall)
  if (!w) return { error: 'Host wall not found' }

  const tA = p.offsetCm - p.sideCm / 2
  const tB = p.offsetCm + p.widthCm + p.sideCm / 2
  if (tA < -FIT_TOL_CM || tB > w.length + FIT_TOL_CM) {
    return { error: 'Storage does not fit on the host wall' }
  }

  const hostProps: WallProps = parent.walls[hostWall] ?? { type: 'partition', thicknessCm: DEFAULT_WALL_CM }
  const { A, B, C, D } = storageCorners(w.start, w.end, w.inward, hostProps.thicknessCm, p)
  if (overlapsAnyRoom(doc, [A, B, C, D])) {
    return { error: 'Storage overlaps another room' }
  }

  const storageRoomId = preserve?.id ?? uid('room')
  const code = preserve?.code ?? nextRoomCode(doc)
  const vIds = [uid('v'), uid('v'), uid('v'), uid('v')]
  const storageRoom: Room = {
    id: storageRoomId,
    code,
    name: preserve?.name ?? 'Storage',
    vertices: [
      { id: vIds[0], x: roundStored(A.x), y: roundStored(A.y) },
      { id: vIds[1], x: roundStored(B.x), y: roundStored(B.y) },
      { id: vIds[2], x: roundStored(C.x), y: roundStored(C.y) },
      { id: vIds[3], x: roundStored(D.x), y: roundStored(D.y) },
    ],
    holes: [],
    walls: {
      [vIds[0]]: { ...hostProps },
      [vIds[1]]: { type: 'partition', thicknessCm: p.sideCm },
      [vIds[2]]: { type: 'partition', thicknessCm: p.backCm },
      [vIds[3]]: { type: 'partition', thicknessCm: p.sideCm },
    },
    walkOrder: preserve?.walkOrder ?? maxWalkOrder(doc) + 1,
    diagonal: [0, 2],
    storage: { parentRoomId: parent.id },
  }

  const ts = nowIso()
  const frontDoor: WallElement = {
    id: uid('el'),
    roomId: parent.id,
    wallStart: hostWall,
    kind: door === 'none' ? 'opening' : 'door',
    ...(door === 'none' ? {} : { variant: door }),
    offsetCm: roundStored(p.offsetCm),
    widthCm: roundStored(p.widthCm),
    swing: 'in',
    createdAt: ts,
    updatedAt: ts,
  }

  return {
    doc: {
      ...doc,
      rooms: [...doc.rooms, storageRoom],
      elements: [...doc.elements, frontDoor],
    },
    storageRoomId,
  }
}

function addStorageV2(
  doc: PlanDoc,
  parent: Room,
  hostWall: string,
  p: StorageParams,
  door: StorageDoor,
  preserve?: PreserveMeta,
): { doc: PlanDoc; storageRoomId: string } | { error: string } {
  const walls = doc.walls ?? []
  const nodes = doc.nodes ?? []
  const w = walls.find((x) => x.id === hostWall)
  if (!w) return { error: 'Host wall not found' }
  const parentFace = parent.cycle?.find((f) => f.wallId === hostWall)
  if (!parentFace) return { error: 'Host wall does not belong to parent room' }

  const na = nodes.find((n) => n.id === w.a)
  const nb = nodes.find((n) => n.id === w.b)
  if (!na || !nb) return { error: 'Host wall nodes missing' }

  const wallLen = dist(na, nb)
  if (wallLen < 1e-6) return { error: 'Host wall has zero length' }

  const pw = wallByStart(parent, parentFace.cornerId)
  if (!pw) return { error: 'Host wall geometry missing' }

  const faceFrom = Math.min(parentFace.from, parentFace.to)
  const faceTo = Math.max(parentFace.from, parentFace.to)
  const faceLen = faceTo - faceFrom

  const tA_face = p.offsetCm - p.sideCm / 2
  const tB_face = p.offsetCm + p.widthCm + p.sideCm / 2
  if (tA_face < -FIT_TOL_CM || tB_face > faceLen + FIT_TOL_CM) {
    return { error: 'Storage does not fit on the host wall' }
  }
  const clampedA = Math.max(0, tA_face)
  const clampedB = Math.min(faceLen, tB_face)

  const h = w.thicknessCm ?? DEFAULT_WALL_CM
  const { A, B, C, D } = storageCorners(pw.start, pw.end, pw.inward, h, p)
  if (overlapsAnyRoom(doc, [A, B, C, D])) {
    return { error: 'Storage overlaps another room' }
  }

  const newId = makeIdGenerator(doc)
  const forward = roomFaceForward(parent, parentFace)
  const faceStart = forward > 0 ? faceFrom : faceTo
  const uA = faceStart + forward * clampedA
  const uB = faceStart + forward * clampedB
  let uLo = roundStored(Math.max(0, Math.min(uA, uB)))
  let uHi = roundStored(Math.min(wallLen, Math.max(uA, uB)))

  const unitW = norm(sub(nb, na))
  const atStart = uLo <= NODE_SNAP_CM
  const atEnd = uHi >= wallLen - NODE_SNAP_CM
  if (atStart) uLo = 0
  if (atEnd) uHi = roundStored(wallLen)

  const nextNodes: StoredNode[] = [...nodes]
  let nLoId = w.a
  if (!atStart) {
    nLoId = newId('N')
    nextNodes.push({ id: nLoId, x: roundStored(na.x + unitW.x * uLo), y: roundStored(na.y + unitW.y * uLo) })
  }
  let nHiId = w.b
  if (!atEnd) {
    nHiId = newId('N')
    nextNodes.push({ id: nHiId, x: roundStored(na.x + unitW.x * uHi), y: roundStored(na.y + unitW.y * uHi) })
  }

  type Piece = { id: string; a: string; b: string; from: number; to: number }
  const pieces: Piece[] = []
  if (!atStart) {
    pieces.push({ id: w.id, a: w.a, b: nLoId, from: 0, to: uLo })
  }
  const frontWallId = atStart ? w.id : newId('W')
  pieces.push({ id: frontWallId, a: nLoId, b: nHiId, from: uLo, to: uHi })
  if (!atEnd) {
    pieces.push({ id: newId('W'), a: nHiId, b: w.b, from: uHi, to: roundStored(wallLen) })
  }

  const splitWalls: StoredWall[] = pieces.map((pc) => ({ ...w, id: pc.id, a: pc.a, b: pc.b, faces: [] }))
  const nextWalls: StoredWall[] = walls.flatMap((x) => (x.id === w.id ? splitWalls : [x]))

  // Add outer nodes C, D and the 3 storage walls B-C, C-D, D-A
  const nCId = newId('N')
  const nDId = newId('N')
  nextNodes.push(
    { id: nCId, x: roundStored(C.x), y: roundStored(C.y) },
    { id: nDId, x: roundStored(D.x), y: roundStored(D.y) },
  )
  const nAId = forward > 0 ? nLoId : nHiId
  const nBId = forward > 0 ? nHiId : nLoId
  const wRightId = newId('W')
  const wBackId = newId('W')
  const wLeftId = newId('W')
  nextWalls.push(
    { id: wRightId, a: nBId, b: nCId, faces: [], type: 'partition', thicknessCm: p.sideCm },
    { id: wBackId, a: nCId, b: nDId, faces: [], type: 'partition', thicknessCm: p.backCm },
    { id: wLeftId, a: nDId, b: nAId, faces: [], type: 'partition', thicknessCm: p.sideCm },
  )

  // Update every room cycle that referenced the split wall
  let frontCornerId = parentFace.cornerId
  const nextRooms: Room[] = doc.rooms.map((r) => {
    if (!r.cycle?.some((f) => f.wallId === w.id)) return r
    const oldCorners = r.cycle.map((f) => f.cornerId)
    const newCycle: RoomFace[] = []
    for (const f of r.cycle) {
      if (f.wallId !== w.id) {
        newCycle.push(f)
        continue
      }
      const fFrom = Math.min(f.from, f.to)
      const fTo = Math.max(f.from, f.to)
      const fwd = roomFaceForward(r, f)
      const overlapping = pieces.filter((pc) => Math.min(fTo, pc.to) - Math.max(fFrom, pc.from) > 1e-4)
      const ordered = fwd > 0 ? overlapping : [...overlapping].reverse()
      ordered.forEach((pc, idx) => {
        const cornerId = idx === 0 ? f.cornerId : newId('v')
        if (r.id === parent.id && pc.id === frontWallId) frontCornerId = cornerId
        newCycle.push({
          wallId: pc.id,
          side: f.side,
          from: roundStored(Math.max(fFrom, pc.from) - pc.from),
          to: roundStored(Math.min(fTo, pc.to) - pc.from),
          cornerId,
        })
      })
    }
    return {
      ...r,
      cycle: newCycle,
      diagonal: remapDiagonal(r, newCycle.map((f) => f.cornerId), oldCorners),
    }
  })

  // Update existing elements on the split wall so they keep their real position
  const nextElements: WallElement[] = doc.elements.map((el) => {
    if (el.wallId !== w.id || el.alongCm === undefined) return el
    const mid = el.alongCm + el.widthCm / 2
    const pc =
      pieces.find((x) => mid >= x.from - 1e-4 && mid <= x.to + 1e-4) ??
      pieces.reduce((best, x) =>
        Math.abs(mid - (x.from + x.to) / 2) < Math.abs(mid - (best.from + best.to) / 2) ? x : best,
      )
    return {
      ...el,
      wallId: pc.id,
      alongCm: roundStored(Math.max(0, el.alongCm - pc.from)),
    }
  })

  // Build storage room cycle A-B-C-D
  const storageRoomId = preserve?.id ?? uid('room')
  const code = preserve?.code ?? nextRoomCode(doc)
  const storageFrontSide: 'L' | 'R' = parentFace.side === 'L' ? 'R' : 'L'
  const newWallSide: 'L' | 'R' = signedArea([A, B, C, D]) >= 0 ? 'L' : 'R'
  const storageCycle: RoomFace[] = [
    { wallId: frontWallId, side: storageFrontSide, from: 0, to: roundStored(uHi - uLo), cornerId: newId('v') },
    { wallId: wRightId, side: newWallSide, from: 0, to: roundStored(dist(B, C)), cornerId: newId('v') },
    { wallId: wBackId, side: newWallSide, from: 0, to: roundStored(dist(C, D)), cornerId: newId('v') },
    { wallId: wLeftId, side: newWallSide, from: 0, to: roundStored(dist(D, A)), cornerId: newId('v') },
  ]
  const storageRoom: Room = {
    id: storageRoomId,
    code,
    name: preserve?.name ?? 'Storage',
    vertices: [],
    cycle: storageCycle,
    holes: [],
    walls: {},
    walkOrder: preserve?.walkOrder ?? maxWalkOrder(doc) + 1,
    diagonal: [0, 2],
    storage: { parentRoomId: parent.id },
  }

  const ts = nowIso()
  const frontDoor: WallElement = {
    id: uid('el'),
    roomId: parent.id,
    wallStart: frontCornerId,
    wallId: frontWallId,
    alongCm: roundStored(p.sideCm / 2),
    kind: door === 'none' ? 'opening' : 'door',
    ...(door === 'none' ? {} : { variant: door }),
    offsetCm: roundStored(p.sideCm / 2),
    widthCm: roundStored(p.widthCm),
    swing: 'in',
    createdAt: ts,
    updatedAt: ts,
  }

  const draftDoc: PlanDoc = {
    ...doc,
    nodes: nextNodes,
    walls: nextWalls,
    rooms: [...nextRooms, storageRoom],
    elements: [...nextElements, frontDoor],
  }
  const withFaces: PlanDoc = { ...draftDoc, walls: deriveWallFaces(draftDoc) }
  const materialized: PlanDoc = { ...withFaces, rooms: materializeRooms(withFaces) }
  return { doc: syncElements(doc, materialized), storageRoomId }
}

/**
 * Add a built-in storage room attached to the outer side of a parent room's host wall.
 * `hostWall` is `wallStart` (vertex id) in v1, or `StoredWall.id` in v2.
 */
export function addStorage(
  doc: PlanDoc,
  parentRoomId: string,
  hostWall: string,
  params: StorageParams,
  door: StorageDoor,
): { doc: PlanDoc; storageRoomId: string } | { error: string } {
  return addStorageImpl(doc, parentRoomId, hostWall, params, door)
}

function sameWallProps(a: StoredWall, b: StoredWall): boolean {
  const pa = storedWallProps(a)
  const pb = storedWallProps(b)
  return (
    pa.type === pb.type &&
    pa.thicknessCm === pb.thicknessCm &&
    pa.status === pb.status &&
    pa.align === pb.align &&
    pa.locked === pb.locked
  )
}

/** Merge a node where exactly two collinear walls with identical props meet. */
function mergeInlineNode(doc: PlanDoc, nodeId: string): PlanDoc {
  const walls = doc.walls ?? []
  const nodes = doc.nodes ?? []
  const incident = walls.filter((w) => w.a === nodeId || w.b === nodeId)
  if (incident.length !== 2) return doc
  const [w1, w2] = incident
  if (!sameWallProps(w1, w2)) return doc

  const other1 = w1.a === nodeId ? w1.b : w1.a
  const other2 = w2.a === nodeId ? w2.b : w2.a
  if (other1 === other2) return doc

  const nMid = nodes.find((n) => n.id === nodeId)
  const n1 = nodes.find((n) => n.id === other1)
  const n2 = nodes.find((n) => n.id === other2)
  if (!nMid || !n1 || !n2) return doc

  const d1 = norm(sub(nMid, n1))
  const d2 = norm(sub(n2, nMid))
  if (Math.abs(cross(d1, d2)) > 1e-3 || dot(d1, d2) < 0.99) return doc

  // Keep w1's id as the merged wall from other1 -> other2
  const l1 = dist(n1, nMid)
  const l2 = dist(nMid, n2)
  const merged: StoredWall = { ...w1, a: other1, b: other2, faces: [] }
  const w1Flipped = w1.a === nodeId // w1 was nodeId -> other1, now other1 -> other2
  const w2Flipped = w2.b === nodeId // w2 was other2 -> nodeId, now other1 -> other2

  const mapSpan = (f: RoomFace, isW1: boolean): { from: number; to: number; side: 'L' | 'R' } => {
    const fFrom = Math.min(f.from, f.to)
    const fTo = Math.max(f.from, f.to)
    if (isW1) {
      if (!w1Flipped) return { from: fFrom, to: fTo, side: f.side }
      return { from: roundStored(l1 - fTo), to: roundStored(l1 - fFrom), side: f.side === 'L' ? 'R' : 'L' }
    }
    if (!w2Flipped) return { from: roundStored(l1 + fFrom), to: roundStored(l1 + fTo), side: f.side }
    return { from: roundStored(l1 + (l2 - fTo)), to: roundStored(l1 + (l2 - fFrom)), side: f.side === 'L' ? 'R' : 'L' }
  }

  const nextWalls = walls.filter((w) => w.id !== w2.id).map((w) => (w.id === w1.id ? merged : w))
  const nextNodes = nodes.filter((n) => n.id !== nodeId)

  const nextRooms = doc.rooms.map((r) => {
    if (!r.cycle?.some((f) => f.wallId === w1.id || f.wallId === w2.id)) return r
    const oldCorners = r.cycle.map((f) => f.cornerId)
    const mapped: RoomFace[] = r.cycle.map((f) => {
      if (f.wallId !== w1.id && f.wallId !== w2.id) return f
      const s = mapSpan(f, f.wallId === w1.id)
      return { wallId: w1.id, side: s.side, from: s.from, to: s.to, cornerId: f.cornerId }
    })
    // Coalesce adjacent faces of the same room on the merged wall
    const coalesced: RoomFace[] = []
    for (const f of mapped) {
      const prev = coalesced[coalesced.length - 1]
      if (prev && prev.wallId === w1.id && f.wallId === w1.id && prev.side === f.side) {
        prev.from = Math.min(prev.from, f.from)
        prev.to = Math.max(prev.to, f.to)
      } else {
        coalesced.push({ ...f })
      }
    }
    // Also coalesce wrap-around if first and last are on w1.id
    if (coalesced.length > 1 && coalesced[0].wallId === w1.id && coalesced[coalesced.length - 1].wallId === w1.id && coalesced[0].side === coalesced[coalesced.length - 1].side) {
      const last = coalesced.pop()!
      coalesced[0].from = Math.min(coalesced[0].from, last.from)
      coalesced[0].to = Math.max(coalesced[0].to, last.to)
      coalesced[0].cornerId = last.cornerId
    }
    return {
      ...r,
      cycle: coalesced,
      diagonal: remapDiagonal(r, coalesced.map((f) => f.cornerId), oldCorners),
    }
  })

  const nextElements = doc.elements.map((el) => {
    if (el.alongCm === undefined) return el
    if (el.wallId === w1.id) {
      return w1Flipped
        ? { ...el, alongCm: roundStored(Math.max(0, l1 - el.alongCm - el.widthCm)) }
        : el
    }
    if (el.wallId === w2.id) {
      return {
        ...el,
        wallId: w1.id,
        alongCm: roundStored(Math.max(0, w2Flipped ? l1 + (l2 - el.alongCm - el.widthCm) : l1 + el.alongCm)),
      }
    }
    return el
  })

  return { ...doc, nodes: nextNodes, walls: nextWalls, rooms: nextRooms, elements: nextElements }
}

/**
 * Delete a built-in storage room, its front door, and (in v2) its own walls/nodes, merging the
 * host wall back if the split is no longer needed.
 */
export function deleteStorage(doc: PlanDoc, storageRoomId: string): PlanDoc {
  const storageRoom = doc.rooms.find((r) => r.id === storageRoomId)
  if (!storageRoom || !storageRoom.storage) return doc

  const frontDoor = findFrontDoor(doc, storageRoom)
  const nextElements = doc.elements.filter((e) => e.roomId !== storageRoomId && e.id !== frontDoor?.id)
  const nextRooms = doc.rooms.filter((r) => r.id !== storageRoomId)

  if (!isV2(doc)) {
    return { ...doc, rooms: nextRooms, elements: nextElements }
  }

  const usedWalls = new Set<string>()
  for (const r of nextRooms) for (const f of r.cycle ?? []) usedWalls.add(f.wallId)

  const frontWallId = storageRoom.cycle?.[0]?.wallId
  const frontWall = frontWallId ? (doc.walls ?? []).find((w) => w.id === frontWallId) : undefined

  const nextWalls = (doc.walls ?? []).filter((w) => usedWalls.has(w.id) || w.standalone === true)
  const usedNodes = new Set<string>()
  for (const w of nextWalls) {
    usedNodes.add(w.a)
    usedNodes.add(w.b)
  }
  const nextNodes = (doc.nodes ?? []).filter((n) => usedNodes.has(n.id))

  let nextDoc: PlanDoc = {
    ...doc,
    nodes: nextNodes,
    walls: nextWalls,
    rooms: nextRooms,
    elements: nextElements,
  }

  if (frontWall) {
    nextDoc = mergeInlineNode(nextDoc, frontWall.a)
    nextDoc = mergeInlineNode(nextDoc, frontWall.b)
  }

  const withFaces: PlanDoc = { ...nextDoc, walls: deriveWallFaces(nextDoc) }
  const materialized: PlanDoc = { ...withFaces, rooms: materializeRooms(withFaces) }
  return syncElements(doc, materialized)
}

/**
 * Update a built-in storage room's dimensions/position and/or front door.
 * Returns `{ error }` without modifying the document if the new placement is invalid.
 */
export function updateStorage(
  doc: PlanDoc,
  storageRoomId: string,
  params: StorageParams,
  door?: StorageDoor,
): { doc: PlanDoc } | { error: string } {
  const err = validateParams(params)
  if (err) return { error: err }

  const storageRoom = doc.rooms.find((r) => r.id === storageRoomId)
  if (!storageRoom || !storageRoom.storage) return { error: 'Storage room not found' }

  const parentId = storageRoom.storage.parentRoomId
  const existingDoor = findFrontDoor(doc, storageRoom)
  const doorToUse: StorageDoor =
    door ?? (existingDoor ? (existingDoor.kind === 'opening' ? 'none' : ((existingDoor.variant as StorageDoor) ?? 'single')) : 'single')

  // Find the host wall before deleting
  let v1WallStart: string | null = null
  let frontMid: Vec | null = null
  if (storageRoom.vertices.length >= 2) {
    frontMid = {
      x: (storageRoom.vertices[0].x + storageRoom.vertices[1].x) / 2,
      y: (storageRoom.vertices[0].y + storageRoom.vertices[1].y) / 2,
    }
  }
  if (!isV2(doc)) {
    v1WallStart = findV1HostWall(doc, storageRoom)
    if (!v1WallStart) return { error: 'Host wall not found' }
  }

  const without = deleteStorage(doc, storageRoomId)

  let hostWall: string | null = v1WallStart
  if (isV2(without) && frontMid) {
    const parent = without.rooms.find((r) => r.id === parentId)
    if (parent && parent.cycle?.length) {
      let bestDist = Infinity
      for (const f of parent.cycle) {
        const pw = wallByStart(parent, f.cornerId)
        if (!pw) continue
        const d = projectOnSegment(frontMid, pw.start, pw.end).distance
        if (d < bestDist) {
          bestDist = d
          hostWall = f.wallId
        }
      }
    }
  }

  if (!hostWall) return { error: 'Host wall not found' }

  const res = addStorageImpl(without, parentId, hostWall, params, doorToUse, {
    id: storageRoom.id,
    code: storageRoom.code,
    name: storageRoom.name,
    walkOrder: storageRoom.walkOrder,
  })
  if ('error' in res) return res
  return { doc: res.doc }
}
