// Pure material calculators. World units are cm; outputs are m / m² / litres.
import { roomAreaM2, roomWalls } from '../../model/geometry'
import type { PlanDoc, Room, WallElement } from '../../model/types'

export type CalcInputs = { wastePct: number; coats: number; coverage: number }
export const DEFAULT_INPUTS: CalcInputs = { wastePct: 10, coats: 2, coverage: 10 }

/** Fallback heights (cm) when an element has no height set. */
export const DEFAULT_HEIGHT = { door: 205, opening: 205, window: 120 } as const

export type RoomCalc = {
  roomId: string
  code: string
  name: string
  floorM2: number
  flooringM2: number
  perimeterM: number
  baseboardM: number
  ceilingCm: number | null
  /** null when ceiling height is unknown */
  wallM2: number | null
  paintL: number | null
}

/** Wall length: verified value if present, else traced. */
export const effectiveWallLengths = (doc: PlanDoc, room: Room): number[] =>
  roomWalls(room).map((w) => {
    const m = doc.measurements?.[`${room.code}-${w.index + 1}`]
    return m && m.actualCm > 0 ? m.actualCm : w.length
  })

/**
 * Ceiling height used for takeoffs, in cm, or null when unknown.
 * Order: verified measurement (`<CODE>-H`) > room.ceilingCm > doc.apartment.defaultCeilingCm.
 * This is the ONLY place ceiling height is resolved: always call it instead of reading
 * `room.ceilingCm` directly.
 */
export const effectiveCeilingCm = (doc: PlanDoc, room: Room): number | null => {
  const m = doc.measurements?.[`${room.code}-H`]
  const v = m && m.actualCm > 0 ? m.actualCm : (room.ceilingCm ?? doc.apartment?.defaultCeilingCm)
  return v && v > 0 ? v : null
}

/** True when the room sets its own height, so the apartment default does not apply. */
export const hasOwnCeiling = (room: Room): boolean =>
  room.ceilingCm !== undefined && room.ceilingCm > 0

const elHeight = (e: WallElement) =>
  e.heightCm && e.heightCm > 0 ? e.heightCm : e.kind === 'window' ? DEFAULT_HEIGHT.window : DEFAULT_HEIGHT.door

export function calcRoom(doc: PlanDoc, room: Room, inp: CalcInputs): RoomCalc {
  const els = (doc.elements ?? []).filter((e) => e.roomId === room.id)
  const perimeterCm = effectiveWallLengths(doc, room).reduce((a, b) => a + b, 0)
  const doorWidthCm = els.filter((e) => e.kind === 'door' || e.kind === 'opening').reduce((s, e) => s + e.widthCm, 0)
  const openingAreaM2 = els
    .filter((e) => e.kind === 'door' || e.kind === 'opening' || e.kind === 'window')
    .reduce((s, e) => s + (e.widthCm * elHeight(e)) / 10000, 0)
  const floorM2 = roomAreaM2(room)
  const ceilingCm = effectiveCeilingCm(doc, room)
  const wallM2 = ceilingCm === null ? null : Math.max(0, (perimeterCm * ceilingCm) / 10000 - openingAreaM2)
  return {
    roomId: room.id, code: room.code, name: room.name,
    floorM2,
    flooringM2: floorM2 * (1 + inp.wastePct / 100),
    perimeterM: perimeterCm / 100,
    baseboardM: Math.max(0, perimeterCm - doorWidthCm) / 100,
    ceilingCm,
    wallM2,
    paintL: wallM2 === null || inp.coverage <= 0 ? null : (wallM2 * inp.coats) / inp.coverage,
  }
}

export type CalcTotals = { floorM2: number; flooringM2: number; baseboardM: number; wallM2: number; paintL: number; missingCeiling: number }

/** Outdoor rooms (balcony etc.) are excluded from interior material estimates. */
export function calcAll(doc: PlanDoc, inp: CalcInputs): { rows: RoomCalc[]; totals: CalcTotals } {
  const rows = doc.rooms.filter((r) => !r.outdoor).map((r) => calcRoom(doc, r, inp))
  const totals = rows.reduce<CalcTotals>((t, r) => ({
    floorM2: t.floorM2 + r.floorM2,
    flooringM2: t.flooringM2 + r.flooringM2,
    baseboardM: t.baseboardM + r.baseboardM,
    wallM2: t.wallM2 + (r.wallM2 ?? 0),
    paintL: t.paintL + (r.paintL ?? 0),
    missingCeiling: t.missingCeiling + (r.ceilingCm === null ? 1 : 0),
  }), { floorM2: 0, flooringM2: 0, baseboardM: 0, wallM2: 0, paintL: 0, missingCeiling: 0 })
  return { rows, totals }
}

const n2 = (v: number | null) => (v === null ? '' : (Math.round(v * 100) / 100).toString())

export function calcCsvRows(rows: RoomCalc[], totals: CalcTotals): (string | number)[][] {
  const head = ['code', 'room', 'floor m2', 'flooring m2 (with waste)', 'baseboard m', 'wall surface m2', 'paint L']
  const body = rows.map((r) => [r.code, r.name, n2(r.floorM2), n2(r.flooringM2), n2(r.baseboardM), n2(r.wallM2), n2(r.paintL)])
  return [head, ...body, ['', 'TOTAL', n2(totals.floorM2), n2(totals.flooringM2), n2(totals.baseboardM), n2(totals.wallM2), n2(totals.paintL)]]
}
