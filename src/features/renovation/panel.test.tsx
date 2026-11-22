// Wall inspector: renovation status control and structural warning (docs/plan.md 7.4).
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { PlanDoc, Room, WallProps } from '../../model/types'
import { RoomsPanelView } from '../rooms/RoomsPanel'

const room = (walls: Record<string, WallProps>): Room => ({
  id: 'a',
  code: 'SE',
  name: 'Séjour',
  holes: [],
  walls,
  walkOrder: 1,
  vertices: [
    { id: 'a_v0', x: 0, y: 0 },
    { id: 'a_v1', x: 400, y: 0 },
    { id: 'a_v2', x: 400, y: 300 },
    { id: 'a_v3', x: 0, y: 300 },
  ],
})

const doc = (walls: Record<string, WallProps>): PlanDoc => ({
  projectId: 'p',
  title: 'T',
  rooms: [room(walls)],
  elements: [],
  measurements: {},
  roomNotes: {},
  tapes: [],
})

const render = (walls: Record<string, WallProps>) =>
  renderToString(<RoomsPanelView doc={doc(walls)} selection={{ kind: 'wall', roomId: 'a', wallStart: 'a_v0' }} activeHole={null} />)

describe('wall inspector: renovation status', () => {
  it('shows the Existing / Demolish / New control, Existing by default', () => {
    const html = render({})
    expect(html).toContain('aria-label="Wall status"')
    expect(html).toContain('Existing')
    expect(html).toContain('Demolish')
    expect(html).toContain('>New<')
    expect(html).toContain('aria-pressed="true"')
    expect(html).not.toContain('STRUCTURAL')
  })

  it('warns in red when a bearing wall is marked for demolition', () => {
    const html = render({ a_v0: { type: 'bearing', thicknessCm: 25, status: 'demolish' } })
    expect(html).toContain('role="alert"')
    expect(html).toContain('STRUCTURAL: bearing wall marked for demolition')
  })

  it('warns for an exterior wall too', () => {
    const html = render({ a_v0: { type: 'exterior', thicknessCm: 30, status: 'demolish' } })
    expect(html).toContain('STRUCTURAL: exterior wall marked for demolition')
  })

  it('gives no warning for a demolished partition or for a new wall', () => {
    expect(render({ a_v0: { type: 'partition', thicknessCm: 10, status: 'demolish' } })).not.toContain('STRUCTURAL')
    expect(render({ a_v0: { type: 'bearing', thicknessCm: 25, status: 'new' } })).not.toContain('STRUCTURAL')
  })
})
