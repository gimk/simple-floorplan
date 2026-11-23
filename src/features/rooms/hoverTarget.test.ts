// hoverTarget: which plan element a survey label ('CU-6', 'CU-D', 'SE-1-T') points at.
import { describe, expect, it } from 'vitest'
import { dist, roomInnerRing } from '../../model/geometry'
import type { PlanDoc, Room } from '../../model/types'
import { diagonalTarget, hoverTarget, roomByCode } from './hoverTarget'

/** Square room CU, 400 x 300 cm, walls CU-1..CU-4 (default thickness). */
const cuisine = (over: Partial<Room> = {}): Room => ({
  id: 'r-cu', code: 'CU', name: 'Cuisine', holes: [], walls: {}, walkOrder: 1,
  vertices: [
    { id: 'cu-v0', x: 0, y: 0 },
    { id: 'cu-v1', x: 400, y: 0 },
    { id: 'cu-v2', x: 400, y: 300 },
    { id: 'cu-v3', x: 0, y: 300 },
  ],
  ...over,
})

const doc = (rooms: Room[] = [cuisine()]): PlanDoc => ({
  projectId: 'p', title: 't', rooms, elements: [], measurements: {}, roomNotes: {}, tapes: [],
})

describe('hoverTarget: walls', () => {
  it('finds the wall of a wall label', () => {
    expect(hoverTarget(doc(), 'CU-2')).toEqual({
      kind: 'wall', roomId: 'r-cu', wallStart: 'cu-v1', label: 'CU-2',
    })
    expect(hoverTarget(doc(), 'CU-4')).toEqual({
      kind: 'wall', roomId: 'r-cu', wallStart: 'cu-v3', label: 'CU-4',
    })
  })

  it('finds the wall of a thickness label', () => {
    // 'CU-3-T' is the thickness of the third wall (index 2, start cu-v2), not a separate element.
    expect(hoverTarget(doc(), 'CU-3-T')).toEqual({
      kind: 'wall', roomId: 'r-cu', wallStart: 'cu-v2', label: 'CU-3-T',
    })
  })

  it('keeps the room code with digits (R1-2)', () => {
    const r = cuisine({ id: 'r-1', code: 'R1' })
    expect(hoverTarget(doc([r]), 'R1-1')).toEqual({
      kind: 'wall', roomId: 'r-1', wallStart: 'cu-v0', label: 'R1-1',
    })
  })
})

describe('hoverTarget: diagonal', () => {
  it('uses the two inside corners of room.diagonal', () => {
    const r = cuisine({ diagonal: [0, 2] })
    const q = roomInnerRing(r)
    const target = hoverTarget(doc([r]), 'CU-D')
    expect(target?.kind).toBe('diagonal')
    if (target?.kind !== 'diagonal') return
    expect(target.a).toEqual(q[0])
    expect(target.b).toEqual(q[2])
    expect(dist(target.a, target.b)).toBeGreaterThan(400)
  })

  it('uses the pair passed by Measure next when the room has no diagonal yet', () => {
    const r = cuisine()
    expect(hoverTarget(doc([r]), 'CU-D')).toBeNull()
    const target = hoverTarget(doc([r]), 'CU-D', [1, 3])
    expect(target?.kind).toBe('diagonal')
    if (target?.kind !== 'diagonal') return
    expect(target.a).toEqual(roomInnerRing(r)[1])
    expect(target.b).toEqual(roomInnerRing(r)[3])
  })

  it('ignores a pair that is not two different corners', () => {
    const r = cuisine()
    expect(hoverTarget(doc([r]), 'CU-D', [0, 0])).toBeNull()
    expect(hoverTarget(doc([r]), 'CU-D', [0, 9])).toBeNull()
    expect(diagonalTarget(r, [0, 9], 'CU-D')).toBeNull()
  })
})

describe('hoverTarget: unknown labels', () => {
  it('returns null for nothing hovered', () => {
    expect(hoverTarget(doc(), null)).toBeNull()
    expect(hoverTarget(doc(), '')).toBeNull()
  })

  it('returns null for a room that is not in the document', () => {
    expect(hoverTarget(doc(), 'ZZ-1')).toBeNull()
  })

  it('returns null for a label that is not a wall, a diagonal or a thickness', () => {
    // The ceiling height has no place on the plan.
    expect(hoverTarget(doc(), 'CU-H')).toBeNull()
    // A wall number out of range.
    expect(hoverTarget(doc(), 'CU-5')).toBeNull()
    expect(hoverTarget(doc(), 'CU-0')).toBeNull()
    expect(hoverTarget(doc(), 'CU-1-T')).not.toBeNull()
    expect(hoverTarget(doc(), 'CU-9-T')).toBeNull()
  })

  it('finds the room of a code', () => {
    expect(roomByCode(doc(), 'CU')?.id).toBe('r-cu')
    expect(roomByCode(doc(), 'ZZ')).toBeUndefined()
  })
})
