import { describe, expect, it } from 'vitest'
import { parsePlan, PlanDocV1Schema, SnapshotPutBodySchema } from '../../core/schema'
import { emptyDoc } from '../../model/store'
import type { Measurement, PlanDoc, Room, RoomFace, StoredNode, StoredWall } from '../../model/types'
import { ensureV2 } from '../../model/v2/ensure'
import { materializeRooms } from '../../model/v2/materialize'
import { restoreChange, revokeChange, solverOff, solverOn, userEditedWalls } from './engine'
import { solverEditRule } from './rule'

const FIXED_NOW = '2026-11-25T12:00:00.000Z'

const meas = (v: Record<string, number>): Record<string, Measurement> =>
  Object.fromEntries(Object.entries(v).map(([label, actualCm]) => [label, { label, actualCm, updatedAt: FIXED_NOW }]))

/** Single rectangular v2 room: 400 x 300 centre line, 20 cm exterior (W1, W4) and 10 cm partitions (W2, W3). */
function makeSingleRoomV2(values: Record<string, number> = {}): PlanDoc {
  const nodes: StoredNode[] = [
    { id: 'N1', x: 0, y: 0 },
    { id: 'N2', x: 400, y: 0 },
    { id: 'N3', x: 400, y: 300 },
    { id: 'N4', x: 0, y: 300 },
  ]
  const walls: StoredWall[] = [
    { id: 'W1', a: 'N1', b: 'N2', faces: [], type: 'exterior', thicknessCm: 20 },
    { id: 'W2', a: 'N2', b: 'N3', faces: [], type: 'partition', thicknessCm: 10 },
    { id: 'W3', a: 'N3', b: 'N4', faces: [], type: 'partition', thicknessCm: 10 },
    { id: 'W4', a: 'N4', b: 'N1', faces: [], type: 'exterior', thicknessCm: 20 },
  ]
  const cycle: RoomFace[] = [
    { wallId: 'W1', side: 'L', from: 0, to: 400, cornerId: 'v1' },
    { wallId: 'W2', side: 'L', from: 0, to: 300, cornerId: 'v2' },
    { wallId: 'W3', side: 'L', from: 0, to: 400, cornerId: 'v3' },
    { wallId: 'W4', side: 'L', from: 0, to: 300, cornerId: 'v4' },
  ]
  const base: PlanDoc = {
    ...emptyDoc(),
    schemaVersion: 2,
    nodes,
    walls,
    rooms: [{ id: 'R1', code: 'KI', name: 'Kitchen', vertices: [], cycle, holes: [], walls: {}, walkOrder: 1 }],
    measurements: meas(values),
  }
  return { ...base, rooms: materializeRooms(base) }
}

/**
 * Three-room apartment (same layout as globalSolve.test.ts) where a loop determines the thickness
 * of the shared wall between B and C (true 8 cm, drawn 10 cm).
 */
function makeLoopV2(): PlanDoc {
  const mkRoom = (id: string, pts: [number, number][], diagonal?: [number, number]): Room => ({
    id, code: id, name: id,
    vertices: pts.map(([x, y], i) => ({ id: `${id}v${i}`, x, y })),
    holes: [], walls: {}, walkOrder: 1,
    ...(diagonal ? { diagonal } : {}),
  })
  const A = { w: 300 - 10 - 5, h: 400 - 10 - 10 }
  const B = { w: 300 - 5 - 10, h: 200 - 10 - 4 }
  const C = { w: 300 - 5 - 10, h: 200 - 4 - 10 }
  const v1: PlanDoc = {
    ...emptyDoc(),
    rooms: [
      mkRoom('A', [[0, 0], [304, 0], [304, 398], [0, 398]], [0, 2]),
      mkRoom('B', [[304, 0], [601, 0], [601, 203], [304, 203]]),
      mkRoom('C', [[304, 203], [601, 203], [601, 398], [304, 398]]),
    ],
    measurements: meas({
      'A-1': A.w, 'A-2': A.h, 'A-3': A.w, 'A-4': A.h, 'A-D': Math.hypot(A.w, A.h),
      'B-1': B.w, 'B-2': B.h, 'B-3': B.w, 'B-4': B.h,
      'C-1': C.w, 'C-2': C.h, 'C-3': C.w, 'C-4': C.h,
    }),
  }
  return ensureV2(v1, { now: FIXED_NOW })
}

describe('solver engine', () => {
  it('leaves an Off doc (no solver field) unchanged on solverOff', () => {
    const doc = makeSingleRoomV2({ 'KI-1': 410 })
    expect(doc.solver).toBeUndefined()
    expect(solverOff(doc)).toBe(doc)
  })

  it('solverOn records changes, baseNodes, solvedAt, and rmsCm and moves geometry', () => {
    // Drawn inside width of KI-1 is 400 - 10 - 5 = 385 cm; measure 405 cm (20 cm wider).
    // Also add a slightly contradicting KI-3 = 403 cm so rmsCm > 0.
    const base = makeSingleRoomV2({ 'KI-1': 405, 'KI-3': 403 })
    const { doc: solved, report } = solverOn(base, { now: FIXED_NOW })

    expect(solved.solver).toBeDefined()
    expect(solved.solver!.enabled).toBe(true)
    expect(solved.solver!.solvedAt).toBe(FIXED_NOW)
    expect(solved.solver!.rmsCm).toBeCloseTo(report.rmsCm, 6)
    expect(solved.solver!.rmsCm!).toBeGreaterThan(0.5)
    expect(solved.solver!.changes.length).toBeGreaterThan(0)
    expect(Object.keys(solved.solver!.baseNodes).length).toBeGreaterThan(0)

    // Geometry moved: W2 (right wall) and W4 (left wall) moved apart.
    const posChanges = solved.solver!.changes.filter((c) => c.kind === 'position')
    expect(posChanges.some((c) => c.wallId === 'W2' && c.dir === 'E')).toBe(true)
    expect(posChanges.some((c) => c.wallId === 'W4' && c.dir === 'W')).toBe(true)
    // Changes are sorted largest first.
    for (let i = 1; i < posChanges.length; i++) {
      expect(posChanges[i - 1].moveCm!).toBeGreaterThanOrEqual(posChanges[i].moveCm!)
    }
    expect(solved.nodes).not.toEqual(base.nodes)
  })

  it('solverOff after solverOn restores exact base node positions and wall thicknesses', () => {
    const base = makeLoopV2()
    const baseNodesCopy = base.nodes!.map((n) => ({ ...n }))
    const baseThickCopy = base.walls!.map((w) => ({ id: w.id, thicknessCm: w.thicknessCm }))

    const { doc: solved } = solverOn(base, { now: FIXED_NOW })
    expect(solved.nodes).not.toEqual(baseNodesCopy)
    expect(Object.keys(solved.solver!.baseThickness).length).toBeGreaterThan(0)

    const restored = solverOff(solved)
    expect(restored.solver!.enabled).toBe(false)
    expect(restored.solver!.changes).toEqual([])
    expect(restored.solver!.baseNodes).toEqual({})
    expect(restored.solver!.baseThickness).toEqual({})
    expect(restored.nodes).toEqual(baseNodesCopy)
    expect(restored.walls!.map((w) => ({ id: w.id, thicknessCm: w.thicknessCm }))).toEqual(baseThickCopy)
  })

  it('solverOn is idempotent (running twice starts from base and gives the same result)', () => {
    const base = makeSingleRoomV2({ 'KI-1': 405, 'KI-2': 300 })
    const first = solverOn(base, { now: FIXED_NOW })
    const second = solverOn(first.doc, { now: FIXED_NOW })

    expect(second.doc.nodes).toEqual(first.doc.nodes)
    expect(second.doc.walls!.map((w) => w.thicknessCm)).toEqual(first.doc.walls!.map((w) => w.thicknessCm))
    expect(second.doc.solver).toEqual(first.doc.solver)
  })

  it('revokeChange holds a wall at its base position with no change; restoreChange brings it back', () => {
    const base = makeSingleRoomV2({ 'KI-1': 405, 'KI-3': 405 })
    const { doc: solved } = solverOn(base, { now: FIXED_NOW })
    expect(solved.solver!.changes.some((c) => c.kind === 'position' && c.wallId === 'W4')).toBe(true)

    const { doc: revokedDoc } = revokeChange(solved, { kind: 'position', wallId: 'W4' }, { now: FIXED_NOW })
    expect(revokedDoc.solver!.revoked).toEqual([{ kind: 'position', wallId: 'W4', by: 'revoke' }])
    // W4 kept its base x = 0 and has no position change.
    expect(revokedDoc.solver!.changes.some((c) => c.kind === 'position' && c.wallId === 'W4')).toBe(false)
    const n1 = revokedDoc.nodes!.find((n) => n.id === 'N1')!
    const n4 = revokedDoc.nodes!.find((n) => n.id === 'N4')!
    expect(n1.x).toBeCloseTo(0, 1)
    expect(n4.x).toBeCloseTo(0, 1)
    // W2 absorbed the full ~20 cm move to the east.
    const w2Change = revokedDoc.solver!.changes.find((c) => c.kind === 'position' && c.wallId === 'W2')
    expect(w2Change).toBeDefined()
    expect(w2Change!.moveCm!).toBeGreaterThan(15)

    // Restore brings W4's change back.
    const { doc: restored } = restoreChange(revokedDoc, { kind: 'position', wallId: 'W4' }, { now: FIXED_NOW })
    expect(restored.solver!.revoked).toEqual([])
    expect(restored.solver!.changes.some((c) => c.kind === 'position' && c.wallId === 'W4')).toBe(true)
    expect(restored.nodes).toEqual(solved.nodes)
  })

  it('holds wall thickness when revoked and restores it when restored', () => {
    const base = makeLoopV2()
    const { doc: solved } = solverOn(base, { now: FIXED_NOW })
    const thickChange = solved.solver!.changes.find((c) => c.kind === 'thickness')
    expect(thickChange).toBeDefined()
    const wallId = thickChange!.wallId
    const baseThick = base.walls!.find((w) => w.id === wallId)!.thicknessCm!
    expect(solved.walls!.find((w) => w.id === wallId)!.thicknessCm).not.toBeCloseTo(baseThick, 1)

    // Revoke thickness change: wall keeps its base thickness and has no thickness change.
    const { doc: held } = revokeChange(solved, { kind: 'thickness', wallId }, { now: FIXED_NOW })
    expect(held.walls!.find((w) => w.id === wallId)!.thicknessCm).toBeCloseTo(baseThick, 1)
    expect(held.solver!.changes.some((c) => c.kind === 'thickness' && c.wallId === wallId)).toBe(false)

    // Restore: thickness change returns.
    const { doc: restored } = restoreChange(held, { kind: 'thickness', wallId }, { now: FIXED_NOW })
    expect(restored.solver!.changes.some((c) => c.kind === 'thickness' && c.wallId === wallId)).toBe(true)
  })

  it('solverEditRule drops change, removes baseNodes entry, adds edit hold, and ignores solver writes', () => {
    const base = makeSingleRoomV2({ 'KI-1': 405, 'KI-3': 405 })
    const { doc: solved } = solverOn(base, { now: FIXED_NOW })
    expect(solved.solver!.changes.some((c) => c.kind === 'position' && c.wallId === 'W2')).toBe(true)
    expect('N2' in solved.solver!.baseNodes).toBe(true)

    // User moves node N2 (endpoint of W1 and W2) by hand while solver is On (same solver ref).
    const userMoved: PlanDoc = {
      ...solved,
      nodes: solved.nodes!.map((n) => (n.id === 'N2' ? { ...n, x: n.x + 15 } : n)),
    }
    const edited = userEditedWalls(solved, userMoved)
    expect(edited.movedNodes).toEqual(['N2'])
    expect(edited.position).toContain('W2')

    const ruled = solverEditRule(solved, userMoved)
    expect(ruled.solver!.changes.some((c) => c.kind === 'position' && c.wallId === 'W2')).toBe(false)
    expect('N2' in ruled.solver!.baseNodes).toBe(false)
    expect(ruled.solver!.revoked).toContainEqual({ kind: 'position', wallId: 'W2', by: 'edit' })

    // Solver write (new solver object ref) is ignored by solverEditRule and userEditedWalls.
    const solverWrite: PlanDoc = {
      ...solved,
      nodes: solved.nodes!.map((n) => (n.id === 'N2' ? { ...n, x: n.x + 15 } : n)),
      solver: { ...solved.solver! },
    }
    expect(userEditedWalls(solved, solverWrite)).toEqual({ position: [], thickness: [], movedNodes: [] })
    expect(solverEditRule(solved, solverWrite)).toBe(solverWrite)
  })

  it('schema keeps solver in parsePlan, PlanDocV1Schema, and SnapshotPutBodySchema', () => {
    const base = makeSingleRoomV2({ 'KI-1': 405 })
    const { doc: solved } = solverOn(base, { now: FIXED_NOW })

    const parsed = parsePlan(solved)
    expect(parsed.solver).toEqual(solved.solver)

    const schemaParsed = PlanDocV1Schema.parse(solved)
    expect(schemaParsed.solver).toEqual(solved.solver)

    const snapParsed = SnapshotPutBodySchema.parse({ ...solved, baseVersion: 3 })
    expect(snapParsed.solver).toEqual(solved.solver)
  })
})
