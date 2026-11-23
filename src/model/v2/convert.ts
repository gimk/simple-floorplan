// Conversion of a v1 document to the v2 model (docs/walls-plan.md, phase 5c step 1). Pure, cm.
//
// v1: each room is a polygon with its own wall properties, so the wall between two rooms is stored
// two times and the solver has to guess that the two copies are one wall.
// v2: `doc.nodes` and `doc.walls` are the source (ONE wall between two rooms, with its properties),
// each room holds a `cycle` of faces and `room.vertices` / `room.walls` become a calculated view.
//
// This conversion is also the CLEANUP of old plans. Copies of one wall that differ are merged:
//   - line = mean of the drawn lines (the graph does this),
//   - thickness = max of the copies,
//   - type and other properties = those of the room first in the walk order,
// and the report lists every such merge, so the user can check it once.
//
// Nothing else changes: measurements (keyed by label), labels, elements, pins, notes, tapes,
// traces, holes, background and apartment data stay exactly as they are. The walked-through room
// codes and the polygon order are kept, so every label (SE-2, SE-D...) means the same wall after
// the conversion. The two sides of a wall are cut independently, so a room keeps one face for a
// wall that other rooms cut on the other side (the Entree / Couloir case).

import { DEFAULT_WALL_CM, cross, dist, dot, roomWalls, sub } from '../geometry'
import { syncStoredGraph } from '../storedGraph'
import { buildWallGraph } from '../wallGraph'
import type {
  ConversionReport, ConversionReportEntry, PlanDoc, Room, RoomFace, StoredWall, Vec, WallProps,
} from '../types'
import { LINE_TOL_CM, deriveWallFaces, materializeRooms, roundReport, roundStored } from './materialize'

/** Properties of a room wall with no entry in `room.walls`. Same default as the wall graph. */
const DEFAULT_PROPS: WallProps = { type: 'partition', thicknessCm: DEFAULT_WALL_CM }

/** One drawn copy of a wall: one room wall. */
type Copy = {
  /** Position of the room in the walk order (lower first). */
  roomOrder: number
  roomCode: string
  /** Signed distance of the drawn line from the centre line of the wall, cm. */
  offsetCm: number
  thicknessCm: number
  props: WallProps
}

/** Room walk order: walk order, then code, then id (the same order as the wall graph). */
const cmpOrder = (a: Room, b: Room) =>
  a.walkOrder - b.walkOrder || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/**
 * The v2 document of a v1 document, and the report of the walls it merged.
 * Rooms that keep at least one wall without a face (a wall of zero length) stay as they are: the
 * conversion never drops a corner of a room.
 */
export function convertToV2(doc: PlanDoc): { doc: PlanDoc; report: ConversionReport } {
  const rooms = doc.rooms
  // The graph gives one wall per group of room walls; the stored graph gives the stable ids (W1,
  // W2...) and keeps the ids of `doc.walls` when the document already has them.
  const graph = buildWallGraph(rooms)
  const stored = syncStoredGraph({ nodes: doc.nodes, walls: doc.walls }, rooms)
  const wallIndex = new Map(graph.walls.map((w, i) => [w.id, i]))
  const nodePos = new Map(stored.nodes.map((n) => [n.id, { x: n.x, y: n.y }]))
  // `syncStoredGraph` builds the same graph from the same rooms, so the two lists are in step. If
  // they ever are not, the document is given back as it is rather than with the faces of another
  // wall.
  if (stored.walls.length !== graph.walls.length) {
    const report: ConversionReport = {
      entries: [], counts: { rooms: rooms.length, walls: stored.walls.length, sharedWalls: 0, droppedRoomWalls: 0 },
    }
    return { doc, report }
  }

  // ---- copies: one per room wall, with its line, its thickness and its properties ----
  // The rooms are read in the walk order, so the copy lists are in the walk order too.
  const copies: Copy[][] = graph.walls.map(() => [])
  const cycles: Record<string, RoomFace[]> = {}
  let dropped = 0
  const ordered = [...rooms].sort(cmpOrder)
  // Room walls -> face, in the polygon order of each room (one entry per room wall).
  const roomFaces = graph.roomFaces
  for (const [roomOrder, r] of ordered.entries()) {
    const refs = roomFaces[r.id] ?? []
    const geo = roomWalls(r)
    if (refs.length !== geo.length) {
      // Cannot happen (the graph gives one entry per room wall): keep the v1 polygon of this room.
      dropped += geo.length
      continue
    }
    const cycle: RoomFace[] = []
    let ok = refs.length > 0
    for (let i = 0; i < refs.length; i++) {
      const fi = refs[i].faceIndexes[0]
      const face = fi === undefined ? undefined : graph.faces[fi]
      const wi = face ? wallIndex.get(face.wallId) : undefined
      const wall = wi === undefined ? undefined : stored.walls[wi]
      if (face === undefined || wi === undefined || wall === undefined) {
        // A wall of zero length gives no face: the room keeps its v1 polygon.
        ok = false
        dropped++
        continue
      }
      cycle.push({
        wallId: wall.id,
        side: face.side,
        ...roomWallSpan(wall, geo[i], nodePos, face),
        cornerId: refs[i].wallStart || r.vertices[i].id,
      })
      // Line of the drawn copy, relative to the centre line of its wall.
      const a = nodePos.get(wall.a)
      const b = nodePos.get(wall.b)
      const start = geo[i].start
      const length = a && b ? dist(a, b) : 0
      const offsetCm = a && b && length > 0
        ? cross({ x: (b.x - a.x) / length, y: (b.y - a.y) / length }, sub(start, a))
        : 0
      const props = r.walls[geo[i].start.id] ?? DEFAULT_PROPS
      copies[wi].push({
        roomOrder,
        roomCode: r.code,
        offsetCm,
        thicknessCm: props.thicknessCm,
        props,
      })
    }
    if (ok) cycles[r.id] = cycle
  }

  // ---- walls: merged properties, and the report of the merges that changed something ----
  const entries: ConversionReportEntry[] = []
  const walls: StoredWall[] = stored.walls.map((w, i) => {
    const list = copies[i]
    const chosen = chosenProps(list)
    const out: StoredWall = { id: w.id, a: w.a, b: w.b, faces: w.faces, type: chosen.type, thicknessCm: chosen.thicknessCm }
    if (chosen.status !== undefined) out.status = chosen.status
    if (chosen.align !== undefined) out.align = chosen.align
    if (chosen.locked !== undefined) out.locked = chosen.locked
    const entry = reportEntry(w.id, list, chosen)
    if (entry) entries.push(entry)
    return out
  })

  // ---- the survey view of each room, calculated from the walls and the cycles ----
  const roomsWithCycle = rooms.map((r) => {
    const cycle = cycles[r.id]
    return cycle ? { ...r, cycle } : r
  })
  const v2: PlanDoc = { ...doc, schemaVersion: 2, nodes: stored.nodes, walls, rooms: roomsWithCycle }
  const report: ConversionReport = {
    entries,
    counts: { rooms: rooms.length, walls: walls.length, sharedWalls: copies.filter((c) => c.length > 1).length, droppedRoomWalls: dropped },
  }
  // The faces of a v2 wall are DERIVED from the cycles (one per room face, plus the outside
  // spans), so the stored faces and the cycles can never disagree.
  const withFaces: PlanDoc = { ...v2, walls: deriveWallFaces(v2) }
  return { doc: { ...withFaces, rooms: materializeRooms(withFaces) }, report }
}

/**
 * Span of ONE room wall along its stored wall, cm from node a. A room wall that is in line with
 * another room wall of the same room keeps its own span, so no corner of the room is lost; the
 * merged face of the graph is wider, but the room's own value (`EN-3`) stays on its own span.
 * When an end node of the wall is missing, the span of the merged face is used.
 */
function roomWallSpan(
  wall: StoredWall,
  w: { start: Vec; end: Vec },
  nodes: Map<string, Vec>,
  face: { from: number; to: number },
): { from: number; to: number } {
  const a = nodes.get(wall.a)
  const b = nodes.get(wall.b)
  const length = a && b ? dist(a, b) : 0
  if (!a || !b || length < 1) return { from: roundStored(face.from), to: roundStored(face.to) }
  const dir = { x: (b.x - a.x) / length, y: (b.y - a.y) / length }
  const u1 = dot(sub(w.start, a), dir)
  const u2 = dot(sub(w.end, a), dir)
  const from = Math.max(0, Math.min(u1, u2))
  const to = Math.min(length, Math.max(u1, u2))
  return { from: roundStored(from), to: roundStored(to) }
}

/**
 * Properties kept on a merged wall: thickness = max of the copies, type and other properties of
 * the copy whose room comes first in the walk order.
 */
function chosenProps(list: Copy[]): WallProps {
  if (!list.length) return DEFAULT_PROPS
  const first = list.reduce((best, c) => (c.roomOrder < best.roomOrder ? c : best))
  const thicknessCm = list.reduce((m, c) => Math.max(m, c.thicknessCm), 0)
  const out: WallProps = { type: first.props.type, thicknessCm }
  if (first.props.status !== undefined) out.status = first.props.status
  if (first.props.align !== undefined) out.align = first.props.align
  if (first.props.locked !== undefined) out.locked = first.props.locked
  return out
}

/** The report line of a wall whose copies differ, or null when the copies agree. */
function reportEntry(wallId: string, list: Copy[], chosen: WallProps): ConversionReportEntry | null {
  if (list.length < 2) return null
  const offsets = list.map((c) => c.offsetCm)
  const linesApartCm = roundReport(Math.max(...offsets) - Math.min(...offsets))
  const thicknesses = list.map((c) => c.thicknessCm)
  const types = list.map((c) => c.props.type)
  const sameThickness = thicknesses.every((t) => t === thicknesses[0])
  const sameType = types.every((t) => t === types[0])
  const sameProps = list.every((c) => sameExtraProps(c.props, list[0].props))
  if (linesApartCm <= LINE_TOL_CM && sameThickness && sameType && sameProps) return null
  const rooms: string[] = []
  for (const c of list) if (!rooms.includes(c.roomCode)) rooms.push(c.roomCode)
  return { wallId, rooms, linesApartCm, thicknesses, types, chosen }
}

/** Same renovation state, line rule and lock. */
const sameExtraProps = (a: WallProps, b: WallProps) =>
  a.status === b.status && a.align === b.align && a.locked === b.locked
