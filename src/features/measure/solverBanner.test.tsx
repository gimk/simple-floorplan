// Measuring Mode round 3 (docs/solver-plan.md): the solver banner with its colour legend and "?"
// tip at the top of the mode, and the new field lines under each measured field.
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { syncStoredGraph } from '../../model/storedGraph'
import { emptyDoc } from '../../model/store'
import type { Measurement, PlanDoc, Room } from '../../model/types'
import { LEGEND_TIP_TEXT, SOLVER_OFF_TEXT, SOLVER_ON_TEXT, SolverBanner, SolverLegend } from './SolverBanner'
import { fmtCm } from '../../model/geometry'
import { FacadeSection } from './FacadeCard'
import { fieldLine, measureRows } from './logic'
import { MiniDrawing } from './MiniDrawing'
import { Overview } from './Overview'
import { RoomCard } from './RoomCard'

const room = (id: string, pts: [number, number][]): Room => ({
  id, code: id, name: id, holes: [], walkOrder: 1,
  vertices: pts.map(([x, y], i) => ({ id: `${id}v${i}`, x, y })),
  walls: Object.fromEntries(pts.map((_, i) => [`${id}v${i}`, { type: 'partition' as const, thicknessCm: 10 }])),
})

/** Room A = 300 x 400 cm. Wall A-1 is 300 cm long, A-2 is 400 cm, A-3 is 300 cm, A-4 is 400 cm. */
function plan(measurements: Record<string, Measurement> = {}): PlanDoc {
  const rooms = [room('A', [[0, 0], [300, 0], [300, 400], [0, 400]])]
  const g = syncStoredGraph(undefined, rooms)
  return { ...emptyDoc(), projectId: 'r3', title: 'Round 3', rooms, nodes: g.nodes, walls: g.walls, measurements }
}

describe('SolverBanner', () => {
  it('says the solver is on, in the purple box, when doc.solver.enabled', () => {
    const html = renderToString(<SolverBanner doc={{ ...emptyDoc(), solver: { enabled: true, changes: [], revoked: [], baseNodes: {}, baseThickness: {} } }} />)
    expect(html).toContain('data-solver-banner="on"')
    expect(html).toContain(SOLVER_ON_TEXT)
    expect(html).toContain('bg-violet-100')
    expect(html).toContain('border-violet-600')
    expect(html).not.toContain(SOLVER_OFF_TEXT)
  })

  it('says the solver is off, in a muted box, when there is no solver state or it is off', () => {
    for (const doc of [emptyDoc(), { ...emptyDoc(), solver: { enabled: false, changes: [], revoked: [], baseNodes: {}, baseThickness: {} } }]) {
      const html = renderToString(<SolverBanner doc={doc} />)
      expect(html).toContain('data-solver-banner="off"')
      expect(html).toContain(SOLVER_OFF_TEXT)
      expect(html).not.toContain('bg-violet-100')
    }
  })

  it('shows the legend: Plan, Measured and Solved, each in its own colour', () => {
    const html = renderToString(<SolverLegend />)
    expect(html).toContain('>Plan<')
    expect(html).toContain('>Measured<')
    expect(html).toContain('>Solved<')
    // Grey plan, green measured, purple solved (tokens from src/shell/panel/styles.ts).
    expect(html).toContain('text-slate-500')
    expect(html).toContain('text-emerald-700')
    expect(html).toContain('text-violet-700')
  })

  it('keeps the tip closed until the "?" is used, then shows what the colours mean', () => {
    expect(renderToString(<SolverBanner doc={emptyDoc()} />)).not.toContain(LEGEND_TIP_TEXT)
    const open = renderToString(<SolverBanner doc={emptyDoc()} tipDefaultOpen />)
    expect(open).toContain('aria-haspopup="dialog"')
    expect(open).toContain(LEGEND_TIP_TEXT)
    expect(open).toContain('Turn the solver on or off in the Solve tab.')
  })
})

describe('field line under a measured value', () => {
  it('says Solved for a wall the solver changed, and how far it is from the value', () => {
    expect(fieldLine(295.8, 296, true)).toBe('Solved 295,8 · 0,2 cm shorter than measured')
    expect(fieldLine(296.2, 296, true)).toBe('Solved 296,2 · 0,2 cm longer than measured')
  })

  it('says Plan for a wall the solver did not change', () => {
    expect(fieldLine(294.5, 296, false)).toBe('Plan 294,5 · 1,5 cm shorter than measured')
    expect(fieldLine(296, 296, false)).toBe('Plan 296 · matches measured')
    expect(fieldLine(296, 296.04, false)).toBe('Plan 296 · matches measured')
  })

  it('adds "check this value" to a flagged line', () => {
    expect(fieldLine(296, 301, false, true)).toBe('Plan 296 · 5 cm shorter than measured · check this value')
  })
})

describe('RoomCard field lines', () => {
  const labels = ['A-1', 'A-2', 'A-3', 'A-4', 'A-D', 'A-H']
  /** The planned length of one room wall, as the card reads it. */
  const planned = (doc: PlanDoc, label: string) => measureRows(doc.rooms[0]).find((r) => r.label === label)!.plannedCm!

  it('shows "Plan … matches measured" when the value is the plan length', () => {
    const base = plan()
    const doc: PlanDoc = { ...base, measurements: { 'A-1': { label: 'A-1', actualCm: planned(base, 'A-1'), updatedAt: '' } } }
    const html = renderToString(<RoomCard doc={doc} room={doc.rooms[0]} allLabels={labels} hideDrawing />)
    expect(html).toContain(`Plan ${fmtCm(planned(base, 'A-1'))} · matches measured`)
    // A measured field is green (MEASURED_TEXT) and keeps its "measured" badge.
    expect(html).toContain('text-emerald-700')
    expect(html).toContain('measured')
    // The placeholder of an empty field stays "plan …" (phone view, with the room drawing).
    expect(renderToString(<RoomCard doc={doc} room={doc.rooms[0]} allLabels={labels} />)).toContain('plan ')
    expect(html).not.toContain('check this value')
  })

  it('shows a flagged value in orange, with "check this value"', () => {
    const base = plan()
    const doc: PlanDoc = { ...base, measurements: { 'A-2': { label: 'A-2', actualCm: planned(base, 'A-2') + 5, updatedAt: '' } } }
    const html = renderToString(<RoomCard doc={doc} room={doc.rooms[0]} allLabels={labels} hideDrawing />)
    expect(html).toContain('5 cm shorter than measured · check this value')
    expect(html).toContain('bg-orange-100')
    expect(html).not.toContain('Solved ')
  })

  it('shows "Solved …" in purple when the solver changed that wall', () => {
    const base = plan()
    const wallId = base.walls!.find((w) => w.faces.some((f) => f.roomId === 'A' && f.wallStart === 'Av3'))!.id
    const doc: PlanDoc = {
      ...base,
      measurements: {
        'A-4': {
          label: 'A-4', actualCm: planned(base, 'A-4'), updatedAt: '',
          target: { wallId, side: 'L', roomId: 'A', kind: 'face' },
        },
      },
      solver: {
        enabled: true,
        changes: [{ kind: 'position', wallId, label: 'A-4', moveCm: 1.2, dir: 'E', lengthFromCm: planned(base, 'A-4'), lengthToCm: planned(base, 'A-4') + 1.2 }],
        revoked: [],
        baseNodes: {},
        baseThickness: {},
      },
    }
    const html = renderToString(<RoomCard doc={doc} room={doc.rooms[0]} allLabels={labels} hideDrawing />)
    expect(html).toContain(`Solved ${fmtCm(planned(base, 'A-4'))} · matches measured`)
    expect(html).toContain('text-violet-700')
    expect(html).not.toContain('check this value')
  })

  it('adds data-value-state hooks for sunlight mode across banner, legend, cards, drawing and overview', () => {
    const base = plan()
    const wallId = base.walls!.find((w) => w.faces.some((f) => f.roomId === 'A' && f.wallStart === 'Av3'))!.id
    const doc: PlanDoc = {
      ...base,
      measurements: {
        'A-1': { label: 'A-1', actualCm: planned(base, 'A-1'), updatedAt: '' },
        'A-4': {
          label: 'A-4', actualCm: planned(base, 'A-4'), updatedAt: '',
          target: { wallId, side: 'L', roomId: 'A', kind: 'face' },
        },
        [`${wallId}-E`]: { label: `${wallId}-E`, actualCm: 410, updatedAt: '' },
      },
      solver: {
        enabled: true,
        changes: [{ kind: 'position', wallId, label: 'A-4', moveCm: 1.2, dir: 'E', lengthFromCm: 400, lengthToCm: 401.2 }],
        revoked: [],
        baseNodes: {},
        baseThickness: {},
      },
    }

    const bannerOn = renderToString(<SolverBanner doc={doc} />)
    expect(bannerOn).toContain('data-solver-banner="on"')
    expect(bannerOn).toMatch(/data-solver-banner="on"[^>]*data-value-state="solved"|data-value-state="solved"[^>]*data-solver-banner="on"/)

    const legend = renderToString(<SolverLegend />)
    expect(legend).toContain('data-value-state="estimated"')
    expect(legend).toContain('data-value-state="measured"')
    expect(legend).toContain('data-value-state="solved"')

    const card = renderToString(<RoomCard doc={doc} room={doc.rooms[0]} allLabels={labels} hideDrawing />)
    expect(card).toContain('data-value-state="measured"')
    expect(card).toContain('data-value-state="estimated"')
    expect(card).toContain('data-value-state="solved"')

    const facade = renderToString(<FacadeSection doc={doc} />)
    expect(facade).toContain('data-value-state="measured"')
    expect(facade).toContain('data-value-state="solved"')

    const drawing = renderToString(<MiniDrawing doc={doc} room={doc.rooms[0]} focused={null} />)
    expect(drawing).toContain('data-value-state="measured"')

    const fullMeasured: PlanDoc = {
      ...base,
      measurements: Object.fromEntries(
        ['A-1', 'A-2', 'A-3', 'A-4', 'A-H'].map((l) => [l, { label: l, actualCm: 300, updatedAt: '' }]),
      ),
    }
    const overview = renderToString(<Overview doc={fullMeasured} rooms={fullMeasured.rooms} />)
    expect(overview).toContain('data-value-state="measured"')
  })
})
