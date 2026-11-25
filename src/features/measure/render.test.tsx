import { renderToString } from 'react-dom/server'
import { expect, it } from 'vitest'
import { pointInPolygon } from '../../model/geometry'
import { normalizeDoorHosts } from '../../core/doorHost'
import { emptyDoc } from '../../model/store'
import { allSurveyIds, roomsInWalkOrder } from '../../model/survey'
import type { PlanDoc, Vec, WallElement } from '../../model/types'
import { demoRooms } from './demo'
import { MeasureMode } from './index'
import { MiniDrawing } from './MiniDrawing'
import { Overview } from './Overview'
import { RoomCard } from './RoomCard'
import { adjacentItems, itemSpan } from './logic'

/** SVG path of a door swing arc, e.g. "M12.0,34.0 A56.0,56.0 0 0 1 ...". */
const SWING_ARC = /<path[^>]*d="M[^"]*A[0-9.]+,[0-9.]+ 0 0 [01] [^"]*"/
/** Dashed stroke used for items of adjacent rooms on a shared wall. */
const ADJACENT_DASH = 'stroke-dasharray="4 3"'

it('shows the empty state', () => {
  expect(renderToString(<MeasureMode />)).toContain('Load demo apartment')
})

it('renders the demo apartment with values and items', () => {
  const doc: PlanDoc = {
    ...emptyDoc(), rooms: demoRooms(),
    measurements: { 'SE-1': { label: 'SE-1', actualCm: 440, updatedAt: '' } },
    elements: [{ id: 'e1', roomId: 'demo-SE', wallStart: 'demo-SE-v2', kind: 'door', offsetCm: 20, widthCm: 80, createdAt: '1', updatedAt: '1' }],
  }
  const rooms = roomsInWalkOrder(doc)
  const labels = allSurveyIds(doc).map((s) => s.label)
  expect(rooms).toHaveLength(12)
  const html = renderToString(<><Overview doc={doc} rooms={rooms} />{rooms.map((r) => <RoomCard key={r.id} doc={doc} room={r} allLabels={labels} />)}</>)
  expect(html).toContain('SE-1 · 440')
  expect(html).toContain('measured')
  expect(html).toContain('Chambre 3')
  expect(html).toContain('plan ')
  expect(html).toContain('Pins &amp; photos')
  expect(html).toContain('+ Tape')
})

it('shows a door on a shared wall DASHED in the adjacent room, solid with swing only in its own room', () => {
  const rooms = demoRooms()
  const se = rooms.find((r) => r.code === 'SE')!
  const en = rooms.find((r) => r.code === 'EN')!
  // SE-5 (demo-SE-v4 -> demo-SE-v5) is the wall Séjour shares with Entrée (EN-1).
  const door: WallElement = {
    id: 'door-shared', roomId: se.id, wallStart: se.vertices[4].id, kind: 'door',
    offsetCm: 20, widthCm: 80, hinge: 'start', swing: 'in', createdAt: '1', updatedAt: '1',
  }
  const doc: PlanDoc = { ...emptyDoc(), rooms, elements: [door] }

  // Logic level: the door is adjacent to Entrée, not to Séjour itself.
  expect(adjacentItems(doc, en)).toHaveLength(1)
  expect(adjacentItems(doc, en)[0].kind).toBe('door')
  expect(adjacentItems(doc, se)).toHaveLength(0)

  // Render level: Entrée shows the dashed segment and NO swing arc; Séjour shows solid + swing.
  const enHtml = renderToString(<MiniDrawing doc={doc} room={en} focused={null} />)
  expect(enHtml).toContain(ADJACENT_DASH)
  expect(SWING_ARC.test(enHtml)).toBe(false)

  const seHtml = renderToString(<MiniDrawing doc={doc} room={se} focused={null} />)
  expect(SWING_ARC.test(seHtml)).toBe(true)
  // The solid door line (no dasharray) is present in the owner room only.
  expect(seHtml).not.toContain(ADJACENT_DASH)
})

it('draws a door in the room it opens into, with its arc inside that room', () => {
  const rooms = demoRooms()
  const se = rooms.find((r) => r.code === 'SE')!
  const en = rooms.find((r) => r.code === 'EN')!
  // SE-5 is shared with EN-1. swing 'out' points into Entrée, so the door belongs to Entrée.
  const door: WallElement = {
    id: 'd-out', roomId: se.id, wallStart: se.vertices[4].id, kind: 'door',
    offsetCm: 20, widthCm: 80, hinge: 'start', swing: 'out', createdAt: '1', updatedAt: '1',
  }
  const doc: PlanDoc = { ...emptyDoc(), rooms, elements: [door] }
  const before = itemSpan(doc, se, door)!

  const { doc: fixed, moved } = normalizeDoorHosts(doc)
  expect(moved).toEqual([{ elementId: 'd-out', fromRoomId: se.id, toRoomId: en.id }])
  const host = fixed.elements[0]
  expect(host.swing).toBe('in')
  expect(host.widthCm).toBe(80)

  // The opening stays at the same place in the world.
  const after = itemSpan(fixed, en, host)!
  const edges = (s: { p0: Vec; p1: Vec }) => [Math.min(s.p0.x, s.p1.x), Math.max(s.p0.x, s.p1.x)]
  expect(edges(after)[0]).toBeCloseTo(edges(before)[0], 6)
  expect(edges(after)[1]).toBeCloseTo(edges(before)[1], 6)

  // Host room: solid door line + swing arc, and the arc opens into the room.
  const enHtml = renderToString(<MiniDrawing doc={fixed} room={en} focused={null} />)
  expect(SWING_ARC.test(enHtml)).toBe(true)
  expect(enHtml).not.toContain(ADJACENT_DASH)
  const hinge: Vec = host.hinge === 'end' ? after.p1 : after.p0
  const leafEnd = { x: hinge.x + after.wall.inward.x * host.widthCm, y: hinge.y + after.wall.inward.y * host.widthCm }
  expect(pointInPolygon(leafEnd, en.vertices)).toBe(true)
  expect(pointInPolygon(leafEnd, se.vertices)).toBe(false)

  // Neighbour room: the same door, dashed, with no swing arc.
  const seHtml = renderToString(<MiniDrawing doc={fixed} room={se} focused={null} />)
  expect(seHtml).toContain(ADJACENT_DASH)
  expect(SWING_ARC.test(seHtml)).toBe(false)
})

it('shows Old values (n) in the room card, and the old values of deleted rooms', async () => {
  const { DeletedRoomsOldValues } = await import('./OldValues')
  const old = (label: string, roomCode: string, reason: 'wall-split' | 'room-deleted') =>
    ({ label, actualCm: 412, updatedAt: '2026-11-01T10:00:00.000Z', roomCode, reason, droppedAt: '2026-11-23T12:00:00.000Z' })
  const doc: PlanDoc = { ...emptyDoc(), rooms: demoRooms(), oldMeasurements: [old('SE-2', 'SE', 'wall-split'), old('ZZ-1', 'ZZ', 'room-deleted')] }
  const se = doc.rooms.find((r) => r.code === 'SE')!
  const en = doc.rooms.find((r) => r.code === 'EN')!
  // renderToString puts comment markers between text parts.
  const text = (h: string) => h.replace(/<!-- -->/g, '')
  const html = text(renderToString(<RoomCard doc={doc} room={se} allLabels={[]} />))
  expect(html).toContain('Old values (1)')
  expect(html).toContain('Delete old value SE-2')
  expect(html).toContain('wall split')
  expect(html).toContain('2026-11-23')
  expect(renderToString(<RoomCard doc={doc} room={en} allLabels={[]} />)).not.toContain('Old values')
  const panel = text(renderToString(<DeletedRoomsOldValues doc={doc} />))
  expect(panel).toContain('Old values of deleted rooms (1)')
  expect(panel).toContain('ZZ-1')
  expect(panel).not.toContain('SE-2')
})

it('does not crash when a room has an element of an unknown legacy kind (e.g. cupboard)', () => {
  const rooms = demoRooms()
  const dg = rooms.find((r) => r.code === 'DG')!
  const legacyCupboard = {
    id: 'el-legacy-cupboard',
    roomId: dg.id,
    wallStart: dg.vertices[0].id,
    kind: 'cupboard' as WallElement['kind'],
    offsetCm: 10,
    widthCm: 100,
    depthCm: 60,
    createdAt: '2026-11-22T00:00:00.000Z',
    updatedAt: '2026-11-22T00:00:00.000Z',
  }
  const doc: PlanDoc = { ...emptyDoc(), rooms, elements: [legacyCupboard] }
  const html = renderToString(<RoomCard doc={doc} room={dg} allLabels={[]} />)
  expect(html).toContain('Dégagement')
  expect(html).toContain('cupboard')
})
