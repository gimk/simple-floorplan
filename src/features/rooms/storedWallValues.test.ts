// Centre ('W12-C') and outside face ('W12-E') values of stored walls, in the solver and in the
// suggestions (docs/walls-plan.md phase 5b). Same test plan as globalSolve.test.ts:
// A = x 0..300, y 0..400. B = x 300..600, y 0..200. C = x 300..600, y 200..400.
// True thicknesses: outside 20, wall A|B+C 10, wall B|C 8. The drawing is a bit wrong (10 cm walls).
import { describe, expect, it } from 'vitest'
import { syncStoredGraph } from '../../model/storedGraph'
import { wallSurveyIds } from '../../model/survey'
import type { Measurement, PlanDoc, Room } from '../../model/types'
import { hoverTarget } from './hoverTarget'
import { solveGlobal, solveGlobalWithModel, type GlobalResidual } from './globalSolve'
import { suggestMeasurements } from './suggest'

const room = (id: string, pts: [number, number][], diagonal?: [number, number]): Room => ({
  id, code: id, name: id,
  vertices: pts.map(([x, y], i) => ({ id: `${id}v${i}`, x, y })),
  holes: [], walls: {}, walkOrder: 1,
  ...(diagonal ? { diagonal } : {}),
})

const meas = (v: Record<string, number>): Record<string, Measurement> =>
  Object.fromEntries(Object.entries(v).map(([label, actualCm]) => [label, { label, actualCm, updatedAt: '' }]))

const rooms = (): Room[] => [
  room('A', [[0, 0], [304, 0], [304, 398], [0, 398]], [0, 2]),
  room('B', [[304, 0], [601, 0], [601, 203], [304, 203]]),
  room('C', [[304, 203], [601, 203], [601, 398], [304, 398]]),
]

/** Inside faces of the true plan. */
const A = { w: 300 - 10 - 5, h: 400 - 10 - 10 }
const B = { w: 300 - 5 - 10, h: 200 - 10 - 4 }
const C = { w: 300 - 5 - 10, h: 200 - 4 - 10 }

const roomValues = (extra: Record<string, number> = {}): Record<string, Measurement> => meas({
  'A-1': A.w, 'A-2': A.h, 'A-3': A.w, 'A-4': A.h, 'A-D': Math.hypot(A.w, A.h),
  'B-1': B.w, 'B-2': B.h, 'B-3': B.w, 'B-4': B.h,
  'C-1': C.w, 'C-2': C.h, 'C-3': C.w, 'C-4': C.h,
  ...extra,
})

/** The test plan with its stored wall graph. */
const plan = (extra: Record<string, number> = {}): PlanDoc => {
  const rs = rooms()
  const g = syncStoredGraph(undefined, rs)
  return {
    projectId: 'p', title: 'test plan', rooms: rs, elements: [], measurements: roomValues(extra),
    roomNotes: {}, tapes: [], nodes: g.nodes, walls: g.walls,
  }
}

/** Stored wall that holds room wall 2 of room B: the right facade wall of B (x = 601, y 0..203). */
const rightFacade = (doc: PlanDoc) => doc.walls!.find((w) => w.faces.some((f) => f.roomId === 'B' && f.wallStart === 'Bv1'))!

/** The value of a facade wall, measured on site from outside: the true plan gives 200 + (20 + 8) / 2. */
const OUTSIDE_CM = 200 + (20 + 8) / 2

const residualOf = (residuals: GlobalResidual[], label: string) => residuals.find((r) => r.label === label)

describe('stored wall values in the solver', () => {
  it('gives the centre value the accuracy of a plan value when it has no source', () => {
    const doc = plan({ 'W6-C': 200 })
    const s = solveGlobal(doc)
    const row = residualOf(s.residuals, 'W6-C')!
    expect(row.kind).toBe('centre')
    expect(row.sigmaCm).toBe(3)
    // The centre line of the true plan is 200 cm: the solved centre line agrees with it.
    // A plan value is weak (3 cm): it agrees, it does not command (the plan is drawn 3 % too big).
    expect(row.solvedCm).toBeCloseTo(200, -1)
    expect(Math.abs(row.diffCm)).toBeLessThan(3)
  })

  it('counts the centre row in rmsCm', () => {
    const doc = plan({ 'W6-C': 205 })
    const s = solveGlobal(doc)
    expect(residualOf(s.residuals, 'W6-C')!.diffCm).toBeGreaterThan(4)
    expect(s.rmsCm).toBeGreaterThan(1)
  })

  it('finds the thickness of an exterior wall that no loop crosses, with an outside value', () => {
    // The right facade of B ends on the top wall (20 cm, undetermined) and on the B|C wall (8 cm,
    // found by the loop of A, B and C). Its outside length therefore finds the top wall thickness.
    const before = solveGlobal(plan())
    const topBefore = before.groups.find((g) => g.walls.includes('B-1'))!
    expect(topBefore.determined).toBe(false)

    const after = solveGlobal(plan({ 'W6-E': OUTSIDE_CM }))
    const topAfter = after.groups.find((g) => g.walls.includes('B-1'))!
    expect(topAfter.determined).toBe(true)
    // The true thickness is 20 cm. The test plan is drawn 3 % too big, so 2 cm of slack.
    expect(Math.abs(topAfter.thicknessCm - 20)).toBeLessThan(2)
    const row = residualOf(after.residuals, 'W6-E')!
    expect(row.kind).toBe('outside')
    // A site value: the default source is tape (1 cm).
    expect(row.sigmaCm).toBe(1)
    expect(Math.abs(row.diffCm)).toBeLessThan(1)
  })

  it('gives the outside value the accuracy of its source', () => {
    const s = solveGlobal({
      ...plan({ 'W6-E': OUTSIDE_CM }),
      measurements: { ...roomValues({ 'W6-E': OUTSIDE_CM }), 'W6-E': { label: 'W6-E', actualCm: OUTSIDE_CM, updatedAt: '', source: 'laser' } },
    })
    expect(residualOf(s.residuals, 'W6-E')!.sigmaCm).toBe(0.3)
  })

  it('skips an outside value of a wall that has no outside face', () => {
    // W2 is the wall between A and B+C: a room on each side, so no facade.
    const s = solveGlobal(plan({ 'W2-E': 400 }))
    expect(s.skipped).toContainEqual({ label: 'W2-E', reason: 'the wall has no outside face on its whole length' })
    expect(residualOf(s.residuals, 'W2-E')).toBeUndefined()
  })

  it('skips a wall value when the plan has no stored wall graph', () => {
    const doc = plan({ 'W6-C': 200 })
    const s = solveGlobal({ rooms: doc.rooms, measurements: doc.measurements })
    expect(s.skipped).toContainEqual({ label: 'W6-C', reason: 'the plan has no stored wall graph' })
  })

  it('skips a wall value when a wall end has no perpendicular wall', () => {
    // A stored wall that runs on past every room: its b end has no wall at all.
    const doc = plan({ 'W6-C': 500 })
    const wall = rightFacade(doc)
    const walls = doc.walls!.map((w) => (w.id === wall.id ? { ...w, b: 'FAR' } : w))
    const nodes = [...doc.nodes!, { id: 'FAR', x: 601, y: 900 }]
    const s = solveGlobal({ ...doc, walls, nodes })
    expect(s.skipped).toContainEqual({ label: 'W6-C', reason: 'no perpendicular wall at one end of this wall' })
  })

  it('skips a wall value of a wall that is not horizontal or vertical', () => {
    // A diamond: no wall of it is horizontal or vertical.
    const rs = [room('D', [[0, 0], [400, 300], [0, 600], [-400, 300]])]
    const g = syncStoredGraph(undefined, rs)
    const doc: PlanDoc = {
      projectId: 'p', title: 'd', rooms: rs, elements: [], measurements: meas({ 'D-1': 500, 'W1-C': 500 }),
      roomNotes: {}, tapes: [], nodes: g.nodes, walls: g.walls,
    }
    const s = solveGlobal(doc)
    expect(s.skipped.some((x) => x.label === 'W1-C' && x.reason === 'wall is not horizontal or vertical')).toBe(true)
  })
})

describe('stored wall values as a candidate quantity', () => {
  it('gives the centre and outside value of a wall, with a gradient', () => {
    const model = solveGlobalWithModel(plan())
    const wall = rightFacade(plan())
    const centre = model.quantity({ kind: 'centre', wallId: wall.id })!
    const outside = model.quantity({ kind: 'outside', wallId: wall.id })!
    expect(centre.value).toBeGreaterThan(100)
    // The outside value is the centre line plus half of the two end wall thicknesses.
    const top = model.solved.groups.find((g) => g.walls.includes('B-1'))!
    const mid = model.solved.groups.find((g) => g.walls.includes('B-3'))!
    expect(outside.value - centre.value).toBeCloseTo((top.thicknessCm + mid.thicknessCm) / 2, 6)
    // The outside value moves with the thickness of its two end walls (half each).
    expect(outside.grad.filter(([, k]) => Math.abs(k - 0.5) < 1e-9)).toHaveLength(2)
    // The centre value moves with the two centre lines only, never with a thickness.
    expect(centre.grad).toHaveLength(2)
  })

  it('gives no value for an unknown wall id', () => {
    const model = solveGlobalWithModel(plan())
    expect(model.quantity({ kind: 'outside', wallId: 'W99' })).toBeNull()
  })
})

describe('suggestions: facade lengths only', () => {
  const doc = plan()
  const { suggestions } = suggestMeasurements(doc, { limit: 40 })

  it('offers the outside face of facade walls, and never a centre value', () => {
    const labels = suggestions.map((s) => s.label)
    expect(labels.some((l) => l.endsWith('-E'))).toBe(true)
    expect(labels.some((l) => l.endsWith('-C'))).toBe(false)
    const facade = suggestions.find((s) => s.label.endsWith('-E'))!
    expect(facade.kind).toBe('outside')
    // The row selects the wall on the plan: its first room face.
    expect(facade.roomId).toBeTruthy()
    expect(facade.wallStart).toBeTruthy()
  })

  it('gives the reason about the exterior wall thickness for a facade length that finds it', () => {
    const facade = suggestions.filter((s) => s.kind === 'outside')
    expect(facade.some((s) => s.reason === 'facade length: finds the exterior wall thickness')).toBe(true)
  })

  it('does not offer a facade length that has a value', () => {
    const withValue = plan({ 'W6-E': OUTSIDE_CM })
    const again = suggestMeasurements(withValue, { limit: 40 }).suggestions
    expect(again.some((s) => s.label === 'W6-E')).toBe(false)
  })
})

describe('hoverTarget: stored wall values', () => {
  it('finds the stored wall of a "W12-C" label, between its two nodes', () => {
    const doc = plan()
    const wall = rightFacade(doc)
    const t = hoverTarget(doc, `${wall.id}-C`)
    expect(t?.kind).toBe('storedWall')
    if (t?.kind !== 'storedWall') throw new Error('not a stored wall')
    expect(t.outside).toBe(false)
    expect(Math.abs(t.a.x - t.b.x)).toBeLessThan(3)
    expect(Math.abs(t.a.y - t.b.y)).toBeCloseTo(200, -1)
  })

  it('marks an outside face label, and knows nothing of an unknown wall id', () => {
    const doc = plan()
    const wall = rightFacade(doc)
    const t = hoverTarget(doc, `${wall.id}-E`)
    expect(t?.kind === 'storedWall' && t.outside).toBe(true)
    expect(hoverTarget(doc, 'W99-C')).toBeNull()
  })
})

describe('wall values in the survey', () => {
  it('lists the centre of every stored wall, and the outside face of the facade walls only', () => {
    const doc = plan()
    const ids = wallSurveyIds(doc)
    const wall = rightFacade(doc)
    const centre = ids.find((s) => s.label === `${wall.id}-C`)!
    expect(centre.kind).toBe('centre')
    expect(centre.optional).toBe(true)
    expect(centre.plannedCm).toBeCloseTo(203, 0)
    const outside = ids.find((s) => s.label === `${wall.id}-E`)!
    // Drawn thicknesses are 10 cm everywhere: 203 + (10 + 10) / 2 = 213.
    expect(outside.plannedCm).toBeCloseTo(213, 0)
    // Every wall has a centre value, but only the facade walls have an outside value.
    expect(ids.filter((s) => s.kind === 'centre')).toHaveLength(doc.walls!.length)
    expect(ids.filter((s) => s.kind === 'outside').length).toBeLessThan(doc.walls!.length)
    expect(ids.some((s) => s.kind === 'outside' && s.label.startsWith('W2-'))).toBe(false)
  })
})
