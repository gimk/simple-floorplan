import { describe, expect, it } from 'vitest'
import type { Selection } from '../../model/types'
import { roomClickSelection, roomDownSelection, wallClickSelection } from './roomsSelectClick'

const AB = 'ab'
const none: Selection = { kind: 'none' }
const room = (roomIds: string[]): Selection => ({ kind: 'room', artboardId: AB, roomIds })
const wall = (roomId: string, edgeIndex: number): Selection => ({ kind: 'wall', artboardId: AB, roomId, edgeIndex })

describe('wallClickSelection', () => {
  it('plain click selects only that wall', () => {
    expect(wallClickSelection(room(['r1', 'r2']), AB, 'r1', 2, false))
      .toEqual({ kind: 'wall', artboardId: AB, roomId: 'r1', edgeIndex: 2 })
  })

  it('plain click replaces a multi selection with that one wall', () => {
    const multi: Selection = {
      kind: 'multi', artboardId: AB,
      items: [{ kind: 'room', roomId: 'r1' }, { kind: 'wall', roomId: 'r1', edgeIndex: 0 }],
    }
    expect(wallClickSelection(multi, AB, 'r2', 1, false))
      .toEqual({ kind: 'wall', artboardId: AB, roomId: 'r2', edgeIndex: 1 })
  })

  it('shift click adds a wall to a room selection', () => {
    expect(wallClickSelection(room(['r1']), AB, 'r2', 0, true)).toEqual({
      kind: 'multi', artboardId: AB,
      items: [{ kind: 'room', roomId: 'r1' }, { kind: 'wall', roomId: 'r2', edgeIndex: 0 }],
    })
  })

  it('shift click removes an already selected wall and stays single', () => {
    const twoWalls: Selection = wall('r1', 0)
    const both = wallClickSelection(twoWalls, AB, 'r1', 3, true)
    expect(both).toEqual({
      kind: 'multi', artboardId: AB,
      items: [{ kind: 'wall', roomId: 'r1', edgeIndex: 0 }, { kind: 'wall', roomId: 'r1', edgeIndex: 3 }],
    })
    expect(wallClickSelection(both, AB, 'r1', 0, true)).toEqual({
      kind: 'wall', artboardId: AB, roomId: 'r1', edgeIndex: 3,
    })
  })

  it('shift click on another artboard starts a fresh selection', () => {
    expect(wallClickSelection(room(['r1']), 'other', 'r2', 1, true))
      .toEqual({ kind: 'wall', artboardId: 'other', roomId: 'r2', edgeIndex: 1 })
  })
})

describe('roomClickSelection', () => {
  it('plain click selects only that room', () => {
    expect(roomClickSelection(room(['r1', 'r2']), AB, 'r2', false))
      .toEqual({ kind: 'room', artboardId: AB, roomIds: ['r2'] })
  })

  it('shift click mixes a room with a wall', () => {
    expect(roomClickSelection(wall('r1', 0), AB, 'r2', true)).toEqual({
      kind: 'multi', artboardId: AB,
      items: [{ kind: 'wall', roomId: 'r1', edgeIndex: 0 }, { kind: 'room', roomId: 'r2' }],
    })
  })

  it('shift click keeps a rooms-only result as kind room', () => {
    expect(roomClickSelection(room(['r1']), AB, 'r2', true))
      .toEqual({ kind: 'room', artboardId: AB, roomIds: ['r1', 'r2'] })
  })

  it('shift click on the only selected room clears the selection', () => {
    expect(roomClickSelection(room(['r1']), AB, 'r1', true)).toEqual({ kind: 'none' })
  })
})

describe('roomDownSelection', () => {
  it('plain press on a room of a room selection keeps the whole selection', () => {
    expect(roomDownSelection(room(['r1', 'r2']), AB, 'r2', false))
      .toEqual({ selection: null, ids: ['r1', 'r2'], startDrag: true })
  })

  it('plain press on a room outside the selection replaces it', () => {
    expect(roomDownSelection(room(['r1']), AB, 'r2', false))
      .toEqual({ selection: { kind: 'room', artboardId: AB, roomIds: ['r2'] }, ids: ['r2'], startDrag: true })
  })

  it('plain press on a room of a multi selection selects only that room', () => {
    const multi: Selection = {
      kind: 'multi', artboardId: AB,
      items: [{ kind: 'room', roomId: 'r1' }, { kind: 'opening', openingId: 'o1' }],
    }
    expect(roomDownSelection(multi, AB, 'r1', false))
      .toEqual({ selection: { kind: 'room', artboardId: AB, roomIds: ['r1'] }, ids: ['r1'], startDrag: true })
  })

  it('shift press adds the room and drags the selected rooms', () => {
    expect(roomDownSelection(room(['r1']), AB, 'r2', true))
      .toEqual({ selection: { kind: 'room', artboardId: AB, roomIds: ['r1', 'r2'] }, ids: ['r1', 'r2'], startDrag: true })
  })

  it('shift press that removes the room writes the selection and starts no drag', () => {
    const multi: Selection = {
      kind: 'multi', artboardId: AB,
      items: [{ kind: 'room', roomId: 'r1' }, { kind: 'wall', roomId: 'r2', edgeIndex: 0 }],
    }
    expect(roomDownSelection(multi, AB, 'r1', true)).toEqual({
      selection: { kind: 'wall', artboardId: AB, roomId: 'r2', edgeIndex: 0 },
      ids: [],
      startDrag: false,
    })
  })

  it('shift press on a room of a multi selection keeps the mix and drags only the rooms', () => {
    const multi: Selection = {
      kind: 'multi', artboardId: AB,
      items: [{ kind: 'room', roomId: 'r1' }, { kind: 'opening', openingId: 'o1' }],
    }
    expect(roomDownSelection(multi, AB, 'r2', true)).toEqual({
      selection: {
        kind: 'multi', artboardId: AB,
        items: [{ kind: 'room', roomId: 'r1' }, { kind: 'opening', openingId: 'o1' }, { kind: 'room', roomId: 'r2' }],
      },
      ids: ['r1', 'r2'],
      startDrag: true,
    })
  })

  it('handles an empty selection', () => {
    expect(roomDownSelection(none, AB, 'r1', false))
      .toEqual({ selection: { kind: 'room', artboardId: AB, roomIds: ['r1'] }, ids: ['r1'], startDrag: true })
    expect(roomDownSelection(none, AB, 'r1', true))
      .toEqual({ selection: { kind: 'room', artboardId: AB, roomIds: ['r1'] }, ids: ['r1'], startDrag: true })
  })
})
