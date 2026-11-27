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

describe('opaque floors in Design mode', () => {
  const withFill = (extra: object): Artboard => ({
    ...board, rooms: [{ ...board.rooms[0], ...extra }],
  })
  const BASE = 'fill="#161b21"'

  it('renders a solid floor on an opaque base with a faded tint in Design, 0.28 in Plan', () => {
    const b = withFill({ fill: '#b5976b' })
    ui.mode = 'design'
    const design = renderToStaticMarkup(<RoomsLayer artboard={b} />)
    expect(design).toContain(BASE)
    expect(design).toContain('fill-opacity="0.42"')
    ui.mode = 'plan'
    const plan = renderToStaticMarkup(<RoomsLayer artboard={b} />)
    expect(plan).toContain('fill-opacity="0.28"')
    expect(plan).not.toContain(BASE)
  })

  it('renders a pattern with an opaque base and a faded tint in Design, 0.28 in Plan', () => {
    const b = withFill({ fill: '#8a6b4a', floorPattern: 'wood' })
    ui.mode = 'design'
    const design = renderToStaticMarkup(<RoomsLayer artboard={b} />)
    expect(design).toContain(BASE)
    expect(design).toContain('fill-opacity="0.42"')
    ui.mode = 'plan'
    const plan = renderToStaticMarkup(<RoomsLayer artboard={b} />)
    expect(plan).toContain('fill-opacity="0.28"')
    expect(plan).not.toContain(BASE)
  })

  it('keeps the subtle default fill with no fill and no pattern', () => {
    ui.mode = 'design'
    const html = renderToStaticMarkup(<RoomsLayer artboard={board} />)
    expect(html).toContain('rgba(255,255,255,0.04)')
    expect(html).not.toContain(BASE)
  })

  it('rotates the pattern by floorPatternAngleDeg', () => {
    ui.mode = 'design'
    const rotated = renderToStaticMarkup(<RoomsLayer artboard={withFill({ floorPattern: 'wood', floorPatternAngleDeg: 45 })} />)
    expect(rotated).toContain('patternTransform="rotate(45)"')
    const plain = renderToStaticMarkup(<RoomsLayer artboard={withFill({ floorPattern: 'wood' })} />)
    expect(plain).not.toContain('patternTransform')
  })
})

describe('door thresholds', () => {
  // A door on the top wall (y = 0) of the room; a window at the same place for the negative case.
  const hosted = (kind: 'door' | 'window'): Artboard => ({
    ...board,
    rooms: [{ ...board.rooms[0], fill: '#8a6b4a', floorPattern: 'wood' }],
    openings: [{
      id: 'o1', kind, xCm: 200, yCm: 0, angleDeg: 0, widthCm: 90, roomId: 'r1',
    } as Artboard['openings'][number]],
  })

  it('fills a door threshold with the floor pattern of its room', () => {
    ui.mode = 'design'
    const html = renderToStaticMarkup(<RoomsLayer artboard={hosted('door')} />)
    expect(html).toContain('data-door-threshold="r1"')
    const m = html.match(/<polygon data-door-threshold="r1"[^>]*>/)
    expect(m?.[0]).toContain('fill="url(#fp-r1)"')
    expect(m?.[0]).toContain('stroke="none"')
  })

  it('draws no threshold for a window', () => {
    ui.mode = 'design'
    expect(renderToStaticMarkup(<RoomsLayer artboard={hosted('window')} />)).not.toContain('data-door-threshold')
  })
})
