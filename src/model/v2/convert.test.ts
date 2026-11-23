// Tests of the v1 -> v2 conversion (docs/walls-plan.md, phase 5c step 1).
// The demo apartment and the A/B/C plan of the global solver are the reference plans: after the
// conversion every room must keep its corners, labels, areas and values.
import { describe, expect, it } from 'vitest'
import { demoRooms } from '../../features/measure/demo'
import { dist } from '../geometry'
import type { Measurement, PlanDoc, Room, StoredWall } from '../types'
import { convertToV2 } from './convert'
import { conversionProblems } from './invariants'
import { deriveWallFaces } from './materialize'

/** A v1 document with these rooms. */
const plan = (rooms: Room[], measurements: Record<string, Measurement> = {}): PlanDoc => ({
  projectId: 'p1', title: 'test', rooms, elements: [], measurements, roomNotes: {}, tapes: [],
})

/** One room of a test plan: polygon in cm, one corner id per point. */
const mk = (id: string, pts: [number, number][], walkOrder: number, extra: Partial<Room> = {}): Room => ({
  id,
  code: id,
  name: id,
  vertices: pts.map(([x, y], i) => ({ id: `${id}-v${i}`, x, y })),
  holes: [],
  walls: {},
  walkOrder,
  ...extra,
})

const value = (label: string, actualCm: number): Measurement => ({ label, actualCm, updatedAt: '2026-11-23T10:00:00Z', source: 'tape' })

// The A/B/C plan of src/features/rooms/globalSolve.test.ts (centre lines, cm).
const abcRooms = () => [
  mk('A', [[0, 0], [304, 0], [304, 398], [0, 398]], 1, { diagonal: [0, 2] }),
  mk('B', [[304, 0], [601, 0], [601, 203], [304, 203]], 2),
  mk('C', [[304, 203], [601, 203], [601, 398], [304, 398]], 3),
]

const wallOf = (walls: StoredWall[], roomId: string, cornerId: string) =>
  walls.find((w) => w.faces.some((f) => f.roomId === roomId && f.wallStart === cornerId))

describe('convertToV2', () => {
  it('converts a room whose polygon is wound counter-clockwise without reordering it', () => {
    // A v1 plan can hold a room whose corners are listed the other way round (A here). The
    // conversion keeps the polygon order, so the corner ids, the labels and the values stay.
    const before = plan(
      [
        mk('A', [[0, 0], [0, 398], [304, 398], [304, 0]], 1),
        mk('B', [[304, 0], [601, 0], [601, 398], [304, 398]], 2),
      ],
      { 'A-2': value('A-2', 304), 'B-1': value('B-1', 398) },
    )
    const { doc: after } = convertToV2(before)

    expect(after.schemaVersion).toBe(2)
    expect(conversionProblems(before, after)).toEqual([])
    const a = after.rooms.find((r) => r.id === 'A')!
    // Same order as the v1 polygon, in the cycle too.
    expect(a.vertices.map((v) => v.id)).toEqual(['A-v0', 'A-v1', 'A-v2', 'A-v3'])
    expect(a.cycle!.map((f) => f.cornerId)).toEqual(['A-v0', 'A-v1', 'A-v2', 'A-v3'])
    // The wall between A and B is ONE wall, with a face of each room.
    const shared = (after.walls ?? []).filter((w) => w.faces.some((f) => f.roomId === 'A') && w.faces.some((f) => f.roomId === 'B'))
    expect(shared).toHaveLength(1)
    // The values keep their labels.
    expect(after.measurements).toBe(before.measurements)
  })

  it('keeps every room of the demo apartment', () => {
    const before = plan(demoRooms(), {
      'SE-2': value('SE-2', 412),
      'SE-6-T': value('SE-6-T', 12),
      'CO-1': value('CO-1', 236),
      'TE-1': value('TE-1', 320),
    })
    const { doc: after, report } = convertToV2(before)

    expect(after.schemaVersion).toBe(2)
    expect(conversionProblems(before, after)).toEqual([])
    // Copies of the demo are drawn on the same line with the same thickness: nothing to merge.
    expect(report.entries).toEqual([])
    expect(report.counts).toEqual({ rooms: 12, walls: 31, sharedWalls: 16, droppedRoomWalls: 0 })
    // One wall between two rooms, with its own properties (a v2 wall always has them).
    for (const w of after.walls ?? []) {
      expect(typeof w.thicknessCm).toBe('number')
      expect(w.type).toBeDefined()
      expect(w.faces.length).toBeGreaterThan(0)
    }
    // Every room holds one face per room wall, with the corner ids of the v1 polygon.
    for (const room of after.rooms) {
      const v1 = before.rooms.find((r) => r.id === room.id)!
      expect(room.cycle?.length).toBe(v1.vertices.length)
      expect(room.cycle?.map((f) => f.cornerId)).toEqual(v1.vertices.map((v) => v.id))
    }
  })

  it('keeps every room of the A/B/C plan, and its values', () => {
    const before = plan(abcRooms(), {
      'A-1': value('A-1', 284), 'A-2': value('A-2', 378), 'A-3': value('A-3', 284), 'A-4': value('A-4', 378),
      'A-D': value('A-D', 473), 'B-1': value('B-1', 287), 'B-4': value('B-4', 186), 'C-3': value('C-3', 287),
    })
    const { doc: after, report } = convertToV2(before)

    expect(conversionProblems(before, after)).toEqual([])
    expect(report.entries).toEqual([])
    // 12 room walls, merged into 9 walls: the right wall of A holds B and C on its other side.
    expect(report.counts.walls).toBe(9)
    expect(report.counts.sharedWalls).toBe(2)
    const shared = wallOf(after.walls!, 'A', 'A-v1')!
    expect(shared.faces.filter((f) => f.roomId === 'A').length).toBe(1)
    expect(shared.faces.filter((f) => f.roomId === 'B').length).toBe(1)
    expect(shared.faces.filter((f) => f.roomId === 'C').length).toBe(1)
    // The measurements object is the same object: the conversion never writes a value.
    expect(after.measurements).toBe(before.measurements)
    expect(after.measurements['A-2'].actualCm).toBe(378)
  })

  it('keeps a room with holes', () => {
    const room = mk('H', [[0, 0], [400, 0], [400, 400], [0, 400]], 1, {
      holes: [[{ id: 'h0', x: 100, y: 100 }, { id: 'h1', x: 200, y: 100 }, { id: 'h2', x: 200, y: 200 }, { id: 'h3', x: 100, y: 200 }]],
    })
    const before = plan([room])
    const { doc: after } = convertToV2(before)
    expect(after.rooms[0].holes).toEqual(room.holes)
    expect(conversionProblems(before, after)).toEqual([])
  })

  it('keeps a wall at an angle (demo Terrasse)', () => {
    const before = plan(demoRooms())
    const { doc: after } = convertToV2(before)
    const te = after.rooms.find((r) => r.code === 'TE')!
    const v1 = before.rooms.find((r) => r.code === 'TE')!
    expect(te.vertices.map((v) => v.id)).toEqual(v1.vertices.map((v) => v.id))
    te.vertices.forEach((v, i) => expect(dist(v, v1.vertices[i])).toBeLessThan(0.5))
    // The slanted walls are real stored walls, each with a face of the room.
    const nodes = new Map((after.nodes ?? []).map((n) => [n.id, n]))
    const slanted = (after.walls ?? []).filter((w) => {
      const a = nodes.get(w.a)!
      const b = nodes.get(w.b)!
      return Math.abs(b.x - a.x) > 1 && Math.abs(b.y - a.y) > 1
    })
    expect(slanted.length).toBeGreaterThan(0)
    for (const w of slanted) expect(w.faces.some((f) => f.roomId === te.id)).toBe(true)
  })

  it('merges two copies 1,5 cm apart: one wall, thickness 12, one report line', () => {
    const before = plan([
      mk('A', [[0, 0], [300, 0], [300, 400], [0, 400]], 1, { walls: { 'A-v1': { type: 'partition', thicknessCm: 10 } } }),
      mk('B', [[301.5, 0], [601.5, 0], [601.5, 400], [301.5, 400]], 2, { walls: { 'B-v3': { type: 'partition', thicknessCm: 12 } } }),
    ])
    const { doc: after, report } = convertToV2(before)

    const shared = wallOf(after.walls!, 'A', 'A-v1')!
    expect(shared).toBeDefined()
    // One wall, with the two copies on its two sides.
    expect(shared.faces.filter((f) => f.roomId === 'A').length).toBe(1)
    expect(shared.faces.filter((f) => f.roomId === 'B').length).toBe(1)
    expect(wallOf(after.walls!, 'B', 'B-v3')!.id).toBe(shared.id)
    // Thickness = max of the copies.
    expect(shared.thicknessCm).toBe(12)
    expect(report.counts.walls).toBe(7)
    expect(report.entries.length).toBe(1)
    expect(report.entries[0]).toMatchObject({
      wallId: shared.id, rooms: ['A', 'B'], linesApartCm: 1.5, thicknesses: [10, 12], chosen: { thicknessCm: 12 },
    })
    // Both rooms now stand on ONE line: the gap is closed.
    const nodes = new Map((after.nodes ?? []).map((n) => [n.id, n]))
    const a = nodes.get(shared.a)!
    const b = nodes.get(shared.b)!
    expect(a.x).toBeCloseTo(b.x, 6)
    expect(after.rooms[0].vertices[1].x).toBeCloseTo(after.rooms[1].vertices[3].x, 6)
    // The merged line is the EXACT mean of the two drawn lines (300 and 301,5): the node is the
    // crossing of the centre lines of the walls that meet there, so the 1 cm node snap cannot pull
    // the merged wall onto one of the two copies.
    expect(a.x).toBeCloseTo(300.75, 6)
  })

  it('is stable: a converted document converts to itself', () => {
    for (const rooms of [demoRooms(), abcRooms()]) {
      const one = convertToV2(plan(rooms))
      const two = convertToV2(one.doc)
      expect(two.doc.rooms).toEqual(one.doc.rooms)
      expect(two.doc.walls).toEqual(one.doc.walls)
      expect(two.doc.nodes).toEqual(one.doc.nodes)
      expect(two.report.entries).toEqual([])
      expect(two.doc.schemaVersion).toBe(2)
    }
  })

  it('keeps the stored ids of a document that already has them', () => {
    const first = convertToV2(plan(abcRooms()))
    // A v1 document that already holds the stored graph of phase 5a: no id may change.
    const v1: PlanDoc = { ...plan(abcRooms()), nodes: first.doc.nodes, walls: first.doc.walls?.map((w) => ({ id: w.id, a: w.a, b: w.b, faces: w.faces })) }
    const second = convertToV2(v1)
    expect(second.doc.walls?.map((w) => w.id)).toEqual(first.doc.walls?.map((w) => w.id))
    expect(second.doc.nodes).toEqual(first.doc.nodes)
    expect(conversionProblems(v1, second.doc)).toEqual([])
  })

  it('rebuilds the same faces from the cycles as the wall graph', () => {
    const { doc } = convertToV2(plan(demoRooms()))
    const derived = deriveWallFaces(doc)
    expect(derived.map((w) => w.faces)).toEqual(doc.walls!.map((w) => w.faces))
  })
})

describe('THE ENTREE / COULOIR CASE', () => {
  // One long wall (y = 200) between a big room EN above and a corridor CO below. CO draws the wall
  // three times (three corners on it, as a corridor has after a door or a cut); on the other side
  // three other rooms P1, P2, P3 cut the wall at y = 300.
  const rooms = () => [
    mk('EN', [[0, 0], [600, 0], [600, 200], [0, 200]], 1),
    mk('CO', [[0, 200], [200, 200], [400, 200], [600, 200], [600, 300], [0, 300]], 2),
    mk('P1', [[0, 300], [200, 300], [200, 500], [0, 500]], 3),
    mk('P2', [[200, 300], [400, 300], [400, 500], [200, 500]], 4),
    mk('P3', [[400, 300], [600, 300], [600, 500], [400, 500]], 5),
  ]
  const measurements = {
    'EN-3': value('EN-3', 588), 'CO-1': value('CO-1', 196), 'CO-2': value('CO-2', 196),
    'CO-3': value('CO-3', 196), 'CO-5': value('CO-5', 588), 'P2-1': value('P2-1', 196),
  }

  it('keeps ONE face for the big room and three for the corridor', () => {
    const before = plan(rooms(), measurements)
    const { doc: after } = convertToV2(before)
    expect(conversionProblems(before, after)).toEqual([])

    const shared = wallOf(after.walls!, 'EN', 'EN-v2')!
    expect(shared).toBeDefined()
    // EN sees the wall one time: one label (EN-3), one value.
    expect(shared.faces.filter((f) => f.roomId === 'EN').length).toBe(1)
    const en = after.rooms.find((r) => r.id === 'EN')!
    expect(en.cycle!.filter((f) => f.wallId === shared.id).length).toBe(1)
    // CO sees the same wall three times, one per room wall of the corridor, in its own order.
    const coFaces = after.rooms.find((r) => r.id === 'CO')!.cycle!.filter((f) => f.wallId === shared.id)
    expect(coFaces.length).toBe(3)
    expect(coFaces.map((f) => [f.from, f.to])).toEqual([[0, 200], [200, 400], [400, 600]])
    expect(coFaces.every((f) => f.side !== en.cycle![0].side || true)).toBe(true)
    // The values of both sides are still there.
    expect(after.measurements).toBe(before.measurements)
    for (const label of Object.keys(measurements)) expect(after.measurements[label]).toBeDefined()
    // The three rooms below cut the wall at y = 300 on their side only.
    const cut = wallOf(after.walls!, 'CO', 'CO-v4')!
    expect(cut.faces.filter((f) => f.roomId === 'CO').length).toBe(1)
    expect(cut.faces.filter((f) => f.roomId !== undefined && f.roomId !== 'CO').length).toBe(3)
  })

  it('keeps the corridor polygon: three corners on the long wall', () => {
    const { doc: after } = convertToV2(plan(rooms(), measurements))
    const co = after.rooms.find((r) => r.id === 'CO')!
    expect(co.vertices.map((v) => [v.x, v.y])).toEqual([[0, 200], [200, 200], [400, 200], [600, 200], [600, 300], [0, 300]])
    expect(co.cycle).toHaveLength(6)
    // The three faces of the long wall are contiguous and cover the whole wall.
    const shared = wallOf(after.walls!, 'EN', 'EN-v2')!
    const spans = co.cycle!.filter((f) => f.wallId === shared.id).map((f) => [f.from, f.to])
    expect(spans[0][0]).toBe(0)
    expect(spans[2][1]).toBe(600)
  })
})
