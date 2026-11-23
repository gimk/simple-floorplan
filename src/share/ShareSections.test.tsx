// Rendering tests for the read-only share viewer blocks (src/share/ShareSections.tsx).
// renderToStaticMarkup works without a DOM, like the SVG export tests.
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { PlanDoc, WallElement } from '../model/types'
import { DimensionsTable, NotesList, OpeningsTable, RoomsTable } from './ShareSections'

const rect = (over: Partial<PlanDoc['rooms'][number]> = {}): PlanDoc['rooms'][number] => ({
  id: 'r1',
  code: 'SE',
  name: 'Séjour',
  walkOrder: 1,
  holes: [],
  walls: {},
  ceilingCm: 265,
  vertices: [
    { id: 'v1', x: 0, y: 0 },
    { id: 'v2', x: 400, y: 0 },
    { id: 'v3', x: 400, y: 300 },
    { id: 'v4', x: 0, y: 300 },
  ],
  ...over,
})

const door = (over: Partial<WallElement> = {}): WallElement => ({
  id: 'e1',
  roomId: 'r1',
  wallStart: 'v1',
  kind: 'door',
  variant: 'single',
  offsetCm: 50,
  widthCm: 83,
  heightCm: 204,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
})

const doc = (over: Partial<PlanDoc> = {}): PlanDoc => ({
  projectId: 'p1',
  title: 'Apt 4B',
  rooms: [rect()],
  elements: [door()],
  measurements: { 'SE-1': { label: 'SE-1', actualCm: 402, updatedAt: '2026-02-01T00:00:00.000Z' } },
  roomNotes: { SE: 'Radiator to move.' },
  tapes: [],
  ...over,
})

describe('RoomsTable', () => {
  it('shows the room, its area, its ceiling and the verified count', () => {
    const html = renderToStaticMarkup(<RoomsTable doc={doc()} />)
    expect(html).toContain('Séjour')
    expect(html).toContain('(SE)')
    expect(html).toContain('11,31 m²') // inside face 390 x 290 cm = 11.31 m²
    expect(html).toContain('265 cm')
    expect(html).toContain('✓ 1/5') // one of four walls plus the height measured
  })

  it('lists the verified survey ids in the cell tooltip', () => {
    const html = renderToStaticMarkup(<RoomsTable doc={doc()} />)
    expect(html).toContain('title="SE-1"')
  })

  it('says the plan is empty instead of drawing an empty table', () => {
    const html = renderToStaticMarkup(<RoomsTable doc={doc({ rooms: [] })} />)
    expect(html).toContain('This plan has no rooms yet.')
    expect(html).not.toContain('<table')
  })

  it('marks an outdoor room and shows it outside the indoor total', () => {
    const d = doc({ rooms: [rect(), rect({ id: 'r2', code: 'BA', name: 'Balcony', walkOrder: 2, outdoor: true })] })
    const html = renderToStaticMarkup(<RoomsTable doc={d} />)
    expect(html).toContain('outdoor')
    expect(html).toContain('Outdoor')
    // One row per room (11,31 m² each), then the indoor total and the outdoor subtotal.
    expect(html.match(/11,31 m²/g)?.length).toBe(4)
  })
})

describe('DimensionsTable', () => {
  it('shows the measured value, the plan value and the gap', () => {
    const html = renderToStaticMarkup(<DimensionsTable doc={doc()} />)
    expect(html).toContain('SE-1')
    expect(html).toContain('390 cm') // plan: inside face 400 - 2 x 5 cm
    expect(html).toContain('402 cm')
    expect(html).toContain('12 cm') // gap 402 - 390
    expect(html).toContain('1 of 5 dimensions measured on site')
  })

  it('uses a French comma for a half centimetre', () => {
    const d = doc({ measurements: { 'SE-1': { label: 'SE-1', actualCm: 401.5, updatedAt: '' } } })
    expect(renderToStaticMarkup(<DimensionsTable doc={d} />)).toContain('401,5 cm')
  })

  it('explains that nothing is verified yet', () => {
    const html = renderToStaticMarkup(<DimensionsTable doc={doc({ measurements: {} })} />)
    expect(html).toContain('No dimension measured on site yet')
  })

  it('renders nothing for a plan without rooms', () => {
    expect(renderToStaticMarkup(<DimensionsTable doc={doc({ rooms: [], measurements: {} })} />)).toBe('')
  })
})

describe('OpeningsTable', () => {
  it('lists the opening, its wall and its sizes', () => {
    const html = renderToStaticMarkup(<OpeningsTable doc={doc()} />)
    expect(html).toContain('Door (single)')
    expect(html).toContain('SE-1') // the host wall label
    expect(html).toContain('204') // height cm
    expect(html).toContain('83') // width cm
  })

  it('renders nothing when the plan has no openings', () => {
    expect(renderToStaticMarkup(<OpeningsTable doc={doc({ elements: [] })} />)).toBe('')
  })
})

describe('NotesList', () => {
  it('shows the room name with its note', () => {
    const html = renderToStaticMarkup(<NotesList doc={doc()} />)
    expect(html).toContain('SE · Séjour')
    expect(html).toContain('Radiator to move.')
  })

  it('hides empty notes and renders nothing without notes', () => {
    expect(renderToStaticMarkup(<NotesList doc={doc({ roomNotes: { SE: '   ' } })} />)).toBe('')
    expect(renderToStaticMarkup(<NotesList doc={doc({ roomNotes: {} })} />)).toBe('')
  })
})
