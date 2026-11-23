// Pure logic for Measuring Mode. No React here, so it is easy to test.
import { lerp, roomWalls } from '../../model/geometry'
import type { Wall } from '../../model/geometry'
import { allSurveyIds, surveyIds } from '../../model/survey'
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
export function nextUnmeasuredLabel(doc: Pick<PlanDoc, 'measurements'>, labels: string[], current: string | null): string | null {
  if (!labels.length) return null
  const start = current ? labels.indexOf(current) : -1
  for (let k = 1; k <= labels.length; k++) {
    const i = (((start + k) % labels.length) + labels.length) % labels.length
    if (doc.measurements[labels[i]] == null) return labels[i]
  }
  return null
}

/** True when at least one survey ID of the room has no measured value yet. */
export function roomHasMissing(doc: Pick<PlanDoc, 'measurements'>, room: Room): boolean {
  return surveyIds(room).some((s) => doc.measurements[s.label] == null)
}

/** True when the room has a flagged discrepancy (> 2 cm vs plan) or a squareness warning. */
export function roomIsFlagged(doc: Pick<PlanDoc, 'measurements'> & { apartment?: PlanDoc['apartment'] }, room: Room): boolean {
  const flagged = surveyIds(room, doc.apartment?.defaultCeilingCm).some((s) => {
    const m = doc.measurements[s.label]
    if (m == null || s.plannedCm == null) return false
    return Math.abs(m.actualCm - s.plannedCm) > DISCREPANCY_CM
  })
  if (flagged) return true
  const sq = squarenessCheck(doc, room)
  return sq != null && !sq.ok
}

export function roomProgress(doc: PlanDoc, room: Room) {
  const ids = surveyIds(room)
  const done = ids.filter((s) => doc.measurements[s.label] != null).length
  const total = ids.length
  return { done, total, state: (done === 0 ? 'none' : done === total ? 'full' : 'part') as 'none' | 'part' | 'full' }
}

export function docProgress(doc: PlanDoc) {
  const ids = allSurveyIds(doc)
  const done = ids.filter((s) => doc.measurements[s.label] != null).length
  return { done, total: ids.length }
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
    for (const w of walls) {
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
  window: 'Window', door: 'Door', opening: 'Opening (no door)', cupboard: 'Cupboard', radiator: 'Radiator', other: 'Other',
}

export type ItemField = 'offsetCm' | 'widthCm' | 'heightCm' | 'sillCm' | 'depthCm'
export const KIND_FIELDS: Record<ElementKind, [ItemField, string][]> = {
  window: [['offsetCm', 'From start'], ['widthCm', 'Width'], ['heightCm', 'Height'], ['sillCm', 'Sill height']],
  door: [['offsetCm', 'From start'], ['widthCm', 'Width'], ['heightCm', 'Height']],
  opening: [['offsetCm', 'From start'], ['widthCm', 'Width'], ['heightCm', 'Height']],
  cupboard: [['offsetCm', 'From start'], ['widthCm', 'Width'], ['depthCm', 'Depth'], ['heightCm', 'Height']],
  radiator: [['offsetCm', 'From start'], ['widthCm', 'Width'], ['heightCm', 'Height']],
  other: [['offsetCm', 'From start'], ['widthCm', 'Width']],
}

type ItemSizes = Partial<Record<'widthCm' | 'heightCm' | 'sillCm' | 'depthCm', number>>

/** Sensible sizes (cm) a new item gets when its type is chosen. */
export const ITEM_DEFAULTS: Record<ElementKind, ItemSizes> = {
  door: { widthCm: 80, heightCm: 204 },
  window: { widthCm: 120, heightCm: 135, sillCm: 90 },
  opening: { widthCm: 90, heightCm: 204 },
  cupboard: { widthCm: 100, depthCm: 60 },
  radiator: { widthCm: 80, heightCm: 60 },
  other: {},
}

const SIZE_KEYS = ['widthCm', 'heightCm', 'sillCm', 'depthCm'] as const

/**
 * Size fields after the type changes from `from` to `to`: values the user never changed (missing, 0 or equal to the
 * old default) take the new default. Values the user typed stay. A missing value is removed, never stored as 0.
 */
export function sizesForKind(el: ItemSizes, from: ElementKind | null, to: ElementKind): ItemSizes {
  const oldD = from ? ITEM_DEFAULTS[from] : {}, newD = ITEM_DEFAULTS[to]
  const out: ItemSizes = {}
  for (const k of SIZE_KEYS) {
    const cur = el[k]
    const untouched = cur == null || cur === 0 || cur === oldD[k]
    const v = untouched ? newD[k] : cur
    if (v != null && v > 0) out[k] = v
  }
  return out
}
