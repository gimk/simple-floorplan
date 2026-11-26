// SSR smoke test of the two Inspect cards (react-dom/server, no DOM needed).
//
// react-dom/server asks zustand for the SERVER snapshot, which is the state frozen when the store
// was created: a document seeded inside a test would not be visible. The store module is therefore
// replaced by a fixed fake document:
//   artboard "ab1" (Plan A) -> r1 = 400 x 300 cm (12 m²), r2 = 300 x 300 cm (9 m², touching r1),
//   r3 = 200 x 200 cm far away, and one door at (200, 0) which sits on the first wall of r1.
// The interactive behaviour (rename, wall length, merge, delete) is not covered here.
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ProjectDoc } from '../../model/types'

const { AB, fakeDoc } = vi.hoisted(() => {
  const rect = (id: string, x0: number, y0: number, x1: number, y1: number) => ({
    id,
    name: id.toUpperCase(),
    vertices: [
      { x: x0, y: y0 },
      { x: x1, y: y0 },
      { x: x1, y: y1 },
      { x: x0, y: y1 },
    ],
  })
  const doc: ProjectDoc = {
    schemaVersion: 3,
    id: 'p1',
    title: 'Test project',
    refImages: [],
    artboards: [
      {
        id: 'ab1',
        name: 'Plan A',
        xCm: 0,
        yCm: 0,
        ceilingHeightCm: 250,
        precisionCm: 1,
        rooms: [
          rect('r1', 0, 0, 400, 300),
          rect('r2', 400, 0, 700, 300),
          rect('r3', 0, 1000, 200, 1200),
        ],
        openings: [{ id: 'o1', kind: 'door', xCm: 200, yCm: 0, angleDeg: 0, widthCm: 80 }],
        furniture: [],
      },
    ],
  }
  return { AB: 'ab1', fakeDoc: doc }
})

vi.mock('../../model/store', () => {
  const getState = () => ({ doc: fakeDoc, update: () => {}, undo: () => {}, redo: () => {} })
  const useDoc = Object.assign(
    (selector: (state: ReturnType<typeof getState>) => unknown) => selector(getState()),
    { getState, getInitialState: getState, setState: () => {}, subscribe: () => () => {} },
  )
  const bounds = () => ({ minX: 0, minY: 0, maxX: 700, maxY: 1200 })
  return { useDoc, artboardBounds: bounds, docBounds: bounds, ARTBOARD_GAP_CM: 150 }
})

// Imported after the mock so the fake store is the one the cards see.
import { RoomInspect } from './RoomInspect'
import { WallInspect } from './WallInspect'

describe('RoomInspect', () => {
  it('renders the single-room card: breadcrumb, name, area, perimeter, walls, delete', () => {
    const html = renderToStaticMarkup(<RoomInspect artboardId={AB} roomIds={['r1']} />)
    expect(html).toContain('aria-label="Room"')
    expect(html).toContain('aria-label="Back to artboard"')
    expect(html).toContain('Plan A')
    expect(html).toContain('aria-label="Room name"')
    // 400 x 300 cm = 12 m², perimeter 4 x 3 m = 14 m
    expect(html).toContain('12,00 m²')
    expect(html).toContain('14,00 m')
    expect(html).toContain('aria-label="Select wall 1"')
    expect(html).toContain('aria-label="Select wall 4"')
    expect(html).toContain('aria-label="Length of wall 1"')
    expect(html).toContain('Delete Room')
    // the multi-selection actions are not shown
    expect(html).not.toContain('Merge Rooms')
  })

  it('renders the multi-selection card: count, combined area, merge, delete selected', () => {
    const html = renderToStaticMarkup(<RoomInspect artboardId={AB} roomIds={['r1', 'r2']} />)
    expect(html).toContain('aria-label="Rooms"')
    expect(html).toContain('Combined area')
    // 12 m² + 9 m²
    expect(html).toContain('21,00 m²')
    expect(html).toContain('Merge Rooms')
    expect(html).toContain('Delete Selected')
    // no per-wall length fields in a multi-selection
    expect(html).not.toContain('aria-label="Length of wall 1"')
  })

  it('counts a repeated id once and falls back to the single-room card', () => {
    const html = renderToStaticMarkup(<RoomInspect artboardId={AB} roomIds={['r1', 'r1', 'missing']} />)
    expect(html).toContain('aria-label="Room"')
    expect(html).not.toContain('Merge Rooms')
  })

  it('renders nothing for an unknown artboard or an empty selection', () => {
    expect(renderToStaticMarkup(<RoomInspect artboardId="missing" roomIds={['r1']} />)).toBe('')
    expect(renderToStaticMarkup(<RoomInspect artboardId={AB} roomIds={[]} />)).toBe('')
    expect(renderToStaticMarkup(<RoomInspect artboardId={AB} roomIds={['missing']} />)).toBe('')
  })
})

describe('WallInspect', () => {
  it('renders heading, length field, endpoints, angle and the door on the wall', () => {
    const html = renderToStaticMarkup(<WallInspect artboardId={AB} roomId="r1" edgeIndex={0} />)
    expect(html).toContain('aria-label="Wall 1"')
    expect(html).toContain('aria-label="Back to room"')
    expect(html).toContain('aria-label="Wall length"')
    // the exact length of the first wall, in cm
    expect(html).toContain('value="400"')
    // (0, 0) -> (400, 0), horizontal
    expect(html).toContain('0,0 · 0,0')
    expect(html).toContain('400,0 · 0,0')
    expect(html).toContain('0,0°')
    expect(html).toContain('1 opening on this wall (door)')
  })

  it('renders a vertical wall with no opening', () => {
    const html = renderToStaticMarkup(<WallInspect artboardId={AB} roomId="r1" edgeIndex={1} />)
    expect(html).toContain('aria-label="Wall 2"')
    expect(html).toContain('90,0°')
    expect(html).toContain('value="300"')
    expect(html).not.toContain('opening on this wall')
  })

  it('renders nothing for an unknown wall, room or artboard', () => {
    expect(renderToStaticMarkup(<WallInspect artboardId={AB} roomId="r1" edgeIndex={9} />)).toBe('')
    expect(renderToStaticMarkup(<WallInspect artboardId={AB} roomId="missing" edgeIndex={0} />)).toBe('')
    expect(renderToStaticMarkup(<WallInspect artboardId="missing" roomId="r1" edgeIndex={0} />)).toBe('')
  })
})
