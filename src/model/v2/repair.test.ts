// Tests of the repair of the wall graph (`repairGraph`). Synthetic documents only.
import { describe, expect, it } from 'vitest'
import { dist } from '../geometry'
import type { Measurement, PlanDoc, Room, WallElement } from '../types'
import { convertToV2 } from './convert'
import { overlaps } from './overlapHelper'
import { repairGraph } from './repair'
import { materializeDoc } from './syncRule'

const room = (id: string, pts: [number, number][], walkOrder = 1): Room => ({
  id, code: id, name: id, holes: [], walls: {}, walkOrder,
  vertices: pts.map(([x, y], i) => ({ id: `${id}-v${i}`, x, y })),
})
const plan = (rooms: Room[], measurements: Record<string, Measurement> = {}): PlanDoc => ({
  projectId: 'p', title: 't', rooms, elements: [], measurements, roomNotes: {}, tapes: [],
})
const value = (label: string, actualCm: number): Measurement => ({ label, actualCm, updatedAt: '2026-11-25T10:00:00Z' })

/** An empty v2 document. */
const empty = (): PlanDoc => convertToV2(plan([])).doc

/** A v2 document with the given nodes and walls (no room). */
function graph(nodes: [string, number, number][], walls: [string, string, string, Partial<PlanDoc['walls'] extends (infer W)[] | undefined ? W : never>?][]): PlanDoc {
  return {
    ...empty(),
    nodes: nodes.map(([id, x, y]) => ({ id, x, y })),
    walls: walls.map(([id, a, b, extra]) => ({ id, a, b, faces: [], type: 'partition', thicknessCm: 10, ...extra })),
  }
}

/** A rectangle room A (400 x 300) whose top wall is cut at x = `cut` into two walls. */
function cutTop(cut: number, measurements: Record<string, Measurement> = {}, extra: Partial<PlanDoc> = {}): PlanDoc {
  const base = convertToV2(plan([room('A', [[0, 0], [400, 0], [400, 300], [0, 300]])], measurements)).doc
  const top = base.rooms[0].cycle![0]
  const w1 = base.walls!.find((w) => w.id === top.wallId)!
  const cycle = base.rooms[0].cycle!
  const rooms = [{
    ...base.rooms[0],
    cycle: [
      { ...cycle[0], to: cut },
      { wallId: 'W9', side: cycle[0].side, from: 0, to: 400 - cut, cornerId: 'A-cut' },
      ...cycle.slice(1),
    ],
  }]
  return materializeDoc({
    ...base,
    ...extra,
    nodes: [...base.nodes!, { id: 'N9', x: cut, y: 0 }],
    walls: [...base.walls!.map((w) => (w.id === w1.id ? { ...w, b: 'N9' } : w)), { ...w1, id: 'W9', a: 'N9', b: w1.b, faces: [] }],
    rooms,
  })
}

describe('repairGraph: a clean document', () => {
  it('comes back as the same object, with no change', () => {
    const doc = convertToV2(plan([room('A', [[0, 0], [400, 0], [400, 300], [0, 300]])])).doc
    const out = repairGraph(doc)
    expect(out.doc).toBe(doc)
    expect(out.changes).toEqual([])
  })
  it('does nothing to a v1 document', () => {
    const v1 = plan([room('A', [[0, 0], [400, 0], [400, 300], [0, 300]])])
    expect(repairGraph(v1).doc).toBe(v1)
  })
})

describe('repairGraph: points, zero length and duplicates', () => {
  it('merges two nodes closer than 1 cm and keeps the node that more walls use', () => {
    const doc = graph(
      [['A', 0, 0], ['B', 300, 0], ['C', 300.8, 0], ['D', 300, 200]],
      [['W1', 'A', 'B'], ['W2', 'C', 'D'], ['W3', 'B', 'D']],
    )
    const out = repairGraph(doc, { inline: false })
    expect(out.changes.length).toBeGreaterThan(0)
    expect(out.doc.nodes!.length).toBe(3)
    expect(out.doc.walls!.every((w) => out.doc.nodes!.some((n) => n.id === w.a) && out.doc.nodes!.some((n) => n.id === w.b))).toBe(true)
  })

  it('removes a wall of zero length and a wall stored twice', () => {
    const doc = graph(
      [['A', 0, 0], ['B', 300, 0], ['C', 0.5, 0.2]],
      [['W1', 'A', 'B'], ['W2', 'B', 'A'], ['W3', 'A', 'C']],
    )
    const out = repairGraph(doc, { inline: false })
    expect(out.doc.walls!.length).toBe(1)
    expect(overlaps(out.doc)).toEqual([])
  })
})

describe('repairGraph: overlapping walls on one line', () => {
  it('a short wall inside a long one: the long one is cut, no overlap is left', () => {
    const doc = graph(
      [['A', 0, 0], ['B', 400, 0], ['C', 100, 0], ['D', 300, 0]],
      [['W1', 'A', 'B'], ['W2', 'C', 'D']],
    )
    expect(overlaps(doc).length).toBe(1)
    const out = repairGraph(doc, { inline: false })
    expect(overlaps(out.doc)).toEqual([])
    expect(out.doc.walls!.length).toBe(3)
  })

  it('two halves and the whole: 3 walls become 2', () => {
    const doc = graph(
      [['A', 0, 0], ['M', 200, 0], ['B', 400, 0]],
      [['W1', 'A', 'M'], ['W2', 'M', 'B'], ['W3', 'A', 'B']],
    )
    const out = repairGraph(doc, { inline: false })
    expect(out.doc.walls!.length).toBe(2)
    expect(overlaps(out.doc)).toEqual([])
  })

  it('never merges a locked wall', () => {
    const doc = graph(
      [['A', 0, 0], ['B', 400, 0], ['C', 100, 0], ['D', 300, 0]],
      [['W1', 'A', 'B', { locked: true }], ['W2', 'C', 'D']],
    )
    const out = repairGraph(doc, { inline: false })
    expect(out.doc.walls!.find((w) => w.id === 'W1')!.locked).toBe(true)
    expect(out.doc.walls!.length).toBe(2)
  })
})

describe('repairGraph: a point in the middle of a straight run', () => {
  it('two walls on one line with a point between them become one wall', () => {
    const doc = graph([['A', 0, 0], ['M', 200, 0], ['B', 400, 0]], [['W1', 'A', 'M'], ['W2', 'M', 'B']])
    const out = repairGraph(doc)
    expect(out.doc.walls!.length).toBe(1)
    expect(out.doc.nodes!.length).toBe(2)
  })

  it('keeps the point at a T junction, at a turn, and with different properties', () => {
    const tee = graph([['A', 0, 0], ['M', 200, 0], ['B', 400, 0], ['T', 200, 300]], [['W1', 'A', 'M'], ['W2', 'M', 'B'], ['W3', 'M', 'T']])
    expect(repairGraph(tee).doc).toBe(tee)
    const turn = graph([['A', 0, 0], ['M', 200, 0], ['B', 200, 300]], [['W1', 'A', 'M'], ['W2', 'M', 'B']])
    expect(repairGraph(turn).doc).toBe(turn)
    const other = graph([['A', 0, 0], ['M', 200, 0], ['B', 400, 0]], [['W1', 'A', 'M'], ['W2', 'M', 'B', { thicknessCm: 25 }]])
    expect(repairGraph(other).doc).toBe(other)
  })

  it('keeps the point when a wall is locked', () => {
    const doc = graph([['A', 0, 0], ['M', 200, 0], ['B', 400, 0]], [['W1', 'A', 'M', { locked: true }], ['W2', 'M', 'B']])
    expect(repairGraph(doc).doc).toBe(doc)
  })

  it('a room that was cut in two pieces on a straight run is one wall again', () => {
    const doc = cutTop(150)
    expect(doc.walls!.length).toBe(5)
    const out = repairGraph(doc)
    expect(out.doc.walls!.length).toBe(4)
    expect(out.doc.rooms[0].cycle!.length).toBe(4)
    expect(out.doc.rooms[0].vertices.length).toBe(4)
  })

  it('inline: false leaves the point (the end of a drag)', () => {
    const doc = cutTop(150)
    expect(repairGraph(doc, { inline: false }).doc).toBe(doc)
  })
})

describe('repairGraph: doors and windows', () => {
  it('an element of a merged wall stays at the same place on the plan', () => {
    const door: WallElement = {
      id: 'E1', roomId: 'A', wallStart: 'A-cut', wallId: 'W9', alongCm: 30, offsetCm: 30, widthCm: 80,
      kind: 'door', createdAt: '2026-11-25T10:00:00Z',
    } as WallElement
    const doc = cutTop(150, {}, { elements: [door] })
    const posOf = (d: PlanDoc, el: WallElement) => {
      const w = d.walls!.find((x) => x.id === el.wallId)!
      const a = d.nodes!.find((n) => n.id === w.a)!
      const b = d.nodes!.find((n) => n.id === w.b)!
      const len = dist(a, b)
      const t = (el.alongCm ?? 0) / len
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
    }
    const before = posOf(doc, door)
    const out = repairGraph(doc)
    const moved = out.doc.elements.find((e) => e.id === 'E1')!
    expect(moved.wallId).toBeDefined()
    const after = posOf(out.doc, moved)
    expect(dist(before, after)).toBeLessThan(0.5)
  })
})

describe('repairGraph: measured values', () => {
  it('all pieces measured: the merged wall holds the sum', () => {
    const doc = cutTop(150, { 'A-1': value('A-1', 151), 'A-2': value('A-2', 249) })
    const out = repairGraph(doc)
    expect(out.doc.rooms[0].cycle!.length).toBe(4)
    expect(Object.values(out.doc.measurements).some((m) => m.actualCm === 400)).toBe(true)
  })

  it('one piece measured and within 2 cm of the merged length: it stays', () => {
    const doc = cutTop(365, { 'A-1': value('A-1', 399) })
    const out = repairGraph(doc)
    expect(Object.values(out.doc.measurements).some((m) => m.actualCm === 399)).toBe(true)
  })

  it('one piece measured and far from the merged length: the value is dropped, said in `changes`, and kept as an old value', () => {
    const doc = cutTop(150, { 'A-1': value('A-1', 150.5) })
    const out = repairGraph(doc)
    expect(Object.values(out.doc.measurements).some((m) => m.actualCm === 150.5)).toBe(false)
    expect(out.changes.some((c) => c.includes('Dropped'))).toBe(true)
    expect((out.doc.oldMeasurements ?? []).some((m) => m.actualCm === 150.5)).toBe(true)
  })
})

describe('repairGraph: the result is stable', () => {
  it('a second run changes nothing', () => {
    const once = repairGraph(cutTop(150, { 'A-1': value('A-1', 151), 'A-2': value('A-2', 249) })).doc
    expect(repairGraph(once).doc).toBe(once)
  })
})
