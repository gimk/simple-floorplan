// The overlays drawn ABOVE the walls of the wall graph (docs/walls-plan.md "Walls in the
// interface", UI review F1, F2, F3, F26): the A / B markers and the "In line on" guide of a
// selected wall, and the wall number badges that follow the wall selection.
import { renderToString } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import { Viewport } from '../../canvas/Viewport'
import { emptyDoc, useDoc, useUi, type Layers } from '../../model/store'
import type { PlanDoc, Room, Selection } from '../../model/types'
import { convertToV2 } from '../../model/v2/convert'
import { useSidebar, type SidebarTab } from '../../shell/sidebar/store'
import { RoomsLayer } from './RoomsLayer'
import { RoomsOverlay } from './RoomsOverlay'

const BASE_LAYERS: Layers = {
  background: true, dimensions: true, bearingHighlight: true, openings: true, notes: true, clashes: true,
  roomCodes: 'auto', wallLabels: 'auto', outsideDims: true,
}

/** Put the stores in the state the canvas reads (the string renderer reads the initial state). */
const applyState = (store: unknown, patch: object) => {
  const s = store as { setState: (p: object) => void; getInitialState: () => object }
  s.setState(patch)
  Object.assign(s.getInitialState(), patch)
}

/** One room of a test plan: polygon in cm, one corner id per point. */
const mk = (id: string, pts: [number, number][], walkOrder: number): Room => ({
  id, code: id, name: id,
  vertices: pts.map(([x, y], i) => ({ id: `${id}-v${i}`, x, y })),
  holes: [], walls: {}, walkOrder,
})

/** Square room A, 400 x 300 cm, turned into a v2 document: its walls W1..W4, 10 cm thick. */
const v2 = (): PlanDoc =>
  convertToV2({ ...emptyDoc(), rooms: [mk('A', [[0, 0], [400, 0], [400, 300], [0, 300]], 1)] }).doc

type Over = {
  tab?: SidebarTab
  selection?: Selection
  /** `align` given to every wall of the document ('In line on' of the wall card). */
  align?: 'room' | 'center' | 'other'
  walls?: Partial<Layers>
}

/** Draw the two layers of the rooms, in the order of the app: under the walls, then above them. */
const setup = (over: Over = {}) => {
  const base = v2()
  const doc = over.align
    ? { ...base, walls: (base.walls ?? []).map((w) => ({ ...w, align: over.align })) }
    : base
  applyState(useUi, {
    layers: { ...BASE_LAYERS, ...over.walls },
    mode: 'edit',
    tool: 'select',
    selection: over.selection ?? null,
    multi: [],
    hoverLabel: null,
    hoverDiagonal: null,
    view: { x: 0, y: 0, zoom: 1 },
  })
  applyState(useSidebar, { tab: over.tab ?? 'inspect' })
  applyState(useDoc, { doc })
  return renderToString(<Viewport><RoomsLayer /><RoomsOverlay /></Viewport>)
}

const wallId = (doc: PlanDoc, i = 0) => doc.walls![i].id

beforeEach(() => {
  applyState(useUi, {
    layers: BASE_LAYERS, mode: 'edit', tool: 'select', selection: null, multi: [],
    hoverLabel: null, hoverDiagonal: null, view: { x: 0, y: 0, zoom: 1 },
  })
  applyState(useSidebar, { tab: 'inspect' })
  applyState(useDoc, { doc: emptyDoc() })
})

describe('A and B markers of the selected wall', () => {
  it('marks the two sides of the wall, outside the band', () => {
    const id = wallId(v2())
    const html = setup({ selection: { kind: 'storedWall', wallId: id, side: 'L' } })
    // W1 runs from (0,0) to (400,0) and is 10 cm thick: the letters sit 17 cm (half of the band
    // plus 12 px at zoom 1) on each side of its midpoint.
    expect(html).toContain('data-wall-side-marker="A"')
    expect(html).toContain('data-wall-side-marker="B"')
    expect(html).toContain('transform="translate(200 17)"')
    expect(html).toContain('transform="translate(200 -17)"')
    // The side the user clicked is the strong one.
    expect(html).toContain('data-wall-side-marker="A" data-wall-side-marker-active=""')
    expect(html).not.toContain('data-wall-side-marker="B" data-wall-side-marker-active=""')
  })

  it('makes side B the strong one when side B was clicked', () => {
    const id = wallId(v2())
    const html = setup({ selection: { kind: 'storedWall', wallId: id, side: 'R' } })
    expect(html).toContain('data-wall-side-marker="B" data-wall-side-marker-active=""')
    expect(html).not.toContain('data-wall-side-marker="A" data-wall-side-marker-active=""')
  })

  it('draws no marker when no stored wall is selected', () => {
    expect(setup()).not.toContain('data-wall-side-marker')
    expect(setup({ selection: { kind: 'room', roomId: 'A' } })).not.toContain('data-wall-side-marker')
  })
})

describe('the "In line on" guide of the selected wall', () => {
  it('draws the guide on side A by default (half a thickness on the L side)', () => {
    const id = wallId(v2())
    const html = setup({ selection: { kind: 'storedWall', wallId: id, side: 'L' } })
    expect(html).toContain(`data-wall-align-line="${id}"`)
    expect(html).toContain('data-align="room"')
    // W1 is horizontal at y = 0, 10 cm thick: side A is the line at y = 5.
    expect(html).toContain('x1="0" y1="5" x2="400" y2="5"')
  })

  it('draws the centre line for Centre, and the other side for Side B', () => {
    const id = wallId(v2())
    const centre = setup({ selection: { kind: 'storedWall', wallId: id, side: 'L' }, align: 'center' })
    expect(centre).toContain('data-align="center"')
    expect(centre).toContain('x1="0" y1="0" x2="400" y2="0"')
    const other = setup({ selection: { kind: 'storedWall', wallId: id, side: 'L' }, align: 'other' })
    expect(other).toContain('data-align="other"')
    expect(other).toContain('x1="0" y1="-5" x2="400" y2="-5"')
  })

  it('draws no guide without a selected stored wall', () => {
    expect(setup()).not.toContain('data-wall-align-line')
  })
})

describe('wall number badges follow the wall selection', () => {
  it('marks the badge of the face of the selected wall, strong on the clicked side', () => {
    const doc = v2()
    // The face of room A on wall W1, seen from side L (the room is above the wall).
    const face = doc.walls![0].faces.find((f) => f.roomId === 'A')!
    const side = face.side
    const html = setup({ tab: 'solve', walls: { wallLabels: 'on' }, selection: { kind: 'storedWall', wallId: wallId(doc), side } })
    expect(html).toContain('data-wall-number-state="strong"')
    // The wall numbers of the walls that the selection does not touch stay neutral.
    expect(html).toContain('data-wall-number-state="none"')
  })

  it('uses the weak colour on the side that was not clicked', () => {
    const doc = v2()
    const face = doc.walls![0].faces.find((f) => f.roomId === 'A')!
    const other = face.side === 'L' ? 'R' : 'L'
    const html = setup({ tab: 'solve', walls: { wallLabels: 'on' }, selection: { kind: 'storedWall', wallId: wallId(doc), side: other } })
    expect(html).toContain('data-wall-number-state="weak"')
  })

  it('hides the badge of a wall that is very short on screen', () => {
    // 400 cm at zoom 0.05 = 20 px, below the 32 px rule of a badge with a selection.
    const id = wallId(v2())
    applyState(useUi, {
      layers: { ...BASE_LAYERS, wallLabels: 'on' }, mode: 'edit', tool: 'select', multi: [],
      selection: { kind: 'storedWall', wallId: id, side: 'L' }, hoverLabel: null, hoverDiagonal: null,
      view: { x: 0, y: 0, zoom: 0.05 },
    })
    applyState(useSidebar, { tab: 'solve' })
    applyState(useDoc, { doc: v2() })
    const html = renderToString(<Viewport><RoomsLayer /><RoomsOverlay /></Viewport>)
    expect(html).not.toContain('data-wall-number=')
  })
})
