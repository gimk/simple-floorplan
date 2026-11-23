// Survey export rows (planned vs measured, items) for CSV and PDF.
import { allSurveyIds, roomsInWalkOrder } from '../../model/survey'
import { roomWalls } from '../../model/geometry'
import type { PlanDoc } from '../../model/types'
import { KIND_LABEL } from '../elements/geometry'
import { markRows } from '../photosketch/logic'
import { toCsv } from './csv'

export type SurveyRow = {
  roomCode: string; roomName: string; id: string; kind: string
  plannedCm: number | null; measuredCm: number | null; diffCm: number | null; status: 'verified' | 'estimated'; notes: string
  /** Not needed to finish the survey (wall thickness). */
  optional?: boolean
}
export type ItemRow = {
  roomCode: string; roomName: string; wall: string; type: string
  fromStartCm: number; widthCm: number; heightCm: number | null; sillCm: number | null; depthCm: number | null; note: string
}

const r1 = (v: number) => Math.round(v * 10) / 10

export function surveyRows(doc: PlanDoc): SurveyRow[] {
  const byId = new Map(doc.rooms.map((r) => [r.id, r]))
  const seenRoom = new Set<string>()
  return allSurveyIds(doc).map((s) => {
    const room = byId.get(s.roomId)!
    const m = doc.measurements?.[s.label]
    const planned = s.plannedCm !== undefined ? r1(s.plannedCm) : null
    const measured = m ? r1(m.actualCm) : null
    // The room note goes on the first row of each room.
    let notes = ''
    if (!seenRoom.has(room.id)) { seenRoom.add(room.id); notes = doc.roomNotes?.[room.code] ?? '' }
    return {
      roomCode: room.code, roomName: room.name, id: s.label, kind: s.kind,
      plannedCm: planned, measuredCm: measured,
      diffCm: planned !== null && measured !== null ? r1(measured - planned) : null,
      status: m ? 'verified' : 'estimated', notes,
      ...(s.optional ? { optional: true } : {}),
    }
  })
}

export function itemRows(doc: PlanDoc): ItemRow[] {
  const out: ItemRow[] = []
  for (const room of roomsInWalkOrder(doc)) {
    const walls = roomWalls(room)
    for (const e of (doc.elements ?? []).filter((x) => x.roomId === room.id)) {
      const w = walls.find((x) => x.start.id === e.wallStart)
      out.push({
        roomCode: room.code, roomName: room.name,
        wall: w ? `${room.code}-${w.index + 1}` : '?',
        type: KIND_LABEL[e.kind] + (e.variant ? ` (${e.variant})` : ''),
        fromStartCm: r1(e.offsetCm), widthCm: r1(e.widthCm),
        heightCm: e.heightCm ?? null, sillCm: e.sillCm ?? null, depthCm: e.depthCm ?? null, note: e.note ?? '',
      })
    }
  }
  return out
}

export const SURVEY_HEAD = ['room code', 'room name', 'id', 'kind', 'planned cm', 'measured cm', 'diff cm', 'status', 'notes']
export const ITEM_HEAD = ['room', 'wall label', 'type', 'from start cm', 'width cm', 'height cm', 'sill cm', 'depth cm', 'note']
/** Dimension marks drawn on pin photos (docs/plan.md 7.4). */
export const MARK_HEAD = ['pin', 'room', 'photo index', 'value cm', 'label', 'note']

export function surveyCsv(doc: PlanDoc): string {
  const a = surveyRows(doc).map((r) => [r.roomCode, r.roomName, r.id, r.kind, r.plannedCm, r.measuredCm, r.diffCm, r.status, r.notes])
  const b = itemRows(doc).map((r) => [r.roomCode, r.wall, r.type, r.fromStartCm, r.widthCm, r.heightCm, r.sillCm, r.depthCm, r.note])
  const c = markRows(doc).map((r) => [r.pin, r.roomCode, r.photoIndex, r.valueCm, r.label, r.note])
  // Items start a second table after one blank line, photo marks a third one.
  return toCsv([SURVEY_HEAD, ...a, [], ITEM_HEAD, ...b, ...(c.length ? [[], MARK_HEAD, ...c] : [])])
}
