// The base position of a wall the solver moved, drawn as a thin dashed purple line while the change
// is hovered (or selected): docs/solver-plan.md, "Purple everywhere".
import { renderToString } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import { Viewport } from '../../canvas/Viewport'
import { emptyDoc, useDoc, useUi } from '../../model/store'
import type { PlanDoc, Selection, SolverState, StoredNode, StoredWall } from '../../model/types'
import { SOLVED_STROKE } from '../../shell/panel/styles'
import { SolverGhostLayer, ghostWallOfLabel, wallBaseLine } from './SolverGhostLayer'

const applyState = (store: unknown, patch: object) => {
  const s = store as { setState: (p: object) => void; getInitialState: () => object }
  s.setState(patch)
  Object.assign(s.getInitialState(), patch)
}

const node = (id: string, x: number, y: number): StoredNode => ({ id, x, y })
const wall = (id: string, a: string, b: string): StoredWall =>
  ({ id, a, b, faces: [], type: 'partition', thicknessCm: 10 })

/** Two walls: W1 along y = 0, W2 along x = 400. The solver moved W1 3 cm north. */
const doc = (solver?: SolverState): PlanDoc => ({
  ...emptyDoc(),
  schemaVersion: 2,
  nodes: [node('N1', 0, 3), node('N2', 400, 3), node('N3', 400, 300)],
  walls: [wall('W1', 'N1', 'N2'), wall('W2', 'N2', 'N3')],
  rooms: [],
  measurements: {},
  ...(solver ? { solver } : {}),
})

const solver = (over: Partial<SolverState> = {}): SolverState => ({
  enabled: true,
  changes: [{ kind: 'position', wallId: 'W1', label: 'SE-1', moveCm: 3, dir: 'S' }],
  revoked: [],
  baseNodes: { N1: { x: 0, y: 0 }, N2: { x: 400, y: 0 } },
  baseThickness: {},
  ...over,
})

type Over = {
  doc?: PlanDoc
  hoverLabel?: string | null
  selection?: Selection
}

const setup = (over: Over = {}) => {
  applyState(useUi, {
    hoverLabel: over.hoverLabel ?? null,
    hoverDiagonal: null,
    selection: over.selection ?? null,
    multi: [],
  })
  applyState(useDoc, { doc: over.doc ?? doc(solver()) })
  return renderToString(<Viewport><SolverGhostLayer /></Viewport>)
}

beforeEach(() => {
  applyState(useUi, { hoverLabel: null, hoverDiagonal: null, selection: null, multi: [] })
  applyState(useDoc, { doc: emptyDoc() })
})

describe('wallBaseLine', () => {
  it('gives the base position of a wall the solver moved', () => {
    expect(wallBaseLine(doc(solver()), 'W1')).toEqual({ wallId: 'W1', a: { x: 0, y: 0 }, b: { x: 400, y: 0 } })
  })

  it('is null when the solver is Off, when the wall has no change, or only its thickness changed', () => {
    expect(wallBaseLine(doc({ ...solver(), enabled: false }), 'W1')).toBeNull()
    expect(wallBaseLine(doc(solver()), 'W2')).toBeNull()
    expect(wallBaseLine(doc(solver({ changes: [{ kind: 'thickness', wallId: 'W1', label: 'SE-1', fromCm: 10, toCm: 12 }] })), 'W1')).toBeNull()
  })

  it('keeps the current position of a node that the solve did not move', () => {
    expect(wallBaseLine(doc(solver({ baseNodes: { N1: { x: 0, y: 0 } } })), 'W1'))
      .toEqual({ wallId: 'W1', a: { x: 0, y: 0 }, b: { x: 400, y: 3 } })
  })
})

describe('ghostWallOfLabel', () => {
  it('maps a stored wall value to its wall', () => {
    expect(ghostWallOfLabel(doc(solver()), 'W1-C')).toBe('W1')
    expect(ghostWallOfLabel(doc(solver()), 'W1-E')).toBe('W1')
  })

  it('is null for no label, for an unknown label, and when the solver is Off', () => {
    expect(ghostWallOfLabel(doc(solver()), null)).toBeNull()
    expect(ghostWallOfLabel(doc(solver()), 'ZZ-9')).toBeNull()
    expect(ghostWallOfLabel(doc({ ...solver(), enabled: false }), 'W1-C')).toBeNull()
  })
})

describe('SolverGhostLayer', () => {
  it('draws the base position of the hovered changed wall as a dashed purple line', () => {
    const html = setup({ hoverLabel: 'W1-C' })
    expect(html).toContain('data-solver-ghost="W1"')
    expect(html).toContain(SOLVED_STROKE)
    expect(html).toContain('stroke-dasharray')
    // The position of the wall before the solve: y = 0, while the plan shows it at y = 3.
    expect(html).toContain('x1="0" y1="0" x2="400" y2="0"')
  })

  it('draws it for the selected wall too', () => {
    const html = setup({ selection: { kind: 'storedWall', wallId: 'W1' } })
    expect(html).toContain('data-solver-ghost="W1"')
  })

  it('lets the hovered change row win over the selected wall (round 2 finding 7)', () => {
    // Both walls moved, W1 is selected and W2 is hovered in the Solve tab: the ghost follows the row.
    const both = doc(solver({
      changes: [
        { kind: 'position', wallId: 'W1', label: 'SE-1', moveCm: 3, dir: 'S' },
        { kind: 'position', wallId: 'W2', label: 'SE-2', moveCm: 3, dir: 'E' },
      ],
      baseNodes: { N1: { x: 0, y: 0 }, N2: { x: 400, y: 0 }, N3: { x: 400, y: 297 } },
    }))
    const html = setup({ doc: both, hoverLabel: 'W2-C', selection: { kind: 'storedWall', wallId: 'W1' } })
    expect(html).toContain('data-solver-ghost="W2"')
    expect(html).not.toContain('data-solver-ghost="W1"')
  })

  it('draws nothing when the solver is Off', () => {
    expect(setup({ doc: doc({ ...solver(), enabled: false }), hoverLabel: 'W1-C' })).not.toContain('data-solver-ghost')
  })

  it('draws nothing without a hover, or when the hovered wall has no change', () => {
    expect(setup()).not.toContain('data-solver-ghost')
    expect(setup({ hoverLabel: 'W2-C' })).not.toContain('data-solver-ghost')
  })

  it('draws nothing when the base position is the position on the plan', () => {
    // A thickness change only: the centre line did not move, so there is nothing to show.
    const only = doc(solver({
      changes: [{ kind: 'thickness', wallId: 'W1', label: 'SE-1', fromCm: 10, toCm: 12 }],
      baseNodes: {},
    }))
    expect(setup({ doc: only, hoverLabel: 'W1-C' })).not.toContain('data-solver-ghost')
  })
})
