// A value typed on the plan is one undo step; a value typed in a panel field is not (actions.ts).
import { describe, expect, it } from 'vitest'
import { useDoc } from '../../model/store'
import { setMeasurement } from './actions'

describe('setMeasurement undo option', () => {
  it('records one undo step with { undo: true } and none without it', () => {
    useDoc.temporal.getState().clear()
    setMeasurement('ZZ-1', 300)
    expect(useDoc.temporal.getState().pastStates.length).toBe(0)
    setMeasurement('ZZ-1', 412.5, undefined, undefined, { undo: true })
    expect(useDoc.getState().doc.measurements['ZZ-1']?.actualCm).toBe(412.5)
    expect(useDoc.temporal.getState().pastStates.length).toBe(1)
    useDoc.temporal.getState().undo()
    expect(useDoc.getState().doc.measurements['ZZ-1']?.actualCm).toBe(300)
    setMeasurement('ZZ-1', null, undefined, undefined, { undo: true })
    expect(useDoc.getState().doc.measurements['ZZ-1']).toBeUndefined()
  })
})
