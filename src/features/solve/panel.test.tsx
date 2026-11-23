import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { PlanDoc, Room } from '../../model/types'
import { hoverUi } from './MeasureNext'
import { SolvePanel, SolvePanelView } from './SolvePanel'

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

const render = (d: PlanDoc = doc(), report: string | null = null) =>
  renderToString(<SolvePanelView doc={d} report={report} />)

// react-dom/server separates interpolated text nodes with <!-- -->, so match fragments.

const verifiedDoc = () => doc({
  measurements: { 'SE-1': { label: 'SE-1', actualCm: 390, updatedAt: '' } },
})


describe('SolvePanel sections', () => {
  it('renders Progress, Settings and Actions in workflow order', () => {
    const html = render(verifiedDoc())
    const progress = html.indexOf('aria-label="Progress"')
    const settings = html.indexOf('aria-label="Settings"')
    const actions = html.indexOf('aria-label="Actions"')
    expect(progress).toBeGreaterThanOrEqual(0)
    expect(settings).toBeGreaterThan(progress)
    expect(actions).toBeGreaterThan(settings)
  })

  it('shows no Last result section before the first run', () => {
    expect(render(verifiedDoc())).not.toContain('aria-label="Last result"')
  })

  it('shows the report of the last run when there is one', () => {
    const html = render(verifiedDoc(), 'Solved 1 rooms together: fit error 0,4 cm rms.')
    expect(html).toContain('aria-label="Last result"')
    expect(html).toContain('data-solve-report')
    expect(html).toContain('Solved 1 rooms together')
  })
})

describe('SolvePanel progress', () => {
  it('gives one row per room with its counts and its fit error', () => {
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
    expect(html).toContain('2 rooms, 1 of 8 walls measured')
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

describe('SolvePanel actions', () => {
  it('disables both actions when no room has a verified wall length', () => {
    const html = render(doc())
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Apply measured lengths to all rooms<\/button>/)
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Solve whole plan<\/button>/)
    expect(html).toContain('No verified wall length in any room.')
  })

  it('enables the actions once a wall is verified, and keeps the solve hint', () => {
    const html = render(verifiedDoc())
    expect(html).toContain('>Apply measured lengths to all rooms</button>')
    expect(html).toContain('>Solve whole plan</button>')
    expect(html).not.toContain('No verified wall length in any room.')
    expect(html).toContain('Solve all rooms together: shared walls, wall thicknesses and walls in line.')
  })
})

describe('SolvePanel (wired to the stores)', () => {
  it('renders on its own with the empty plan', () => {
    const html = renderToString(<SolvePanel />)
    expect(html).toContain('aria-label="Progress"')
    expect(html).toContain('No room in the plan yet.')
    expect(html).toContain('No verified wall length in any room.')
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
      renderToString(<SolvePanelView doc={withRef()} report={null} surfaceMode={mode} />)
    expect(view('guide')).toContain('aria-pressed="true" title="Never move a surface away from its reference')
    expect(view('match')).toContain('aria-pressed="true" title="Pull the surface toward its reference')
  })

  it('keeps the new lines of the surface report visible', () => {
    const html = render(withRef(), 'Solved 1 rooms together: fit error 0,3 cm rms.\nDPE (SE): 11,3 -> 12,0 m2, ref 12,0 m2 (+0,0 %)')
    expect(html).toContain('data-solve-report')
    expect(html).toContain('whitespace-pre-line')
    expect(html).toContain('DPE (SE): 11,3 -&gt; 12,0 m2')
  })
})

describe('SolvePanel measure next', () => {
  it('sits above Actions and says which value to measure next, with its uncertainty', () => {
    const html = render(doc())
    const section = html.indexOf('aria-label="Measure next"')
    expect(section).toBeGreaterThan(0)
    expect(section).toBeLessThan(html.indexOf('aria-label="Actions"'))
    expect(html).toContain('data-measure-suggestion="SE-1"')
    expect(html).toContain('aria-label="Show on plan"')
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

describe('SolvePanel preview', () => {
  const preview = {
    moves: [
      { roomId: 'r1', code: 'SE', vertexIndex: 2, dxCm: 4, dyCm: 1.3, distCm: 4.2 },
      { roomId: 'r1', code: 'SE', vertexIndex: 0, dxCm: 1.5, dyCm: 0, distCm: 1.5 },
      { roomId: 'r1', code: 'SE', vertexIndex: 1, dxCm: 0.5, dyCm: 0, distCm: 0.5 },
    ],
    thicknessChanges: [{ walls: ['SE-1', 'SB-3'], fromCm: 10, toCm: 7 }],
    report: { rooms: 1, rmsCm: 0, lockedKept: 0, foundThicknesses: [], surfaces: [] },
  }

  it('shows no preview block by default', () => {
    expect(renderToString(<SolvePanelView doc={verifiedDoc()} report={null} />)).not.toContain('data-solve-preview')
  })

  it('shows the headline, the changes, the top moves, Apply and Cancel', () => {
    const html = renderToString(<SolvePanelView doc={verifiedDoc()} report={null} preview={preview} />)
    expect(html).toContain('data-solve-preview-apply')
    expect(html).toContain('data-solve-preview-cancel')
    expect(html).toContain('2 corners move')
    expect(html).toContain('4,2')
    expect(html).toContain('SE corner 3')
    expect(html).toContain('SE-1/SB-3')
    expect(html).toContain('Snap thicknesses not found by the data to usual values')
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
