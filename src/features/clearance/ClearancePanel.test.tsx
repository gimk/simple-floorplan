import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { PlanDoc, Room, WallElement } from '../../model/types'
import { ClashShapes } from './ClashLayer'
import { ClashList } from './ClearancePanel'
import type { Clash } from './clash'

const room: Room = {
  id: 'r1',
  code: 'A',
  name: 'Entrance',
  holes: [],
  walls: {},
  walkOrder: 0,
  vertices: [
    { id: 'A0', x: 0, y: 0 },
    { id: 'A1', x: 400, y: 0 },
    { id: 'A2', x: 400, y: 300 },
    { id: 'A3', x: 0, y: 300 },
  ],
}

const element = (p: Partial<WallElement> = {}): WallElement => ({
  id: 'd1', roomId: 'r1', wallStart: 'A0', kind: 'door', offsetCm: 50, widthCm: 80,
  hinge: 'start', swing: 'in',
  createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z', ...p,
})

const doc: PlanDoc = {
  projectId: 'test',
  title: 'Test',
  rooms: [room],
  // A radiator right where the door swings: one door-fixture clash.
  elements: [element(), element({ id: 'rad', kind: 'radiator', offsetCm: 60 })],
  measurements: {},
  roomNotes: {},
  tapes: [],
  pins: [],
}

const clash: Clash = { kind: 'door-fixture', a: 'd1', b: 'rad', overlapCm2: 700 }

describe('ClashList', () => {
  it('renders nothing when the plan is clean', () => {
    expect(renderToString(<ClashList doc={doc} clashes={[]} onSelect={() => {}} />)).toBe('')
  })

  it('lists one clickable row per clash', () => {
    const html = renderToString(<ClashList doc={doc} clashes={[clash]} onSelect={() => {}} />)
    expect(html).toContain('aria-label="Clearance"')
    expect(html).toContain('1 clash')
    expect(html).toContain('Door A-1 hits radiator A-1')
    expect(html).toContain('data-clash-row="d1&gt;rad"')
    expect(html).toContain('<button')
  })

  it('counts several clashes in the description', () => {
    const second: Clash = { kind: 'door-wall', a: 'd1', b: null, roomId: 'r1', wallStart: 'A2', overlapCm2: 400 }
    expect(renderToString(<ClashList doc={doc} clashes={[clash, second]} onSelect={() => {}} />)).toContain('2 clashes')
  })
})

describe('ClashShapes', () => {
  const render = (d: PlanDoc) => renderToString(<ClashShapes doc={d} px={(n) => n / 2} />)

  it('draws the footprints of the clashing elements only', () => {
    const html = render(doc)
    expect(html).toContain('data-layer="clashes"')
    expect(html).toContain('data-clash-element="d1"')
    expect(html).toContain('data-clash-element="rad"')
    expect(html).toContain('fill-red-500/20')
    expect(html).toContain('pointer-events="none"')
    // Zoom-independent hairline: 1,5 screen px at zoom 2 = 0,75 world cm.
    expect(html).toContain('stroke-width="0.75"')
  })

  it('draws nothing when there is no clash', () => {
    expect(render({ ...doc, elements: [element()] })).toBe('')
  })
})
