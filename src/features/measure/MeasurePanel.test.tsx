import { renderToString } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import { emptyDoc, useDoc, useUi } from '../../model/store'
import { roomsInWalkOrder } from '../../model/survey'
import type { PlanDoc } from '../../model/types'
import { demoRooms } from './demo'
import { focusMeasureField, selectionRoomId } from './focusField'
import { APPLY_LABEL } from './ApplyMeasuredButton'
import { currentRoomId, MeasurePanel } from './MeasurePanel'
import { RoomCard } from './RoomCard'
import { SOLVER_OFF_TEXT, SOLVER_ON_TEXT } from './SolverBanner'

/** renderToString reads the INITIAL zustand state, so patch both (see RoomsLayer.test.tsx). */
const applyState = (store: unknown, patch: object) => {
  const s = store as { setState: (p: object) => void; getInitialState: () => object }
  s.setState(patch)
  Object.assign(s.getInitialState(), patch)
}

const doc = (): PlanDoc => ({ ...emptyDoc(), rooms: demoRooms() })

beforeEach(() => {
  applyState(useDoc, { doc: doc() })
  applyState(useUi, { mode: 'measure', selection: null, multi: [], hoverLabel: null })
})

describe('currentRoomId', () => {
  const rooms = roomsInWalkOrder(doc())
  it('prefers the selected room, then the last one, then the first with missing values', () => {
    expect(currentRoomId(rooms, rooms[2].id, rooms[1].id, () => true)).toBe(rooms[2].id)
    expect(currentRoomId(rooms, null, rooms[1].id, () => true)).toBe(rooms[1].id)
    expect(currentRoomId(rooms, 'gone', null, (r) => r.id === rooms[3].id)).toBe(rooms[3].id)
    expect(currentRoomId(rooms, null, null, () => false)).toBe(rooms[0].id)
    expect(currentRoomId([], null, null, () => true)).toBeNull()
  })
  it('reads the room of a canvas selection', () => {
    expect(selectionRoomId({ kind: 'wall', roomId: 'r1' })).toBe('r1')
    expect(selectionRoomId({ kind: 'element' })).toBeNull()
    expect(selectionRoomId(null)).toBeNull()
  })
})

describe('MeasurePanel', () => {
  it('opens the selected room and collapses the others', () => {
    const rooms = roomsInWalkOrder(doc())
    applyState(useUi, { selection: { kind: 'room', roomId: rooms[1].id } })
    const html = renderToString(<MeasurePanel />)
    expect(html).toContain(`id="m-${rooms[1].code}-1"`)
    expect(html).not.toContain(`id="m-${rooms[0].code}-1"`)
    expect(html).not.toContain(`id="m-${rooms[2].code}-1"`)
    // Collapsed rooms are header buttons; the canvas replaces the mini drawing.
    expect(html).toContain('data-collapsed')
    expect(html).not.toContain('<svg viewBox')
    // Header: progress, filter, keep screen on; no sunlight mode on desktop.
    expect(html).toContain('aria-label="Measured of total"')
    expect(html).toContain('aria-label="Filter rooms"')
    expect(html).toContain('aria-label="Keep screen on"')
    expect(html).not.toContain('Sunlight')
  })

  it('puts the solver banner at the top and the apply button at the bottom', () => {
    const html = renderToString(<MeasurePanel />)
    const banner = html.indexOf(SOLVER_OFF_TEXT)
    const rooms = html.indexOf('Click a room or a wall on the plan')
    const facade = html.indexOf('Facade')
    const apply = html.indexOf(APPLY_LABEL)
    expect(banner).toBeGreaterThan(-1)
    expect(apply).toBeGreaterThan(-1)
    expect(banner).toBeLessThan(rooms)
    expect(apply).toBeGreaterThan(facade)
    // The banner explains the solver state (purple when On).
    expect(html).toContain('data-solver-banner="off"')
    applyState(useDoc, { doc: { ...doc(), solver: { enabled: true, changes: [], revoked: [], baseNodes: {}, baseThickness: {} } } })
    const on = renderToString(<MeasurePanel />)
    expect(on).toContain(SOLVER_ON_TEXT)
    expect(on).toContain('data-solver-banner="on"')
  })

  it('opens the first room when nothing is selected', () => {
    const rooms = roomsInWalkOrder(doc())
    const html = renderToString(<MeasurePanel />)
    expect(html).toContain(`id="m-${rooms[0].code}-1"`)
    expect(html).not.toContain(`id="m-${rooms[1].code}-1"`)
  })
})

describe('RoomCard on desktop', () => {
  const d = doc()
  const room = roomsInWalkOrder(d)[0]
  const labels = [`${room.code}-1`]

  it('shows the mini drawing by default and hides it with hideDrawing', () => {
    expect(renderToString(<RoomCard doc={d} room={room} allLabels={labels} />)).toContain('<svg')
    expect(renderToString(<RoomCard doc={d} room={room} allLabels={labels} hideDrawing />)).not.toContain('<svg')
  })

  it('rings the field whose label is hovered', () => {
    const plain = renderToString(<RoomCard doc={d} room={room} allLabels={labels} hideDrawing />)
    expect(plain).not.toContain('data-field-highlight')
    applyState(useUi, { hoverLabel: `${room.code}-2` })
    const html = renderToString(<RoomCard doc={d} room={room} allLabels={labels} hideDrawing />)
    expect(html).toContain(`data-field-highlight="${room.code}-2"`)
    expect(html).toContain('ring-orange-500')
    expect(html.match(/data-field-highlight/g)).toHaveLength(1)
  })
})

it('focusMeasureField does nothing without a document', () => {
  expect(() => focusMeasureField('XX-1')).not.toThrow()
})
