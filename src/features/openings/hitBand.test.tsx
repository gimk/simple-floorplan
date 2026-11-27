// SSR tests of the invisible opening hit band and of the resize handles of OpeningsLayer
// (react-dom/server, no DOM): clicking anywhere across a thick opening must pick the opening.
//
// react-dom/server asks zustand for the SERVER snapshot, so the document store is replaced by a
// small fake that reads a mutable state object, and the UI store by a fake that returns plan mode
// with the select tool. The viewport context defaults to px = cm and zoom 1, so the markup is
// directly readable in cm.
//
// Layout: two rooms side by side, one 120 cm window at (400, 150) running along y (angle 90). The
// left room ends at x = 400 and the right one starts at x = 400 + gap. The wall of the left room is
// drawn outward in +x, so on a 10 cm artboard the wall centreline is x = 400 + visible / 2, where the
// visible wall is the gap between the rooms: 0 cm when they are flush (the thick wall is masked away
// by the right room), the gap when they are apart, and the full 10 cm for an exterior wall.
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ProjectDoc } from '../../model/types'

const { AB, makeDoc, state, ui } = vi.hoisted(() => {
  const AB = 'ab1'
  /** Two rooms 300 cm tall with `gapCm` between them (0 = flush: they share the same wall line). */
  const makeDoc = (wallThicknessCm: number, gapCm = 0): ProjectDoc => {
    const x2 = 400 + gapCm
    return {
      schemaVersion: 3,
      id: 'p1',
      title: 'Test project',
      refImages: [],
      artboards: [
        {
          id: AB,
          name: 'Plan A',
          xCm: 0,
          yCm: 0,
          ceilingHeightCm: 250,
          precisionCm: 1,
          wallThicknessCm,
          rooms: [
            {
              id: 'r1',
              name: 'Living',
              vertices: [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }, { x: 0, y: 300 }],
            },
            {
              id: 'r2',
              name: 'Kitchen',
              vertices: [{ x: x2, y: 0 }, { x: x2 + 300, y: 0 }, { x: x2 + 300, y: 300 }, { x: x2, y: 300 }],
            },
          ],
          openings: [{ id: 'w1', kind: 'window', xCm: 400, yCm: 150, angleDeg: 90, widthCm: 120 }],
          furniture: [],
        },
      ],
    }
  }
  const state: { doc: ProjectDoc } = { doc: makeDoc(10) }
  const ui: { mode: string; tool: string; selection: unknown } = {
    mode: 'plan',
    tool: 'select',
    selection: { kind: 'none' },
  }
  return { AB, makeDoc, state, ui }
})

vi.mock('../../model/store', () => {
  const getState = () => ({
    doc: state.doc,
    updateSilent: () => {},
    beginDrag: () => {},
    endDrag: () => {},
  })
  const useDoc = Object.assign(
    (selector: (s: ReturnType<typeof getState>) => unknown) => selector(getState()),
    { getState, getInitialState: getState, setState: () => {}, subscribe: () => () => {} },
  )
  return { useDoc }
})

vi.mock('../../shell/uiStore', () => {
  const getState = () => ({ ...ui, set: () => {} })
  const useUi = Object.assign((selector: (s: ReturnType<typeof getState>) => unknown) => selector(getState()), {
    getState,
    getInitialState: getState,
    setState: () => {},
    subscribe: () => () => {},
  })
  return { useUi }
})

// Imported after the mocks so the layer sees the fake stores.
import { OpeningsLayer } from './OpeningsLayer'

const emptySelection = { kind: 'none' as const }
const selectedWindow = { kind: 'opening' as const, artboardId: AB, openingId: 'w1' }

/** Markup of the layer for one wall thickness, one room gap and one selection. */
function layer(wallThicknessCm: number, selection: unknown, gapCm = 0): string {
  state.doc = makeDoc(wallThicknessCm, gapCm)
  ui.selection = selection
  const artboard = state.doc.artboards[0]
  return renderToStaticMarkup(<svg><OpeningsLayer artboard={artboard} /></svg>)
}

/** The single transparent hit line of the layer. */
function hitLine(html: string): string {
  const found = html.match(/<line [^>]*stroke="transparent"[^>]*>/g) ?? []
  expect(found).toHaveLength(1)
  return found[0] ?? ''
}

/** The two resize handles of the layer. */
function handles(html: string): string[] {
  const circles = html.match(/<circle [^>]*>/g) ?? []
  expect(circles).toHaveLength(2)
  return circles
}

describe('OpeningsLayer hit band on a thick wall', () => {
  it('centres the hit line on the wall and spans the whole wall thickness', () => {
    // Two rooms 10 cm apart on a 10 cm artboard: the visible wall is the whole 10 cm.
    const line = hitLine(layer(10, emptySelection, 10))
    // Opening points (400, 90) and (400, 210) shifted 10 / 2 = 5 cm along outward +x.
    expect(line).toContain('x1="405" y1="90" x2="405" y2="210"')
    // max(px(14), 10 + px(6)) = 16 cm at px = cm: 3 cm of margin on both wall faces.
    expect(line).toContain('stroke-width="16"')
    expect(line).toContain('pointer-events="stroke"')
  })

  it('keeps the hit line on the wall line when the two rooms are flush', () => {
    // Flush rooms (0 cm gap) at 10 cm thickness: the thick wall is masked away by the right room, so
    // the wall is a thin line and the opening keeps the thin-wall pick band on that line.
    const html = layer(10, emptySelection, 0)
    const line = hitLine(html)
    expect(line).toContain('x1="400" y1="90" x2="400" y2="210"')
    expect(line).toContain('stroke-width="14"')
    // The jambs are short centred ticks (4 px each way), not 10 cm jambs reaching into the next room.
    expect(html).toContain('x1="404" y1="90" x2="396" y2="90"')
    expect(html).not.toContain('x2="410"')
  })

  it('sits in the middle of a visible wall narrower than the artboard thickness', () => {
    // 5 cm gap between the rooms on a 10 cm artboard: the visible wall is 5 cm, centre at x = 402.5.
    const line = hitLine(layer(10, emptySelection, 5))
    expect(line).toContain('x1="402.5" y1="90" x2="402.5" y2="210"')
    expect(line).toContain('stroke-width="14"')
  })

  it('keeps the plain hit line when the walls are thin', () => {
    const line = hitLine(layer(0, emptySelection))
    expect(line).toContain('x1="400" y1="90" x2="400" y2="210"')
    expect(line).toContain('stroke-width="14"')
  })

  it('puts the resize handles on the middle of the jambs of a thick wall', () => {
    const [a, b] = handles(layer(10, selectedWindow, 10))
    expect(a).toContain('cx="405" cy="90"')
    expect(b).toContain('cx="405" cy="210"')
  })

  it('keeps the resize handles on the wall line when the two rooms are flush', () => {
    const [a, b] = handles(layer(10, selectedWindow, 0))
    expect(a).toContain('cx="400" cy="90"')
    expect(b).toContain('cx="400" cy="210"')
  })

  it('puts the resize handles in the middle of a visible wall narrower than the artboard', () => {
    const [a, b] = handles(layer(10, selectedWindow, 5))
    expect(a).toContain('cx="402.5" cy="90"')
    expect(b).toContain('cx="402.5" cy="210"')
  })

  it('keeps the resize handles on the room edge when the walls are thin', () => {
    const [a, b] = handles(layer(0, selectedWindow))
    expect(a).toContain('cx="400" cy="90"')
    expect(b).toContain('cx="400" cy="210"')
  })
})

describe('OpeningsLayer gap eraser on a thick artboard', () => {
  it('drops the opaque eraser on a thick artboard, even for a flush opening', () => {
    // The stroke mask of RoomsLayer already cuts both flush room borders out of the opening.
    for (const gap of [0, 5, 10]) expect(layer(10, emptySelection, gap)).not.toContain('#09090b')
  })

  it('keeps the eraser when the walls are thin', () => {
    expect(layer(0, emptySelection)).toContain('#09090b')
  })
})
