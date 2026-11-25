// One undo step for a value typed in a wall card (docs/measurements-plan.md 4, docs/solver-plan.md).
// In Edit Mode a value typed on the plan is a direct edit of the plan: its write is ONE undo step,
// and the solver's debounced re-solve after it folds into that same step. So one Ctrl+Z removes the
// typed value and its re-solve, and nothing older (like turning the solver On).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyDoc, useDoc, useUi } from '../../model/store'
import type { Measurement, PlanDoc, RoomFace, StoredNode, StoredWall } from '../../model/types'
import { targetOfLabel } from '../../model/v2/targets'
import { materializeRooms } from '../../model/v2/materialize'
import { setSolverEnabled } from '../solver/actions'
import { _resetSolverTriggersForTest, installSolverTriggers, SOLVER_DEBOUNCE_MS } from '../solver/triggers'
import { installMeasureRules } from './measureRules'
import { writeWallValue } from './StoredWallCard'

const FIXED_NOW = '2026-11-25T12:00:00.000Z'

const meas = (v: Record<string, number>): Record<string, Measurement> =>
  Object.fromEntries(Object.entries(v).map(([label, actualCm]) => [label, { label, actualCm, updatedAt: FIXED_NOW }]))

/** One room KI (400 x 300 cm) as a v2 document: stored nodes N1..N4 and walls W1..W4. */
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

describe('a value typed in a wall card (Edit Mode, solver On)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    installMeasureRules()
    installSolverTriggers()
    _resetSolverTriggersForTest()
    useUi.setState({
      mode: 'edit',
      measureSource: 'tape',
      solveKeepLocked: true,
      solveSnapThickness: false,
      solveSurfaceMode: 'off',
      solveAngles: 'square',
    })
    useDoc.getState().replace(makeRoomV2({ 'KI-1': 405 }))
    useDoc.temporal.getState().clear()
  })

  afterEach(() => {
    _resetSolverTriggersForTest()
    vi.useRealTimers()
  })

  it('is one undo step: one undo removes the value and its re-solve, and the solver stays On', () => {
    // Solver On is its own undo step; the value must not go back past it.
    setSolverEnabled(true)
    vi.advanceTimersByTime(SOLVER_DEBOUNCE_MS)
    const before = useDoc.getState().doc
    expect(before.solver?.enabled).toBe(true)
    const pastBefore = useDoc.temporal.getState().pastStates.length

    // The wall card path of the face 'KI-3' (the inside of W3), in Edit Mode: one write.
    const doc = useDoc.getState().doc
    writeWallValue('KI-3', 340, 'tape', targetOfLabel(doc, 'KI-3'))
    expect(useDoc.getState().doc.measurements['KI-3']?.actualCm).toBe(340)
    // The write itself is the undo step (the re-solve comes later, silently).
    expect(useDoc.temporal.getState().pastStates.length).toBe(pastBefore + 1)

    // The re-solve waits for the debounce, then folds into the step of the value.
    vi.advanceTimersByTime(SOLVER_DEBOUNCE_MS)
    const solved = useDoc.getState().doc
    expect(solved.solver?.enabled).toBe(true)
    expect(solved.nodes).not.toEqual(before.nodes)
    expect(useDoc.temporal.getState().pastStates.length).toBe(pastBefore + 1)

    // ONE undo: the value is gone, the solver is still On, and the geometry is the one before it.
    useDoc.temporal.getState().undo()
    const undone = useDoc.getState().doc
    expect(undone.measurements['KI-3']).toBeUndefined()
    expect(undone.solver?.enabled).toBe(true)
    expect(undone.nodes).toEqual(before.nodes)
    expect(undone.walls).toEqual(before.walls)
  })

  it('is not an undo step in Measuring Mode, and does not solve there', () => {
    setSolverEnabled(true)
    useUi.getState().setMode('measure')
    const before = useDoc.getState().doc
    const pastBefore = useDoc.temporal.getState().pastStates.length

    writeWallValue('KI-3', 340, 'tape')

    vi.advanceTimersByTime(SOLVER_DEBOUNCE_MS + 100)
    const after = useDoc.getState().doc
    // The value is stored as a value only: no undo step, and the plan did not move.
    expect(after.measurements['KI-3']?.actualCm).toBe(340)
    expect(useDoc.temporal.getState().pastStates.length).toBe(pastBefore)
    expect(after.nodes).toEqual(before.nodes)
  })
})
