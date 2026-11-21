import { renderToString } from 'react-dom/server'
import { expect, it } from 'vitest'
import { emptyDoc } from '../../model/store'
import { allSurveyIds, roomsInWalkOrder } from '../../model/survey'
import type { PlanDoc } from '../../model/types'
import { demoRooms } from './demo'
import { MeasureMode } from './index'
import { Overview } from './Overview'
import { RoomCard } from './RoomCard'

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
})
