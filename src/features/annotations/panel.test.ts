import { describe, expect, it } from 'vitest'
import type { TapeMeasure } from '../../model/types'
import { PIN_FIELD_NAMES, TAPE_FIELD_NAMES, notePatch, pinTextPatch, realLengthPatch, tapeStats } from './panel'

const tape = (over: Partial<TapeMeasure> = {}): TapeMeasure => ({
  id: 't1',
  a: { x: 0, y: 0 },
  b: { x: 245, y: 0 },
  ...over,
})

describe('tapeStats', () => {
  it('shows the drawn length in cm', () => {
    expect(tapeStats(tape())).toEqual([{ label: 'Drawn length', value: '245 cm' }])
  })

  it('measures diagonals and writes a French comma', () => {
    const stats = tapeStats({ a: { x: 0, y: 0 }, b: { x: 300, y: 400 } })
    expect(stats[0].value).toBe('500 cm')
    expect(tapeStats({ a: { x: 0, y: 0 }, b: { x: 12.5, y: 0 } })[0].value).toBe('12,5 cm')
  })
})

describe('realLengthPatch', () => {
  it('stores a measured length', () => {
    expect(realLengthPatch(243)).toEqual({ actualCm: 243 })
  })

  it('clears the measured length when the field is emptied', () => {
    expect(realLengthPatch(null)).toEqual({ actualCm: undefined })
  })
})

describe('notePatch and pinTextPatch', () => {
  it('store the text as typed', () => {
    expect(notePatch('door frame 2 cm')).toEqual({ note: 'door frame 2 cm' })
    expect(pinTextPatch('panel 140 cm from floor')).toEqual({ text: 'panel 140 cm from floor' })
  })

  it('clear the value on empty text', () => {
    expect(notePatch('')).toEqual({ note: undefined })
    expect(pinTextPatch('')).toEqual({ text: undefined })
  })
})

describe('field names', () => {
  it('keep the names of the pre-migration inputs', () => {
    expect(TAPE_FIELD_NAMES).toEqual({ realLength: 'tapeLength', note: 'tapeNote' })
    expect(PIN_FIELD_NAMES).toEqual({ note: 'pinNote' })
  })
})
