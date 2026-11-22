import { describe, expect, it } from 'vitest'
import { buildReference, draftAfterAdd, EMPTY_REFERENCE_DRAFT } from './referenceForm'

describe('buildReference', () => {
  it('builds a whole-apartment reference from the draft', () => {
    expect(buildReference({ ...EMPTY_REFERENCE_DRAFT, source: 'carrez', surfaceM2: 62.4 }, 'ref_1')).toEqual({
      id: 'ref_1',
      source: 'carrez',
      surfaceM2: 62.4,
    })
  })

  it('trims the optional text and drops the empty ones', () => {
    const ref = buildReference(
      { source: 'dpe', surfaceM2: 60, roomCode: 'SE', label: '  DPE 2023 ', date: '', note: '   ' },
      'ref_2',
    )
    expect(ref).toEqual({ id: 'ref_2', source: 'dpe', surfaceM2: 60, roomCode: 'SE', label: 'DPE 2023' })
  })

  it('keeps the room and the date when they are set', () => {
    const ref = buildReference(
      { source: 'boutin', surfaceM2: 12, roomCode: 'CU', label: '', date: '2024-03-01', note: 'kitchen only' },
      'ref_3',
    )
    expect(ref).toEqual({ id: 'ref_3', source: 'boutin', surfaceM2: 12, roomCode: 'CU', date: '2024-03-01', note: 'kitchen only' })
  })

  it('rejects a missing, zero, negative or non-finite surface', () => {
    expect(buildReference({ ...EMPTY_REFERENCE_DRAFT, surfaceM2: null }, 'x')).toBeNull()
    expect(buildReference({ ...EMPTY_REFERENCE_DRAFT, surfaceM2: 0 }, 'x')).toBeNull()
    expect(buildReference({ ...EMPTY_REFERENCE_DRAFT, surfaceM2: -3 }, 'x')).toBeNull()
    expect(buildReference({ ...EMPTY_REFERENCE_DRAFT, surfaceM2: Number.NaN }, 'x')).toBeNull()
    expect(buildReference({ ...EMPTY_REFERENCE_DRAFT, surfaceM2: Number.POSITIVE_INFINITY }, 'x')).toBeNull()
  })
})

describe('draftAfterAdd', () => {
  it('clears the surface, the label, the date and the note, and keeps the source and room', () => {
    const next = draftAfterAdd({ source: 'deed', surfaceM2: 55, roomCode: 'SE', label: 'Acte', date: '2024-01-02', note: 'notary' })
    expect(next).toEqual({ source: 'deed', surfaceM2: null, roomCode: 'SE', label: '', date: '', note: '' })
  })
})
