// Tests of the load step of the v2 model (docs/walls-plan.md, phase 5c step 4): every document that
// comes into the app becomes v2 once, and nothing that the user measured moves.
import { describe, expect, it } from 'vitest'
import { demoRooms } from '../../features/measure/demo'
import { normalizeOrigin } from '../origin'
import type { Measurement, PlanDoc, Room } from '../types'
import { ensureV2, tracesToWalls } from './ensure'
import { conversionProblems } from './invariants'
import { labelOfTarget } from './targets'

const NOW = '2026-11-24T10:00:00.000Z'
const AT = '2026-11-20T08:00:00.000Z'

/** The v1 demo apartment: the same rooms as the demo button, and its on-site values. */
function demoV1(): PlanDoc {
  const rooms = demoRooms()
  const measurements: Record<string, Measurement> = {}
  // One face value and one thickness value per room wall, all different: a moved value is visible.
  let k = 0
  for (const r of rooms) {
    r.vertices.forEach((_v, i) => {
      measurements[`${r.code}-${i + 1}`] = { label: `${r.code}-${i + 1}`, actualCm: 100 + k, updatedAt: AT }
      k++
      measurements[`${r.code}-${i + 1}-T`] = { label: `${r.code}-${i + 1}-T`, actualCm: 10 + (i % 3), updatedAt: AT }
    })
  }
  return {
    projectId: 'demo', title: 'Demo', rooms, elements: [],
    measurements, roomNotes: {}, tapes: [],
  }
}

const roomOf = (doc: PlanDoc, id: string) => doc.rooms.find((r) => r.id === id)!

/** The values without their target: the load step adds a target, it never changes a value. */
const valuesOnly = (m: PlanDoc['measurements']): PlanDoc['measurements'] =>
  Object.fromEntries(Object.entries(m).map(([label, v]) => {
    const { target: _t, ...rest } = v
    return [label, rest]
  }))

describe('ensureV2: a v1 document', () => {
  it('becomes a v2 document with the conversion report and its values kept', () => {
    const v1 = demoV1()
    const v2 = ensureV2(v1, { now: NOW })
    expect(v1.schemaVersion).toBeUndefined()
    expect(v2.schemaVersion).toBe(2)
    // The report is always stored: the UI decides when to show it (`seen`).
    expect(v2.conversion?.at).toBe(NOW)
    expect(v2.conversion?.report.counts.rooms).toBe(v1.rooms.length)
    expect(v2.conversion?.seen).toBeUndefined()
    // The conversion kept every room, corner, code, label and area (the values get a target, so
    // they are compared with `valuesOnly`).
    expect(conversionProblems(v1, { ...v2, measurements: v1.measurements })).toEqual([])
    expect(valuesOnly(v2.measurements)).toEqual(v1.measurements)
    // The walls are the source, they have their properties, and every room has a cycle.
    expect((v2.walls ?? []).length).toBeGreaterThan(20)
    expect((v2.nodes ?? []).length).toBeGreaterThan(20)
    expect(v2.rooms.every((r) => (r.cycle?.length ?? 0) >= 3)).toBe(true)
    // Every value that can hold a target holds one in a v2 document.
    const faces = Object.entries(v2.measurements).filter(([label]) => !label.endsWith('-T'))
    expect(faces.every(([, m]) => !!m.target)).toBe(true)
    // The value labels did not change.
    expect(Object.keys(v2.measurements).sort()).toEqual(Object.keys(v1.measurements).sort())
  })

  it('is not converted twice (a second load gives the same document back)', () => {
    const v2 = ensureV2(demoV1(), { now: NOW })
    expect(ensureV2(v2, { now: '2027-01-01T00:00:00.000Z' })).toBe(v2)
  })

  it('keeps the conversion report of a document that is already v2', () => {
    const v2 = ensureV2(demoV1(), { now: NOW })
    // A document that comes back from a device with a wall edit: the report stays as it was.
    const edited: PlanDoc = { ...v2, title: 'Other' }
    expect(ensureV2(edited).conversion).toBe(v2.conversion)
  })

  it('gives an empty document back as a v2 document with no rooms', () => {
    const empty: PlanDoc = { projectId: 'local', title: 'New', rooms: [], elements: [], measurements: {}, roomNotes: {}, tapes: [] }
    const v2 = ensureV2(empty, { now: NOW })
    expect(v2.schemaVersion).toBe(2)
    expect(v2.rooms).toEqual([])
    expect(v2.conversion?.report.counts.walls).toBe(0)
  })
})

describe('ensureV2: a v2 document', () => {
  it('calculates the room polygons again from the walls (a saved polygon is a fallback)', () => {
    const v2 = ensureV2(demoV1(), { now: NOW })
    // A saved document whose room polygon is stale (a wall was moved by another device).
    const stale: PlanDoc = {
      ...v2,
      rooms: v2.rooms.map((r) => (r.id === 'demo-SE'
        ? { ...r, vertices: r.vertices.map((v, i) => (i === 0 ? { ...v, x: v.x + 500 } : v)) }
        : r)),
    }
    const out = ensureV2(stale)
    expect(roomOf(out, 'demo-SE').vertices[0].x).toBe(roomOf(v2, 'demo-SE').vertices[0].x)
  })

  it('adopts a room that has no cycle into the graph', () => {
    const v2 = ensureV2(demoV1(), { now: NOW })
    // A room saved by an old client: a polygon, no cycle.
    const loose: Room = {
      id: 'loose', code: 'ZZ', name: 'Loose', holes: [], walls: {}, walkOrder: 99,
      vertices: [{ id: 'l0', x: 5000, y: 5000 }, { id: 'l1', x: 5400, y: 5000 }, { id: 'l2', x: 5400, y: 5300 }, { id: 'l3', x: 5000, y: 5300 }],
    }
    const out = ensureV2({ ...v2, rooms: [...v2.rooms, loose] })
    const room = roomOf(out, 'loose')
    expect(room.cycle?.length).toBe(4)
    // It is now a room of the graph: one wall per side, no duplicates.
    expect((out.walls ?? []).filter((w) => w.faces.some((f) => f.roomId === 'loose')).length).toBe(4)
    expect(room.vertices.map((v) => [v.x, v.y])).toEqual([[5000, 5000], [5400, 5000], [5400, 5300], [5000, 5300]])
  })

  it('keeps a room that cannot enter the graph as it was saved', () => {
    const v2 = ensureV2(demoV1(), { now: NOW })
    // Two corners only: no wall can hold it.
    const bad: Room = {
      id: 'bad', code: 'YY', name: 'Bad', holes: [], walls: {}, walkOrder: 98,
      vertices: [{ id: 'b0', x: 8000, y: 8000 }, { id: 'b1', x: 8200, y: 8000 }],
    }
    const out = ensureV2({ ...v2, rooms: [...v2.rooms, bad] })
    expect(roomOf(out, 'bad').vertices.length).toBe(2)
  })

  it('keeps its walls with the plan origin (no wall id changes, so no value loses its target)', () => {
    const v2 = ensureV2(demoV1(), { now: NOW })
    const { doc: moved, offset } = normalizeOrigin(v2)
    expect(offset.x !== 0 || offset.y !== 0).toBe(true)
    // The graph moves with the rooms: the nodes take the offset and the walls keep their ids.
    expect((moved.nodes ?? []).length).toBe((v2.nodes ?? []).length)
    expect((moved.walls ?? []).map((w) => w.id)).toEqual((v2.walls ?? []).map((w) => w.id))
    const nodesAfter = moved.nodes ?? []
    const nodesBefore = v2.nodes ?? []
    nodesAfter.forEach((n, i) => {
      expect(n.x).toBeCloseTo(nodesBefore[i].x + offset.x, 6)
      expect(n.y).toBeCloseTo(nodesBefore[i].y + offset.y, 6)
    })
    // Every value keeps its label, so no toast asks the user to measure again.
    for (const [label, m] of Object.entries(v2.measurements)) {
      if (!m.target) continue
      expect(labelOfTarget(moved, m.target)).toBe(label)
    }
    // The document is still a v2 document that the load step leaves as it is.
    expect(ensureV2(moved)).toEqual(moved)
  })

  it('does not move a value that a wall edit made stale', () => {
    const v2 = ensureV2(demoV1(), { now: NOW })
    const before = v2.measurements
    const out = ensureV2({ ...v2, title: 'Other' })
    expect(out.measurements).toBe(before)
    expect(out.oldMeasurements).toBeUndefined()
  })
})

describe('traces of an older document (the Wall tool of phase 6)', () => {
  /** A vertical traced wall 400 cm long, 25 cm thick, far from the demo rooms. */
  const trace = { id: 'trace-1', a: { x: 6000, y: 6000 }, b: { x: 6000, y: 6400 }, thicknessCm: 25, type: 'bearing' as const }

  const wallsOf = (doc: PlanDoc) => (doc.walls ?? []).filter((w) => w.standalone)

  it('become standalone walls of the graph, and doc.traces is cleared', () => {
    const v1 = { ...demoV1(), traces: [trace] }
    const v2 = ensureV2(v1, { now: NOW })
    expect(v2.schemaVersion).toBe(2)
    expect(v2.traces).toEqual([])
    const added = wallsOf(v2)
    expect(added.length).toBe(1)
    expect(added[0].thicknessCm).toBe(25)
    expect(added[0].type).toBe('bearing')
    // A wall with no room face: both of its sides are outside.
    expect(added[0].faces.every((f) => f.roomId === undefined)).toBe(true)
    // The length of the drawn wall is kept.
    const nodes = new Map((v2.nodes ?? []).map((n) => [n.id, n]))
    expect(Math.abs(nodes.get(added[0].a)!.y - nodes.get(added[0].b)!.y)).toBe(400)
    // No value moved: the conversion and the trace do not touch the measurements.
    expect(valuesOnly(v2.measurements)).toEqual(valuesOnly(ensureV2(demoV1(), { now: NOW }).measurements))
  })

  it('become walls of a document that is already v2 (a load of an older client)', () => {
    const v2 = ensureV2(demoV1(), { now: NOW })
    const withTrace: PlanDoc = { ...v2, traces: [trace] }
    const out = ensureV2(withTrace)
    expect(out.traces).toEqual([])
    expect(wallsOf(out).length).toBe(1)
    // Every room keeps its polygon and its labels.
    expect(out.rooms.map((r) => r.code)).toEqual(v2.rooms.map((r) => r.code))
    expect(out.rooms.map((r) => r.vertices.length)).toEqual(v2.rooms.map((r) => r.vertices.length))
    // A load of the same document again changes nothing.
    expect(ensureV2(out)).toEqual(out)
  })

  it('add nothing to a document without traces, and keep the ids W<n> free of the walls there', () => {
    const v1 = demoV1()
    expect(ensureV2(v1, { now: NOW })).toEqual(ensureV2(v1, { now: NOW }))
    const withTrace = ensureV2({ ...v1, traces: [trace] }, { now: NOW })
    const ids = (withTrace.walls ?? []).map((w) => w.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('tracesToWalls gives the same document back when there is no trace', () => {
    const v2 = ensureV2(demoV1(), { now: NOW })
    expect(tracesToWalls(v2)).toBe(v2)
  })
})
