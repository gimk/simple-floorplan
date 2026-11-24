// The merge_rooms command on a v2 document (docs/walls-plan.md, "Walls in the interface"): the wall
// between the two rooms that became ONE space is not a wall of the plan any more, so it goes away,
// and the walls of the outside stay. No value is lost: a value whose face is gone goes to the old
// values.
//
// The command writes the polygon of the merged room only; the wall graph follows it through the
// rules (model/v2/syncRule.ts -> model/v2/write.ts). This test goes through the store, so it uses
// the same path as the app.
import { beforeAll, describe, expect, it } from 'vitest'
import { emptyDoc, useDoc } from '../model/store'
import { allSurveyIds } from '../model/survey'
import type { Measurement, PlanDoc, Room } from '../model/types'
import { ensureV2 } from '../model/v2/ensure'
import { installMeasureRules } from '../features/rooms/measureRules'
import { apply } from './commands'

const AT = '2026-11-24T10:00:00.000Z'

/** One room of the test plan: a rectangle on the centre lines, cm. */
const room = (id: string, x: number, y: number, w: number, h: number, walkOrder: number): Room => ({
  id,
  code: id,
  name: id,
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

/** A and C side by side, y 0..400: ONE wall between them, at x = 300. */
const acRooms = () => [room('A', 0, 0, 300, 400, 1), room('C', 300, 0, 300, 400, 2)]

/** One value on every survey label of the plan, all different: a lost value is easy to see. */
const measured = (doc: PlanDoc): Record<string, Measurement> => {
  const out: Record<string, Measurement> = {}
  allSurveyIds(doc).forEach((s, i) => {
    if (s.kind === 'wall') out[s.label] = { label: s.label, actualCm: 100 + i, updatedAt: AT }
  })
  return out
}

/** The v2 project loaded in the store, with a value on every wall face. */
function load(): PlanDoc {
  useDoc.getState().replace(emptyDoc())
  useDoc.temporal.getState().clear()
  const v1: PlanDoc = { ...emptyDoc(), projectId: 'p1', title: 'Merge', rooms: acRooms() }
  const withValues: PlanDoc = { ...v1, measurements: measured(v1) }
  useDoc.getState().replace(ensureV2(withValues, { now: AT }))
  return useDoc.getState().doc
}

const nodesOf = (doc: PlanDoc) => new Map((doc.nodes ?? []).map((n) => [n.id, n]))

/** Walls whose centre line lies on the vertical line x = c. */
const verticalWallsAt = (doc: PlanDoc, c: number) => {
  const nodes = nodesOf(doc)
  return (doc.walls ?? []).filter((w) => {
    const a = nodes.get(w.a), b = nodes.get(w.b)
    return !!a && !!b && Math.abs(a.x - c) < 0.5 && Math.abs(b.x - c) < 0.5
  })
}

/** Every value of `before` that is in neither `measurements` nor `oldMeasurements` of `after`. */
const lostValues = (before: PlanDoc, after: PlanDoc): string[] => {
  const kept = [...Object.values(after.measurements), ...(after.oldMeasurements ?? [])]
  return Object.values(before.measurements)
    .filter((m) => !kept.some((k) => k.actualCm === m.actualCm))
    .map((m) => m.label)
}

beforeAll(() => installMeasureRules())

describe('merge_rooms on a v2 document', () => {
  it('removes the wall between the two rooms and keeps the walls of the outside', () => {
    const before = load()
    expect(before.schemaVersion).toBe(2)
    const between = verticalWallsAt(before, 300)
    expect(between.length).toBe(1)
    const outer = (before.walls ?? []).filter((w) => w.id !== between[0].id).map((w) => w.id)
    expect(outer.length).toBeGreaterThan(0)

    const out = apply(before, { type: 'merge_rooms', roomIds: ['A', 'C'] })
    useDoc.getState().update(() => out.doc)
    const after = useDoc.getState().doc

    // One room, on the union polygon, held by the graph.
    expect(after.rooms.length).toBe(1)
    expect(after.rooms[0].id).toBe('A')
    // One face per wall of the graph: the corners of the two rooms on the outline are still nodes.
    expect(after.rooms[0].cycle!.length).toBe(after.rooms[0].vertices.length)
    const xs = after.rooms[0].vertices.map((v) => Math.round(v.x))
    expect(Math.min(...xs)).toBe(0)
    expect(Math.max(...xs)).toBe(600)
    // The wall between the two rooms is GONE: it was the wall of one space.
    expect((after.walls ?? []).some((w) => w.id === between[0].id)).toBe(false)
    expect(verticalWallsAt(after, 300)).toEqual([])
    // The walls of the outside stay, and none is left without a face (no standalone wall).
    for (const id of outer) expect((after.walls ?? []).some((w) => w.id === id)).toBe(true)
    expect((after.walls ?? []).filter((w) => w.standalone)).toEqual([])
    for (const w of after.walls ?? []) expect(w.faces.length).toBeGreaterThan(0)
    // The nodes of the wall that went away stay only if another wall uses them: the two walls of the
    // top edge meet at one of them, so the node is still on the plan.
    for (const n of after.nodes ?? []) {
      const used = (after.walls ?? []).some((w) => w.a === n.id || w.b === n.id)
      expect(used).toBe(true)
    }
    // No value is lost: a value whose face is gone is in the old values now.
    expect(lostValues(before, after)).toEqual([])
    expect((after.oldMeasurements ?? []).length).toBeGreaterThan(0)
  })

  it('keeps every value of the two rooms somewhere, and the outer values keep their place', () => {
    const before = load()
    const out = apply(before, { type: 'merge_rooms', roomIds: ['A', 'C'] })
    useDoc.getState().update(() => out.doc)
    const after = useDoc.getState().doc
    // Every value of the two rooms is still there, one time each: in the plan, or in the old values.
    const kept = [...Object.values(after.measurements), ...(after.oldMeasurements ?? [])]
    expect(kept.length).toBe(Object.keys(before.measurements).length)
    expect(lostValues(before, after)).toEqual([])
    // The value of a face that the merged room still has follows its face (the outer walls).
    expect(after.measurements['A-1'].actualCm).toBe(before.measurements['A-1'].actualCm)
    // The value of the wall between the two rooms is an old value now: its face is gone.
    const old = after.oldMeasurements ?? []
    expect(old.some((o) => o.actualCm === before.measurements['A-2'].actualCm)).toBe(true)
    expect(old.every((o) => o.reason === 'wall-split' || o.reason === 'wall-removed' || o.reason === 'room-deleted')).toBe(true)
  })

  it('is ONE undo step: undo gives the two rooms and the wall between them back', () => {
    const before = load()
    const out = apply(before, { type: 'merge_rooms', roomIds: ['A', 'C'] })
    useDoc.getState().update(() => out.doc)
    const after = useDoc.getState().doc
    expect(after).not.toBe(before)
    useDoc.temporal.getState().undo()
    const back = useDoc.getState().doc
    expect(back.rooms.map((r) => r.id)).toEqual(['A', 'C'])
    expect(verticalWallsAt(back, 300).length).toBe(1)
    // The wall between the rooms is back with its two faces, and it is not a standalone wall.
    const wall = verticalWallsAt(back, 300)[0]
    expect(wall.standalone).toBeUndefined()
    expect(wall.faces.filter((f) => f.roomId !== undefined).length).toBe(2)
    useDoc.temporal.getState().redo()
    expect(useDoc.getState().doc).toEqual(after)
  })
})
