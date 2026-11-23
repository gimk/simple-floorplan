// Tests of the relabel by target of a v2 document (docs/walls-plan.md, phase 5c step 2).
// The v1 rule (model/relabel.ts) follows corner ids; this rule follows the stored target of each
// value, so a label can move to another wall number (or the value can go to the old values).
import { describe, expect, it } from 'vitest'
import type { Measurement, PlanDoc, Room, RoomFace, StoredWall } from '../types'
import { convertToV2 } from './convert'
import { relabelByTarget, type RelabelTargetsResult } from './relabelV2'
import { attachTargets } from './targets'

const NOW = '2026-11-23T12:00:00.000Z'
const value = (label: string, actualCm: number): Measurement => ({ label, actualCm, updatedAt: '2026-01-01T00:00:00.000Z' })

/** A v1 document with these rooms. */
const plan = (rooms: Room[], measurements: Record<string, Measurement> = {}): PlanDoc => ({
  projectId: 'p1', title: 'test', rooms, elements: [], measurements, roomNotes: {}, tapes: [],
})

/** One room: polygon in cm, one corner id per point. */
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

/** A v2 document of a v1 one, with a target on every value (as the app does on an edit). */
const v2 = (rooms: Room[], m: Record<string, Measurement>) => attachTargets(convertToV2(plan(rooms, m)).doc)

/**
 * The document after an outline edit: only the rooms changed, so the values are the SAME object
 * (which is what the doc rule sees in the app).
 */
const edited = (before: PlanDoc, rooms: Room[]): PlanDoc => ({
  ...convertToV2(plan(rooms, before.measurements)).doc,
  measurements: before.measurements,
})

/** The values of a document that a label holds. */
const labels = (doc: PlanDoc) => Object.keys(doc.measurements).sort()
/** The values that left the measurements, e.g. ['CO-1 (wall-split)']. */
const oldLabels = (res: RelabelTargetsResult) =>
  res.droppedValues.map((o) => `${o.measurement.label} (${o.reason})`).sort()

/** Every value of `before` is in the measurements or in the old values of `after`. Never lost. */
const expectConservation = (before: PlanDoc, res: RelabelTargetsResult) => {
  const kept = [
    ...Object.values(res.measurements).map((m) => m.actualCm),
    ...res.droppedValues.map((o) => o.measurement.actualCm),
  ].sort((a, b) => a - b)
  const had = Object.values(before.measurements).map((m) => m.actualCm).sort((a, b) => a - b)
  expect(kept).toEqual(had)
}

// A 400 x 300 room, all four walls and the height measured.
const rect = () => mk('R1', [[0, 0], [400, 0], [400, 300], [0, 300]], 1)
const rectValues = () => ({
  'R1-1': value('R1-1', 401), 'R1-2': value('R1-2', 302), 'R1-3': value('R1-3', 403),
  'R1-4': value('R1-4', 304), 'R1-H': value('R1-H', 250),
})

describe('relabelByTarget: a v2 document', () => {
  it('does nothing when the rooms did not change', () => {
    const before = v2([rect()], rectValues())
    expect(relabelByTarget(before, { ...before, rooms: [...before.rooms] }, NOW)).toBeNull()
  })

  it('a corner added before a measured wall: the labels shift, the values follow', () => {
    const before = v2([rect()], rectValues())
    // One more corner on the FIRST wall (a corner id before the measured walls).
    const after = edited(before, [mk('R1', [[0, 0], [200, 0], [400, 0], [400, 300], [0, 300]], 1)])

    const res = relabelByTarget(before, after, NOW)!
    expect(res).not.toBeNull()
    // Wall 1 is now two walls (no value: it is cut in two equal parts), and walls 2, 3, 4 become
    // walls 3, 4, 5. The values follow their walls, not the numbers.
    const out = res.measurements
    expect(out['R1-3']?.actualCm).toBe(302)
    expect(out['R1-4']?.actualCm).toBe(403)
    expect(out['R1-5']?.actualCm).toBe(304)
    expect(out['R1-H']?.actualCm).toBe(250)
    expect(out['R1-1']).toBeUndefined()
    expect(out['R1-2']).toBeUndefined()
    // The moved values are marked as new, so the server keeps them (last write wins).
    expect(out['R1-3'].updatedAt).toBe(NOW)
    // The value of the cut wall is not lost: it goes to the old values.
    expect(oldLabels(res)).toEqual(['R1-1 (wall-split)'])
    expect(res.dropped).toEqual(['R1-1'])
    expectConservation(before, res)
  })

  it('a wall that moved keeps its span: every value stays under its label', () => {
    const before = v2([rect()], rectValues())
    // The same room, 10 cm to the right: the spans do not change.
    const after = edited(before, [mk('R1', [[10, 0], [410, 0], [410, 300], [10, 300]], 1)])
    expect(relabelByTarget(before, after, NOW)).toBeNull()
  })

  it('follows its room when the room code changes (a value without a target)', () => {
    const before = v2([rect()], rectValues())
    const renamed: Room = { ...rect(), code: 'SA' }
    const after = edited(before, [renamed])
    const res = relabelByTarget(before, after, NOW)!
    expect(labels({ ...after, measurements: res.measurements })).toEqual(['SA-1', 'SA-2', 'SA-3', 'SA-4', 'SA-H'])
    expect(res.droppedValues).toEqual([])
    expectConservation(before, res)
  })

  it('a value of a deleted room goes to the old values', () => {
    const before = v2([rect()], rectValues())
    const after = edited(before, [])
    const res = relabelByTarget(before, after, NOW)!
    expect(Object.keys(res.measurements)).toEqual([])
    expect(oldLabels(res)).toEqual([
      'R1-1 (room-deleted)', 'R1-2 (room-deleted)', 'R1-3 (room-deleted)', 'R1-4 (room-deleted)', 'R1-H (room-deleted)',
    ])
    expectConservation(before, res)
  })

  it('leaves a document alone when the edit wrote the values itself', () => {
    const before = v2([rect()], rectValues())
    const after: PlanDoc = { ...before, measurements: { ...before.measurements, 'R1-1': value('R1-1', 999) } }
    expect(relabelByTarget(before, after, NOW)).toBeNull()
  })

  it('does nothing for a v1 document (its own rule keeps the values)', () => {
    const before = plan([rect()], rectValues())
    const after = plan([rect()], rectValues())
    expect(relabelByTarget(before, after, NOW)).toBeNull()
  })
})

describe('THE ENTREE / COULOIR WALL (one wall, two sides cut differently)', () => {
  const rooms = () => [
    mk('EN', [[0, 0], [600, 0], [600, 200], [0, 200]], 1),
    mk('CO', [[0, 200], [200, 200], [400, 200], [600, 200], [600, 300], [0, 300]], 2),
    mk('P1', [[0, 300], [200, 300], [200, 500], [0, 500]], 3),
    mk('P2', [[200, 300], [400, 300], [400, 500], [200, 500]], 4),
    mk('P3', [[400, 300], [600, 300], [600, 500], [400, 500]], 5),
  ]
  const values = () => ({
    'EN-3': value('EN-3', 588), 'CO-1': value('CO-1', 196), 'CO-2': value('CO-2', 196), 'CO-3': value('CO-3', 196),
  })

  /**
   * The document after a T wall meets the shared wall 100 cm from its start on the CORRIDOR side:
   * that wall is split in two (the first part keeps the id), and the corridor sees two faces where
   * it saw one. The faces are spliced in the room order, as materializeRooms/wallGraph do it.
   */
  function splitSharedWall(doc: PlanDoc): PlanDoc {
    const walls = doc.walls ?? []
    const nodes = doc.nodes ?? []
    const shared = walls.find((w) => {
      const ids = new Set(w.faces.map((f) => f.roomId))
      return ids.has('EN') && ids.has('CO')
    })!
    const a = nodes.find((n) => n.id === shared.a)!
    const b = nodes.find((n) => n.id === shared.b)!
    const length = Math.hypot(b.x - a.x, b.y - a.y)
    const cut = 100
    const split = { id: 'n-split', x: a.x + ((b.x - a.x) / length) * cut, y: a.y + ((b.y - a.y) / length) * cut }
    // The first part keeps the id of the wall: the values of the wall stay on it.
    const first: StoredWall = { ...shared, b: split.id, faces: [] }
    const second: StoredWall = { ...shared, id: 'W-split', a: split.id, faces: [] }
    const tee: StoredWall = { id: 'W-tee', a: split.id, b: 'n-tee', type: 'partition', thicknessCm: 10, faces: [] }
    const down = { id: 'n-tee', x: split.x, y: split.y + 100 }

    const pieces = (f: RoomFace): RoomFace[] => {
      const lo = Math.min(f.from, f.to)
      const hi = Math.max(f.from, f.to)
      const out: RoomFace[] = []
      if (lo < cut) out.push({ ...f, wallId: first.id, from: lo, to: Math.min(hi, cut) })
      if (hi > cut) out.push({ ...f, wallId: second.id, from: Math.max(lo, cut) - cut, to: hi - cut, cornerId: `${f.cornerId}-cut` })
      // Room order: side L runs a -> b (increasing), side R runs b -> a (decreasing).
      return f.side === 'L'
        ? out.sort((p, q) => p.from - q.from || p.to - q.to)
        : out.sort((p, q) => q.to - p.to || q.from - p.from)
    }
    const roomsAfter = doc.rooms.map((r) => ({
      ...r,
      cycle: (r.cycle ?? []).flatMap((f) => (f.wallId === shared.id ? pieces(f) : [f])),
    }))
    return {
      ...doc,
      nodes: [...nodes.filter((n) => n.id !== shared.b || true), split, down],
      walls: [...walls.map((w) => (w.id === shared.id ? first : w)), second, tee],
      rooms: roomsAfter,
    }
  }

  it('the corridor value goes to the old values, the big room value stays', () => {
    const before = v2(rooms(), values())
    // The corridor sees two faces where it saw one long face: the value of that face is ambiguous.
    const after = splitSharedWall(before)

    const res = relabelByTarget(before, after, NOW)!
    expect(res).not.toBeNull()
    const out = res.measurements
    // EN sees the wall on its own side: its face is on the second part now, with the whole span.
    expect(out['EN-3']?.actualCm).toBe(588)
    // CO-1 was [0, 200] on the old wall: it is now two faces of 100 cm (ambiguous), so it leaves.
    expect(oldLabels(res)).toEqual(['CO-1 (wall-split)'])
    expect(res.dropped).toEqual(['CO-1'])
    // The other faces of the corridor follow their spans (one face moves to another wall number).
    expect(Object.values(out).map((v) => v.actualCm).sort()).toEqual([196, 196, 588])
    expectConservation(before, res)
  })

  it('keeps every value when nothing is cut', () => {
    const before = v2(rooms(), values())
    // Same rooms, only the order of the array changed: no target moves.
    expect(relabelByTarget(before, { ...before, rooms: [...before.rooms].reverse() }, NOW)).toBeNull()
  })
})
