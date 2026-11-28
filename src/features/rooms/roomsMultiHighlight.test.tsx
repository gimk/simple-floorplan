// Highlight of a mixed multi-selection on the canvas: every selected wall and every selected room
// must look exactly like today's single selected wall / single selected room. Rendered with
// react-dom/server, so the zustand `useUi` snapshot is mocked and set per test.
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Artboard, Selection } from '../../model/types'

const ui = vi.hoisted(() => ({
  mode: 'plan' as 'plan' | 'design',
  selection: { kind: 'none' } as Selection,
}))

vi.mock('../../shell/uiStore', () => {
  const state = () => ({
    mode: ui.mode, tool: 'select', selection: ui.selection, activeArtboardId: null,
  })
  type State = ReturnType<typeof state>
  const useUi = (sel: (s: State) => unknown) => sel(state())
  useUi.getState = () => ({ ...state(), set: () => {} })
  useUi.setState = () => {}
  return { useUi }
})

const { RoomsLayer } = await import('./RoomsLayer')

const AB = 'ab1'

/** Two 400 x 300 cm rooms side by side, so every wall is long enough for its label at zoom 1. */
const board = (): Artboard => ({
  id: AB, name: 'Ground floor', xCm: 0, yCm: 0, ceilingHeightCm: 250, precisionCm: 1, wallThicknessCm: 10,
  rooms: [
    {
      id: 'r1', name: 'Living',
      vertices: [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }, { x: 0, y: 300 }],
    },
    {
      id: 'r2', name: 'Kitchen',
      vertices: [{ x: 400, y: 0 }, { x: 700, y: 0 }, { x: 700, y: 300 }, { x: 400, y: 300 }],
    },
  ],
  openings: [],
  furniture: [],
})

const render = (selection: Selection): string => {
  ui.mode = 'plan'
  ui.selection = selection
  return renderToStaticMarkup(<RoomsLayer artboard={board()} />)
}

/** Markup of the group of one wall, from its `data-wall` attribute to the next wall group. */
const wallGroup = (html: string, key: string): string => {
  const from = html.indexOf(`data-wall="${key}"`)
  expect(from).toBeGreaterThan(-1)
  const to = html.indexOf('data-wall="', from + 1)
  return html.slice(from, to < 0 ? undefined : to)
}

/** Markup of the stroked border of one room (up to the next room stroke). */
const roomStroke = (html: string, roomId: string): string => {
  const from = html.indexOf(`data-room-stroke="${roomId}"`)
  expect(from).toBeGreaterThan(-1)
  // The polygon of the border ends at its closing tag: keep the slice independent of what follows.
  const end = html.indexOf('</polygon>', from)
  expect(end).toBeGreaterThan(-1)
  return html.slice(from, end + '</polygon>'.length)
}

const ORANGE = '#fb923c'

describe('RoomsLayer highlight of a mixed multi-selection', () => {
  it('paints the selected wall of a multi selection like a single selected wall', () => {
    const single = render({ kind: 'wall', artboardId: AB, roomId: 'r1', edgeIndex: 1 })
    const multi = render({
      kind: 'multi', artboardId: AB,
      items: [{ kind: 'wall', roomId: 'r1', edgeIndex: 1 }, { kind: 'room', roomId: 'r2' }],
    })
    // The selected wall draws its orange line and orange label in both cases.
    expect(wallGroup(single, 'r1:1')).toContain(`stroke="${ORANGE}"`)
    expect(wallGroup(multi, 'r1:1')).toBe(wallGroup(single, 'r1:1'))
    // Its neighbour wall stays unselected in the multi selection.
    expect(wallGroup(multi, 'r1:0')).toBe(wallGroup(single, 'r1:0'))
    expect(wallGroup(multi, 'r1:0')).not.toContain(ORANGE)
  })

  it('paints every selected wall of a multi selection', () => {
    const html = render({
      kind: 'multi', artboardId: AB,
      items: [{ kind: 'wall', roomId: 'r1', edgeIndex: 1 }, { kind: 'wall', roomId: 'r2', edgeIndex: 3 }],
    })
    expect(wallGroup(html, 'r1:1')).toContain(`stroke="${ORANGE}"`)
    expect(wallGroup(html, 'r2:3')).toContain(`stroke="${ORANGE}"`)
    expect(wallGroup(html, 'r1:2')).not.toContain(ORANGE)
    // A room that holds a selected wall paints its border selected, as for a single selected wall.
    expect(roomStroke(html, 'r1')).toContain(`stroke="${ORANGE}"`)
    expect(roomStroke(html, 'r2')).toContain(`stroke="${ORANGE}"`)
  })

  it('paints the selected room of a multi selection like a single selected room', () => {
    const single = render({ kind: 'room', artboardId: AB, roomIds: ['r2'] })
    const multi = render({
      kind: 'multi', artboardId: AB,
      items: [{ kind: 'wall', roomId: 'r1', edgeIndex: 0 }, { kind: 'room', roomId: 'r2' }],
    })
    expect(roomStroke(single, 'r2')).toContain(`stroke="${ORANGE}"`)
    expect(roomStroke(multi, 'r2')).toBe(roomStroke(single, 'r2'))
    // r1 holds a selected wall, so its border paints selected too (as for a single selected wall).
    expect(roomStroke(multi, 'r1')).toContain(`stroke="${ORANGE}"`)
  })

  it('paints every selected room of a room selection', () => {
    const html = render({ kind: 'room', artboardId: AB, roomIds: ['r1', 'r2'] })
    expect(roomStroke(html, 'r1')).toContain(`stroke="${ORANGE}"`)
    expect(roomStroke(html, 'r2')).toContain(`stroke="${ORANGE}"`)
  })

  it('paints nothing selected for an empty selection', () => {
    const html = render({ kind: 'none' })
    expect(html).not.toContain(`stroke="${ORANGE}"`)
  })
})
