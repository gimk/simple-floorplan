// Room codes and wall numbers on the plan: they must follow the sidebar tab when the layer is
// 'auto', so the survey IDs of the Solve tab ('CU-6', 'CU-6-T') can be found on the canvas.
import { renderToString } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import { Viewport } from '../../canvas/Viewport'
import { emptyDoc, useDoc, useUi, type Layers } from '../../model/store'
import type { PlanDoc, Room } from '../../model/types'
import { useSidebar, type SidebarTab } from '../../shell/sidebar/store'
import { RoomsLayer } from './RoomsLayer'
import { measuredText } from '../../model/precision'

const BASE_LAYERS: Layers = {
  background: true, dimensions: true, bearingHighlight: true, openings: true, notes: true, clashes: true,
  roomCodes: 'auto', wallLabels: 'auto',
}

/**
 * Put the stores in the state the canvas reads. `renderToString` reads the INITIAL state of a
 * zustand store, and a browser reads the current one, so both get the values.
 */
const applyState = (store: unknown, patch: object) => {
  const s = store as { setState: (p: object) => void; getInitialState: () => object }
  s.setState(patch)
  Object.assign(s.getInitialState(), patch)
}

/** Square room CU, 400 x 300 cm, walls CU-1..CU-4. */
const cuisine = (): Room => ({
  id: 'r-cu', code: 'CU', name: 'Cuisine', holes: [], walls: {}, walkOrder: 1,
  vertices: [
    { id: 'cu-v0', x: 0, y: 0 },
    { id: 'cu-v1', x: 400, y: 0 },
    { id: 'cu-v2', x: 400, y: 300 },
    { id: 'cu-v3', x: 0, y: 300 },
  ],
})

const doc = (rooms: Room[]): PlanDoc => ({ ...emptyDoc(), rooms })

type Over = {
  tab?: SidebarTab; layers?: Partial<Layers>; mode?: 'edit' | 'measure'; zoom?: number; rooms?: Room[]
  /** Survey label under the pointer in the Solve tab list, e.g. 'CU-2'. */
  hoverLabel?: string | null
  hoverDiagonal?: { roomId: string; pair: [number, number] } | null
}

/** Set the stores as the app would, then draw the plan (zoom 1 = 1 cm per screen px). */
const setup = (over: Over = {}) => {
  applyState(useUi, {
    layers: { ...BASE_LAYERS, ...over.layers },
    mode: over.mode ?? 'edit',
    tool: 'select',
    selection: null,
    multi: [],
    hoverLabel: over.hoverLabel ?? null,
    hoverDiagonal: over.hoverDiagonal ?? null,
    view: { x: 0, y: 0, zoom: over.zoom ?? 1 },
  })
  applyState(useSidebar, { tab: over.tab ?? 'inspect' })
  applyState(useDoc, { doc: doc(over.rooms ?? [cuisine()]) })
  // Inside a Viewport, exactly like the app: the zoom and `px()` come from its context.
  return renderToString(<Viewport><RoomsLayer /></Viewport>)
}

beforeEach(() => {
  applyState(useUi, {
    layers: BASE_LAYERS, mode: 'edit', tool: 'select', selection: null, multi: [],
    hoverLabel: null, hoverDiagonal: null,
  })
  applyState(useSidebar, { tab: 'inspect' })
  applyState(useDoc, { doc: doc([]) })
})

describe('hover highlight (Solve tab list)', () => {
  it('draws no highlight when nothing is hovered', () => {
    expect(setup()).not.toContain('data-hover-highlight')
  })

  it('highlights the wall of a wall label', () => {
    const html = setup({ hoverLabel: 'CU-2' })
    expect(html).toContain('data-hover-highlight="wall"')
    expect(html).toContain('data-hover-label="CU-2"')
    // The line runs on the centre line of wall 2: cu-v1 (400,0) to cu-v2 (400,300).
    expect(html).toContain('x1="400" y1="0" x2="400" y2="300"')
    expect(html).toContain('stroke-orange-500/40 dark:stroke-orange-400/45')
  })

  it('highlights the wall of a thickness label', () => {
    const html = setup({ hoverLabel: 'CU-3-T' })
    expect(html).toContain('data-hover-highlight="wall"')
    expect(html).toContain('data-hover-label="CU-3-T"')
    // Wall 3: cu-v2 (400,300) to cu-v3 (0,300).
    expect(html).toContain('x1="400" y1="300" x2="0" y2="300"')
  })

  it('highlights the diagonal of the room, with its planned length', () => {
    // 400 x 300 cm inside the walls: the diagonal of corners 0 and 2 is about 500 cm.
    const html = setup({ hoverLabel: 'CU-D', rooms: [{ ...cuisine(), diagonal: [0, 2] }] })
    expect(html).toContain('data-hover-highlight="diagonal"')
    expect(html).toContain('data-hover-length="CU-D"')
    expect(html).toMatch(/data-hover-length="CU-D"[\s\S]*?cm<\/text>/)
    expect(html).toContain('data-hover-label="CU-D"')
  })

  it('uses the diagonal pair of the suggestion when the room has none', () => {
    const html = setup({ hoverLabel: 'CU-D', hoverDiagonal: { roomId: 'r-cu', pair: [1, 3] } })
    expect(html).toContain('data-hover-highlight="diagonal"')
  })

  it('ignores a diagonal pair of another room and unknown labels', () => {
    expect(setup({ hoverLabel: 'CU-D', hoverDiagonal: { roomId: 'other', pair: [0, 2] } }))
      .not.toContain('data-hover-highlight')
    expect(setup({ hoverLabel: 'ZZ-1' })).not.toContain('data-hover-highlight')
    expect(setup({ hoverLabel: 'CU-H' })).not.toContain('data-hover-highlight')
  })
})

describe('room codes on the plan (layer auto)', () => {
  it('shows the code before the name in the Solve tab', () => {
    const html = setup({ tab: 'solve' })
    expect(html).toContain('data-room-code-text="CU"')
    // Bold mono code, two spaces, then the name in the same text line.
    expect(html).toContain('>CU  </tspan>')
    expect(html).toContain('Cuisine')
    // The area line stays.
    expect(html).toContain('m²')
  })

  it('hides the code on the Inspect tab', () => {
    const html = setup({ tab: 'inspect' })
    expect(html).not.toContain('data-room-code-text=')
    expect(html).toContain('Cuisine')
  })

  it("shows the code everywhere with 'on'", () => {
    expect(setup({ tab: 'inspect', layers: { roomCodes: 'on' } })).toContain('data-room-code-text="CU"')
    expect(setup({ tab: 'plan', layers: { roomCodes: 'on' } })).toContain('data-room-code-text="CU"')
  })

  it("hides the code in the Solve tab with 'off'", () => {
    expect(setup({ tab: 'solve', layers: { roomCodes: 'off' } })).not.toContain('data-room-code-text=')
  })

  it("shows the code alone when the room is too small for the label ('on')", () => {
    // Zoom 0.05: the room is 20 x 15 screen px, below the 50 px rule of the name.
    const html = setup({ tab: 'inspect', layers: { roomCodes: 'on' }, zoom: 0.05 })
    expect(html).toContain('data-room-code-only="r-cu"')
    expect(html).toContain('>CU<')
    expect(html).not.toContain('>Cuisine')
  })

  it('draws no code when there is no room', () => {
    expect(setup({ tab: 'solve', layers: { roomCodes: 'on' }, rooms: [] })).not.toContain('data-room-code-text')
  })
})

describe('wall numbers on the plan (layer auto)', () => {
  it('shows one badge per wall in the Solve tab', () => {
    const html = setup({ tab: 'solve' })
    for (const n of ['1', '2', '3', '4']) expect(html).toContain(`data-wall-number="${n}"`)
    // The badge shows the number only: the code is in the room label.
    expect(html).toContain('>1</text>')
  })

  it('hides the badges on the Inspect tab', () => {
    expect(setup({ tab: 'inspect' })).not.toContain('data-wall-number=')
  })

  it("shows the badges everywhere with 'on'", () => {
    expect(setup({ tab: 'plan', layers: { wallLabels: 'on' } })).toContain('data-wall-number="1"')
  })

  it("hides the badges in the Solve tab with 'off'", () => {
    expect(setup({ tab: 'solve', layers: { wallLabels: 'off' } })).not.toContain('data-wall-number=')
  })

  it('marks the badge of the selected wall in orange', () => {
    const none = setup({ tab: 'solve', layers: { wallLabels: 'on' } })
    expect(none).not.toContain('fill-orange-500 stroke-orange-700')
    // Wall 2 starts at cu-v1: its badge is the only orange one.
    applyState(useUi, { selection: { kind: 'wall', roomId: 'r-cu', wallStart: 'cu-v1' } })
    const html = renderToString(<Viewport><RoomsLayer /></Viewport>)
    expect(html).toContain('data-wall-number="2"')
    expect(html.match(/fill-orange-500 stroke-orange-700/g)).toHaveLength(1)
  })

  it('hides every badge when the walls are too short on screen', () => {
    // 400 cm at zoom 0.03 = 12 screen px, below the 18 px rule.
    expect(setup({ tab: 'solve', layers: { wallLabels: 'on' }, zoom: 0.03 })).not.toContain('data-wall-number=')
  })

  it('shows the badges in Measuring Mode too (auto)', () => {
    expect(setup({ tab: 'inspect', mode: 'measure' })).toContain('data-wall-number="1"')
  })
})

describe('measuredText', () => {
  it('shows the measured value alone when the plan agrees within its precision', () => {
    expect(measuredText(412, 412.5, 0.5)).toBe('✓ 412')
  })
  it('shows the measured and the solved value when they differ', () => {
    expect(measuredText(412, 410.5, 0.5)).toBe('✓ 412 · 410,5')
  })
})
