// Typing a length on the plan (docs/measurements-plan.md section 4): which value a dimension text
// writes, where Tab goes next, and what the field reads.
import { describe, expect, it } from 'vitest'
import {
  dimEditAllowed,
  dimTextLabel,
  isRoomWallLabel,
  isWallValueLabel,
  parseDimValue,
  parseRoomWallLabel,
  stepRoomWallLabel,
  useDimEdit,
  type DimEditOpen,
} from './dimEdit'

describe('parseRoomWallLabel', () => {
  it('reads the code and the number of a room face', () => {
    expect(parseRoomWallLabel('SE-2')).toEqual({ code: 'SE', n: 2 })
    expect(parseRoomWallLabel('CU-12')).toEqual({ code: 'CU', n: 12 })
  })

  it('does not read a thickness, a diagonal, a face number of 0 or a wall value', () => {
    expect(parseRoomWallLabel('SE-2-T')).toBeNull()
    expect(parseRoomWallLabel('SE-D')).toBeNull()
    expect(parseRoomWallLabel('SE-H')).toBeNull()
    expect(parseRoomWallLabel('SE-0')).toBeNull()
    expect(parseRoomWallLabel('W12-E')).toBeNull()
    expect(parseRoomWallLabel('W12-C')).toBeNull()
    expect(parseRoomWallLabel('SE')).toBeNull()
  })

  it('tells a room face and a wall value apart', () => {
    expect(isRoomWallLabel('SE-1')).toBe(true)
    expect(isRoomWallLabel('W12-E')).toBe(false)
    expect(isWallValueLabel('W12-E')).toBe(true)
    expect(isWallValueLabel('W12-C')).toBe(true)
    expect(isWallValueLabel('SE-1')).toBe(false)
  })
})

describe('dimTextLabel', () => {
  it('gives the survey label of a room wall text and of a room face helper', () => {
    expect(dimTextLabel('wall', 'SE-2')).toBe('SE-2')
    expect(dimTextLabel('helper', 'SE-2')).toBe('SE-2')
    // The label is not the same as the wall number: the number counts walls, the label counts faces.
    expect(dimTextLabel('wall', 'A-4')).toBe('A-4')
  })

  it('gives the wall value of the helper dimensions of a wall', () => {
    expect(dimTextLabel('helper', 'W12-E')).toBe('W12-E')
    expect(dimTextLabel('helper', 'W12-C')).toBe('W12-C')
  })

  it('gives the facade value of an outside span of a selected wall, when it has one', () => {
    expect(dimTextLabel('helper', 'out:R:0', 'W12-E')).toBe('W12-E')
    // A span in the middle of a side that a room also covers has no value of its own.
    expect(dimTextLabel('helper', 'out:R:0', null)).toBeNull()
    expect(dimTextLabel('helper', 'out:R:0')).toBeNull()
  })

  it('writes a value for a facade segment of an outside chain only', () => {
    expect(dimTextLabel('outside', 'W1-E')).toBe('W1-E')
    // The overall row of a run, and a segment that is not a whole outside face, write nothing.
    expect(dimTextLabel('outside', 'overall')).toBeNull()
    expect(dimTextLabel('outside', '0')).toBeNull()
    expect(dimTextLabel('outside', '1')).toBeNull()
  })
})

describe('stepRoomWallLabel', () => {
  it('goes to the next wall of the room and wraps around', () => {
    expect(stepRoomWallLabel('SE-1', 1, 4)).toBe('SE-2')
    expect(stepRoomWallLabel('SE-3', 1, 4)).toBe('SE-4')
    expect(stepRoomWallLabel('SE-4', 1, 4)).toBe('SE-1')
  })

  it('goes to the previous wall of the room and wraps around', () => {
    expect(stepRoomWallLabel('SE-2', -1, 4)).toBe('SE-1')
    expect(stepRoomWallLabel('SE-1', -1, 4)).toBe('SE-4')
  })

  it('stays on the room: a wall value, a thickness or a diagonal has no neighbour', () => {
    expect(stepRoomWallLabel('W12-E', 1, 4)).toBeNull()
    expect(stepRoomWallLabel('W12-C', 1, 4)).toBeNull()
    expect(stepRoomWallLabel('SE-1-T', 1, 4)).toBeNull()
    expect(stepRoomWallLabel('SE-D', 1, 4)).toBeNull()
  })

  it('needs at least one face, and comes back into range when the label is stale', () => {
    expect(stepRoomWallLabel('SE-1', 1, 0)).toBeNull()
    expect(stepRoomWallLabel('SE-1', 1, 1)).toBe('SE-1')
    // A face went away: the number is taken back into the walls the room has now.
    expect(stepRoomWallLabel('SE-9', 1, 4)).toBe('SE-2')
  })
})

describe('dimEditAllowed', () => {
  it('is Edit mode with the Select tool only', () => {
    expect(dimEditAllowed('edit', 'select')).toBe(true)
    expect(dimEditAllowed('edit', 'wall')).toBe(false)
    expect(dimEditAllowed('edit', 'pan')).toBe(false)
    expect(dimEditAllowed('measure', 'select')).toBe(false)
  })
})

describe('parseDimValue', () => {
  it('reads a length with a comma or a dot', () => {
    expect(parseDimValue('412,5')).toEqual({ kind: 'cm', cm: 412.5 })
    expect(parseDimValue('412.5')).toEqual({ kind: 'cm', cm: 412.5 })
    expect(parseDimValue('  412 ')).toEqual({ kind: 'cm', cm: 412 })
  })

  it('removes the value when the text is empty', () => {
    expect(parseDimValue('')).toEqual({ kind: 'empty' })
    expect(parseDimValue('   ')).toEqual({ kind: 'empty' })
  })

  it('rejects a word, a zero length and a negative length', () => {
    expect(parseDimValue('abc').kind).toBe('invalid')
    expect(parseDimValue('0').kind).toBe('invalid')
    expect(parseDimValue('-12').kind).toBe('invalid')
    const bad = parseDimValue('4,2,5')
    expect(bad.kind).toBe('invalid')
    if (bad.kind === 'invalid') expect(bad.message.length).toBeGreaterThan(0)
  })
})

describe('useDimEdit', () => {
  it('opens and closes the field of one dimension text', () => {
    const at: DimEditOpen = { label: 'SE-2', at: { x: 10, y: 20 }, plannedCm: 412, roomCode: 'SE', faces: 4 }
    expect(useDimEdit.getState().edit).toBeNull()
    useDimEdit.getState().open(at)
    expect(useDimEdit.getState().edit).toEqual(at)
    useDimEdit.getState().close()
    expect(useDimEdit.getState().edit).toBeNull()
  })
})
