// One hit area per STORED wall (docs/walls-plan.md, "Walls in the interface"): the canvas selects a
// wall as one object, also when no room uses it (a single wall, or a wall left by a deleted room).
import { renderToString } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import { Viewport } from '../../canvas/Viewport'
import { emptyDoc, useDoc, useUi, type Layers } from '../../model/store'
import type { PlanDoc, Room, StoredWall } from '../../model/types'
import { convertToV2 } from '../../model/v2/convert'
import { removeRoom } from '../../model/v2/write'
import { WallsLayer } from './WallsLayer'

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

/** One room of a test plan: polygon in cm, one corner id per point. */
const mk = (id: string, pts: [number, number][], walkOrder: number): Room => ({
  id,
  code: id,
  name: id,
  vertices: pts.map(([x, y], i) => ({ id: `${id}-v${i}`, x, y })),
  holes: [],
  walls: {},
  walkOrder,
})

/** Room A above room B, sharing the wall at y = 300; A is 400 cm wide, 300 tall. */
const rooms = (): Room[] => [
  mk('A', [[0, 0], [400, 0], [400, 300], [0, 300]], 1),
  mk('B', [[0, 300], [400, 300], [400, 600], [0, 600]], 2),
]

/** The v2 document of the two rooms. */
const v2 = (): PlanDoc => convertToV2({ ...emptyDoc(), rooms: rooms() }).doc

/** Draw the walls layer at zoom 1 (1 cm per screen px). */
const setup = (doc: PlanDoc, over: { mode?: 'edit' | 'measure'; tool?: 'select' | 'pan' } = {}) => {
  applyState(useUi, {
    layers: BASE_LAYERS,
    mode: over.mode ?? 'edit',
    tool: over.tool ?? 'select',
    selection: null,
    multi: [],
    view: { x: 0, y: 0, zoom: 1 },
  })
  applyState(useDoc, { doc })
  return renderToString(<Viewport><WallsLayer /></Viewport>)
}

/** Ids of the walls that have a hit area in the rendered plan. */
const hitIds = (html: string) => [...html.matchAll(/data-wall-hit="([^"]+)"/g)].map((m) => m[1])

beforeEach(() => {
  applyState(useUi, {
    layers: BASE_LAYERS, mode: 'edit', tool: 'select', selection: null, multi: [],
    view: { x: 0, y: 0, zoom: 1 },
  })
  applyState(useDoc, { doc: emptyDoc() })
})

describe('WallsLayer hit areas', () => {
  it('draws one hit area per stored wall, once per wall', () => {
    const doc = v2()
    const html = setup(doc)
    const ids = hitIds(html)
    // Every wall of the document, exactly once: the two rooms do not give two hit areas.
    expect(ids).toEqual(doc.walls!.map((w) => w.id))
    expect(new Set(ids).size).toBe(ids.length)
    // The wall between the two rooms is ONE band, so it has ONE hit area.
    const roomsOf = (w: StoredWall) => new Set(w.faces.flatMap((f) => (f.roomId === undefined ? [] : [f.roomId])))
    const shared = doc.walls!.filter((w) => roomsOf(w).size === 2)
    expect(shared).toHaveLength(1)
    expect(ids.filter((id) => id === shared[0].id)).toHaveLength(1)
  })

  it('keeps a hit area on a wall that no room uses any more (a room was deleted)', () => {
    const kept = removeRoom(v2(), 'B')
    const lonely = kept.walls!.filter((w) => w.faces.every((f) => f.roomId === undefined))
    // The walls of room B stayed, as single walls: no room sees them any more.
    expect(lonely.length).toBeGreaterThan(0)
    const ids = hitIds(setup(kept))
    expect(ids).toEqual(kept.walls!.map((w) => w.id))
    for (const w of lonely) expect(ids).toContain(w.id)
  })

  it('draws no hit area for a v1 document (the room walls are used there)', () => {
    const v1: PlanDoc = { ...emptyDoc(), rooms: rooms() }
    expect(hitIds(setup(v1))).toHaveLength(0)
  })

  it('draws no hit area in Measuring Mode, and none when the select tool is off', () => {
    expect(hitIds(setup(v2(), { mode: 'measure' }))).toHaveLength(0)
    expect(hitIds(setup(v2(), { tool: 'pan' }))).toHaveLength(0)
  })
})
