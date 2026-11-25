import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { beginDrag, emptyDoc, endDrag, useDoc, useUi } from '../../model/store'
import type { Measurement, PlanDoc, RoomFace, StoredNode, StoredWall } from '../../model/types'
import { materializeRooms } from '../../model/v2/materialize'
import { installMeasureRules } from '../rooms/measureRules'
import { setSolverEnabled } from './actions'
import { _resetSolverTriggersForTest, installSolverTriggers, SOLVER_DEBOUNCE_MS } from './triggers'

const FIXED_NOW = '2026-11-25T12:00:00.000Z'

const meas = (v: Record<string, number>): Record<string, Measurement> =>
  Object.fromEntries(Object.entries(v).map(([label, actualCm]) => [label, { label, actualCm, updatedAt: FIXED_NOW }]))

function makeRoomV2(values: Record<string, number> = {}): PlanDoc {
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

describe('solver triggers', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    installMeasureRules()
    installSolverTriggers()
    _resetSolverTriggersForTest()
    useUi.setState({
      mode: 'edit',
      solveKeepLocked: true,
      solveSnapThickness: false,
      solveSurfaceMode: 'off',
      solveAngles: 'square',
    })
    useDoc.getState().replace(makeRoomV2({ 'KI-1': 405, 'KI-3': 405 }))
    useDoc.temporal.getState().clear()
  })

  afterEach(() => {
    _resetSolverTriggersForTest()
    vi.useRealTimers()
  })

  it('solves when leaving Measuring Mode while On (one undo step)', () => {
    setSolverEnabled(true)
    const beforeMeasure = useDoc.getState().doc
    useUi.getState().setMode('measure')

    // Change a measurement while in Measuring Mode: must NOT solve yet.
    useDoc.getState().update((d) => ({
      ...d,
      measurements: { ...d.measurements, 'KI-2': { label: 'KI-2', actualCm: 320, updatedAt: FIXED_NOW } },
    }))
    vi.advanceTimersByTime(SOLVER_DEBOUNCE_MS + 100)
    expect(useDoc.getState().doc.solver!.changes.some((c) => c.wallId === 'W3')).toBe(false)

    const pastBeforeLeave = useDoc.temporal.getState().pastStates.length
    // Leave Measuring Mode -> solves immediately in one undo step.
    useUi.getState().setMode('edit')
    expect(useDoc.getState().doc.solver!.changes.some((c) => c.wallId === 'W3')).toBe(true)
    expect(useDoc.temporal.getState().pastStates.length).toBe(pastBeforeLeave + 1)
    expect(useDoc.getState().doc.nodes).not.toEqual(beforeMeasure.nodes)
  })

  it('does not solve on edits in Measuring Mode', () => {
    setSolverEnabled(true)
    useUi.getState().setMode('measure')
    const solvedAt = useDoc.getState().doc.solver!.solvedAt

    vi.advanceTimersByTime(1000)
    useDoc.getState().update((d) => ({
      ...d,
      nodes: d.nodes!.map((n) => (n.id === 'N2' ? { ...n, x: n.x + 10 } : n)),
    }))
    vi.advanceTimersByTime(SOLVER_DEBOUNCE_MS + 200)
    expect(useDoc.getState().doc.solver!.solvedAt).toBe(solvedAt)
  })

  it('solves after debounce on a geometry edit in Edit Mode and folds into that edit undo step', () => {
    setSolverEnabled(true)
    const afterOn = useDoc.getState().doc
    const pastBeforeEdit = useDoc.temporal.getState().pastStates.length
    const solvedAtBefore = afterOn.solver!.solvedAt

    vi.advanceTimersByTime(1000)
    // User moves W4 (N1 and N4) by +10 cm in Edit Mode.
    useDoc.getState().update((d) => ({
      ...d,
      nodes: d.nodes!.map((n) => (n.id === 'N1' || n.id === 'N4' ? { ...n, x: n.x + 10 } : n)),
    }))
    // solverEditRule held W4 as 'edit'; re-solve has NOT fired yet before debounce.
    expect(useDoc.getState().doc.solver!.revoked).toContainEqual(
      expect.objectContaining({ kind: 'position', wallId: 'W4', by: 'edit' }),
    )
    expect(useDoc.getState().doc.solver!.solvedAt).toBe(solvedAtBefore)
    expect(useDoc.temporal.getState().pastStates.length).toBe(pastBeforeEdit + 1)

    vi.advanceTimersByTime(SOLVER_DEBOUNCE_MS)
    // Re-solved silently: solvedAt updated, W4 kept at user position, W2 adjusted, NO extra undo step!
    expect(useDoc.getState().doc.solver!.solvedAt).not.toBe(solvedAtBefore)
    expect(useDoc.temporal.getState().pastStates.length).toBe(pastBeforeEdit + 1)
    expect(useDoc.getState().doc.solver!.changes.some((c) => c.wallId === 'W4')).toBe(false)

    // One undo undoes both the user edit and the folded re-solve.
    useDoc.temporal.getState().undo()
    expect(useDoc.getState().doc).toBe(afterOn)
  })

  it('does not solve during a silent drag preview, but solves after endDrag settles', () => {
    setSolverEnabled(true)
    const solvedAtBefore = useDoc.getState().doc.solver!.solvedAt

    vi.advanceTimersByTime(1000)
    const start = beginDrag()
    useDoc.getState().updateSilent((d) => ({
      ...d,
      nodes: d.nodes!.map((n) => (n.id === 'N1' || n.id === 'N4' ? { ...n, x: n.x + 10 } : n)),
    }))
    vi.advanceTimersByTime(SOLVER_DEBOUNCE_MS + 200)
    // Still dragging: must not solve.
    expect(useDoc.getState().doc.solver!.solvedAt).toBe(solvedAtBefore)

    endDrag(start)
    vi.advanceTimersByTime(SOLVER_DEBOUNCE_MS)
    expect(useDoc.getState().doc.solver!.solvedAt).not.toBe(solvedAtBefore)
  })

  it('defers drop-on-edit during drag previews and drops nothing if drag ends where it started', () => {
    setSolverEnabled(true)
    const afterOn = useDoc.getState().doc
    const solvedAtBefore = afterOn.solver!.solvedAt
    expect(afterOn.solver!.changes.some((c) => c.kind === 'position' && c.wallId === 'W4')).toBe(true)
    expect('N1' in afterOn.solver!.baseNodes).toBe(true)

    vi.advanceTimersByTime(1000)
    const start = beginDrag()
    // Drag W4 (N1, N4) by +10 cm during preview.
    useDoc.getState().updateSilent((d) => ({
      ...d,
      nodes: d.nodes!.map((n) => (n.id === 'N1' || n.id === 'N4' ? { ...n, x: n.x + 10 } : n)),
    }))
    // During preview: nothing dropped or held yet.
    expect(useDoc.getState().doc.solver!.changes.some((c) => c.kind === 'position' && c.wallId === 'W4')).toBe(true)
    expect('N1' in useDoc.getState().doc.solver!.baseNodes).toBe(true)
    expect(useDoc.getState().doc.solver!.revoked).toEqual([])

    // Drag back to the exact starting position before releasing.
    useDoc.getState().updateSilent((d) => ({
      ...d,
      nodes: d.nodes!.map((n) => (n.id === 'N1' || n.id === 'N4' ? { ...n, x: n.x - 10 } : n)),
    }))
    endDrag(start)
    // Ended where it started: nothing dropped, nothing held, no re-solve.
    expect(useDoc.getState().doc.solver!.changes.some((c) => c.kind === 'position' && c.wallId === 'W4')).toBe(true)
    expect('N1' in useDoc.getState().doc.solver!.baseNodes).toBe(true)
    expect(useDoc.getState().doc.solver!.revoked).toEqual([])
    vi.advanceTimersByTime(SOLVER_DEBOUNCE_MS + 100)
    expect(useDoc.getState().doc.solver!.solvedAt).toBe(solvedAtBefore)

    // Now drag W4 by +10 cm and release: drop-on-edit runs at endDrag and debounced re-solve runs.
    const start2 = beginDrag()
    useDoc.getState().updateSilent((d) => ({
      ...d,
      nodes: d.nodes!.map((n) => (n.id === 'N1' || n.id === 'N4' ? { ...n, x: n.x + 10 } : n)),
    }))
    endDrag(start2)
    expect(useDoc.getState().doc.solver!.changes.some((c) => c.kind === 'position' && c.wallId === 'W4')).toBe(false)
    expect('N1' in useDoc.getState().doc.solver!.baseNodes).toBe(false)
    expect(useDoc.getState().doc.solver!.revoked).toContainEqual(
      expect.objectContaining({ kind: 'position', wallId: 'W4', by: 'edit' }),
    )

    vi.advanceTimersByTime(SOLVER_DEBOUNCE_MS)
    expect(useDoc.getState().doc.solver!.solvedAt).not.toBe(solvedAtBefore)
    expect(useDoc.getState().doc.solver!.changes.some((c) => c.kind === 'position' && c.wallId === 'W4')).toBe(false)
  })

  it('does not solve on a remote update', () => {
    setSolverEnabled(true)
    const solvedAtBefore = useDoc.getState().doc.solver!.solvedAt

    vi.advanceTimersByTime(1000)
    useDoc.getState().updateSilent(
      (d) => ({
        ...d,
        measurements: { ...d.measurements, 'KI-2': { label: 'KI-2', actualCm: 320, updatedAt: FIXED_NOW } },
      }),
      { remote: true },
    )
    vi.advanceTimersByTime(SOLVER_DEBOUNCE_MS + 200)
    expect(useDoc.getState().doc.solver!.solvedAt).toBe(solvedAtBefore)
  })

  it('does nothing when solver is Off', () => {
    expect(useDoc.getState().doc.solver).toBeUndefined()
    useUi.getState().setMode('measure')
    useUi.getState().setMode('edit')
    expect(useDoc.getState().doc.solver).toBeUndefined()

    useDoc.getState().update((d) => ({
      ...d,
      nodes: d.nodes!.map((n) => (n.id === 'N2' ? { ...n, x: n.x + 5 } : n)),
    }))
    vi.advanceTimersByTime(SOLVER_DEBOUNCE_MS + 200)
    expect(useDoc.getState().doc.solver).toBeUndefined()

    useUi.getState().set({ solveAngles: 'free' })
    expect(useDoc.getState().doc.solver).toBeUndefined()
  })

  it('solves immediately when a solver setting or precision changes while On', () => {
    setSolverEnabled(true)
    const t0 = useDoc.getState().doc.solver!.solvedAt

    vi.advanceTimersByTime(1000)
    useUi.getState().set({ solveAngles: 'free' })
    const t1 = useDoc.getState().doc.solver!.solvedAt
    expect(t1).not.toBe(t0)

    vi.advanceTimersByTime(1000)
    useDoc.getState().update((d) => ({ ...d, apartment: { ...(d.apartment ?? {}), precisionCm: 1 } }))
    const t2 = useDoc.getState().doc.solver!.solvedAt
    expect(t2).not.toBe(t1)
  })

  it('schedules debounced re-solve on updateSilent measurement edit in Edit Mode and folds into undo', () => {
    setSolverEnabled(true)
    const afterOn = useDoc.getState().doc
    const solvedAtBefore = afterOn.solver!.solvedAt
    const pastBefore = useDoc.temporal.getState().pastStates.length

    vi.advanceTimersByTime(1000)
    // Simulate setMeasurement from StoredWallCard/WallCard (updateSilent without { undo: true }).
    useDoc.getState().updateSilent((d) => ({
      ...d,
      measurements: { ...d.measurements, 'KI-2': { label: 'KI-2', actualCm: 320, updatedAt: FIXED_NOW } },
    }))
    // Not solved before debounce.
    expect(useDoc.getState().doc.solver!.solvedAt).toBe(solvedAtBefore)

    vi.advanceTimersByTime(SOLVER_DEBOUNCE_MS)
    // Re-solved silently: W3 moved to match KI-2 = 320, no extra undo step created.
    expect(useDoc.getState().doc.solver!.solvedAt).not.toBe(solvedAtBefore)
    expect(useDoc.getState().doc.solver!.changes.some((c) => c.wallId === 'W3')).toBe(true)
    expect(useDoc.temporal.getState().pastStates.length).toBe(pastBefore)

    // In Measuring Mode, updateSilent measurement edit must NOT trigger a solve.
    useUi.getState().setMode('measure')
    const solvedAtInMeasure = useDoc.getState().doc.solver!.solvedAt
    vi.advanceTimersByTime(1000)
    useDoc.getState().updateSilent((d) => ({
      ...d,
      measurements: { ...d.measurements, 'KI-4': { label: 'KI-4', actualCm: 340, updatedAt: FIXED_NOW } },
    }))
    vi.advanceTimersByTime(SOLVER_DEBOUNCE_MS + 200)
    expect(useDoc.getState().doc.solver!.solvedAt).toBe(solvedAtInMeasure)
  })
})
