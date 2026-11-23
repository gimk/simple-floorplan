// .sfp import into a v2 project (docs/walls-plan.md phase 5c). The text holds the rooms, the
// elements and the values, not the wall graph, the old values, the traced walls, the rounding
// precision nor the conversion report: an import must keep them, and the values must follow their
// labels in the NEW graph (review finding 2).
import { describe, expect, it } from 'vitest'
import { emptyDoc } from '../model/store'
import type { Measurement, PlanDoc, Room, TraceWall } from '../model/types'
import { ensureV2 } from '../model/v2/ensure'
import { isV2Doc, labelOfTarget } from '../model/v2/targets'
import { dslToPlan, planToDsl } from './dsl'

const AT = '2026-11-24T10:00:00.000Z'

const room = (id: string, code: string, x: number, y: number, w: number, h: number, walkOrder: number): Room => ({
  id,
  code,
  name: code,
  vertices: [
    { id: `${id}-v0`, x, y },
    { id: `${id}-v1`, x: x + w, y },
    { id: `${id}-v2`, x: x + w, y: y + h },
    { id: `${id}-v3`, x, y: y + h },
  ],
  holes: [],
  walls: {},
  walkOrder,
})

const values = (): Record<string, Measurement> => ({
  'SE-1': { label: 'SE-1', actualCm: 401, updatedAt: AT },
  'SE-2': { label: 'SE-2', actualCm: 302, updatedAt: AT },
  'SE-3': { label: 'SE-3', actualCm: 403, updatedAt: AT },
  'SE-4': { label: 'SE-4', actualCm: 304, updatedAt: AT },
})

const trace: TraceWall = { id: 'T1', a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, thicknessCm: 10, type: 'partition' }

/** A v2 project: one room SE, with a value on each wall, old values, a traced wall and a report. */
const project = (): PlanDoc => {
  const v1: PlanDoc = {
    ...emptyDoc(),
    projectId: 'p1',
    title: 'Projet',
    rooms: [room('se', 'SE', 0, 0, 400, 300, 1)],
    measurements: values(),
    traces: [trace],
    apartment: { precisionCm: 1, references: [] },
    oldMeasurements: [{ label: 'SE-9', actualCm: 111, updatedAt: AT, roomCode: 'SE', reason: 'wall-split', droppedAt: AT }],
  }
  const v2 = ensureV2(v1, { now: AT })
  // The report is already shown to the user: an import must not show it again.
  return { ...v2, conversion: { ...v2.conversion!, seen: true } }
}

describe('.sfp import into a v2 project (review finding 2)', () => {
  it('keeps the target of each value on its own wall of the new graph', () => {
    const base = project()
    expect(isV2Doc(base)).toBe(true)
    const seId = base.rooms[0].id
    expect(labelOfTarget(base, base.measurements['SE-1'].target!)).toBe('SE-1')

    // The .sfp text of a plan where a room AA comes BEFORE SE: the wall numbers of the new graph
    // are not the wall numbers of this project any more.
    const withAA = ensureV2(
      { ...base, rooms: [room('aa', 'AA', 2000, 0, 200, 200, 1), { ...base.rooms[0], walkOrder: 2 }] },
      { now: AT },
    )
    const imported = dslToPlan(planToDsl(withAA), base, { now: AT })

    expect(isV2Doc(imported)).toBe(true)
    // Every value of SE still measures the face of SE, whatever the number of its wall now is.
    for (const label of Object.keys(values())) {
      const target = imported.measurements[label].target
      expect(target).toBeDefined()
      expect(target!.roomId).toBe(seId)
      expect(labelOfTarget(imported, target!)).toBe(label)
    }
    // The values themselves are the values of the text.
    expect(imported.measurements['SE-1'].actualCm).toBe(401)
  })

  it('keeps the old values, the conversion report, the traced walls and the precision', () => {
    const base = project()
    const imported = dslToPlan(planToDsl(base), base, { now: AT })

    expect(imported.oldMeasurements).toEqual(base.oldMeasurements)
    // The report of the project, with its `seen` flag: it is not shown again.
    expect(imported.conversion).toEqual(base.conversion)
    expect(imported.conversion?.seen).toBe(true)
    expect(imported.traces).toEqual([trace])
    expect(imported.apartment?.precisionCm).toBe(1)
  })

  it('a v1 project keeps the document of the text, as before', () => {
    const v1: PlanDoc = { ...emptyDoc(), projectId: 'p1', rooms: [room('se', 'SE', 0, 0, 400, 300, 1)], measurements: values() }
    const out = dslToPlan(planToDsl(v1), v1, { now: AT })
    expect(out.schemaVersion).toBe(1)
    // No target is copied from a v1 document (a v1 document has none to give).
    expect(out.measurements['SE-1'].target).toBeUndefined()
  })
})
