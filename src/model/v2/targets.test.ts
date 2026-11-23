// Tests of the measurement targets of a v2 document (docs/walls-plan.md, phase 5c step 2).
import { describe, expect, it } from 'vitest'
import type { Measurement, PlanDoc, Room, RoomFace } from '../types'
import { convertToV2 } from './convert'
import { attachTargets, labelOfTarget, targetOfLabel } from './targets'

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

const value = (label: string, actualCm: number): Measurement => ({ label, actualCm, updatedAt: '2026-11-23T10:00:00Z' })

// A big room EN above a corridor CO, three rooms below the corridor (the Entree / Couloir case).
const rooms = () => [
  mk('EN', [[0, 0], [600, 0], [600, 200], [0, 200]], 1),
  mk('CO', [[0, 200], [200, 200], [400, 200], [600, 200], [600, 300], [0, 300]], 2, { diagonal: [0, 3] }),
  mk('P1', [[0, 300], [200, 300], [200, 500], [0, 500]], 3),
  mk('P2', [[200, 300], [400, 300], [400, 500], [200, 500]], 4),
  mk('P3', [[400, 300], [600, 300], [600, 500], [400, 500]], 5),
]

/** The v2 document of the test plan. */
const v2 = (): PlanDoc => convertToV2(plan(rooms())).doc

const room = (doc: PlanDoc, code: string) => doc.rooms.find((r) => r.code === code)!

describe('targetOfLabel', () => {
  it('gives the face of the room for CODE-n', () => {
    const doc = v2()
    const face = room(doc, 'CO').cycle![0]
    expect(targetOfLabel(doc, 'CO-1')).toEqual({
      kind: 'face', wallId: face.wallId, side: face.side, roomId: 'CO', from: face.from, to: face.to,
    })
    // The third room wall of the corridor is on the same wall as the first one, with its own span.
    const three = room(doc, 'CO').cycle!.slice(0, 3)
    expect(targetOfLabel(doc, 'CO-3')?.from).toBe(three[2].from)
    expect(targetOfLabel(doc, 'CO-3')?.to).toBe(three[2].to)
    // EN sees the same wall ONE time, over its whole length.
    expect(targetOfLabel(doc, 'EN-3')).toMatchObject({ kind: 'face', roomId: 'EN', from: 0, to: 600 })
  })

  it('gives the thickness of the wall for CODE-n-T, and the room diagonal for CODE-D', () => {
    const doc = v2()
    const face = room(doc, 'CO').cycle![0]
    expect(targetOfLabel(doc, 'CO-1-T')).toEqual({ kind: 'thickness', wallId: face.wallId, side: face.side, roomId: 'CO' })
    // A thickness belongs to the WALL: the label comes back on the first face of the room on it.
    expect(labelOfTarget(doc, targetOfLabel(doc, 'CO-2-T')!)).toBe('CO-1-T')
    expect(targetOfLabel(doc, 'CO-D')).toEqual({
      kind: 'diagonal', wallId: room(doc, 'CO').cycle![0].wallId, side: room(doc, 'CO').cycle![0].side, roomId: 'CO',
    })
  })

  it('gives the centre line and the outside face of a stored wall', () => {
    const doc = v2()
    const wallId = doc.walls![0].id
    expect(targetOfLabel(doc, `${wallId}-C`)).toMatchObject({ kind: 'centre', wallId })
    const facade = doc.walls!.find((w) => w.faces.some((f) => f.roomId === undefined))!
    expect(targetOfLabel(doc, `${facade.id}-E`)).toMatchObject({ kind: 'outside', wallId: facade.id })
    expect(targetOfLabel(doc, 'W999-C')).toBeUndefined()
  })

  it('gives nothing for a height, an unknown room or an unknown wall', () => {
    const doc = v2()
    expect(targetOfLabel(doc, 'CO-H')).toBeUndefined()
    expect(targetOfLabel(doc, 'ZZ-1')).toBeUndefined()
    expect(targetOfLabel(doc, 'CO-99')).toBeUndefined()
  })

  it('gives nothing for a v1 document (no cycles)', () => {
    expect(targetOfLabel(plan(rooms()), 'CO-1')).toBeUndefined()
  })
})

describe('labelOfTarget', () => {
  it('is the inverse of targetOfLabel', () => {
    const doc = v2()
    const labels = ['EN-1', 'EN-3', 'CO-1', 'CO-2', 'CO-3', 'CO-5', 'CO-1-T', 'CO-D', 'P2-1']
    for (const label of labels) {
      const target = targetOfLabel(doc, label)!
      expect(target).toBeDefined()
      expect(labelOfTarget(doc, target)).toBe(label)
    }
    for (const wall of doc.walls ?? []) {
      expect(labelOfTarget(doc, { wallId: wall.id, side: 'L', kind: 'centre' })).toBe(`${wall.id}-C`)
    }
  })

  it('follows the corner order of the current cycle', () => {
    const doc = v2()
    const target = targetOfLabel(doc, 'EN-3')!
    // A corner added in the middle of the FIRST wall of EN: face 3 becomes face 4, same span.
    const en = room(doc, 'EN')
    const first = en.cycle![0]
    const mid = (first.from + first.to) / 2
    const cycle: RoomFace[] = [
      { ...first, to: mid },
      { ...first, from: mid, cornerId: 'new-corner' },
      ...en.cycle!.slice(1),
    ]
    const after: PlanDoc = { ...doc, rooms: doc.rooms.map((r) => (r.code === 'EN' ? { ...r, cycle } : r)) }
    expect(labelOfTarget(after, target)).toBe('EN-4')
  })

  it('keeps the value on the larger part of a cut face', () => {
    const doc = v2()
    const target = targetOfLabel(doc, 'EN-3')! // the wall of EN, whole length [0, 600]
    const en = room(doc, 'EN')
    const i = en.cycle!.findIndex((f) => f.wallId === target.wallId)
    const face = en.cycle![i]
    // A T junction on the other side cuts EN's face at 450: 75 % stays, 25 % is new.
    const cycle = [...en.cycle!]
    cycle.splice(i, 1, { ...face, to: 450 }, { ...face, from: 450, cornerId: 'cut' })
    const after: PlanDoc = { ...doc, rooms: doc.rooms.map((r) => (r.code === 'EN' ? { ...r, cycle } : r)) }
    expect(labelOfTarget(after, target)).toBe('EN-3')
  })

  it('gives no label for a face cut in two equal parts, or for a room that is gone', () => {
    const doc = v2()
    const target = targetOfLabel(doc, 'EN-3')!
    const en = room(doc, 'EN')
    const i = en.cycle!.findIndex((f) => f.wallId === target.wallId)
    const face = en.cycle![i]
    const mid = (face.from + face.to) / 2
    const cycle = [...en.cycle!]
    cycle.splice(i, 1, { ...face, to: mid }, { ...face, from: mid, cornerId: 'cut' })
    const cut: PlanDoc = { ...doc, rooms: doc.rooms.map((r) => (r.code === 'EN' ? { ...r, cycle } : r)) }
    // Equal parts: the value must be measured again.
    expect(labelOfTarget(cut, target)).toBeUndefined()
    // Room gone.
    expect(labelOfTarget({ ...doc, rooms: doc.rooms.filter((r) => r.code !== 'EN') }, target)).toBeUndefined()
    // Wall gone.
    expect(labelOfTarget({ ...doc, walls: (doc.walls ?? []).filter((w) => w.id !== target.wallId) }, target)).toBeUndefined()
  })

  it('gives no label for the outside face of a wall that is no longer a facade', () => {
    const doc = v2()
    const facade = doc.walls!.find((w) => w.faces.some((f) => f.roomId === undefined))!
    const target = { wallId: facade.id, side: 'L' as const, kind: 'outside' as const }
    expect(labelOfTarget(doc, target)).toBe(`${facade.id}-E`)
    // The wall now has a room on both sides (the outside faces are gone).
    const walls = doc.walls!.map((w) =>
      w.id === facade.id ? { ...w, faces: [{ side: 'L' as const, roomId: 'CO', from: 0, to: 10 }, { side: 'R' as const, roomId: 'EN', from: 0, to: 10 }] } : w,
    )
    expect(labelOfTarget({ ...doc, walls }, target)).toBeUndefined()
  })
})

describe('attachTargets', () => {
  it('puts a target on every value of a v2 document that has none', () => {
    const before = convertToV2(plan(rooms(), {
      'EN-3': value('EN-3', 588), 'CO-1': value('CO-1', 196), 'CO-3': value('CO-3', 196),
      'CO-1-T': value('CO-1-T', 10), 'CO-D': value('CO-D', 640), 'CO-H': value('CO-H', 250),
    })).doc
    // The conversion does not set targets.
    for (const m of Object.values(before.measurements)) expect(m.target).toBeUndefined()

    const after = attachTargets(before)
    expect(after.measurements['EN-3'].target).toMatchObject({ kind: 'face', roomId: 'EN' })
    expect(after.measurements['CO-3'].target).toMatchObject({ kind: 'face', roomId: 'CO' })
    expect(after.measurements['CO-1-T'].target).toMatchObject({ kind: 'thickness', roomId: 'CO' })
    expect(after.measurements['CO-D'].target).toMatchObject({ kind: 'diagonal', roomId: 'CO' })
    // A height names no wall: it stays without a target.
    expect(after.measurements['CO-H'].target).toBeUndefined()
    // The values themselves do not move and the label gives the same target back.
    for (const [label, m] of Object.entries(after.measurements)) {
      expect(m.label).toBe(label)
      if (m.target) expect(labelOfTarget(after, m.target)).toBe(label)
    }
    // Same measurements values, same objects for the values that did not change.
    expect(Object.keys(after.measurements).sort()).toEqual(Object.keys(before.measurements).sort())
  })

  it('gives the same document back when nothing changes, and never touches a v1 document', () => {
    const once = attachTargets(v2())
    expect(attachTargets(once)).toBe(once)
    const v1 = plan(rooms(), { 'CO-1': value('CO-1', 196) })
    expect(attachTargets(v1)).toBe(v1)
  })
})
