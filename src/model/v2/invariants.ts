// Checks that a v1 -> v2 conversion keeps the survey view of a plan (docs/walls-plan.md, phase 5c).
// Pure. Used by the tests of this folder, and by the conversion report of step 4 to refuse a
// conversion that would move a value or a label.
//
// What must not change: the rooms (same codes, walk order, number of corners, corner ids in the same
// order, holes), the corner positions (within 0.5 cm: the copies of a merged wall can be a little
// apart), the floor areas (within 0.05 m²), the survey labels in the same order, and every stored
// part of the document that the conversion does not touch (measurements, elements, pins, notes).

import { dist, roomAreaM2 } from '../geometry'
import { surveyIds } from '../survey'
import type { PlanDoc } from '../types'

/** A corner of a room may move this much in the conversion (cm). */
export const CORNER_TOL_CM = 0.5
/** A room area may change this much in the conversion (m²). */
export const AREA_TOL_M2 = 0.05

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/**
 * An element without the v2-only fields (docs/walls-plan.md phase 7): `wallId` and `alongCm` are
 * added by the load step from the view, so the conversion may add them. What must not change is the
 * VIEW (roomId, wallStart, offsetCm) and the sizes of the element.
 */
const elementViews = (elements: PlanDoc['elements']) =>
  elements.map((el) => {
    const { wallId: _wall, alongCm: _along, elementMoved: _moved, ...rest } = el
    return rest
  })

/**
 * Problems that make the converted document a different plan (empty = the conversion kept
 * everything). The text uses room codes and ids only, never a measured value.
 */
export function conversionProblems(before: PlanDoc, after: PlanDoc): string[] {
  const problems: string[] = []
  const afterById = new Map(after.rooms.map((r) => [r.id, r]))
  for (const r of before.rooms) {
    const a = afterById.get(r.id)
    if (!a) {
      problems.push(`room ${r.code}: gone`)
      continue
    }
    if (a.code !== r.code) problems.push(`room ${r.id}: code ${a.code}, was ${r.code}`)
    if (a.walkOrder !== r.walkOrder) problems.push(`room ${r.code}: walk order ${a.walkOrder}, was ${r.walkOrder}`)
    if (!sameJson(a.holes, r.holes)) problems.push(`room ${r.code}: holes changed`)
    if (a.vertices.length !== r.vertices.length) {
      problems.push(`room ${r.code}: ${a.vertices.length} corners, was ${r.vertices.length}`)
    } else {
      r.vertices.forEach((v, i) => {
        const w = a.vertices[i]
        if (w.id !== v.id) problems.push(`room ${r.code}: corner ${i} is ${w.id}, was ${v.id}`)
        else if (dist(w, v) > CORNER_TOL_CM) problems.push(`room ${r.code}: corner ${v.id} moved ${Math.round(dist(w, v) * 10) / 10} cm`)
      })
    }
    const areaBefore = roomAreaM2(r)
    const areaAfter = roomAreaM2(a)
    if (Math.abs(areaAfter - areaBefore) > AREA_TOL_M2) {
      problems.push(`room ${r.code}: area ${Math.round(areaAfter * 100) / 100} m², was ${Math.round(areaBefore * 100) / 100} m²`)
    }
    const labels = (room: typeof r) => surveyIds(room).map((s) => s.label).join(',')
    if (labels(a) !== labels(r)) problems.push(`room ${r.code}: survey labels changed`)
  }
  if (after.rooms.length !== before.rooms.length) {
    problems.push(`${after.rooms.length} rooms, was ${before.rooms.length}`)
  }
  // Parts that the conversion must not touch.
  if (!sameJson(after.measurements, before.measurements)) problems.push('measurements changed')
  if (!sameJson(elementViews(after.elements), elementViews(before.elements))) problems.push('elements changed')
  if (!sameJson(after.roomNotes, before.roomNotes)) problems.push('room notes changed')
  if (!sameJson(after.tapes, before.tapes)) problems.push('tapes changed')
  if (!sameJson(after.pins, before.pins)) problems.push('pins changed')
  if (!sameJson(after.oldMeasurements, before.oldMeasurements)) problems.push('old values changed')
  if (!sameJson(after.traces, before.traces)) problems.push('traces changed')
  if (!sameJson(after.apartment, before.apartment)) problems.push('apartment data changed')
  return problems
}
