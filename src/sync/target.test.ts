// Tests for the target in the sync wire payloads (docs/walls-plan.md phase 5c).
// The target goes to the API only when the value has one, so a value without target
// never removes the target stored on the server.
import { describe, expect, it } from 'vitest'
import type { Measurement } from '../model/types'
import { measurementPutBody } from './api'

const face = { wallId: 'W12', side: 'L' as const, roomId: 'room_SE', from: 0, to: 412 }

describe('measurementPutBody (PUT /measurements/:label body)', () => {
  it('sends the target with the value when the value has one', () => {
    const m: Measurement = { label: 'SE-2', actualCm: 412, updatedAt: 'u', source: 'laser', target: face }
    expect(measurementPutBody(m)).toEqual({ actualCm: 412, updatedAt: 'u', source: 'laser', target: face })
  })

  it('leaves the target out when the value has none (the server keeps its target)', () => {
    const m: Measurement = { label: 'SE-2', actualCm: 412, updatedAt: 'u' }
    expect(measurementPutBody(m)).toEqual({ actualCm: 412, updatedAt: 'u' })
  })

  it('sends a minimal target unchanged', () => {
    const m: Measurement = { label: 'W12-C', actualCm: 424, updatedAt: 'u', target: { wallId: 'W12', side: 'R' } }
    expect(measurementPutBody(m).target).toEqual({ wallId: 'W12', side: 'R' })
  })
})
