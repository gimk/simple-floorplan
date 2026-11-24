// The face of a stored wall on the canvas and on the wall card (docs/walls-plan.md, "Walls in the
// interface"): the strong line runs along the selected face only, and a row of the card selects its
// face. The wall has 4 faces: two room faces on one side, a room face and an outside span on the
// other (same plan as wallFaces.test.ts).
import { renderToString } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import { Viewport } from '../../canvas/Viewport'
import { emptyDoc, useDoc, useUi, type Layers } from '../../model/store'
import type { PlanDoc, Room, Selection } from '../../model/types'
import { convertToV2 } from '../../model/v2/convert'
import { useSidebar } from '../../shell/sidebar/store'
import { setStoredWallFace } from './cards'
import { RoomsLayer } from './RoomsLayer'
import { RoomsOverlay } from './RoomsOverlay'
import { StoredWallCard } from './StoredWallCard'
import { sideFaceKeys, storedWallView } from './wallSides'

const BASE_LAYERS: Layers = {
  background: true, dimensions: true, bearingHighlight: true, openings: true, notes: true, clashes: true,
  roomCodes: 'auto', wallLabels: 'auto',
}

/** Put the stores in the state the canvas reads (the string renderer reads the initial state). */
const applyState = (store: unknown, patch: object) => {
  const s = store as { setState: (p: object) => void; getInitialState: () => object }
  s.setState(patch)
  Object.assign(s.getInitialState(), patch)
}

const mk = (id: string, pts: [number, number][], walkOrder: number): Room => ({
  id, code: id, name: id,
  vertices: pts.map(([x, y], i) => ({ id: `${id}-v${i}`, x, y })),
  holes: [], walls: {}, walkOrder,
})

const plan = (): PlanDoc => convertToV2({
  ...emptyDoc(),
  rooms: [
    mk('A', [[0, 0], [250, 0], [250, 300], [0, 300]], 1),
    mk('B1', [[0, 300], [200, 300], [200, 600], [0, 600]], 2),
    mk('B2', [[200, 300], [400, 300], [400, 600], [200, 600]], 3),
  ],
}).doc

const longWall = (doc: PlanDoc) =>
  doc.walls!.find((w) => w.faces.some((f) => f.roomId === 'A') && w.faces.some((f) => f.roomId === 'B1'))!

const draw = (selection: Selection, numbers = false) => {
  applyState(useUi, {
    layers: numbers ? { ...BASE_LAYERS, wallLabels: 'on' } : BASE_LAYERS, mode: 'edit', tool: 'select', selection, multi: [],
    hoverLabel: null, hoverDiagonal: null, view: { x: 0, y: 0, zoom: 1 },
  })
  applyState(useSidebar, { tab: numbers ? 'solve' : 'inspect' })
  applyState(useDoc, { doc: plan() })
  return renderToString(<Viewport><RoomsLayer /><RoomsOverlay /></Viewport>)
}

beforeEach(() => {
  applyState(useUi, { selection: null, multi: [] })
  applyState(useDoc, { doc: emptyDoc() })
})

describe('the overlay of a selected face', () => {
  it('draws the strong line only along the span of each face, on its side', () => {
    const doc = plan()
    const wall = longWall(doc)
    const view = storedWallView(doc, wall.id)!
    let checked = 0
    for (const s of view.sides) {
      const keys = sideFaceKeys(s)
      s.faces.forEach((f, i) => {
        const html = draw({ kind: 'storedWall', wallId: wall.id, side: s.side, face: keys[i] })
        // One strong line, tagged with the key of the face, and its two ends are the face span.
        expect(html.match(/data-selected-wall-face="/g)).toHaveLength(1)
        const tag = new RegExp(`<line[^>]*data-selected-wall-face="${keys[i]}"[^>]*>`).exec(html)![0]
        const num = (name: string) => Number(new RegExp(`${name}="(-?[\\d.]+)"`).exec(tag)![1])
        const len = Math.hypot(view.b.x - view.a.x, view.b.y - view.a.y)
        const ux = (view.b.x - view.a.x) / len
        const xs = [num('x1'), num('x2')].sort((p, q) => p - q)
        const wantX = [view.a.x + ux * f.from, view.a.x + ux * f.to].sort((p, q) => p - q)
        expect(xs[0]).toBeCloseTo(wantX[0], 3)
        expect(xs[1]).toBeCloseTo(wantX[1], 3)
        // The line is on the side of the face: below the wall (y > 300) for side L.
        expect(num('y1') > 300).toBe(s.side === 'L')
        // The two full side lines are weak (1.5), the strong one is 3.
        expect(html.match(/stroke-width="1.5"[^>]*stroke-orange-500\/70|stroke-orange-500\/70[^>]*stroke-width="1.5"/g)!.length).toBeGreaterThanOrEqual(2)
        // The marker of the side of the face is the active one.
        expect(html).toContain(`data-wall-side-marker="${s.letter}" data-wall-side-marker-active=""`)
        checked++
      })
    }
    expect(checked).toBe(4)
  })

  it('keeps the side behaviour without a face', () => {
    const doc = plan()
    const html = draw({ kind: 'storedWall', wallId: longWall(doc).id, side: 'L' })
    expect(html).not.toContain('data-selected-wall-face')
  })

  it('makes only the selected room face number strong', () => {
    const doc = plan()
    const wall = longWall(doc)
    const view = storedWallView(doc, wall.id)!
    const side = view.sides.find((s) => s.faces.filter((f) => f.kind === 'room').length === 2)!
    const keys = sideFaceKeys(side)
    const html = draw({ kind: 'storedWall', wallId: wall.id, side: side.side, face: keys[0] }, true)
    const states = [...html.matchAll(/data-wall-label="([^"]+)" data-wall-number-state="(\w+)"/g)]
    const first = side.faces[0]
    if (first.kind !== 'room') throw new Error('room face expected')
    const strong = states.filter((m) => m[2] === 'strong').map((m) => m[1])
    expect(strong).toEqual([first.label])
  })
})

describe('the wall card: a face row selects its face', () => {
  it('marks the selected face row (aria-pressed, Selected tag) and the others not', () => {
    const doc = plan()
    const wall = longWall(doc)
    const view = storedWallView(doc, wall.id)!
    const side = view.sides.find((s) => s.faces.filter((f) => f.kind === 'room').length === 2)!
    const keys = sideFaceKeys(side)
    const html = renderToString(<StoredWallCard doc={doc} wallId={wall.id} side={side.side} face={keys[1]} />)
    expect(html).toContain(`data-wall-face-row="${keys[1]}"`)
    // One face is selected, so one 'Selected' tag on a face row, and the side header is not selected.
    expect(html.match(/>Selected</g)).toHaveLength(1)
    expect(html).toContain(`aria-pressed="false" data-wall-side-button="${side.side}"`)
    const row = new RegExp(`data-wall-face-row="${keys[1]}"[\\s\\S]*?Selected`).test(html)
    expect(row).toBe(true)
  })

  it('writes the face of the row into the selection', () => {
    const doc = plan()
    const wall = longWall(doc)
    const view = storedWallView(doc, wall.id)!
    const side = view.sides.find((s) => s.faces.some((f) => f.kind === 'outside'))!
    const keys = sideFaceKeys(side)
    const at = side.faces.findIndex((f) => f.kind === 'outside')
    setStoredWallFace(wall.id, side.side, keys[at])
    expect(useUi.getState().selection).toEqual({ kind: 'storedWall', wallId: wall.id, side: side.side, face: keys[at] })
  })
})
