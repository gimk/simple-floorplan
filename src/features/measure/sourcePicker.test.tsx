// Tests for the source saved with a value typed in Measuring Mode (docs/walls-plan.md phase 3a).
// The source picker and the L / P tag are gone from the UI: the API and MCP can still send a source.
import { beforeEach, describe, expect, it } from 'vitest'
import { emptyDoc, useDoc, useUi } from '../../model/store'
import { demoRooms } from './demo'
import { setMeasurement } from './actions'

describe('values typed in Measuring Mode carry the source', () => {
  beforeEach(() => {
    useDoc.setState({ doc: { ...emptyDoc(), rooms: demoRooms() } })
    useUi.setState({ measureSource: 'tape' })
  })

  it('saves the source of the value', () => {
    setMeasurement('SE-1', 440, 'laser')
    expect(useDoc.getState().doc.measurements['SE-1'].source).toBe('laser')
  })

  it('saves no source field when there is none (it then counts as tape)', () => {
    setMeasurement('SE-1', 440)
    expect(useDoc.getState().doc.measurements['SE-1'].source).toBeUndefined()
    expect(useDoc.getState().doc.measurements['SE-1'].actualCm).toBe(440)
  })

  it('removes the value and its source together', () => {
    setMeasurement('SE-1', 440, 'plan')
    setMeasurement('SE-1', null, 'plan')
    expect(useDoc.getState().doc.measurements['SE-1']).toBeUndefined()
  })
})
