import { renderToString } from 'react-dom/server'
import { expect, it } from 'vitest'
import { emptyDoc } from '../../model/store'
import { allSurveyIds, roomsInWalkOrder } from '../../model/survey'
import type { PlanDoc, WallElement } from '../../model/types'
import { demoRooms } from './demo'
import { MeasureMode } from './index'
import { MiniDrawing } from './MiniDrawing'
import { Overview } from './Overview'
import { RoomCard } from './RoomCard'
import { adjacentItems } from './logic'

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
  expect(html).toContain('verified')
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
