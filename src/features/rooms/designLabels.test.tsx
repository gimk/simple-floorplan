// Canvas labels in Design mode: no room name, no area (m²) and no wall length may be drawn.
// Rendered with react-dom/server, so the zustand `useUi` hook returns its *initial* snapshot: the
// mode is therefore mocked through `vi.hoisted` state, flipped per test.
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Artboard } from '../../model/types'

const ui = vi.hoisted(() => ({ mode: 'design' as 'plan' | 'design' }))

vi.mock('../../shell/uiStore', () => {
  const state = () => ({
    mode: ui.mode, tool: 'select', selection: { kind: 'none' }, activeArtboardId: null,
  })
  type State = ReturnType<typeof state>
  const useUi = (sel: (s: State) => unknown) => sel(state())
  useUi.getState = () => ({ ...state(), set: () => {} })
  useUi.setState = () => {}
  return { useUi }
})

const { RoomsLayer } = await import('./RoomsLayer')

/** One 400 x 300 cm room (12 m²), so every wall is long enough for its label at zoom 1. */
const board: Artboard = {
  id: 'ab1', name: 'Ground floor', xCm: 0, yCm: 0, ceilingHeightCm: 250, precisionCm: 1, wallThicknessCm: 10,
  rooms: [{ id: 'r1', name: 'Living', vertices: [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }, { x: 0, y: 300 }] }],
  openings: [],
  furniture: [],
}

const count = (haystack: string, needle: string) => haystack.split(needle).length - 1

describe('canvas labels in Design mode', () => {
  it('draws no room name, no area and no wall length', () => {
    ui.mode = 'design'
    const html = renderToStaticMarkup(<RoomsLayer artboard={board} />)

    expect(html).not.toContain('data-lod')
    expect(count(html, '<text')).toBe(0)
    expect(html).not.toContain('Living</tspan>')
    // No drawn area text. The m² of the room aria-label below is the only occurrence left.
    expect(count(html, '12 m²')).toBe(1)

    // The accessible names of the room and of every wall stay, so the canvas is still navigable.
    expect(html).toContain('aria-label="Living (12 m²)"')
    expect(html).toContain('aria-label="Wall 1 of Living, 400 cm"')
    expect(html).toContain('aria-label="Wall 2 of Living, 300 cm"')
    expect(count(html, 'data-wall="')).toBe(4)
  })

  it('keeps every label in Plan mode', () => {
    ui.mode = 'plan'
    const html = renderToStaticMarkup(<RoomsLayer artboard={board} />)

    expect(html).toContain('data-lod="full"')
    expect(html).toContain('>Living</tspan>')
    expect(html).toContain('>12 m²</tspan>')
    // Four wall labels of 400, 300, 400 and 300 cm.
    expect(count(html, '<text')).toBe(5)
    expect(count(html, '>400</text>')).toBe(2)
    expect(count(html, '>300</text>')).toBe(2)
    expect(html).toContain('aria-label="Living (12 m²)"')
  })
})
