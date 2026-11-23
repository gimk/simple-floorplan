// Inspect tab of the traced walls and of the Wall tool (docs/walls-plan.md phase 6).
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { PlanDoc, Room, Selection } from '../../model/types'
import { RoomsPanelView } from './RoomsPanel'

const room: Room = {
  id: 'r1', code: 'SE', name: 'Séjour', holes: [], walls: {}, walkOrder: 1,
  vertices: [{ id: 'v0', x: 0, y: 0 }, { id: 'v1', x: 400, y: 0 }, { id: 'v2', x: 400, y: 300 }],
}

const doc = (over: Partial<PlanDoc> = {}): PlanDoc => ({
  projectId: 'local', title: 'T', rooms: [room], elements: [], measurements: {}, roomNotes: {}, tapes: [],
  traces: [{ id: 't1', a: { x: 1000, y: 0 }, b: { x: 1400, y: 0 }, thicknessCm: 30, type: 'exterior' }],
  ...over,
})

const render = (selection: Selection, d: PlanDoc = doc(), tool: 'select' | 'wall' = 'select') =>
  renderToString(<RoomsPanelView doc={d} selection={selection} activeHole={null} tool={tool} />)

describe('Inspect tab: traced wall', () => {
  it('shows the length, the thickness, the type and a delete button', () => {
    const html = render({ kind: 'trace', id: 't1' })
    expect(html).toContain('Traced wall')
    // React puts a comment between the number and the unit in the server HTML.
    expect(html).toContain('400<!-- --> cm')
    expect(html).toContain('name="traceThickness"')
    expect(html).toContain('Exterior')
    expect(html).toContain('Delete traced wall')
  })

  it('shows nothing when the trace is gone', () => {
    expect(render({ kind: 'trace', id: 'gone' })).toBe('')
  })
})

describe('Inspect tab: New walls card', () => {
  it('shows the thickness and the type of the Wall tool with nothing selected', () => {
    const html = render(null, doc(), 'wall')
    expect(html).toContain('New walls')
    expect(html).toContain('name="newWallThickness"')
    expect(html).toContain('Partition')
    expect(html).toContain('Bearing')
  })

  it('stays hidden with nothing selected and another tool', () => {
    expect(render(null, doc(), 'select')).toBe('')
  })

  it('shows the selected item instead of the card when something is selected', () => {
    const html = render({ kind: 'room', roomId: 'r1' }, doc(), 'wall')
    expect(html).not.toContain('New walls')
  })
})
