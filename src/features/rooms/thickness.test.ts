import { describe, expect, it } from 'vitest'
import { allSurveyIds, labelRoomCode, parseThicknessLabel, surveyIds, thicknessIds } from '../../model/survey'
import { relabelMeasurements } from '../../model/relabel'
import type { Measurement, PlanDoc, Room } from '../../model/types'
import { docProgress, roomHasMissing, roomIsFlagged } from '../measure/logic'
import { solveGlobal } from './globalSolve'
import { applyThicknessLabel, otherSides } from './thickness'
import { wallProps } from './walls'

const room = (id: string, walkOrder: number, pts: [number, number][]): Room => ({
  id, code: id, name: id, walkOrder,
  vertices: pts.map(([x, y], i) => ({ id: `${id}v${i}`, x, y })),
  holes: [], walls: {},
})
const meas = (v: Record<string, number>): Record<string, Measurement> =>
  Object.fromEntries(Object.entries(v).map(([label, actualCm]) => [label, { label, actualCm, updatedAt: '' }]))

// A (first in the walk) | B, wall at x = 300. A-2 and B-4 are the two sides of it.
const A = room('A', 1, [[0, 0], [300, 0], [300, 200], [0, 200]])
const B = room('B', 2, [[300, 0], [600, 0], [600, 200], [300, 200]])
const doc = (m: Record<string, number> = {}): PlanDoc => ({
  projectId: 'p', title: 't', rooms: [A, B], elements: [], measurements: meas(m), roomNotes: {}, tapes: [],
})

describe('thickness labels', () => {
  it('reads CODE-n-T', () => {
    expect(parseThicknessLabel('SE-6-T')).toEqual({ code: 'SE', index: 5 })
    expect(parseThicknessLabel('SE-6')).toBeNull()
    expect(parseThicknessLabel('SE-0-T')).toBeNull()
    expect(labelRoomCode('SE-6-T')).toBe('SE')
    expect(labelRoomCode('SE-D')).toBe('SE')
  })
})

describe('one thickness ID per wall', () => {
  it('finds the other side of a shared wall', () => {
    expect(otherSides(doc(), A, 1).map((o) => `${o.room.code}-${o.index + 1}`)).toEqual(['B-4'])
    expect(otherSides(doc(), A, 0)).toEqual([])
  })

  it('gives a shared wall to the first room of the walk only', () => {
    expect(thicknessIds(doc(), A).map((s) => s.label)).toEqual(['A-1-T', 'A-2-T', 'A-3-T', 'A-4-T'])
    expect(thicknessIds(doc(), B).map((s) => s.label)).toEqual(['B-1-T', 'B-2-T', 'B-3-T'])
  })

  it('keeps an ID that already has a value', () => {
    expect(thicknessIds(doc({ 'B-4-T': 12 }), B).map((s) => s.label)).toContain('B-4-T')
  })

  it('puts thicknesses after the other IDs of the room, as optional', () => {
    const labels = allSurveyIds(doc()).map((s) => s.label)
    expect(labels.slice(0, 6)).toEqual(['A-1', 'A-2', 'A-3', 'A-4', 'A-H', 'A-1-T'])
    expect(surveyIds(A).some((s) => s.kind === 'thickness')).toBe(false)
    expect(allSurveyIds(doc()).filter((s) => s.kind === 'thickness').every((s) => s.optional)).toBe(true)
  })
})

describe('measuring a thickness', () => {
  it('sets the thickness on both sides of the wall', () => {
    const d = applyThicknessLabel(doc(), 'A-2-T', 14)
    expect(wallProps(d.rooms[0], 'Av1').thicknessCm).toBe(14)
    expect(wallProps(d.rooms[1], 'Bv3').thicknessCm).toBe(14)
    expect(wallProps(d.rooms[0], 'Av0').thicknessCm).toBe(10)
  })

  it('ignores other labels', () => {
    const d = doc()
    expect(applyThicknessLabel(d, 'A-2', 14)).toBe(d)
  })

  it('does not count in progress and never flags a room', () => {
    const all = { 'A-1': 290, 'A-2': 190, 'A-3': 290, 'A-4': 190, 'A-H': 250 }
    expect(roomHasMissing(doc(all), A)).toBe(false)
    expect(roomIsFlagged(doc({ ...all, 'A-1-T': 30 }), A)).toBe(false)
    expect(docProgress(doc({ 'A-1-T': 30 })).done).toBe(0)
  })

  it('follows its wall when the walls are renumbered', () => {
    const before = doc({ 'A-2-T': 14 })
    const after = { ...before, rooms: [{ ...A, vertices: [...A.vertices.slice(1), A.vertices[0]] }, B] }
    expect(Object.keys(relabelMeasurements(before, after, 'now')!.measurements)).toEqual(['A-1-T'])
  })

  it('is used by the global solver', () => {
    const s = solveGlobal(doc({ 'A-2-T': 14 }))
    const g = s.groups.find((x) => x.walls.includes('A-2'))!
    expect(g.walls).toContain('B-4')
    expect(g.thicknessCm).toBeCloseTo(14, 0)
    expect(g.determined).toBe(true)
  })
})

describe('wall alignment', () => {
  it('sets the mirrored value on the other side', async () => {
    const { setWallAlign } = await import('./thickness')
    const d = setWallAlign(doc(), 'A', 1, 'room')
    expect(d.rooms[0].walls.Av1?.align).toBeUndefined() // 'room' is the default: not stored
    expect(d.rooms[1].walls.Bv3?.align).toBe('other')
    const c = setWallAlign(doc(), 'A', 1, 'center')
    expect(c.rooms[0].walls.Av1?.align).toBe('center')
    expect(c.rooms[1].walls.Bv3?.align).toBe('center')
  })
})

describe('solve whole plan', () => {
  it('moves the rooms and keeps the shared wall shared', async () => {
    const { applyGlobal } = await import('./applyGlobal')
    const r = applyGlobal(doc({ 'A-1': 280, 'A-2': 180, 'B-1': 290, 'B-2': 180, 'A-2-T': 12 }))
    const [a, b] = r.doc.rooms
    expect(b.vertices[0].x).toBeCloseTo(a.vertices[1].x, 1)
    expect(wallProps(b, 'Bv3').thicknessCm).toBe(12)
    expect(r.report.rmsCm).toBeLessThan(0.5)
  })
})

describe('plan precision', () => {
  const values = { 'A-1': 283.3, 'A-2': 181.7, 'B-1': 287.2, 'B-2': 181.7 }
  const onStep = (v: number, step: number) => Math.abs(v / step - Math.round(v / step)) < 1e-9

  it('rounds the corners of "Solve whole plan" to the step', async () => {
    const { applyGlobal } = await import('./applyGlobal')
    for (const step of [0.5, 1] as const) {
      const r = applyGlobal({ ...doc(values), apartment: { precisionCm: step } })
      expect(r.doc.rooms.flatMap((x) => x.vertices).every((v) => onStep(v.x, step) && onStep(v.y, step))).toBe(true)
    }
  })

  it('rounds the corners of "Apply measured lengths" to the step', async () => {
    const { applyMeasured } = await import('./apply')
    const r = applyMeasured({ ...doc(values), apartment: { precisionCm: 1 } }, 'A')
    expect(r.doc.rooms[0].vertices.every((v) => onStep(v.x, 1) && onStep(v.y, 1))).toBe(true)
    const exact = applyMeasured({ ...doc(values), apartment: { precisionCm: 0 } }, 'A')
    expect(exact.doc.rooms[0].vertices.some((v) => !onStep(v.x, 0.5) || !onStep(v.y, 0.5))).toBe(true)
  })
})

describe('plan precision default', () => {
  it('rounds to 0,5 cm when the plan has no setting', async () => {
    const { applyMeasured } = await import('./apply')
    const r = applyMeasured(doc({ 'A-1': 283.3, 'A-2': 181.7 }), 'A')
    expect(r.doc.rooms[0].vertices.every((v) => Number.isInteger(v.x * 2) && Number.isInteger(v.y * 2))).toBe(true)
  })
})

describe('solve whole plan with locked walls', () => {
  // B-2 (right wall of B, no value) is locked at its drawn inside length 190 cm (200 - 5 - 5).
  const locked = (): PlanDoc => {
    const d = doc({ 'A-2': 150, 'A-4': 150 })
    return { ...d, rooms: [d.rooms[0], { ...d.rooms[1], walls: { Bv1: { type: 'partition', thicknessCm: 10, locked: true } } }] }
  }
  const innerB2 = (d: PlanDoc) => Math.abs(d.rooms[1].vertices[2].y - d.rooms[1].vertices[1].y) - 10

  it('keeps a locked wall with no value when the toggle is on', async () => {
    const { applyGlobal } = await import('./applyGlobal')
    const r = applyGlobal(locked(), { keepLocked: true })
    expect(innerB2(r.doc)).toBeCloseTo(190, 0)
    expect(r.report.lockedKept).toBe(1)
  })

  it('lets it move with the next walls when the toggle is off', async () => {
    const { applyGlobal } = await import('./applyGlobal')
    const r = applyGlobal(locked(), { keepLocked: false })
    // A is 150 high inside: the shared top and bottom walls move, so B follows.
    expect(innerB2(r.doc)).toBeCloseTo(150, 0)
    expect(r.report.lockedKept).toBe(0)
  })
})
