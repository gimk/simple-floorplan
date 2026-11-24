// "Next unmeasured" remembers the last field that had the focus (review finding 16): the jump
// continues after it, and the panel shows every room again when the field is hidden by a filter.
import { describe, expect, it } from 'vitest'
import { labelOfFieldId, startLabel } from './focusField'

describe('start of the next unmeasured jump', () => {
  it('reads the survey label of a field id', () => {
    expect(labelOfFieldId('m-SE-3')).toBe('SE-3')
    expect(labelOfFieldId('m-W12-C')).toBe('W12-C')
    // Not a survey field: a room card, a note, an empty id.
    expect(labelOfFieldId('room-SE')).toBeNull()
    expect(labelOfFieldId('note-SE')).toBeNull()
    expect(labelOfFieldId('')).toBeNull()
    expect(labelOfFieldId(undefined)).toBeNull()
  })

  it('continues after the last field that had the focus', () => {
    // A field has the focus: the label comes from it.
    expect(startLabel('m-SE-2', 'SE-1')).toBe('SE-2')
    // Nothing has the focus (a click on the canvas): the last field is the start.
    expect(startLabel(undefined, 'SE-1')).toBe('SE-1')
    expect(startLabel('wall-name', 'SE-1')).toBe('SE-1')
    // Nothing was ever focused: the jump starts at the first missing value.
    expect(startLabel(undefined, null)).toBeNull()
  })
})
