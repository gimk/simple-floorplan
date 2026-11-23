// Tests for the target kept by a value typed in Measuring Mode (docs/walls-plan.md phase 5c).
// The label stays the key: typing a new value never drops the target of that label.
import { beforeEach, describe, expect, it } from 'vitest'
import { emptyDoc, useDoc } from '../../model/store'
import type { MeasureTarget } from '../../model/types'
import { demoRooms } from './demo'
import { setMeasurement } from './actions'

const face: MeasureTarget = { wallId: 'W12', side: 'L', roomId: 'room_SE', from: 0, to: 440, kind: 'face' }

const targetOf = (label: string) => useDoc.getState().doc.measurements[label]?.target

const withTarget = () => {
  const doc = useDoc.getState().doc
  useDoc.setState({
    doc: { ...doc, measurements: { ...doc.measurements, 'SE-1': { label: 'SE-1', actualCm: 440, updatedAt: 'u', target: face } } },
  })
}

describe('values typed in Measuring Mode keep their target', () => {
  beforeEach(() => {
    useDoc.setState({ doc: { ...emptyDoc(), rooms: demoRooms() } })
  })

  it('keeps the stored target when a new value is typed without a target', () => {
    withTarget()
    setMeasurement('SE-1', 442)
    expect(useDoc.getState().doc.measurements['SE-1'].actualCm).toBe(442)
    expect(targetOf('SE-1')).toEqual(face)
  })

  it('stores the target given with the value', () => {
    setMeasurement('SE-1', 440, 'laser', face)
    expect(targetOf('SE-1')).toEqual(face)
    expect(useDoc.getState().doc.measurements['SE-1'].source).toBe('laser')
  })

  it('replaces the target when a new one is given', () => {
    withTarget()
    const other: MeasureTarget = { wallId: 'W12', side: 'R', kind: 'centre' }
    setMeasurement('SE-1', 442, undefined, other)
    expect(targetOf('SE-1')).toEqual(other)
  })

  it('a value with no target and no stored target has no target field', () => {
    setMeasurement('SE-1', 440)
    expect(targetOf('SE-1')).toBeUndefined()
  })

  it('a cleared value leaves no measurement (and no target)', () => {
    withTarget()
    setMeasurement('SE-1', null)
    expect(useDoc.getState().doc.measurements['SE-1']).toBeUndefined()
  })
})
