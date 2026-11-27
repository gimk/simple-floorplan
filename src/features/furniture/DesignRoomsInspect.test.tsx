// SSR test of the multi-room floor card (DesignRoomsInspect).
//
// No DOM library (jsdom, happy-dom, @testing-library) is installed in this repo, so the markup comes
// from react-dom/server and a real pointer click cannot be dispatched (the same limit as
// src/shell/panel/panel-audit.test.tsx and src/features/rooms/inspect.test.tsx). The click is
// therefore exercised through the action the card wires on every swatch — `onPick` calls exactly
// `setRoomsFill(artboardId, roomIds, swatch.color)` (see DesignRoomsInspect.tsx) — and the markup is
// checked before and after so the "Mixed" state and the common colour are both covered.
// The store is a small mutable fake, because the server renderer asks zustand for the frozen initial
// snapshot: a document seeded from the real store would not be visible.
//   ab1 -> r1 = 400 x 300 cm (12 m², Warm Wood) and r2 = 300 x 300 cm (9 m², Light Oak).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ProjectDoc } from '../../model/types'

const { AB, store } = vi.hoisted(() => {
  const rect = (id: string, x0: number, y0: number, x1: number, y1: number, fill?: string) => ({
    id,
    name: id.toUpperCase(),
    vertices: [
      { x: x0, y: y0 },
      { x: x1, y: y0 },
      { x: x1, y: y1 },
      { x: x0, y: y1 },
    ],
    ...(fill === undefined ? {} : { fill }),
  })
  const doc = {
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
        rooms: [rect('r1', 0, 0, 400, 300, '#8a6b4a'), rect('r2', 400, 0, 700, 300, '#b5976b')],
        openings: [],
        furniture: [],
      },
    ],
  } as ProjectDoc
  const counter = { updates: 0 }
  const getState = () => ({
    doc,
    update: (fn: (d: ProjectDoc) => unknown) => { counter.updates++; fn(doc) },
    updateSilent: (fn: (d: ProjectDoc) => unknown) => { fn(doc) },
    undo: () => {},
    redo: () => {},
  })
  return { AB: 'ab1', store: { doc, counter, getState } }
})

vi.mock('../../model/store', () => {
  const getState = store.getState
  const useDoc = Object.assign((selector: (state: ReturnType<typeof getState>) => unknown) => selector(getState()), {
    getState,
    getInitialState: getState,
    setState: () => {},
    subscribe: () => () => {},
  })
  const bounds = () => ({ minX: 0, minY: 0, maxX: 700, maxY: 1200 })
  return { useDoc, artboardBounds: bounds, docBounds: bounds, ARTBOARD_GAP_CM: 150 }
})

// Imported after the mock so the card sees the fake store.
import { DesignRoomsInspect } from './DesignRoomsInspect'
import { setRoomsFill } from './actions'

const rooms = () => store.doc.artboards[0].rooms
const fills = () => rooms().map((r) => r.fill)
const html = (roomIds: string[]) => renderToStaticMarkup(<DesignRoomsInspect artboardId={AB} roomIds={roomIds} />)

beforeEach(() => {
  store.counter.updates = 0
  rooms()[0].fill = '#8a6b4a'
  rooms()[1].fill = '#b5976b'
})

describe('DesignRoomsInspect', () => {
  it('shows the count, the total area and "Mixed" for two different fills', () => {
    const markup = html(['r1', 'r2'])
    expect(markup).toContain('2 rooms selected')
    // 400 x 300 + 300 x 300 cm = 12 + 9 = 21 m²
    expect(markup).toContain('21')
    expect(markup).toContain('Mixed')
    // No swatch is active, and neither the Warm Wood nor the Light Oak label is shown as current.
    expect(markup).not.toContain('aria-pressed="true" aria-label="Warm Wood"')
    expect(markup).not.toContain('aria-pressed="true" aria-label="Light Oak"')
    // No per-room sections: no name field, no walls, no furniture list.
    expect(markup).not.toContain('Wall paint')
    expect(markup).not.toContain('Furniture')
    expect(markup).not.toContain('Room name')
  })

  it('paints both rooms on one swatch pick, in a single update', () => {
    html(['r1', 'r2'])
    // What the Warm Wood swatch's onPick does.
    setRoomsFill(AB, ['r1', 'r2'], '#8a6b4a')
    expect(fills()).toEqual(['#8a6b4a', '#8a6b4a'])
    expect(store.counter.updates).toBe(1)
    // The card now shows the common colour instead of "Mixed".
    const after = html(['r1', 'r2'])
    expect(after).not.toContain('Mixed')
    expect(after).toContain('Warm Wood')
    expect(after).toContain('aria-pressed="true" aria-label="Warm Wood"')
  })

  it('renders nothing for an unknown artboard or unknown room ids', () => {
    expect(renderToStaticMarkup(<DesignRoomsInspect artboardId="nope" roomIds={['r1', 'r2']} />)).toBe('')
    expect(renderToStaticMarkup(<DesignRoomsInspect artboardId={AB} roomIds={['nope']} />)).toBe('')
  })
})
