// .sfp import into a v2 project (docs/walls-plan.md phase 5c). The text holds the rooms, the
// elements and the values, not the wall graph, the old values, the traced walls, the rounding
// precision nor the conversion report: an import must keep them, and the values must follow their
// labels in the NEW graph (review finding 2).
import { describe, expect, it } from 'vitest'
import { emptyDoc } from '../model/store'
import type { Measurement, PlanDoc, Room, TraceWall } from '../model/types'
import { ensureV2 } from '../model/v2/ensure'
import { addStandaloneWall } from '../model/v2/write'
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

  it('keeps the old values, the conversion report and the precision', () => {
    const base = project()
    const imported = dslToPlan(planToDsl(base), base, { now: AT })

    expect(imported.oldMeasurements).toEqual(base.oldMeasurements)
    // The report of the project, with its `seen` flag: it is not shown again.
    expect(imported.conversion).toEqual(base.conversion)
    expect(imported.conversion?.seen).toBe(true)
    // A v2 project has no traces: the traced wall of the project is a STANDALONE wall of the graph
    // (docs/walls-plan.md, "Walls in the interface": src/model/v2/ensure.ts, tracesToWalls). The
    // text does not hold the wall graph, so an import rebuilds it from the rooms of the text.
    expect(base.traces).toEqual([])
    // The trace lies on the wall of SE (0,0)-(400,0): that wall already holds it, so no second wall is stored.
    expect((base.walls ?? []).filter((w) => w.standalone).length).toBe(0)
    expect((base.walls ?? []).length).toBe(4)
    expect(imported.traces).toEqual([])
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

// The .sfp text holds the rooms, the elements and the values, not the walls of the graph. A wall
// that the user drew (a STANDALONE wall, docs/walls-plan.md "Walls in the interface") is therefore
// added again to the graph of the import, with its properties: an import must not delete walls.
describe('.sfp import into a v2 project: the standalone walls of the project', () => {
  /** The project with one wall drawn in the middle of nothing: (1000,0) -> (1000,200), 20 cm. */
  const withDrawnWall = () => {
    const base = project()
    const out = addStandaloneWall(base, { x: 1000, y: 0 }, { x: 1000, y: 200 }, { type: 'bearing', thicknessCm: 20 })
    expect(out.wallId).not.toBeNull()
    return { doc: out.doc, wallId: out.wallId! }
  }

  it('adds the walls that the user drew again, with their properties and their ids', () => {
    const { doc, wallId } = withDrawnWall()
    const wall = (doc.walls ?? []).find((w) => w.id === wallId)!
    expect(wall.standalone).toBe(true)
    const imported = dslToPlan(planToDsl(doc), doc, { now: AT })

    // The same wall is in the graph of the import: same place, same type, same thickness.
    const back = (imported.walls ?? []).find((w) => w.id === wallId)
    expect(back).toBeDefined()
    expect(back!.standalone).toBe(true)
    expect(back!.type).toBe('bearing')
    expect(back!.thicknessCm).toBe(20)
    const nodes = new Map((imported.nodes ?? []).map((n) => [n.id, n]))
    expect(nodes.has(back!.a)).toBe(true)
    expect(nodes.has(back!.b)).toBe(true)
    // The project keeps its id on the wall and on the two nodes (they are free in the import).
    expect([back!.a, back!.b].sort()).toEqual([wall.a, wall.b].sort())
    // Every standalone wall of the project is in the graph of the import, one time each.
    const drawn = (doc.walls ?? []).filter((w) => w.standalone).map((w) => w.id).sort()
    const carried = (imported.walls ?? []).filter((w) => w.standalone).map((w) => w.id).sort()
    expect(carried).toEqual(drawn)
    // The rooms are unchanged, and the graph holds them.
    expect(imported.rooms.map((r) => r.code)).toEqual(doc.rooms.map((r) => r.code))
    expect(imported.rooms.every((r) => (r.cycle?.length ?? 0) === r.vertices.length)).toBe(true)
    expect(imported.traces).toEqual([])
  })

  it('keeps the walls of a project whose text holds another room order', () => {
    // A room AA comes before SE in the text: the walls of the new graph are not the walls of the
    // project, so the drawn wall must be added by its place, not by its id.
    const { doc, wallId } = withDrawnWall()
    const withAA = ensureV2(
      { ...doc, rooms: [room('aa', 'AA', 2000, 0, 200, 200, 1), { ...doc.rooms[0], walkOrder: 2 }] },
      { now: AT },
    )
    const imported = dslToPlan(planToDsl(withAA), doc, { now: AT })
    const carried = (imported.walls ?? []).filter((w) => w.standalone)
    expect(carried.length).toBe((doc.walls ?? []).filter((w) => w.standalone).length)
    // The drawn wall is carried by its PLACE: its id is one of the walls of the new graph (an id of
    // the project is kept only when the import is free to give it), so it gets a new one.
    const nodes = new Map((imported.nodes ?? []).map((n) => [n.id, n]))
    const at = (w: typeof carried[number]) => [nodes.get(w.a)!, nodes.get(w.b)!]
    expect(carried.some((w) => [w.a, w.b].some((id) => id === wallId))).toBe(false)
    const drawn = carried.find((w) => w.thicknessCm === 20 && w.type === 'bearing')
    expect(drawn).toBeDefined()
    const [p, q] = at(drawn!)
    expect(Math.min(p.x, q.x)).toBe(1000)
    expect(Math.abs(p.y - q.y)).toBe(200)
  })
})
