// Targets of on-site values (docs/walls-plan.md, phase 5c step 2). Pure, cm, y points down.
//
// A value stays keyed by its label ('EN-3', 'EN-3-T', 'EN-D', 'W12-C'...) because the server table
// and the sync use the label as the key. The label is only for DISPLAY: it is calculated from the
// current order of the room faces, so it changes when a corner is added or removed. The TARGET
// says what the value really measures, with the stable ids of the stored walls:
//   'CODE-n'   -> one face of room CODE: { kind: 'face', wallId, side, roomId, from, to }
//   'CODE-n-T' -> the thickness of the wall of that face: { kind: 'thickness', wallId, side, roomId }
//   'CODE-D'   -> the diagonal of the room: { kind: 'diagonal', roomId, wallId, side }
//                 (a target always names a wall, so the diagonal keeps the wall of its first corner
//                  face, that is face `room.diagonal[0]`: the label alone does not say it)
//   'W12-C' / 'W12-E' -> centre line / outside face of a stored wall: { kind, wallId, side }
//                 (the side of a centre or outside value says nothing: it is filled in so that the
//                  shape is complete, and it is ignored when the label is calculated back)
//
// `labelOfTarget` is the inverse. An edit can cut a face (a T junction) or split its wall in two
// (one wall between two rooms is split where another wall meets it on one side): the exact span is
// then gone, and the value goes to the face of the same room on the same SIDE with the largest
// overlap (a face on the same wall id is tried first). It follows that face when the overlap is at
// least half of the old span and no other face overlaps as much (a face cut in two equal parts is
// ambiguous, so the value goes to the old values and is measured again). Otherwise no label: the
// value leaves `doc.measurements` (relabelV2.ts).
import type { MeasureTarget, Measurement, PlanDoc, Room, RoomFace, StoredNode, StoredWall } from '../types'
import { labelRoomCode } from '../survey'
import { outsideFaceSide, parseWallValueLabel, wallCentreCm, wallValueLabel } from '../wallValues'

const EPS = 1e-6
/** Two spans closer than this are the same span (cm): a stored length is rounded to 0.001 cm. */
const SAME_SPAN_CM = 0.5
/** A face keeps the value of a cut face when it covers at least this part of the old span. */
const MIN_OVERLAP = 0.5
/** |sin| under this between two walls: they are in line (the two parts of a split wall). */
const PARALLEL_SIN = 1e-3

/** A v2 document: the walls are the source, so the labels come from the room cycles. */
export const isV2Doc = (d: Pick<PlanDoc, 'schemaVersion'>) => d.schemaVersion === 2

/** Cycle face of room `room` for wall number `n` (1-based, as in 'EN-3'), or undefined. */
function faceOfNumber(room: Room, n: number): RoomFace | undefined {
  const cycle = room.cycle ?? []
  if (!cycle.length) return undefined
  // The label numbers the corners: face n starts at corner n-1. The face is found by its corner id,
  // so a document whose vertex list was rebuilt still gives the right face.
  const cornerId = room.vertices[n - 1]?.id
  const at = cornerId === undefined ? -1 : cycle.findIndex((f) => f.cornerId === cornerId)
  return at >= 0 ? cycle[at] : cycle[n - 1]
}

/** Length of a stored wall (cm), or 0 when a node is missing. */
function wallLengthCm(nodes: StoredNode[], wall: StoredWall): number {
  const a = nodes.find((n) => n.id === wall.a)
  const b = nodes.find((n) => n.id === wall.b)
  return a && b ? Math.hypot(b.x - a.x, b.y - a.y) : 0
}

/** Side to store on a value of a stored wall: the outside side, else the side of its first face. */
function sideOfWallValue(nodes: StoredNode[], wall: StoredWall, kind: 'centre' | 'outside'): 'L' | 'R' {
  if (kind === 'outside') {
    const centre = wallCentreCm(nodes, wall)
    const outside = centre === null ? null : outsideFaceSide(wall, centre)
    if (outside) return outside
  }
  return wall.faces[0]?.side ?? 'L'
}

/**
 * What a survey label measures in a v2 document, or undefined when the label names nothing
 * (a height 'EN-H', an old label of a value of a room that is gone...).
 */
export function targetOfLabel(doc: PlanDoc, label: string): MeasureTarget | undefined {
  // 'W12-C' / 'W12-E': a value of a stored wall, not of a room.
  const wallValue = parseWallValueLabel(label)
  if (wallValue) {
    const wall = (doc.walls ?? []).find((w) => w.id === wallValue.wallId)
    if (!wall) return undefined
    return { wallId: wall.id, side: sideOfWallValue(doc.nodes ?? [], wall, wallValue.kind), kind: wallValue.kind }
  }

  const code = labelRoomCode(label)
  const room = code ? doc.rooms.find((r) => r.code === code) : undefined
  if (!room || !room.cycle?.length) return undefined
  const suffix = label.slice(code.length + 1)

  if (suffix === 'D') {
    // The wall of the face at the first corner of the diagonal (0 when the room has no pair yet).
    const cycle = room.cycle
    const face = cycle[(room.diagonal?.[0] ?? 0) % cycle.length]
    return face ? { wallId: face.wallId, side: face.side, roomId: room.id, kind: 'diagonal' } : undefined
  }

  const m = /^(\d+)(-T)?$/.exec(suffix)
  if (!m) return undefined
  const face = faceOfNumber(room, Number(m[1]))
  if (!face) return undefined
  if (m[2]) return { wallId: face.wallId, side: face.side, roomId: room.id, kind: 'thickness' }
  return { wallId: face.wallId, side: face.side, roomId: room.id, from: face.from, to: face.to, kind: 'face' }
}

/**
 * The wall of a target and the walls that continue it in line at one of its two nodes: the parts of
 * a wall that was split in two (docs/walls-plan.md phase 5c: a wall between two rooms is split
 * where another wall meets it on one side).
 */
function partnerWalls(doc: PlanDoc, wallId: string): Set<string> {
  const out = new Set<string>([wallId])
  const walls = doc.walls ?? []
  const nodes = new Map((doc.nodes ?? []).map((n) => [n.id, { x: n.x, y: n.y }]))
  const dir = (w: StoredWall) => {
    const a = nodes.get(w.a)
    const b = nodes.get(w.b)
    if (!a || !b) return null
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    return len < EPS ? null : { x: (b.x - a.x) / len, y: (b.y - a.y) / len }
  }
  const wall = walls.find((w) => w.id === wallId)
  const d = wall ? dir(wall) : null
  if (!wall || !d) return out
  for (const other of walls) {
    if (other.id === wall.id) continue
    if (other.a !== wall.a && other.a !== wall.b && other.b !== wall.a && other.b !== wall.b) continue
    const o = dir(other)
    if (o && Math.abs(d.x * o.y - d.y * o.x) <= PARALLEL_SIN) out.add(other.id)
  }
  return out
}

/**
 * Position of each part in the frame of the wall of the target: the distance of its node a along
 * the target wall (`offset`), and +1 when the two walls run the same way, -1 when they run against
 * each other. A face of a split part is read with these values, so its span can be compared with
 * the span of the target (both walls are in line).
 */
function partFrames(doc: PlanDoc, wallId: string, parts: Set<string>): Map<string, { offset: number; scale: number }> {
  const out = new Map<string, { offset: number; scale: number }>([[wallId, { offset: 0, scale: 1 }]])
  const walls = doc.walls ?? []
  const nodes = new Map((doc.nodes ?? []).map((n) => [n.id, { x: n.x, y: n.y }]))
  const target = walls.find((w) => w.id === wallId)
  const ta = target ? nodes.get(target.a) : undefined
  const tb = target ? nodes.get(target.b) : undefined
  if (!target || !ta || !tb) return out
  const length = Math.hypot(tb.x - ta.x, tb.y - ta.y)
  if (length < EPS) return out
  const d = { x: (tb.x - ta.x) / length, y: (tb.y - ta.y) / length }
  for (const id of parts) {
    if (id === wallId) continue
    const w = walls.find((x) => x.id === id)
    const a = w ? nodes.get(w.a) : undefined
    const b = w ? nodes.get(w.b) : undefined
    if (!a || !b) continue
    const offset = (a.x - ta.x) * d.x + (a.y - ta.y) * d.y
    const scale = (b.x - a.x) * d.x + (b.y - a.y) * d.y >= 0 ? 1 : -1
    out.set(id, { offset, scale })
  }
  return out
}

/**
 * Candidate faces of one side: the faces on the wall of the target first, then the faces of the
 * walls that continue it (a split wall gives its faces to two walls).
 */
function sides(cycle: RoomFace[], side: number[], parts: Set<string>, wallId: string): number[] {
  const mine = side.filter((i) => parts.has(cycle[i].wallId))
  const onWall = mine.filter((i) => cycle[i].wallId === wallId)
  return [...onWall, ...mine.filter((i) => cycle[i].wallId !== wallId)]
}

/** The frames of the parts of a target wall: a face of a split part is read in the target frame. */
function framesOfTarget(doc: PlanDoc, wallId: string): Map<string, { offset: number; scale: number }> {
  return partFrames(doc, wallId, partnerWalls(doc, wallId))
}

/** Span of a face of the room cycle, in the frame of the target wall (the parts are in line). */
function spanInFrame(
  frames: Map<string, { offset: number; scale: number }>,
  f: RoomFace,
): { from: number; to: number } {
  const fr = frames.get(f.wallId) ?? { offset: 0, scale: 1 }
  const lo = Math.min(f.from, f.to)
  const hi = Math.max(f.from, f.to)
  return fr.scale > 0 ? { from: fr.offset + lo, to: fr.offset + hi } : { from: fr.offset - hi, to: fr.offset - lo }
}

/**
 * Index in `room.cycle` of the face that a target measures: the same span when it still exists,
 * else the face of the same side with the largest overlap (see the header of this file).
 */
function faceIndexOf(doc: PlanDoc, room: Room, target: MeasureTarget): number | undefined {
  const cycle = room.cycle ?? []
  const onPlan = new Set((doc.walls ?? []).map((w) => w.id))
  const side: number[] = []
  cycle.forEach((f, i) => {
    if (f.side === target.side && onPlan.has(f.wallId)) side.push(i)
  })
  if (!side.length) return undefined
  if (target.kind === 'thickness') {
    // A thickness belongs to the wall itself: only a face ON THAT WALL gives its label.
    const onWall = side.filter((i) => cycle[i].wallId === target.wallId)
    return onWall[0]
  }
  // A face can be cut by a new junction, and a wall split in two gives its faces to two walls.
  // The candidates are the faces of the same SIDE on the wall of the target and on the walls that
  // continue it in line (a split part): no other wall of the room can take the value.
  const parts = partnerWalls(doc, target.wallId)
  const mine = sides(cycle, side, parts, target.wallId)
  if (!mine.length) return undefined

  // A target saved without from/to measures the whole wall.
  const frames = partFrames(doc, target.wallId, parts)
  const frameSpan = (f: RoomFace) => spanInFrame(frames, f)
  const wall = (doc.walls ?? []).find((w) => w.id === target.wallId)
  const length = wall ? wallLengthCm(doc.nodes ?? [], wall) : 0
  const from = target.from ?? 0
  const to = target.to ?? Math.max(length, ...mine.map((i) => frameSpan(cycle[i]).to))
  const same = (f: RoomFace) => Math.abs(frameSpan(f).from - from) <= SAME_SPAN_CM && Math.abs(frameSpan(f).to - to) <= SAME_SPAN_CM
  const exact = mine.find((i) => same(cycle[i]))
  if (exact !== undefined) return exact

  const span = to - from
  if (span <= EPS) return undefined
  const overlaps = mine.map((i) => {
    const fs = frameSpan(cycle[i])
    return { i, o: Math.max(0, Math.min(fs.to, to) - Math.max(fs.from, from)) }
  })
  const best = overlaps.reduce((a, b) => (b.o > a.o ? b : a))
  if (best.o < span * MIN_OVERLAP) return undefined
  // A cut in two equal parts (or more) is ambiguous: the value must be measured again.
  if (overlaps.some((x) => x.i !== best.i && Math.abs(x.o - best.o) <= SAME_SPAN_CM)) return undefined
  return best.i
}

/**
 * The target with the span of the face it matches in `doc`. A wall that is stretched, and a face
 * that a new junction cuts, move the span of the face: the stored target follows it, so the next
 * edit compares the value with the span it really has (review finding 9). A target without from/to
 * (the whole wall), a thickness, a diagonal, and a target that no face matches stay as they are.
 * Same object when the span did not change.
 */
export function refreshTargetSpan(doc: PlanDoc, target: MeasureTarget): MeasureTarget {
  if ((target.kind ?? 'face') !== 'face') return target
  if (target.from === undefined || target.to === undefined) return target
  const room = target.roomId === undefined ? undefined : doc.rooms.find((r) => r.id === target.roomId)
  if (!room) return target
  const i = faceIndexOf(doc, room, target)
  const face = i === undefined ? undefined : room.cycle?.[i]
  if (!face) return target
  const span = spanInFrame(framesOfTarget(doc, target.wallId), face)
  const near = (a: number, b: number) => Math.abs(a - b) <= SAME_SPAN_CM
  return near(target.from, span.from) && near(target.to, span.to) ? target : { ...target, from: span.from, to: span.to }
}

/**
 * Label of a target in the CURRENT document (null/undefined when the target is not on the plan
 * any more: its room is gone, its wall is gone, or no face matches its span).
 */
export function labelOfTarget(doc: PlanDoc, target: MeasureTarget): string | undefined {
  const kind = target.kind ?? 'face'
  if (kind === 'centre' || kind === 'outside') {
    const wall = (doc.walls ?? []).find((w) => w.id === target.wallId)
    if (!wall) return undefined
    if (kind === 'outside') {
      const centre = wallCentreCm(doc.nodes ?? [], wall)
      // The wall is no longer a facade: the value of its outside face has no label.
      if (centre === null || outsideFaceSide(wall, centre) === null) return undefined
    }
    return wallValueLabel(wall.id, kind)
  }
  const room = target.roomId === undefined ? undefined : doc.rooms.find((r) => r.id === target.roomId)
  if (!room) return undefined
  // The wall itself must still be on the plan (a cycle of a broken document may name a gone wall).
  if (!(doc.walls ?? []).some((w) => w.id === target.wallId)) return undefined
  if (kind === 'diagonal') return room.diagonal ? `${room.code}-D` : undefined
  const i = faceIndexOf(doc, room, target)
  if (i === undefined) return undefined
  return kind === 'thickness' ? `${room.code}-${i + 1}-T` : `${room.code}-${i + 1}`
}

/**
 * The document with a target on every value that has none, for a v2 document. A target is only
 * stored when the label comes back the same, so this step never moves a value. Same object when
 * nothing changed.
 */
export function attachTargets(doc: PlanDoc): PlanDoc {
  if (!isV2Doc(doc)) return doc
  const entries = Object.entries(doc.measurements)
  if (!entries.length) return doc
  let changed = false
  const out: PlanDoc['measurements'] = {}
  for (const [label, m] of entries) {
    if (m.target) {
      out[label] = m
      continue
    }
    const target = targetOfLabel(doc, label)
    if (target && labelOfTarget(doc, target) === label) {
      const next: Measurement = { ...m, target }
      out[label] = next
      changed = true
    } else out[label] = m
  }
  return changed ? { ...doc, measurements: out } : doc
}
