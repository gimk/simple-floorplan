// Pure logic for Measuring Mode. No React here, so it is easy to test.
import { fmtCm, lerp, roomWalls } from '../../model/geometry'
import type { Wall } from '../../model/geometry'
import { roomsInWalkOrder, surveyIds } from '../../model/survey'
import type { SurveyId } from '../../model/survey'
import { wallRunMetrics } from '../storage/geometry'
import type { ElementKind, PlanDoc, Room, Vec, WallElement } from '../../model/types'

/** Parse a length typed by the user. Comma or dot. null = empty, NaN = invalid. */
export function parseCm(text: string, allowZero = false): number | null {
  const t = text.trim().replace(',', '.')
  if (!t) return null
  if (!/^\d*\.?\d*$/.test(t) || t === '.') return NaN
  const n = Number(t)
  if (!Number.isFinite(n)) return NaN
  return n > 0 || (allowZero && n === 0) ? n : NaN
}

/** Signed difference text with a real minus sign: "+4", "−4", "0". */
export function fmtDiff(diff: number): string {
  const r = Math.round(diff * 10) / 10
  if (r === 0) return '0'
  const s = String(Math.abs(r)).replace('.', ',')
  return r > 0 ? `+${s}` : `−${s}`
}

export const DISCREPANCY_CM = 2
export const SQUARE_TOLERANCE_CM = 1
export const OPPOSITE_TOLERANCE_CM = 2

/** Difference between real and planned length. null if one value is missing. */
export function discrepancy(plannedCm?: number, actualCm?: number) {
  if (plannedCm == null || actualCm == null) return null
  const diff = actualCm - plannedCm
  return { diff, flagged: Math.abs(diff) > DISCREPANCY_CM }
}

/**
 * Text under a measured field (docs/solver-plan.md, Measuring Mode): the length that the plan has now,
 * then how far it is from the value typed. `d` = measured − plan, so d > 0 means the plan is
 * SHORTER than the measurement.
 *   solved wall: "Solved 295,8 · 0,2 cm shorter than measured"
 *   other wall:  "Plan 296 · matches measured"
 * A flagged value (over DISCREPANCY_CM) also says to check it.
 */
export function fieldLine(plannedCm: number, measuredCm: number, solved: boolean, flagged = false): string {
  const d = measuredCm - plannedCm
  const a = Math.round(Math.abs(d) * 10) / 10
  const head = `${solved ? 'Solved' : 'Plan'} ${fmtCm(plannedCm)} · `
  const tail = a < 0.05 ? 'matches measured' : `${fmtCm(a)} cm ${d > 0 ? 'shorter' : 'longer'} than measured`
  return head + tail + (flagged ? ' · check this value' : '')
}

const val = (doc: Pick<PlanDoc, 'measurements'>, label: string) => doc.measurements[label]?.actualCm

/** Squareness check for 4-vertex rooms with a diagonal. Needs 4 walls + D measured. */
export function squarenessCheck(doc: Pick<PlanDoc, 'measurements'>, room: Room) {
  if (room.vertices.length !== 4 || !room.diagonal) return null
  const [p, q] = room.diagonal
  const i = Math.min(p, q), j = Math.max(p, q)
  if (j - i !== 2 || i > 1) return null // only the two true diagonals: [0,2] or [1,3]
  const walls = [1, 2, 3, 4].map((n) => val(doc, `${room.code}-${n}`))
  const d = val(doc, `${room.code}-D`)
  if (d == null || walls.some((w) => w == null)) return null
  const a = walls[i] as number, b = walls[i + 1] as number // the two walls that meet at the corner opposite the diagonal
  const expected = Math.sqrt(a * a + b * b)
  const diff = d - expected
  return { expected, actual: d, diff, ok: Math.abs(diff) <= SQUARE_TOLERANCE_CM }
}

/** Opposite walls of a 4-vertex room (1 vs 3, 2 vs 4) that differ by more than 2 cm. */
export function oppositeWallNotes(doc: Pick<PlanDoc, 'measurements'>, room: Room) {
  if (room.vertices.length !== 4) return []
  const out: { a: string; b: string; diff: number }[] = []
  for (const [x, y] of [[1, 3], [2, 4]]) {
    const la = `${room.code}-${x}`, lb = `${room.code}-${y}`
    const va = val(doc, la), vb = val(doc, lb)
    if (va == null || vb == null) continue
    const diff = vb - va
    if (Math.abs(diff) > OPPOSITE_TOLERANCE_CM) out.push({ a: la, b: lb, diff })
  }
  return out
}

/** Next survey ID after `current` in walk order (across rooms). null at the end or if unknown. */
export function nextLabel(labels: string[], current: string): string | null {
  const i = labels.indexOf(current)
  return i < 0 || i >= labels.length - 1 ? null : labels[i + 1]
}

/**
 * Next survey ID without a measured value, starting AFTER `current` (wrapping once around).
 * `current` null/empty starts from the beginning. null when everything is measured.
 */
export function nextUnmeasuredLabel(
  doc: Pick<PlanDoc, 'measurements'>, labels: string[], current: string | null,
  /** Is this row label measured? Default: the label has a value (a grouped wall row needs all its pieces). */
  isMeasured: (label: string) => boolean = (l) => doc.measurements[l] != null,
): string | null {
  if (!labels.length) return null
  const start = current ? labels.indexOf(current) : -1
  for (let k = 1; k <= labels.length; k++) {
    const i = (((start + k) % labels.length) + labels.length) % labels.length
    if (!isMeasured(labels[i])) return labels[i]
  }
  return null
}

// ---------- measure rows: one row per VISIBLE straight wall ----------
// A straight wall can be stored as 2+ consecutive collinear faces (a T junction where another room's
// wall meets it, a locked piece, a piece of another type). The user sees one wall, so the panel shows
// ONE row for the run (wallRunMetrics, the same grouping as the storage "Wall" select).
// The solver is unchanged: it reads one value per face label. A total typed on a grouped row is
// written as one value per piece, split in proportion (setRunMeasurement); the row shows the sum.

export type MeasureRow = SurveyId & {
  /** Text shown for the row: "R1-4" for one face, "R1-4+5" for a run. */
  text: string
  /** Face labels of the row, in wall order. `label` is the first one. */
  labels: string[]
  /** Stored faces of the run (vertex indices), in wall order. */
  faceIndices: number[]
  /** Planned length of each piece, in wall order (a grouped row only). */
  pieces: { label: string; plannedCm: number }[]
}

const round1 = (n: number) => Math.round(n * 10) / 10

/** Rows of one room (walls grouped by run, diagonal, height). */
export function measureRows(room: Room, defaultCeilingCm?: number): MeasureRow[] {
  const ids = surveyIds(room, defaultCeilingCm)
  const wallIds = ids.filter((s) => s.kind === 'wall')
  const byIndex = new Map(wallIds.map((s, i) => [i, s]))
  const done = new Set<number>()
  const rows: MeasureRow[] = []
  const nWalls = wallIds.length
  for (const s of ids) {
    if (s.kind !== 'wall') { rows.push({ ...s, text: s.label, labels: [s.label], faceIndices: [], pieces: [] }); continue }
    const i = wallIds.indexOf(s)
    if (done.has(i)) continue
    const run = wallRunMetrics(room, i)?.faceIndices ?? [i]
    const faces = run.length > 1 && run.length < nWalls && run.every((k) => byIndex.has(k)) ? run : [i]
    faces.forEach((k) => done.add(k))
    const pieces = faces.map((k) => ({ label: byIndex.get(k)!.label, plannedCm: byIndex.get(k)!.plannedCm ?? 0 }))
    const first = byIndex.get(faces[0])!
    const nums = pieces.map((p) => p.label.slice(p.label.lastIndexOf('-') + 1))
    rows.push({
      ...first,
      plannedCm: faces.length > 1 ? round1(pieces.reduce((a, p) => a + p.plannedCm, 0)) : first.plannedCm,
      text: faces.length > 1 ? `${first.label}+${nums.slice(1).join('+')}` : first.label,
      labels: pieces.map((p) => p.label), faceIndices: faces, pieces: faces.length > 1 ? pieces : [],
    })
  }
  return rows
}

/** A thickness id as a row of its own (one label). */
export const thicknessRow = (s: SurveyId): MeasureRow => ({ ...s, text: s.label, labels: [s.label], faceIndices: [], pieces: [] })

/**
 * Measured length of a row: the value, or for a grouped row the sum of its pieces.
 * When a single piece of a grouped row already holds a value close to the whole run length
 * (within DISCREPANCY_CM of plannedCm) while the other pieces are unmeasured, treat that value as
 * the run total (the user typed the full wall length into one piece).
 */
export function rowValue(doc: Pick<PlanDoc, 'measurements'>, row: Pick<MeasureRow, 'labels' | 'plannedCm'>): number | undefined {
  const vals = row.labels.map((l) => doc.measurements[l]?.actualCm)
  if (vals.every((v) => v != null)) return round1((vals as number[]).reduce((a, v) => a + v, 0))
  if (row.labels.length > 1 && row.plannedCm != null) {
    const present = vals.filter((v): v is number => v != null)
    if (present.length === 1 && Math.abs(present[0] - row.plannedCm) <= DISCREPANCY_CM) return round1(present[0])
  }
  return undefined
}

export const rowMeasured = (doc: Pick<PlanDoc, 'measurements'>, row: Pick<MeasureRow, 'labels' | 'plannedCm'>) => rowValue(doc, row) != null

/** Smallest value a piece of a split run can get (cm). The schema needs actualCm > 0. */
export const MIN_PIECE_CM = 0.1

/**
 * Split a run total over its pieces in proportion to `bases`. Every piece gets at least MIN_PIECE_CM
 * (a piece with a base of 0 or less counts as the smallest piece), so no piece is ever 0. The extra
 * that the minimums take comes off the largest piece, and the pieces always add up to the total.
 * A total too small for the minimums (total < n x MIN_PIECE_CM) is shared in equal parts.
 */
export function splitRunTotal(total: number, bases: number[]): number[] {
  const n = bases.length
  if (!n) return []
  if (total < n * MIN_PIECE_CM) return bases.map(() => total / n) // too small to round: equal parts, still > 0
  const w = bases.map((b) => (b > 0 ? b : 0))
  const sum = w.reduce((a, b) => a + b, 0)
  const raw = sum > 0 ? w.map((b) => (total * b) / sum) : w.map(() => total / n)
  const out = raw.map((v) => Math.max(MIN_PIECE_CM, round1(v)))
  // The pieces add up to the total: the largest piece takes the rounding rest and the minimums.
  let big = 0
  out.forEach((v, i) => { if (v > out[big]) big = i })
  out[big] = round1(out[big] + (total - out.reduce((a, b) => a + b, 0)))
  return out
}

/** Required rows of a room (no optional ones). */
export const requiredRows = (room: Room, defaultCeilingCm?: number) => measureRows(room, defaultCeilingCm).filter((s) => !s.optional)

/** Every required row of the plan in walk order, storage rooms left out (they live in their parent card). */
export function allMeasureRows(doc: PlanDoc): MeasureRow[] {
  return measureRooms(doc).flatMap((r) => requiredRows(r, doc.apartment?.defaultCeilingCm))
}

/** True when at least one row of the room has no measured value yet. */
export function roomHasMissing(doc: Pick<PlanDoc, 'measurements'>, room: Room): boolean {
  return requiredRows(room).some((s) => !rowMeasured(doc, s))
}

/** True when the room has a flagged discrepancy (> 2 cm vs plan) or a squareness warning. */
export function roomIsFlagged(doc: Pick<PlanDoc, 'measurements'> & { apartment?: PlanDoc['apartment'] }, room: Room): boolean {
  const flagged = requiredRows(room, doc.apartment?.defaultCeilingCm).some((s) => {
    const v = rowValue(doc, s)
    if (v == null || s.plannedCm == null) return false
    return Math.abs(v - s.plannedCm) > DISCREPANCY_CM
  })
  if (flagged) return true
  const sq = squarenessCheck(doc, room)
  return sq != null && !sq.ok
}

export function roomProgress(doc: PlanDoc, room: Room) {
  const rows = requiredRows(room)
  const done = rows.filter((s) => rowMeasured(doc, s)).length
  const total = rows.length
  return { done, total, state: (done === 0 ? 'none' : done === total ? 'full' : 'part') as 'none' | 'part' | 'full' }
}

/** Rooms shown in Measuring Mode: storage rooms live inside their parent room card. */
export const measureRooms = (doc: Pick<PlanDoc, 'rooms'>): Room[] =>
  roomsInWalkOrder(doc as PlanDoc).filter((r) => !r.storage)

export function docProgress(doc: PlanDoc) {
  const rows = allMeasureRows(doc)
  return { done: rows.filter((s) => rowMeasured(doc, s)).length, total: rows.length }
}

/** Length used to place items on a wall: measured if known, else planned. */
export function wallRefLength(doc: Pick<PlanDoc, 'measurements'>, room: Room, wall: Wall): number {
  return val(doc, `${room.code}-${wall.index + 1}`) ?? wall.length
}

/** Where an element sits on its wall, in world cm. null if it cannot be drawn yet. */
export function itemSpan(doc: Pick<PlanDoc, 'measurements'>, room: Room, el: WallElement) {
  const wall = roomWalls(room).find((w) => w.start.id === el.wallStart)
  if (!wall || !(el.widthCm > 0)) return null
  const ref = wallRefLength(doc, room, wall)
  if (!(ref > 0)) return null
  const t0 = Math.min(1, Math.max(0, el.offsetCm / ref))
  const t1 = Math.min(1, Math.max(0, (el.offsetCm + el.widthCm) / ref))
  if (t1 - t0 < 1e-6) return null
  return { wall, ref, t0, t1, p0: lerp(wall.start, wall.end, t0), p1: lerp(wall.start, wall.end, t1) }
}

const ADJ_TOLERANCE_CM = 3

/**
 * Walls of `room` that an element of ANOTHER room shows on, dashed.
 * In a v2 document the element belongs to a stored wall (`wallId`, docs/walls-plan.md phase 7): the
 * same wall is the same door, so only the walls of this room that share that wall id can show it
 * (none = nothing to show). null = the geometry decides: a v1 element, or a room without a cycle.
 */
function sharedHostWalls(room: Room, el: WallElement): Wall[] | null {
  if (!el.wallId) return null
  const cycle = room.cycle ?? []
  if (!cycle.length) return null
  const starts = new Set(cycle.filter((f) => f.wallId === el.wallId).map((f) => f.cornerId))
  return roomWalls(room).filter((w) => starts.has(w.start.id))
}

/** Doors and openings owned by OTHER rooms that lie on a wall of `room` (shown dashed). */
export function adjacentItems(doc: PlanDoc, room: Room) {
  const out: { kind: 'door' | 'opening'; p0: Vec; p1: Vec; inward: Vec }[] = []
  const walls = roomWalls(room)
  for (const el of doc.elements) {
    if (el.roomId === room.id || (el.kind !== 'door' && el.kind !== 'opening')) continue
    const owner = doc.rooms.find((r) => r.id === el.roomId)
    if (!owner) continue
    const span = itemSpan(doc, owner, el)
    if (!span) continue
    const hostWalls = sharedHostWalls(room, el)
    if (hostWalls && !hostWalls.length) continue
    for (const w of hostWalls ?? walls) {
      const d = { x: w.end.x - w.start.x, y: w.end.y - w.start.y }
      const dd = d.x * d.x + d.y * d.y
      if (dd < 1e-9) continue
      const off = (p: Vec) => Math.abs((p.x - w.start.x) * d.y - (p.y - w.start.y) * d.x) / Math.sqrt(dd)
      if (off(span.p0) > ADJ_TOLERANCE_CM || off(span.p1) > ADJ_TOLERANCE_CM) continue
      const sp = (p: Vec) => ((p.x - w.start.x) * d.x + (p.y - w.start.y) * d.y) / dd
      const s0 = Math.max(0, Math.min(sp(span.p0), sp(span.p1)))
      const s1 = Math.min(1, Math.max(sp(span.p0), sp(span.p1)))
      if (s1 - s0 < 0.001) continue
      out.push({ kind: el.kind, p0: lerp(w.start, w.end, s0), p1: lerp(w.start, w.end, s1), inward: w.inward })
    }
  }
  return out
}

export const KIND_LABEL: Record<ElementKind, string> = {
  window: 'Window', door: 'Door', opening: 'Opening (no door)', radiator: 'Radiator', other: 'Other',
}

export type ItemField = 'offsetCm' | 'widthCm' | 'heightCm' | 'sillCm' | 'depthCm'
export const KIND_FIELDS: Record<ElementKind, [ItemField, string][]> = {
  window: [['offsetCm', 'From start'], ['widthCm', 'Width'], ['heightCm', 'Height'], ['sillCm', 'Sill height']],
  door: [['offsetCm', 'From start'], ['widthCm', 'Width'], ['heightCm', 'Height']],
  opening: [['offsetCm', 'From start'], ['widthCm', 'Width'], ['heightCm', 'Height']],
  radiator: [['offsetCm', 'From start'], ['widthCm', 'Width'], ['heightCm', 'Height']],
  other: [['offsetCm', 'From start'], ['widthCm', 'Width']],
}

type ItemSizes = Partial<Record<'widthCm' | 'heightCm' | 'sillCm' | 'depthCm', number>>

/** Sensible sizes (cm) a new item gets when its type is chosen. */
export const ITEM_DEFAULTS: Record<ElementKind, ItemSizes> = {
  door: { widthCm: 80, heightCm: 204 },
  window: { widthCm: 120, heightCm: 135, sillCm: 90 },
  opening: { widthCm: 90, heightCm: 204 },
  radiator: { widthCm: 80, heightCm: 60 },
  other: {},
}

const SIZE_KEYS = ['widthCm', 'heightCm', 'sillCm', 'depthCm'] as const

/**
 * Size fields after the type changes from `from` to `to`: values the user never changed (missing, 0 or equal to the
 * old default) take the new default. Values the user typed stay. A missing value is removed, never stored as 0.
 */
export function sizesForKind(el: ItemSizes, from: ElementKind | null, to: ElementKind): ItemSizes {
  const oldD = from ? (ITEM_DEFAULTS[from] ?? {}) : {}, newD = ITEM_DEFAULTS[to] ?? {}
  const out: ItemSizes = {}
  for (const k of SIZE_KEYS) {
    const cur = el[k]
    const untouched = cur == null || cur === 0 || cur === oldD[k]
    const v = untouched ? newD[k] : cur
    if (v != null && v > 0) out[k] = v
  }
  return out
}
