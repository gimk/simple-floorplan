import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Room, WallElement } from '../../model/types'
import { ElementCard } from './index'

const room: Room = {
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
}

const element = (over: Partial<WallElement> = {}): WallElement => ({
  id: 'e1',
  roomId: 'r1',
  wallStart: 'v1',
  kind: 'door',
  variant: 'single',
  offsetCm: 10,
  widthCm: 83,
  createdAt: '',
  updatedAt: '',
  ...over,
})

/** Renders the inspector card for one element and returns its HTML. */
const render = (el: WallElement = element(), host: Room | null = room) =>
  renderToString(<ElementCard el={el} room={host ?? undefined} onPatch={() => {}} onDelete={() => {}} />)

describe('ElementCard', () => {
  it('titles the section with the kind and the wall', () => {
    const html = render()
    expect(html).toContain('Door · wall SE-2 (300 cm)')
    expect(html).toContain('aria-label="Door · wall SE-2 (300 cm)"')
  })

  it('renders as one shared panel card', () => {
    // The PanelSection brings the card look: the old own border box must be gone.
    expect(render().match(/<section/g)?.length).toBe(1)
  })

  it('keeps the names of the pre-migration fields', () => {
    const html = render()
    expect(html).toContain('name="elementKind"')
    expect(html).toContain('name="elementVariant"')
    expect(html).toContain('name="width-cm-"')
    expect(html).toContain('name="height-cm-"')
    expect(html).toContain('name="from-start-corner-cm-"')
    expect(html).toContain('name="from-end-corner-cm-"')
    expect(html).toContain('name="elementNote"')
  })

  it('shows the values with a French comma and the unit inside the field', () => {
    const html = render(element({ offsetCm: 12.5 }))
    expect(html).toContain('value="83"') // width
    expect(html).toContain('value="12,5"') // offset from the start corner
    expect(html).toContain('>cm</span>')
  })

  it('shows hinge and swing as segmented groups for a door', () => {
    const html = render()
    expect(html).toContain('role="group" aria-label="Hinge"')
    expect(html).toContain('role="group" aria-label="Swing"')
    expect(html).toContain('aria-pressed="true"')
    expect(html).not.toContain('name="sill-cm-"')
  })

  it('shows the sill for a window', () => {
    const html = render(element({ kind: 'window', variant: 'standard' }))
    expect(html).toContain('Window · wall SE-2 (300 cm)')
    expect(html).toContain('name="sill-cm-"')
  })

  it('shows the depth for a radiator only', () => {
    expect(render(element({ kind: 'radiator', variant: undefined }))).toContain('name="depth-cm-"')
    expect(render(element({ kind: 'door', variant: 'single' }))).not.toContain('name="depth-cm-"')
  })

  it('warns inline when offset + width is longer than the wall', () => {
    const html = render(element({ offsetCm: 250, widthCm: 83 }))
    expect(html).toContain('role="alert"')
    expect(html).toContain('Offset + width is longer than the wall (300 cm).')
  })

  it('has no warning when the element fits', () => {
    expect(render()).not.toContain('Offset + width is longer than the wall')
  })

  it('puts the delete action in the header', () => {
    const html = render()
    expect(html).toContain('aria-label="Delete element"')
    expect(html).toContain('title="Delete element"')
  })

  it('still renders when the room is gone', () => {
    const html = render(element(), null)
    expect(html).toContain('Door · wall ?')
  })
})
