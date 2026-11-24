// Breadcrumb trail and Esc rule of a stored wall (docs/walls-plan.md, "Walls in the interface"):
// 'Apartment > Wall W12', and Esc goes to NOTHING (a wall belongs to no room, it sits between two).
import { describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import { useDoc, useUi } from '../../model/store'
import type { PlanDoc, Room } from '../../model/types'
import { Breadcrumb } from './Breadcrumb'
import { buildTrail, parentSelection } from './trail'

/**
 * Put the stores in the state the breadcrumb reads. `renderToString` reads the INITIAL state of a
 * zustand store and a browser reads the current one, so both get the values.
 */
const applyState = (store: unknown, patch: object) => {
  const s = store as { setState: (p: object) => void; getInitialState: () => object }
  s.setState(patch)
  Object.assign(s.getInitialState(), patch)
}

const rect = (): Room => ({
  id: 'r1', code: 'SE', name: 'Séjour', holes: [], walls: {}, walkOrder: 1,
  vertices: [
    { id: 'v0', x: 0, y: 0 },
    { id: 'v1', x: 400, y: 0 },
    { id: 'v2', x: 400, y: 300 },
    { id: 'v3', x: 0, y: 300 },
  ],
})

const doc = (): PlanDoc => ({
  projectId: 'local', title: 'Test', schemaVersion: 2, rooms: [rect()], elements: [], measurements: {},
  roomNotes: {}, tapes: [], nodes: [], walls: [],
})

describe('buildTrail: a stored wall', () => {
  it('shows the apartment and the wall, with no room above it', () => {
    const crumbs = buildTrail(doc(), { kind: 'storedWall', wallId: 'W12', side: 'L' }, null)
    expect(crumbs.map((c) => c.text)).toEqual(['Apartment', 'Wall W12'])
    expect(crumbs[1].level).toBe('storedWall')
    // A click on the crumb selects the same wall, with the side that was clicked.
    expect(crumbs[1].select).toEqual({ kind: 'storedWall', wallId: 'W12', side: 'L' })
  })

  it('keeps the side of the wall when it is not known', () => {
    const crumbs = buildTrail(doc(), { kind: 'storedWall', wallId: 'W7' }, null)
    expect(crumbs[1].select).toEqual({ kind: 'storedWall', wallId: 'W7', side: undefined })
  })
})

describe('Esc from a stored wall', () => {
  it('goes to nothing, not to the room of the clicked side', () => {
    expect(parentSelection(doc(), { kind: 'storedWall', wallId: 'W12', side: 'R' }, null))
      .toEqual({ kind: 'select', selection: null })
  })

  it('still goes up one level from a room, a wall and a vertex', () => {
    expect(parentSelection(doc(), { kind: 'wall', roomId: 'r1', wallStart: 'v1' }, null))
      .toEqual({ kind: 'select', selection: { kind: 'room', roomId: 'r1' } })
    expect(parentSelection(doc(), { kind: 'room', roomId: 'r1' }, null)).toEqual({ kind: 'select', selection: null })
  })
})

describe('Breadcrumb: a stored wall', () => {
  it('writes Apartment > Wall W12', () => {
    applyState(useDoc, { doc: doc() })
    applyState(useUi, { selection: { kind: 'storedWall', wallId: 'W12', side: 'L' }, multi: [] })
    const html = renderToString(<Breadcrumb />)
    expect(html).toContain('Apartment')
    expect(html).toContain('Wall W12')
    // The wall crumb is the current one.
    expect(html).toContain('aria-current="page"')
    applyState(useUi, { selection: null, multi: [] })
  })
})
