import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { PlanDoc, Room } from '../../model/types'
import { Sidebar } from './Sidebar'
import { buildTrail, roomIdOfSelection } from './trail'

const rect = (): Room => ({
  id: 'r1',
  code: 'SE',
  name: 'Séjour',
  holes: [],
  walls: {},
  walkOrder: 1,
  vertices: [
    { id: 'v0', x: 0, y: 0 },
    { id: 'v1', x: 400, y: 0 },
    { id: 'v2', x: 400, y: 300 },
    { id: 'v3', x: 0, y: 300 },
  ],
})

const doc = (over: Partial<PlanDoc> = {}): PlanDoc => ({
  projectId: 'local',
  title: 'Test',
  rooms: [rect()],
  elements: [
    { id: 'e1', roomId: 'r1', wallStart: 'v1', kind: 'door', offsetCm: 10, widthCm: 83, createdAt: '', updatedAt: '' },
  ],
  measurements: {},
  roomNotes: {},
  tapes: [{ id: 't1', a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, roomId: 'r1' }],
  pins: [{ id: 'p1', roomId: 'r1', at: { x: 10, y: 10 }, photoKeys: [], createdAt: '', updatedAt: '' }],
  ...over,
})

const texts = (d: PlanDoc, selection: Parameters<typeof buildTrail>[1], annot: Parameters<typeof buildTrail>[2] = null) =>
  buildTrail(d, selection, annot).map((c) => c.text)

describe('buildTrail', () => {
  it('shows the apartment alone when nothing is selected', () => {
    expect(texts(doc(), null)).toEqual(['Apartment'])
  })

  it('shows the room name and code for a room selection', () => {
    expect(texts(doc(), { kind: 'room', roomId: 'r1' })).toEqual(['Apartment', 'Séjour (SE)'])
  })

  it('shows the survey wall label', () => {
    expect(texts(doc(), { kind: 'wall', roomId: 'r1', wallStart: 'v1' })).toEqual(['Apartment', 'Séjour (SE)', 'Wall SE-2'])
  })

  it('shows a vertex', () => {
    expect(texts(doc(), { kind: 'vertex', roomId: 'r1', vertexId: 'v1' })).toEqual(['Apartment', 'Séjour (SE)', 'Vertex'])
  })

  it('shows the element kind through its room', () => {
    expect(texts(doc(), { kind: 'element', elementId: 'e1' })).toEqual(['Apartment', 'Séjour (SE)', 'Element Door'])
  })

  it('shows tape and pin through their room', () => {
    expect(texts(doc(), null, { kind: 'tape', id: 't1' })).toEqual(['Apartment', 'Séjour (SE)', 'Tape'])
    expect(texts(doc(), null, { kind: 'pin', id: 'p1' })).toEqual(['Apartment', 'Séjour (SE)', 'Pin'])
  })

  it('falls back to the bare level when the item is gone', () => {
    expect(texts(doc({ elements: [], rooms: [] }), { kind: 'element', elementId: 'nope' })).toEqual(['Apartment', 'Element'])
    expect(texts(doc({ rooms: [] }), { kind: 'wall', roomId: 'r1', wallStart: 'v0' })).toEqual(['Apartment', 'Wall'])
  })

  it('gives every crumb the selection that restores it', () => {
    const crumbs = buildTrail(doc(), { kind: 'wall', roomId: 'r1', wallStart: 'v1' }, null)
    expect(crumbs.map((c) => c.select)).toEqual([
      { kind: 'apartment' },
      { kind: 'room', roomId: 'r1' },
      { kind: 'wall', roomId: 'r1', wallStart: 'v1' },
    ])
  })
})

describe('roomIdOfSelection', () => {
  it('finds the room of an element, a tape and a pin', () => {
    expect(roomIdOfSelection(doc(), { kind: 'element', elementId: 'e1' }, null)).toBe('r1')
    expect(roomIdOfSelection(doc(), null, { kind: 'tape', id: 't1' })).toBe('r1')
    expect(roomIdOfSelection(doc(), null, { kind: 'pin', id: 'p1' })).toBe('r1')
  })

  it('returns undefined when there is no room', () => {
    expect(roomIdOfSelection(doc(), null, null)).toBeUndefined()
    expect(roomIdOfSelection(doc({ tapes: [] }), null, { kind: 'tape', id: 't1' })).toBeUndefined()
  })
})

describe('Sidebar shell', () => {
  it('renders the three tabs with Inspect active', () => {
    const html = renderToString(<Sidebar />)
    expect(html).toContain('role="tablist"')
    expect(html).toContain('aria-selected="true"')
    expect(html).toContain('>Inspect<')
    expect(html).toContain('>Solve<')
    expect(html).toContain('>Plan<')
    expect(html).toContain('role="tabpanel"')
  })

  it('gives the Solve tab the whole-plan sections', () => {
    const html = renderToString(<Sidebar />)
    expect(html).toContain('-panel-solve"')
    expect(html).toContain('aria-label="Progress"')
    expect(html).toContain('aria-label="Settings"')
    expect(html).toContain('aria-label="Actions"')
    // The whole-plan tools live there now, not in the room card.
    expect(html).toContain('name="solveKeepLocked"')
    expect(html).toContain('aria-label="Precision of solved corners and thicknesses"')
  })

  it('mounts the panels unchanged, including the layer checkboxes', () => {
    const html = renderToString(<Sidebar />)
    expect(html).toContain('aria-label="Selection"')
    expect(html).toContain('aria-label="Apartment"')
    expect(html).toContain('name="layer-background"')
    expect(html).toContain('name="layer-notes"')
  })

  it('gives the Plan tab one collapsible section per global tool', () => {
    const html = renderToString(<Sidebar />)
    for (const title of ['Background', 'Layers', 'Calculators', 'Export']) {
      expect(html).toContain(`aria-label="${title}"`)
    }
    // The sections own their content: no double border box around them any more.
    expect(html).not.toContain('<details')
    expect(html).toContain('name="wastePct"')
    expect(html).toContain('name="coverage"')
    expect(html).toContain('name="exportA3"')
    expect(html).toContain('name="exportWithBg"')
  })
})
