// Tests for the stored target of a value in the command layer (docs/walls-plan.md phase 5c).
// The label stays the key: a command without a target keeps the target already stored.
import { describe, expect, it } from 'vitest'
import { apply, CommandsBatchRequestSchema } from './commands'
import { parsePlan, type PlanDocV1 } from './schema'
import type { MeasureTarget } from '../model/types'

const emptyDoc = (): PlanDocV1 =>
  parsePlan({
    projectId: 'test',
    title: 'Test Apt',
    rooms: [],
    elements: [],
    measurements: {},
    roomNotes: {},
    tapes: [],
    pins: [],
  })

const face: MeasureTarget = { wallId: 'W12', side: 'L', roomId: 'room_SE', from: 0, to: 412, kind: 'face' }

const docWithTarget = (): PlanDocV1 =>
  apply(emptyDoc(), { type: 'set_measurement', label: 'SE-2', actualCm: 412, target: face }).doc

describe('commands: measurement target', () => {
  it('stores the target sent with the value', () => {
    const res = apply(emptyDoc(), { type: 'set_measurement', label: 'SE-2', actualCm: 412, target: face })
    expect(res.doc.measurements['SE-2'].target).toEqual(face)
    expect(res.doc.measurements['SE-2'].actualCm).toBe(412)
  })

  it('keeps the stored target when the command has none', () => {
    const res = apply(docWithTarget(), { type: 'set_measurement', label: 'SE-2', actualCm: 415 })
    expect(res.doc.measurements['SE-2'].actualCm).toBe(415)
    expect(res.doc.measurements['SE-2'].target).toEqual(face)
  })

  it('replaces the target when the command sends a new one', () => {
    const other: MeasureTarget = { wallId: 'W12', side: 'R', kind: 'centre' }
    const res = apply(docWithTarget(), { type: 'set_measurement', label: 'SE-2', actualCm: 415, target: other })
    expect(res.doc.measurements['SE-2'].target).toEqual(other)
  })

  it('strips unknown target keys and rejects a wrong shape', () => {
    const res = apply(emptyDoc(), {
      type: 'set_measurement',
      label: 'SE-2',
      actualCm: 412,
      target: { ...face, extra: 'ignored' },
    })
    expect(res.doc.measurements['SE-2'].target).toEqual(face)

    const bad = CommandsBatchRequestSchema.safeParse({
      commands: [{ type: 'set_measurement', label: 'SE-2', actualCm: 412, target: { wallId: 'W12' } }],
    })
    expect(bad.success).toBe(false)
  })

  it('a value with no target and no stored target has no target field', () => {
    const res = apply(emptyDoc(), { type: 'set_measurement', label: 'SE-2', actualCm: 412 })
    expect(res.doc.measurements['SE-2'].target).toBeUndefined()
  })
})
