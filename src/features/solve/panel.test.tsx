import { renderToString } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import { emptyDoc, useDoc, useUi } from '../../model/store'
import type { PlanDoc, Room, RoomFace, StoredNode, StoredWall } from '../../model/types'
import { materializeRooms } from '../../model/v2/materialize'
import { SOLVED_TEXT } from '../../shell/panel/styles'
import { restoreSolverChange, revokeSolverChange, setSolverEnabled, solverOn } from '../solver'
import { hoverUi } from './MeasureNext'
import { SolvePanel, SolvePanelView } from './SolvePanel'

const FIXED_NOW = '2026-11-25T12:00:00.000Z'
const FIXED_NOW_MS = Date.parse('2026-11-25T12:02:00.000Z')

const rect = (over: Partial<Room> = {}): Room => ({
  id: 'r1',
  code: 'SE',
  name: 'Séjour',
  holes: [],
  walls: {},
  walkOrder: 1,
  vertices: [
    { id: 'v0', x: 0, y: 0 },
    { id: 'v1', x: 400, y: 0 },
    { id: 'v2', x: 400, y: 300 },
    { id: 'v3', x: 0, y: 300 },
  ],
  ...over,
})

const doc = (over: Partial<PlanDoc> = {}): PlanDoc => ({
  projectId: 'local',
  title: 'Test',
  rooms: [rect()],
  elements: [],
  measurements: {},
  roomNotes: {},
  tapes: [],
  pins: [],
  apartment: { defaultCeilingCm: 250 },
  ...over,
})

const makeV2Doc = (values: Record<string, number> = {}): PlanDoc => {
  const nodes: StoredNode[] = [
    { id: 'N1', x: 0, y: 0 },
    { id: 'N2', x: 400, y: 0 },
    { id: 'N3', x: 400, y: 300 },
    { id: 'N4', x: 0, y: 300 },
  ]
  const walls: StoredWall[] = [
    { id: 'W1', a: 'N1', b: 'N2', faces: [], type: 'exterior', thicknessCm: 20 },
    { id: 'W2', a: 'N2', b: 'N3', faces: [], type: 'partition', thicknessCm: 10 },
    { id: 'W3', a: 'N3', b: 'N4', faces: [], type: 'partition', thicknessCm: 10 },
    { id: 'W4', a: 'N4', b: 'N1', faces: [], type: 'exterior', thicknessCm: 20 },
  ]
  const cycle: RoomFace[] = [
    { wallId: 'W1', side: 'L', from: 0, to: 400, cornerId: 'v1' },
    { wallId: 'W2', side: 'L', from: 0, to: 300, cornerId: 'v2' },
    { wallId: 'W3', side: 'L', from: 0, to: 400, cornerId: 'v3' },
    { wallId: 'W4', side: 'L', from: 0, to: 300, cornerId: 'v4' },
  ]
  const base: PlanDoc = {
    ...emptyDoc(),
    schemaVersion: 2,
    nodes,
    walls,
    rooms: [{ id: 'R1', code: 'KI', name: 'Kitchen', vertices: [], cycle, holes: [], walls: {}, walkOrder: 1 }],
    measurements: Object.fromEntries(
      Object.entries(values).map(([label, actualCm]) => [label, { label, actualCm, updatedAt: FIXED_NOW }]),
    ),
  }
  return { ...base, rooms: materializeRooms(base) }
}

const render = (d: PlanDoc = doc(), extra: Partial<Parameters<typeof SolvePanelView>[0]> = {}) =>
  renderToString(<SolvePanelView doc={d} mode="edit" nowMs={FIXED_NOW_MS} {...extra} />)

// react-dom/server separates interpolated text nodes with <!-- -->, so match fragments.

const verifiedDoc = () => doc({
  measurements: { 'SE-1': { label: 'SE-1', actualCm: 390, updatedAt: '' } },
})

beforeEach(() => {
  useUi.setState({ mode: 'edit', solveKeepLocked: true, solveSnapThickness: false, solveSurfaceMode: 'off', solveAngles: 'square' })
  useDoc.getState().replace(emptyDoc())
})

describe('SolvePanel sections', () => {
  it('renders Solver, Changes, Kept walls, Progress, Measure next and Settings in order', () => {
    const solved = solverOn(makeV2Doc({ 'KI-1': 405, 'KI-3': 405 }), { now: FIXED_NOW }).doc
    const withHold: PlanDoc = {
      ...solved,
      solver: {
        ...solved.solver!,
        revoked: [{ kind: 'position', wallId: 'W1', by: 'revoke' }],
      },
    }
    const html = render(withHold)
    const solver = html.indexOf('aria-label="Solver"')
    const changes = html.indexOf('aria-label="Changes"')
    const kept = html.indexOf('aria-label="Kept walls"')
    const progress = html.indexOf('aria-label="Progress"')
    const measureNext = html.indexOf('aria-label="Measure next"')
    const settings = html.indexOf('aria-label="Settings"')
    expect(solver).toBeGreaterThanOrEqual(0)
    expect(changes).toBeGreaterThan(solver)
    expect(kept).toBeGreaterThan(changes)
    expect(progress).toBeGreaterThan(kept)
    expect(measureNext).toBeGreaterThan(progress)
    expect(settings).toBeGreaterThan(measureNext)
    expect(html).toContain('aria-expanded="false"')
    // Removed old buttons and Last result block.
    expect(html).not.toContain('Apply measured lengths to all rooms')
    expect(html).not.toContain('Solve whole plan')
    expect(html).not.toContain('aria-label="Last result"')
  })
})

describe('SolvePanel solver switch & status', () => {
  it('shows Off status text when solver is Off and hides Changes section', () => {
    const html = render(verifiedDoc())
    expect(html).toContain('role="switch"')
    expect(html).toContain('aria-checked="false"')
    expect(html).toContain('Off: the plan shows estimated and measured values only.')
    expect(html).not.toContain('aria-label="Changes"')
  })

  it('toggles solver enabled via setSolverEnabled and shows On status line', () => {
    useDoc.getState().replace(makeV2Doc({ 'KI-1': 405, 'KI-3': 403 }))
    expect(renderToString(<SolvePanel />)).toContain('aria-checked="false"')

    setSolverEnabled(true)
    const onDoc = useDoc.getState().doc
    expect(onDoc.solver?.enabled).toBe(true)
    const html = render(onDoc, { nowMs: Date.parse(onDoc.solver!.solvedAt!) + 120_000 })
    expect(html).toContain('aria-checked="true"')
    expect(html).toContain('Solved 2 min ago')
    expect(html).toContain('average mismatch')

    setSolverEnabled(false)
    expect(useDoc.getState().doc.solver?.enabled).toBe(false)
    expect(renderToString(<SolvePanel />)).toContain('aria-checked="false"')
  })

  it('shows waiting status text when On in Measuring Mode', () => {
    const solved = solverOn(makeV2Doc({ 'KI-1': 405 }), { now: FIXED_NOW }).doc
    const html = render(solved, { mode: 'measure' })
    expect(html).toContain('Waits until you leave Measuring Mode.')
  })

  it('renders the help tip explaining estimated, measured, and solved colours', () => {
    const html = render(verifiedDoc(), { tipDefaultOpen: true })
    expect(html).toContain('aria-label="About the solver"')
    expect(html).toContain('estimated on the plan')
    expect(html).toContain('measured')
    expect(html).toContain('solved')
    expect(html).toContain('Turning it off puts the plan back.')
  })
})

describe('SolvePanel changes & kept walls', () => {
  it('renders position and thickness changes with SOLVED_TEXT, hover label, and Revoke button', () => {
    const solved = solverOn(makeV2Doc({ 'KI-1': 405, 'KI-3': 405 }), { now: FIXED_NOW }).doc
    const withBoth: PlanDoc = {
      ...solved,
      solver: {
        ...solved.solver!,
        changes: [
          {
            kind: 'position',
            wallId: 'W2',
            label: 'KI-2',
            moveCm: 1.5,
            dir: 'E',
            lengthFromCm: 300,
            lengthToCm: 298.5,
          },
          {
            kind: 'thickness',
            wallId: 'W1',
            label: 'KI-1',
            fromCm: 20,
            toCm: 18,
          },
        ],
      },
    }
    const html = render(withBoth)
    expect(html).toContain(SOLVED_TEXT)
    expect(html).toContain('data-solver-change="position:W2"')
    expect(html).toContain('data-hover-row="W2-C"')
    expect(html).toContain('KI-2')
    expect(html).toContain('east')
    expect(html).toContain('length')
    expect(html).toContain('data-solver-change="thickness:W1"')
    expect(html).toContain('thickness')
    expect(html).toContain('data-solver-revoke="position:W2"')
    expect(html).toContain('>Revoke</button>')
  })

  it('shows empty changes hint when On with no changes', () => {
    const emptySolved: PlanDoc = {
      ...makeV2Doc(),
      solver: { enabled: true, solvedAt: FIXED_NOW, rmsCm: 0, changes: [], revoked: [], baseNodes: {}, baseThickness: {} },
    }
    expect(render(emptySolved)).toContain('The solver changed nothing.')
  })

  it('revoking a change moves it to Kept walls and restoring brings it back', () => {
    useDoc.getState().replace(makeV2Doc({ 'KI-1': 405, 'KI-3': 405 }))
    setSolverEnabled(true)
    expect(useDoc.getState().doc.solver!.changes.some((c) => c.wallId === 'W4')).toBe(true)

    revokeSolverChange({ kind: 'position', wallId: 'W4' })
    const afterRevoke = render(useDoc.getState().doc)
    expect(afterRevoke).toContain('aria-label="Kept walls"')
    expect(afterRevoke).toContain('data-solver-kept="position:W4"')
    expect(afterRevoke).toContain('kept at plan value')
    expect(afterRevoke).toContain('(revoked)')
    expect(afterRevoke).toContain('data-solver-restore="position:W4"')

    restoreSolverChange({ kind: 'position', wallId: 'W4' })
    expect(useDoc.getState().doc.solver!.revoked).toEqual([])
    expect(render(useDoc.getState().doc)).not.toContain('aria-label="Kept walls"')
  })

  it('shows "(you edited it)" for edit holds in Kept walls', () => {
    const d: PlanDoc = {
      ...makeV2Doc(),
      solver: {
        enabled: true,
        solvedAt: FIXED_NOW,
        rmsCm: 0,
        changes: [],
        revoked: [{ kind: 'position', wallId: 'W2', by: 'edit' }],
        baseNodes: {},
        baseThickness: {},
      },
    }
    const html = render(d)
    expect(html).toContain('KI-2')
    expect(html).toContain('kept at plan value')
    expect(html).toContain('(you edited it)')
  })
})

describe('SolvePanel progress', () => {
  it('gives one row per room with its counts and its average mismatch', () => {
    const d = doc({
      measurements: { 'SE-1': { label: 'SE-1', actualCm: 392, updatedAt: '' } },
      rooms: [rect(), rect({ id: 'r2', code: 'CU', name: 'Cuisine' })],
    })
    const html = render(d)
    expect(html).toContain('data-solve-room="SE"')
    expect(html).toContain('data-solve-room="CU"')
    expect(html).toContain('aria-label="Select room Séjour (SE)"')
    expect(html).toContain('1<!-- -->/<!-- -->4') // one measured wall out of four
    expect(html).toContain('data-solve-residual="SE"')
    expect(html).toContain('±<!-- -->2')
    expect(html).toContain('data-solve-totals')
    expect(html).toContain('2 rooms, 1 of 8 walls measured, average mismatch')
    expect(html).not.toContain('fit error')
  })

  it('shows a lock on a room whose verified walls are all locked', () => {
    const d = doc({
      rooms: [rect({ walls: { v0: { type: 'partition', thicknessCm: 10, locked: true } } })],
      measurements: { 'SE-1': { label: 'SE-1', actualCm: 390, updatedAt: '' } },
    })
    expect(render(d)).toContain('aria-label="locked"')
    expect(render(verifiedDoc())).not.toContain('aria-label="locked"')
  })

  it('has a hint instead of the list when the plan has no room', () => {
    expect(render(doc({ rooms: [] }))).toContain('No room in the plan yet.')
  })
})

describe('SolvePanel settings', () => {
  it('owns the precision control and the keep-locked option', () => {
    const html = render(verifiedDoc())
    expect(html).toContain('aria-label="Precision of solved corners and thicknesses"')
    expect(html).toContain('Precision (cm)')
    expect(html).toContain('name="solveKeepLocked"')
    expect(html).toContain('Default 0,5 cm')
  })

  it('marks the precision of the plan as pressed', () => {
    expect(render(verifiedDoc())).toContain('aria-pressed="true" title="0,5"')
    const off = doc({ apartment: { precisionCm: 0 } })
    expect(render(off)).toContain('aria-pressed="true" title="Off"')
  })
})

describe('SolvePanel (wired to the stores)', () => {
  it('renders on its own with the empty plan', () => {
    const html = renderToString(<SolvePanel />)
    expect(html).toContain('aria-label="Solver"')
    expect(html).toContain('aria-label="Progress"')
    expect(html).toContain('No room in the plan yet.')
  })
})

describe('SolvePanel surface references', () => {
  const withRef = () => doc({ apartment: { references: [{ id: 'r1', source: 'dpe', surfaceM2: 12, roomCode: 'SE' }] } })

  it('offers Off, Guide and Match when the plan has surface references', () => {
    const html = render(withRef())
    expect(html).toContain('Surface references')
    expect(html).toContain('aria-label="Surface references: Off, Guide or Match"')
    expect(html).toContain('title="Do not use the surface references"')
    expect(html).toContain('title="Never move a surface away from its reference: only block the wrong direction"')
    expect(html).toContain('title="Pull the surface toward its reference (weak: a measured wall always wins)"')
    // Off is the default, and the control is usable.
    expect(html).toContain('aria-pressed="true" title="Do not use the surface references" class')
    expect(html).not.toContain('title="Do not use the surface references" disabled=""')
    expect(html).not.toContain('Add surface references in the Apartment card.')
  })

  it('disables the control and says where to add references when there is none', () => {
    const html = render(verifiedDoc())
    expect(html).toContain('Add surface references in the Apartment card.')
    expect(html).toContain('aria-pressed="true" title="Do not use the surface references" disabled=""')
    expect(html).toContain('title="Pull the surface toward its reference (weak: a measured wall always wins)" disabled=""')
  })

  it('marks the mode passed by the panel as pressed', () => {
    const view = (mode: 'off' | 'guide' | 'match') =>
      renderToString(<SolvePanelView doc={withRef()} mode="edit" surfaceMode={mode} />)
    expect(view('guide')).toContain('aria-pressed="true" title="Never move a surface away from its reference')
    expect(view('match')).toContain('aria-pressed="true" title="Pull the surface toward its reference')
  })
})

describe('SolvePanel measure next', () => {
  it('sits above Settings and says which value to measure next, with its uncertainty', () => {
    const html = render(doc())
    const section = html.indexOf('aria-label="Measure next"')
    expect(section).toBeGreaterThan(0)
    expect(section).toBeLessThan(html.indexOf('aria-label="Settings"'))
    expect(html).toContain('data-measure-suggestion="SE-1"')
    // Each button names its row (review finding 12).
    expect(html).toContain('aria-label="Show SE-1 on plan"')
    expect(html).toContain('position only from the drawing')
    expect(html).toContain('data-measure-sd="SE-1"')
    expect(html).toContain('141,5')
    // A field per line: type the value in place (react-dom/server keeps the camel case of inputMode).
    expect(html).toContain('inputMode="decimal"')
    expect(html).toContain('aria-label="Measured value of SE-1"')
  })

  it('asks to measure again a value that the plan cannot fit', () => {
    const d = doc({
      measurements: {
        'SE-1': { label: 'SE-1', actualCm: 390, updatedAt: '' },
        'SE-3': { label: 'SE-3', actualCm: 402, updatedAt: '' },
      },
    })
    const html = render(d)
    expect(html).toContain('data-measure-remeasure')
    expect(html).toContain('Measure again')
    // A line to measure again also goes to the plan, with a name of its own (review finding 12).
    expect(html).toMatch(/aria-label="Show SE-\d+ on plan"/)
    expect(html).toContain('text-amber-700')
    expect(html).toContain('plan says')
    // The remeasure lines come before the suggestions.
    const again = html.indexOf('Measure again')
    const list = html.indexOf('data-measure-list')
    expect(list === -1 || again < list).toBe(true)
  })

  it('has a hint when every value has a measurement', () => {
    const all = {
      'SE-1': { label: 'SE-1', actualCm: 390, updatedAt: '' },
      'SE-2': { label: 'SE-2', actualCm: 290, updatedAt: '' },
      'SE-3': { label: 'SE-3', actualCm: 390, updatedAt: '' },
      'SE-4': { label: 'SE-4', actualCm: 290, updatedAt: '' },
      'SE-D': { label: 'SE-D', actualCm: 486, updatedAt: '' },
      'SE-1-T': { label: 'SE-1-T', actualCm: 10, updatedAt: '' },
      'SE-2-T': { label: 'SE-2-T', actualCm: 10, updatedAt: '' },
      'SE-3-T': { label: 'SE-3-T', actualCm: 10, updatedAt: '' },
      'SE-4-T': { label: 'SE-4-T', actualCm: 10, updatedAt: '' },
    }
    const html = render(doc({ measurements: all }))
    expect(html).toContain('Nothing left to suggest')
    expect(html).not.toContain('data-measure-list')
  })
})

describe('Measure next: hover shows the element on the plan', () => {
  it('marks every line with its survey label, to set the hover state', () => {
    const html = render(doc())
    // A browser-only event: the label of the row is the part a test can read.
    expect(html).toContain('data-hover-row="SE-1"')
  })

  it('gives the UI store the label of the line, and the diagonal pair of a diagonal', () => {
    expect(hoverUi('SE-1')).toEqual({ hoverLabel: 'SE-1', hoverDiagonal: null })
    expect(hoverUi('SE-1-T')).toEqual({ hoverLabel: 'SE-1-T', hoverDiagonal: null })
    expect(hoverUi('SE-D', { roomId: 'r1', pair: [0, 2] })).toEqual({
      hoverLabel: 'SE-D', hoverDiagonal: { roomId: 'r1', pair: [0, 2] },
    })
    // Leaving a line clears both.
    expect(hoverUi(null)).toEqual({ hoverLabel: null, hoverDiagonal: null })
  })
})
