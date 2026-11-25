// Round 3 (docs/solver-plan.md): a value typed in Measuring Mode NEVER moves the plan. The old
// per-room auto-apply (scheduleAutoApply / flushAutoApply) is gone, so nothing happens after typing,
// not even once the old 800 ms delay has passed. The plan follows the values only on Apply, or when
// the solver runs on leaving the mode.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { syncStoredGraph } from '../../model/storedGraph'
import { emptyDoc, useDoc } from '../../model/store'
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
