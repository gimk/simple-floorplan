// Pure semantic query engine for PlanDoc (zero React, zero DOM).
import { z } from 'zod'
import { area, cross, dist, dot, lerp, roomAreaM2, roomWalls, sub, wallByStart } from '../model/geometry'
import { allSurveyIds, roomsInWalkOrder, surveyIds } from '../model/survey'
import type { PlanDoc, Room, Vec, WallType } from '../model/types'
import { calcAll, calcRoom, DEFAULT_INPUTS, effectiveCeilingCm, type CalcInputs } from '../features/export/calc'
import { overflows, wallThickness } from '../features/elements/geometry'
import {
  discrepancy,
  docProgress,
  oppositeWallNotes,
  roomProgress,
  squarenessCheck,
  wallRefLength,
} from '../features/measure/logic'
import { selfIntersects } from '../features/rooms/crossing'
import { wallProps } from '../features/rooms/walls'

export class QueryError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'QueryError'
    this.code = code
  }
}

// ---------- Zod schemas for POST /api/projects/:id/query ----------

export const SummaryArgsSchema = z
  .object({
    wastePct: z.number().finite().min(0).max(100).optional(),
    coats: z.number().finite().min(1).max(10).optional(),
    coverage: z.number().finite().positive().optional(),
  })
  .optional()

export const UnmeasuredArgsSchema = z
  .object({
    roomId: z.string().optional(),
    roomCode: z.string().optional(),
  })
  .optional()

export const ValidateArgsSchema = z
  .object({
    roomId: z.string().optional(),
    roomCode: z.string().optional(),
  })
  .optional()

export const SharedWallsArgsSchema = z
  .object({
    roomCodes: z.array(z.string()).optional(),
    roomIds: z.array(z.string()).optional(),
    maxGapCm: z.number().finite().min(0).max(200).optional(),
    minOverlapCm: z.number().finite().min(0).optional(),
  })
  .optional()

export const RoomArgsSchema = z
  .object({
    roomId: z.string().optional(),
    roomCode: z.string().optional(),
  })
  .refine((v) => Boolean(v.roomId || v.roomCode), {
    message: 'room query requires roomId or roomCode',
  })

export const QueryRequestSchema = z.discriminatedUnion('query', [
  z.object({ query: z.literal('summary'), args: SummaryArgsSchema }),
  z.object({ query: z.literal('unmeasured'), args: UnmeasuredArgsSchema }),
  z.object({ query: z.literal('validate'), args: ValidateArgsSchema }),
  z.object({ query: z.literal('shared_walls'), args: SharedWallsArgsSchema }),
  z.object({ query: z.literal('room'), args: RoomArgsSchema }),
])

export type QueryRequest = z.infer<typeof QueryRequestSchema>

// ---------- helpers ----------

const round2 = (n: number) => Math.round(n * 100) / 100
const round1 = (n: number) => Math.round(n * 10) / 10

function findRoom(doc: PlanDoc, ref?: { roomId?: string; roomCode?: string }): Room | undefined {
  if (!ref) return undefined
  if (ref.roomId) return doc.rooms.find((r) => r.id === ref.roomId)
  if (ref.roomCode) return doc.rooms.find((r) => r.code === ref.roomCode)
  return undefined
}

function filterRooms(doc: PlanDoc, ref?: { roomId?: string; roomCode?: string }): Room[] {
  if (!ref || (!ref.roomId && !ref.roomCode)) return roomsInWalkOrder(doc)
  const room = findRoom(doc, ref)
  return room ? [room] : []
}

// ---------- 1. summary ----------

export function querySummary(doc: PlanDoc, args?: z.infer<typeof SummaryArgsSchema>) {
  const inp: CalcInputs = {
    wastePct: args?.wastePct ?? DEFAULT_INPUTS.wastePct,
    coats: args?.coats ?? DEFAULT_INPUTS.coats,
    coverage: args?.coverage ?? DEFAULT_INPUTS.coverage,
  }
  const ordered = roomsInWalkOrder(doc)
  const { rows, totals } = calcAll(doc, inp)
  const progress = docProgress(doc)

  let totalIndoorAreaM2 = 0
  let totalOutdoorAreaM2 = 0

  const rooms = ordered.map((r) => {
    const areaM2 = round2(roomAreaM2(r))
    if (r.outdoor) totalOutdoorAreaM2 += areaM2
    else totalIndoorAreaM2 += areaM2
    const rp = roomProgress(doc, r)
    const walls = roomWalls(r)
    const perimeterM = round2(walls.reduce((s, w) => s + w.length, 0) / 100)
    const elementCount = (doc.elements ?? []).filter((e) => e.roomId === r.id).length
    return {
      id: r.id,
      code: r.code,
      name: r.name,
      areaM2,
      perimeterM,
      ceilingCm: effectiveCeilingCm(doc, r),
      ceilingFromApartment: r.ceilingCm === undefined && effectiveCeilingCm(doc, r) !== null,
      outdoor: Boolean(r.outdoor),
      walkOrder: r.walkOrder,
      wallCount: walls.length,
      elementCount,
      measured: { done: rp.done, total: rp.total, state: rp.state },
    }
  })

  return {
    projectId: doc.projectId,
    title: doc.title,
    totalIndoorAreaM2: round2(totalIndoorAreaM2),
    totalOutdoorAreaM2: round2(totalOutdoorAreaM2),
    roomCount: ordered.length,
    elementCount: (doc.elements ?? []).length,
    progress,
    rooms,
    takeoff: {
      inputs: inp,
      rooms: rows.map((r) => ({
        ...r,
        floorM2: round2(r.floorM2),
        flooringM2: round2(r.flooringM2),
        perimeterM: round2(r.perimeterM),
        baseboardM: round2(r.baseboardM),
        wallM2: r.wallM2 === null ? null : round2(r.wallM2),
        paintL: r.paintL === null ? null : round2(r.paintL),
      })),
      totals: {
        floorM2: round2(totals.floorM2),
        flooringM2: round2(totals.flooringM2),
        baseboardM: round2(totals.baseboardM),
        wallM2: round2(totals.wallM2),
        paintL: round2(totals.paintL),
        missingCeiling: totals.missingCeiling,
      },
    },
  }
}

// ---------- 2. unmeasured ----------

export function queryUnmeasured(doc: PlanDoc, args?: z.infer<typeof UnmeasuredArgsSchema>) {
  const targetRoom = args?.roomId || args?.roomCode ? findRoom(doc, args) : undefined
  if ((args?.roomId || args?.roomCode) && !targetRoom) {
    throw new QueryError('ROOM_NOT_FOUND', `Room not found: ${args.roomCode ?? args.roomId}`)
  }
  const ids = (targetRoom ? surveyIds(targetRoom, doc.apartment?.defaultCeilingCm) : allSurveyIds(doc)).filter((s) => !s.optional)
  const roomMap = new Map(doc.rooms.map((r) => [r.id, r]))
  const remaining = ids
    .filter((s) => doc.measurements?.[s.label] == null)
    .map((s) => {
      const r = roomMap.get(s.roomId)
      return {
        label: s.label,
        roomId: s.roomId,
        roomCode: r?.code ?? '',
        roomName: r?.name ?? '',
        kind: s.kind,
        plannedCm: s.plannedCm != null ? round1(s.plannedCm) : null,
      }
    })
  const total = ids.length
  const done = total - remaining.length
  return { done, total, remaining }
}

// ---------- 3. validate ----------

export type ValidationIssue = {
  severity: 'error' | 'warning'
  code: string
  message: string
  roomId?: string
  roomCode?: string
  wallLabel?: string
  elementId?: string
  label?: string
  details?: Record<string, unknown>
}

export function queryValidate(doc: PlanDoc, args?: z.infer<typeof ValidateArgsSchema>) {
  const errors: ValidationIssue[] = []
  const warnings: ValidationIssue[] = []

  const rooms = filterRooms(doc, args)
  if ((args?.roomId || args?.roomCode) && !rooms.length) {
    throw new QueryError('ROOM_NOT_FOUND', `Room not found: ${args.roomCode ?? args.roomId}`)
  }

  // Duplicate room codes across whole doc
  const codeCounts = new Map<string, number>()
  for (const r of doc.rooms) codeCounts.set(r.code, (codeCounts.get(r.code) ?? 0) + 1)
  for (const [code, count] of codeCounts) {
    if (count > 1) {
      errors.push({
        severity: 'error',
        code: 'DUPLICATE_ROOM_CODE',
        roomCode: code,
        message: `Room code "${code}" is used by ${count} rooms.`,
      })
    }
  }

  const roomById = new Map(doc.rooms.map((r) => [r.id, r]))
  const targetRoomIds = new Set(rooms.map((r) => r.id))

  for (const r of rooms) {
    // Polygon validity & self-intersection
    if (r.vertices.length < 3 || area(r.vertices) <= 100) {
      errors.push({
        severity: 'error',
        code: 'INVALID_POLYGON',
        roomId: r.id,
        roomCode: r.code,
        message: `Room ${r.code} (${r.name}) has an invalid polygon (< 3 vertices or area <= 100 cm²).`,
      })
    }
    if (selfIntersects(r.vertices)) {
      errors.push({
        severity: 'error',
        code: 'SELF_INTERSECTION',
        roomId: r.id,
        roomCode: r.code,
        message: `Room ${r.code} (${r.name}) outline self-intersects.`,
      })
    }
    for (let hi = 0; hi < (r.holes ?? []).length; hi++) {
      if (selfIntersects(r.holes[hi])) {
        errors.push({
          severity: 'error',
          code: 'SELF_INTERSECTION',
          roomId: r.id,
          roomCode: r.code,
          message: `Room ${r.code} hole #${hi + 1} self-intersects.`,
        })
      }
    }

    // Measurement discrepancies
    for (const s of surveyIds(r, doc.apartment?.defaultCeilingCm)) {
      const m = doc.measurements?.[s.label]
      if (!m || s.optional) continue
      const d = discrepancy(s.plannedCm, m.actualCm)
      if (d && d.flagged) {
        warnings.push({
          severity: 'warning',
          code: 'DISCREPANCY',
          roomId: r.id,
          roomCode: r.code,
          label: s.label,
          message: `${s.label} differs by ${round1(d.diff)} cm (planned ${round1(s.plannedCm ?? 0)} cm, actual ${round1(m.actualCm)} cm).`,
          details: { plannedCm: round1(s.plannedCm ?? 0), actualCm: round1(m.actualCm), diffCm: round1(d.diff) },
        })
      }
    }

    // Squareness check
    const sq = squarenessCheck(doc, r)
    if (sq && !sq.ok) {
      warnings.push({
        severity: 'warning',
        code: 'NOT_SQUARE',
        roomId: r.id,
        roomCode: r.code,
        message: `Room ${r.code} diagonal differs from square by ${round1(sq.diff)} cm (expected ${round1(sq.expected)} cm, actual ${round1(sq.actual)} cm).`,
        details: { expectedDiagCm: round1(sq.expected), actualDiagCm: round1(sq.actual), diffCm: round1(sq.diff) },
      })
    }

    // Opposite wall notes
    for (const opp of oppositeWallNotes(doc, r)) {
      warnings.push({
        severity: 'warning',
        code: 'OPPOSITE_WALL_DIFF',
        roomId: r.id,
        roomCode: r.code,
        message: `Opposite walls ${opp.a} and ${opp.b} differ by ${round1(Math.abs(opp.diff))} cm.`,
        details: { wallA: opp.a, wallB: opp.b, diffCm: round1(opp.diff) },
      })
    }
  }

  // Elements: dangling, overflow, overlapping
  const byWall = new Map<string, { room: Room; wallLabel: string; wallLength: number; els: PlanDoc['elements'] }>()

  for (const el of doc.elements ?? []) {
    const room = roomById.get(el.roomId)
    if (!room) {
      if (!args?.roomId && !args?.roomCode) {
        errors.push({
          severity: 'error',
          code: 'DANGLING_ELEMENT',
          elementId: el.id,
          message: `Element ${el.id} references missing room ${el.roomId}.`,
        })
      }
      continue
    }
    if (!targetRoomIds.has(room.id)) continue

    const wall = wallByStart(room, el.wallStart)
    if (!wall) {
      errors.push({
        severity: 'error',
        code: 'DANGLING_ELEMENT',
        roomId: room.id,
        roomCode: room.code,
        elementId: el.id,
        message: `Element ${el.id} references missing wallStart ${el.wallStart} in room ${room.code}.`,
      })
      continue
    }

    const wallLabel = `${room.code}-${wall.index + 1}`
    const refLen = wallRefLength(doc, room, wall)
    if (overflows(el, refLen)) {
      errors.push({
        severity: 'error',
        code: 'ELEMENT_OVERFLOW',
        roomId: room.id,
        roomCode: room.code,
        wallLabel,
        elementId: el.id,
        message: `${el.kind} ${el.id} (offset ${round1(el.offsetCm)} + width ${round1(el.widthCm)} = ${round1(el.offsetCm + el.widthCm)} cm) exceeds wall ${wallLabel} length ${round1(refLen)} cm.`,
        details: { offsetCm: el.offsetCm, widthCm: el.widthCm, wallLengthCm: round1(refLen) },
      })
    }

    const key = `${room.id}:${el.wallStart}`
    const entry = byWall.get(key)
    if (entry) entry.els.push(el)
    else byWall.set(key, { room, wallLabel, wallLength: refLen, els: [el] })
  }

  for (const { room, wallLabel, els } of byWall.values()) {
    if (els.length < 2) continue
    const sorted = [...els].sort((a, b) => a.offsetCm - b.offsetCm)
    for (let i = 0; i < sorted.length; i++) {
      const a = sorted[i]
      const aEnd = a.offsetCm + a.widthCm
      for (let j = i + 1; j < sorted.length; j++) {
        const b = sorted[j]
        if (b.offsetCm >= aEnd - 0.5) break
        const overlapCm = round1(Math.min(aEnd, b.offsetCm + b.widthCm) - b.offsetCm)
        errors.push({
          severity: 'error',
          code: 'ELEMENT_OVERLAP',
          roomId: room.id,
          roomCode: room.code,
          wallLabel,
          elementId: a.id,
          message: `Elements ${a.id} and ${b.id} overlap by ${overlapCm} cm on wall ${wallLabel}.`,
          details: { elementA: a.id, elementB: b.id, overlapCm },
        })
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  }
}

// ---------- 4. shared_walls ----------

export type SharedWall = {
  roomAId: string
  roomBId: string
  roomACode: string
  roomBCode: string
  wallA: string
  wallB: string
  wallStartA: string
  wallStartB: string
  overlapCm: number
  gapCm: number
  typeA: WallType
  typeB: WallType
  thicknessA: number
  thicknessB: number
  isBearing: boolean
  /** Overlap endpoints along wall A (useful for bridging in merge_rooms). */
  segmentA: [Vec, Vec]
  /** Overlap endpoints along wall B (projected onto wall B). */
  segmentB: [Vec, Vec]
}

export function findSharedWalls(
  doc: PlanDoc,
  opts: { roomCodes?: string[]; roomIds?: string[]; maxGapCm?: number; minOverlapCm?: number } = {},
): SharedWall[] {
  const maxGap = opts.maxGapCm ?? 35
  const minOverlap = opts.minOverlapCm ?? 10
  let rooms = doc.rooms
  if (opts.roomIds?.length) {
    const set = new Set(opts.roomIds)
    rooms = rooms.filter((r) => set.has(r.id))
  } else if (opts.roomCodes?.length) {
    const set = new Set(opts.roomCodes)
    rooms = rooms.filter((r) => set.has(r.code))
  }

  const shared: SharedWall[] = []
  for (let i = 0; i < rooms.length; i++) {
    const rA = rooms[i]
    const wallsA = roomWalls(rA)
    for (let j = i + 1; j < rooms.length; j++) {
      const rB = rooms[j]
      const wallsB = roomWalls(rB)
      for (const wA of wallsA) {
        if (wA.length < 1) continue
        for (const wB of wallsB) {
          if (wB.length < 1) continue
          const align = Math.abs(dot(wA.dir, wB.dir))
          if (align < 0.985) continue

          const perpStart = Math.abs(cross(sub(wB.start, wA.start), wA.dir))
          const perpEnd = Math.abs(cross(sub(wB.end, wA.start), wA.dir))
          if (perpStart > maxGap || perpEnd > maxGap) continue

          const t0 = dot(sub(wB.start, wA.start), wA.dir)
          const t1 = dot(sub(wB.end, wA.start), wA.dir)
          const lo = Math.max(0, Math.min(t0, t1))
          const hi = Math.min(wA.length, Math.max(t0, t1))
          const overlapCm = hi - lo
          if (overlapCm < minOverlap) continue

          const gapCm = (perpStart + perpEnd) / 2
          const pA = wallProps(rA, wA.start.id)
          const pB = wallProps(rB, wB.start.id)
          const segA0 = lerp(wA.start, wA.end, lo / wA.length)
          const segA1 = lerp(wA.start, wA.end, hi / wA.length)

          const bLo = Math.max(0, Math.min(dot(sub(segA0, wB.start), wB.dir), dot(sub(segA1, wB.start), wB.dir)))
          const bHi = Math.min(wB.length, Math.max(dot(sub(segA0, wB.start), wB.dir), dot(sub(segA1, wB.start), wB.dir)))
          const segB0 = lerp(wB.start, wB.end, bLo / wB.length)
          const segB1 = lerp(wB.start, wB.end, bHi / wB.length)

          shared.push({
            roomAId: rA.id,
            roomBId: rB.id,
            roomACode: rA.code,
            roomBCode: rB.code,
            wallA: `${rA.code}-${wA.index + 1}`,
            wallB: `${rB.code}-${wB.index + 1}`,
            wallStartA: wA.start.id,
            wallStartB: wB.start.id,
            overlapCm: round1(overlapCm),
            gapCm: round1(gapCm),
            typeA: pA.type,
            typeB: pB.type,
            thicknessA: wallThickness(rA, wA.start.id),
            thicknessB: wallThickness(rB, wB.start.id),
            isBearing: pA.type === 'bearing' || pB.type === 'bearing',
            segmentA: [segA0, segA1],
            segmentB: [segB0, segB1],
          })
        }
      }
    }
  }
  return shared
}

export function querySharedWalls(doc: PlanDoc, args?: z.infer<typeof SharedWallsArgsSchema>) {
  const sharedWalls = findSharedWalls(doc, args ?? {}).map(({ segmentA: _a, segmentB: _b, ...rest }) => rest)
  return { sharedWalls }
}

// ---------- 5. room ----------

export function queryRoom(doc: PlanDoc, args: z.infer<typeof RoomArgsSchema>) {
  const room = findRoom(doc, args)
  if (!room) {
    throw new QueryError('ROOM_NOT_FOUND', `Room not found: ${args.roomCode ?? args.roomId}`)
  }
  const walls = roomWalls(room).map((w) => {
    const label = `${room.code}-${w.index + 1}`
    const props = wallProps(room, w.start.id)
    const meas = doc.measurements?.[label]
    return {
      index: w.index + 1,
      label,
      wallStart: w.start.id,
      wallEnd: w.end.id,
      lengthCm: round1(w.length),
      measuredCm: meas?.actualCm ?? null,
      type: props.type,
      thicknessCm: props.thicknessCm,
      locked: Boolean(props.locked),
    }
  })

  const wallByStartMap = new Map(roomWalls(room).map((w) => [w.start.id, w]))
  const elements = (doc.elements ?? [])
    .filter((e) => e.roomId === room.id)
    .map((e) => {
      const w = wallByStartMap.get(e.wallStart)
      const wallLabel = w ? `${room.code}-${w.index + 1}` : null
      const refLen = w ? wallRefLength(doc, room, w) : 0
      return {
        ...e,
        wallLabel,
        overflows: w ? overflows(e, refLen) : true,
      }
    })

  const measurements: Record<string, { label: string; actualCm: number; updatedAt: string }> = {}
  for (const s of surveyIds(room, doc.apartment?.defaultCeilingCm)) {
    const m = doc.measurements?.[s.label]
    if (m) measurements[s.label] = m
  }

  const calc = calcRoom(doc, room, DEFAULT_INPUTS)
  const sq = squarenessCheck(doc, room)
  const opp = oppositeWallNotes(doc, room)

  return {
    id: room.id,
    code: room.code,
    name: room.name,
    areaM2: round2(roomAreaM2(room)),
    perimeterM: round2(roomWalls(room).reduce((s, w) => s + w.length, 0) / 100),
    ceilingCm: effectiveCeilingCm(doc, room),
    outdoor: Boolean(room.outdoor),
    walkOrder: room.walkOrder,
    diagonal: room.diagonal ?? null,
    vertices: room.vertices,
    holes: room.holes,
    walls,
    elements,
    measurements,
    note: doc.roomNotes?.[room.code] ?? '',
    takeoff: {
      floorM2: round2(calc.floorM2),
      flooringM2: round2(calc.flooringM2),
      perimeterM: round2(calc.perimeterM),
      baseboardM: round2(calc.baseboardM),
      ceilingCm: calc.ceilingCm,
      wallM2: calc.wallM2 === null ? null : round2(calc.wallM2),
      paintL: calc.paintL === null ? null : round2(calc.paintL),
    },
    squareness: sq
      ? { expectedCm: round1(sq.expected), actualCm: round1(sq.actual), diffCm: round1(sq.diff), ok: sq.ok }
      : null,
    oppositeWalls: opp.map((o) => ({ wallA: o.a, wallB: o.b, diffCm: round1(o.diff) })),
    progress: roomProgress(doc, room),
  }
}

// ---------- dispatcher ----------

export function runQuery(doc: PlanDoc, rawRequest: unknown) {
  const req = QueryRequestSchema.parse(rawRequest)
  switch (req.query) {
    case 'summary':
      return querySummary(doc, req.args)
    case 'unmeasured':
      return queryUnmeasured(doc, req.args)
    case 'validate':
      return queryValidate(doc, req.args)
    case 'shared_walls':
      return querySharedWalls(doc, req.args)
    case 'room':
      return queryRoom(doc, req.args)
  }
}

export { dist }
