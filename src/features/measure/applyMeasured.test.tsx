// Bottom of Measuring Mode (docs/solver-plan.md, round 3): "Apply measured values to the plan"
// moves the walls once (one undo step), and is greyed out while no value exists.
import { renderToString } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import { syncStoredGraph } from '../../model/storedGraph'
import { emptyDoc, useDoc, useUi } from '../../model/store'
import type { PlanDoc, Room } from '../../model/types'
import { APPLY_HINT, APPLY_LABEL, APPLY_NONE_TEXT, ApplyMeasuredButton, applyMeasuredToPlan, hasMeasuredValue, measuredThicknesses } from './ApplyMeasuredButton'
import { measureRows } from './logic'

const room = (id: string, pts: [number, number][]): Room => ({
  id, code: id, name: id, holes: [], walkOrder: 1,
  vertices: pts.map(([x, y], i) => ({ id: `${id}v${i}`, x, y })),
  walls: Object.fromEntries(pts.map((_, i) => [`${id}v${i}`, { type: 'partition' as const, thicknessCm: 10 }])),
})

/** Rooms A (300 x 400) and C (300 x 400), side by side. */
function plan(): PlanDoc {
  const rooms = [room('A', [[0, 0], [300, 0], [300, 400], [0, 400]]), room('C', [[300, 0], [600, 0], [600, 400], [300, 400]])]
  const g = syncStoredGraph(undefined, rooms)
  return { ...emptyDoc(), projectId: 'r3', title: 'Round 3', rooms, nodes: g.nodes, walls: g.walls }
}

/** renderToString reads the INITIAL zustand state, so patch both (see MeasurePanel.test.tsx). */
const applyState = (store: unknown, patch: object) => {
  const s = store as { setState: (p: object) => void; getInitialState: () => object }
  s.setState(patch)
  Object.assign(s.getInitialState(), patch)
}

beforeEach(() => {
  applyState(useDoc, { doc: plan() })
  applyState(useUi, { mode: 'measure', selection: null, multi: [], hoverLabel: null })
  // The store write above is itself an undo step: start from a clean history.
  useDoc.temporal.getState().clear()
})

describe('hasMeasuredValue', () => {
  it('is false with no value, and with a value of 0 (the schema stores none)', () => {
    expect(hasMeasuredValue(emptyDoc())).toBe(false)
    expect(hasMeasuredValue({ measurements: { 'A-1': { label: 'A-1', actualCm: 0, updatedAt: '' } } })).toBe(false)
  })

  it('is true as soon as one value has a length', () => {
    expect(hasMeasuredValue({ measurements: { 'A-1': { label: 'A-1', actualCm: 310, updatedAt: '' } } })).toBe(true)
  })
})

describe('applyMeasuredToPlan', () => {
  it('says that there is nothing to apply when no value exists, and moves nothing', () => {
    const before = useDoc.getState().doc
    expect(applyMeasuredToPlan()).toBe(APPLY_NONE_TEXT)
    expect(useDoc.getState().doc).toBe(before)
    expect(useDoc.temporal.getState().pastStates.length).toBe(0)
  })

  it('moves the walls of the measured rooms, as one undo step', () => {
    const base = plan()
    const planned = measureRows(base.rooms[0]).find((r) => r.label === 'A-1')!.plannedCm!
    useDoc.setState({ doc: { ...base, measurements: { 'A-1': { label: 'A-1', actualCm: planned + 20, updatedAt: '' } } } })
    useDoc.temporal.getState().clear()
    const before = useDoc.getState().doc

    expect(applyMeasuredToPlan()).toBe('Applied to 1 room.')
    const after = useDoc.getState().doc
    // The room followed its value: its top wall is now 20 cm longer.
    const top = measureRows(after.rooms.find((r) => r.code === 'A')!).find((r) => r.label === 'A-1')!.plannedCm!
    expect(Math.round(top * 10) / 10).toBe(Math.round((planned + 20) * 10) / 10)
    expect(after).not.toBe(before)
    // One undo step, which puts the plan back.
    expect(useDoc.temporal.getState().pastStates.length).toBe(1)
    useDoc.temporal.getState().undo()
    expect(useDoc.getState().doc).toBe(before)
  })
})

describe('applyMeasuredToPlan and wall thicknesses (round 2 finding 2)', () => {
  it('lists only the thickness values of the plan, with their cm', () => {
    const measurements = {
      'A-1': { label: 'A-1', actualCm: 310, updatedAt: '' },
      'A-1-T': { label: 'A-1-T', actualCm: 24, updatedAt: '' },
      'A-2-T': { label: 'A-2-T', actualCm: 0, updatedAt: '' },
    }
    expect(measuredThicknesses({ measurements })).toEqual([{ label: 'A-1-T', cm: 24 }])
  })

  it('puts a measured thickness on its wall, in the same single undo step, and counts it', () => {
    const base = plan()
    useDoc.setState({ doc: { ...base, measurements: { 'A-1-T': { label: 'A-1-T', actualCm: 24, updatedAt: '' } } } })
    useDoc.temporal.getState().clear()
    const before = useDoc.getState().doc

    // No measured length, only a thickness: the toast says what it applied.
    expect(applyMeasuredToPlan()).toBe('Applied to 1 wall thickness.')
    const after = useDoc.getState().doc
    expect(after.rooms.find((r) => r.code === 'A')!.walls['Av0'].thicknessCm).toBe(24)
    // One undo step, which puts the plan back.
    expect(useDoc.temporal.getState().pastStates.length).toBe(1)
    useDoc.temporal.getState().undo()
    expect(useDoc.getState().doc).toBe(before)
  })

  it('applies lengths and thicknesses together, in one step, and counts both', () => {
    const base = plan()
    const planned = measureRows(base.rooms[0]).find((r) => r.label === 'A-1')!.plannedCm!
    useDoc.setState({
      doc: {
        ...base,
        measurements: {
          'A-1': { label: 'A-1', actualCm: planned + 20, updatedAt: '' },
          'A-1-T': { label: 'A-1-T', actualCm: 24, updatedAt: '' },
        },
      },
    })
    useDoc.temporal.getState().clear()
    const before = useDoc.getState().doc

    expect(applyMeasuredToPlan()).toBe('Applied to 1 room and 1 wall thickness.')
    const after = useDoc.getState().doc
    const room = after.rooms.find((r) => r.code === 'A')!
    expect(room.walls['Av0'].thicknessCm).toBe(24)
    expect(Math.round(measureRows(room).find((r) => r.label === 'A-1')!.plannedCm! * 10) / 10)
      .toBe(Math.round((planned + 20) * 10) / 10)
    // Still one undo step for the whole apply.
    expect(useDoc.temporal.getState().pastStates.length).toBe(1)
    useDoc.temporal.getState().undo()
    expect(useDoc.getState().doc).toBe(before)
  })
})

describe('ApplyMeasuredButton', () => {
  it('is greyed out while no measured value exists, and shows its hint line', () => {
    const html = renderToString(<ApplyMeasuredButton />)
    expect(html).toContain(APPLY_LABEL)
    expect(html).toContain(APPLY_HINT)
    expect(html).toContain('disabled=""')
  })

  it('is enabled as soon as one value exists', () => {
    applyState(useDoc, { doc: { ...plan(), measurements: { 'A-1': { label: 'A-1', actualCm: 310, updatedAt: '' } } } })
    expect(renderToString(<ApplyMeasuredButton />)).not.toContain('disabled=""')
  })
})
