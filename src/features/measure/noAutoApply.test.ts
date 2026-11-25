// Round 3 (docs/solver-plan.md): a value typed in Measuring Mode NEVER moves the plan. The old
// per-room auto-apply (scheduleAutoApply / flushAutoApply) is gone, so nothing happens after typing,
// not even once the old 800 ms delay has passed. The plan follows the values only on Apply, or when
// the solver runs on leaving the mode.
//
// A wall thickness (CODE-n-T) follows the same rule (round 2 finding 2): in Measuring Mode it is a
// value only, in Edit Mode it is a direct edit of the wall.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { syncStoredGraph } from '../../model/storedGraph'
import { emptyDoc, useDoc, useUi } from '../../model/store'
import { thicknessLabel } from '../../model/survey'
import type { PlanDoc, Room } from '../../model/types'
import { installMeasureRules } from '../rooms/measureRules'
import { setMeasurement } from './actions'
import { measureRows } from './logic'

const room = (id: string, pts: [number, number][]): Room => ({
  id, code: id, name: id, holes: [], walkOrder: 1,
  vertices: pts.map(([x, y], i) => ({ id: `${id}v${i}`, x, y })),
  walls: Object.fromEntries(pts.map((_, i) => [`${id}v${i}`, { type: 'partition' as const, thicknessCm: 10 }])),
})

function plan(): PlanDoc {
  const rooms = [room('A', [[0, 0], [300, 0], [300, 400], [0, 400]])]
  const g = syncStoredGraph(undefined, rooms)
  return { ...emptyDoc(), rooms, nodes: g.nodes, walls: g.walls }
}

afterEach(() => vi.useRealTimers())

describe('no auto-apply', () => {
  it('keeps the plan unchanged after a value is typed, even past the old auto-apply delay', () => {
    vi.useFakeTimers()
    installMeasureRules()
    const doc = plan()
    useDoc.setState({ doc })
    const before = useDoc.getState().doc
    const planned = measureRows(before.rooms[0]).find((r) => r.label === 'A-1')!.plannedCm!

    setMeasurement('A-1', planned + 20)
    setMeasurement('A-2', 380)
    vi.advanceTimersByTime(5000)

    const after = useDoc.getState().doc
    expect(after.measurements['A-1']?.actualCm).toBe(planned + 20)
    // Same geometry objects: no corner moved, no wall changed.
    expect(after.nodes).toBe(before.nodes)
    expect(after.walls).toBe(before.walls)
    expect(after.rooms).toBe(before.rooms)
    expect(measureRows(after.rooms[0]).find((r) => r.label === 'A-1')!.plannedCm).toBe(planned)
  })

  it('is not an undo step either', () => {
    const doc = plan()
    useDoc.setState({ doc })
    useDoc.temporal.getState().clear()
    setMeasurement('A-1', 320)
    expect(useDoc.temporal.getState().pastStates.length).toBe(0)
  })
})

describe('a typed wall thickness (round 2 finding 2)', () => {
  it('stays a value in Measuring Mode: no room wall and no stored wall changes', () => {
    installMeasureRules()
    const doc = plan()
    useDoc.setState({ doc })
    useUi.setState({ mode: 'measure' })
    const before = useDoc.getState().doc
    const label = thicknessLabel('A', 0)

    setMeasurement(label, 24)

    const after = useDoc.getState().doc
    expect(after.measurements[label]?.actualCm).toBe(24)
    // The geometry is the same objects: nothing moved, no wall got thicker.
    expect(after.rooms).toBe(before.rooms)
    expect(after.walls).toBe(before.walls)
    expect(after.rooms[0].walls['Av0'].thicknessCm).toBe(10)
    expect(after.walls!.map((w) => w.thicknessCm)).toEqual(before.walls!.map((w) => w.thicknessCm))
  })

  it('is a direct edit of the wall in Edit Mode', () => {
    installMeasureRules()
    const doc = plan()
    useDoc.setState({ doc })
    useUi.setState({ mode: 'edit' })
    const label = thicknessLabel('A', 0)

    setMeasurement(label, 24)

    const after = useDoc.getState().doc
    expect(after.measurements[label]?.actualCm).toBe(24)
    expect(after.rooms[0].walls['Av0'].thicknessCm).toBe(24)
  })
})
