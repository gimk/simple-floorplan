// Walls at any angle (docs/walls-plan.md phase 4b): rooms whose walls are not horizontal or
// vertical are solved, a shared wall at an angle is one wall, and the option `angles` decides if a
// room drawn square can turn out to be out of square.
import { describe, expect, it } from 'vitest'
import { innerWallLengths, roomInnerRing } from '../../model/geometry'
import { syncStoredGraph } from '../../model/storedGraph'
import type { Measurement, PlanDoc, Room, WallProps } from '../../model/types'
import { demoRooms } from '../measure/demo'
import { applyGlobal, describeGlobal } from './applyGlobal'
import { renderToString } from 'react-dom/server'
import { SolvePanelView } from '../solve/SolvePanel'
import { solveGlobal, solveGlobalWithModel, type RoomAngles } from './globalSolve'
import { suggestMeasurements } from './suggest'

const room = (id: string, pts: [number, number][], over: Partial<Room> = {}): Room => ({
  id, code: id, name: id,
  vertices: pts.map(([x, y], i) => ({ id: `${id}v${i}`, x, y })),
  holes: [], walls: {}, walkOrder: 1,
  ...over,
})

const props = (cm: number): WallProps => ({ type: 'partition', thicknessCm: cm })

const meas = (v: Record<string, number>, source: Measurement['source'] = 'tape'): Record<string, Measurement> =>
  Object.fromEntries(Object.entries(v).map(([label, actualCm]) => [label, { label, actualCm, updatedAt: '', source }]))

/** Inside lengths of the walls of a room whose walls have the given thickness (index -> cm). */
const innerOf = (r: Room, cms: Record<number, number> = {}): number[] =>
  innerWallLengths({ ...r, walls: Object.fromEntries(r.vertices.map((v, i) => [v.id, props(cms[i] ?? 10)])) })

/** Inside length of the diagonal between corners i and j of a room. */
const innerDiag = (r: Room, i: number, j: number, cms: Record<number, number> = {}): number => {
  const ring = roomInnerRing({ ...r, walls: Object.fromEntries(r.vertices.map((v, k) => [v.id, props(cms[k] ?? 10)])) })
  return Math.hypot(ring[j].x - ring[i].x, ring[j].y - ring[i].y)
}

/** Interior angle at inside corner k of a solved room, in degrees (0..180). */
const innerAngle = (p: { x: number; y: number }[], k: number): number => {
  const n = p.length
  const a = p[(k + n - 1) % n], b = p[k], c = p[(k + 1) % n]
  const v1 = { x: b.x - a.x, y: b.y - a.y }, v2 = { x: c.x - b.x, y: c.y - b.y }
  const turn = Math.abs(Math.atan2(v1.x * v2.y - v1.y * v2.x, v1.x * v2.x + v1.y * v2.y)) * 180 / Math.PI
  return 180 - turn
}

const doc = (rooms: Room[], measurements: Record<string, Measurement>): PlanDoc =>
  ({ projectId: 'p', title: 't', rooms, elements: [], measurements, roomNotes: {}, tapes: [], pins: [] })

/** A plain rectangular room, for the panel test. */
const trapRoomForUi = (): Room => room('SE', [[0, 0], [400, 0], [400, 300], [0, 300]])

const maxMove = (a: Room[], b: Record<string, { x: number; y: number }[]>): number => {
  let worst = 0
  for (const r of a) r.vertices.forEach((v, i) => {
    worst = Math.max(worst, Math.hypot(b[r.id][i].x - v.x, b[r.id][i].y - v.y))
  })
  return worst
}

// ---- a room with a slanted wall (like the Terrasse of the demo apartment) ----

describe('solveGlobal on a room with a slanted wall', () => {
  // The demo Terrasse: seven walls, one of them at about 45 degrees.
  const drawn: Room = { ...demoRooms().find((r) => r.code === 'TE')!, diagonal: [0, 4] }
  // The true plan: the same shape 2 % wider and 1 % lower, so the drawn plan is a bit wrong.
  const truth: Room = { ...drawn, vertices: drawn.vertices.map((v) => ({ ...v, x: v.x * 1.02, y: v.y * 0.99 })) }
  const values: Record<string, number> = {}
  innerOf(truth).forEach((cm, i) => { values[`TE-${i + 1}`] = cm })
  values['TE-D'] = innerDiag(truth, 0, 4)

  /** Wall index of the slanted wall of the Terrasse (not horizontal and not vertical). */
  const slant = drawn.vertices.findIndex((v, i) => {
    const w = drawn.vertices[(i + 1) % drawn.vertices.length]
    return Math.abs(w.x - v.x) > 1 && Math.abs(w.y - v.y) > 1
  })
  const s = solveGlobal({ rooms: [drawn], measurements: meas(values) })
  const groupOf = (label: string) => s.groups.find((g) => g.walls.includes(label))!

  it('gives the slanted wall its own value row and its own wall', () => {
    expect(s.skipped).toEqual([])
    const g = groupOf(`TE-${slant + 1}`)
    expect(g.orient).toBe('o')
    // A wall drawn at an angle is always solved with its own angle: it has an uncertainty, and the
    // angle stays close to the drawn one (the prior is 3 degrees).
    expect(g.angleSdDeg).toBeGreaterThan(0)
    expect(g.angleSdDeg).toBeLessThan(3)
    // The wall is really at an angle: its angle is about 90 degrees away from the axes.
    const off = Math.abs(g.angleDeg) % 90
    expect(Math.min(off, 90 - off)).toBeGreaterThan(10)
  })

  it('matches the measured length of the slanted wall, and fits the room', () => {
    const row = s.residuals.find((r) => r.label === `TE-${slant + 1}`)!
    expect(row.kind).toBe('wall')
    expect(Math.abs(row.diffCm)).toBeLessThan(0.1)
    expect(s.rmsCm).toBeLessThan(0.2)
    // The plan is drawn a bit wrong: the fit does move the corners.
    expect(maxMove([drawn], s.inner)).toBeGreaterThan(1)
  })
})

describe('suggestMeasurements on a slanted room', () => {
  it('offers the values of a room with a slanted wall', () => {
    const te = demoRooms().find((r) => r.code === 'TE')!
    const slant = te.vertices.findIndex((v, i) => {
      const w = te.vertices[(i + 1) % te.vertices.length]
      return Math.abs(w.x - v.x) > 1 && Math.abs(w.y - v.y) > 1
    })
    const { suggestions } = suggestMeasurements({ rooms: [te], measurements: {} }, { limit: 40 })
    // Walls of the slanted room are suggested, in any direction.
    expect(suggestions.filter((x) => x.kind === 'wall' && x.label.startsWith('TE-')).length).toBeGreaterThan(2)
    // The slanted wall has a thickness to measure too (it had no wall at all before this phase).
    expect(suggestions.some((x) => x.label === `TE-${slant + 1}-T`)).toBe(true)
    // Its inside length is a quantity of the solve, and it moves with both of its walls.
    const model = solveGlobalWithModel({ rooms: [te], measurements: {} })
    const q = model.quantity({ kind: 'wall', roomId: te.id, wallIndex: slant })!
    expect(q.value).toBeGreaterThan(50)
    expect(q.grad.length).toBeGreaterThan(1)
  })
})

// ---- rooms that are not square (option angles: 'square' | 'free') ----

describe('solveGlobal option angles', () => {
  // A parallelogram: sides 800 and 600, the angle at the first corner 88.5 degrees.
  const angle = (88.5 * Math.PI) / 180
  const side = 600
  const truth = room('P', [
    [0, 0], [800, 0],
    [800 + side * Math.cos(angle), side * Math.sin(angle)],
    [side * Math.cos(angle), side * Math.sin(angle)],
  ])
  // The drawing is a rectangle of the same sides, so only the diagonal shows the difference.
  const drawn = room('P', [[0, 0], [800, 0], [800, 600], [0, 600]], { diagonal: [0, 2] })
  const values: Record<string, number> = {}
  innerOf(truth).forEach((cm, i) => { values[`P-${i + 1}`] = cm })
  values['P-D'] = innerDiag(truth, 0, 2)
  // A laser measure: a diagonal needs a good value to show a small angle.
  const measurements = meas(values, 'laser')

  const solve = (angles: RoomAngles) => solveGlobal({ rooms: [drawn], measurements }, { angles })

  it('finds the true angle of a parallelogram with angles = free', () => {
    const s = solve('free')
    const corner = innerAngle(s.inner.P, 0)
    expect(Math.abs(corner - 88.5)).toBeLessThan(0.1)
    expect(s.rmsCm).toBeLessThan(0.3)
    // The report says how far the room is from square.
    expect(s.outOfSquare).toHaveLength(1)
    expect(s.outOfSquare[0].roomCode).toBe('P')
    expect(Math.abs(s.outOfSquare[0].deg - 1.45)).toBeLessThan(0.1)
  })

  it('cannot turn the room with angles = square (the default)', () => {
    const s = solve('square')
    expect(s.outOfSquare).toEqual([])
    for (let k = 0; k < 4; k++) expect(Math.abs(innerAngle(s.inner.P, k) - 90)).toBeLessThan(1e-6)
    // The diagonal does not fit: the plan is square and the room is not.
    const diagonal = s.residuals.find((r) => r.label === 'P-D')!
    expect(Math.abs(diagonal.diffCm)).toBeGreaterThan(5)
    // The fixed walls of the default mode keep the drawn angle exactly.
    for (const g of s.groups) expect(g.angleSdDeg).toBe(0)
  })

  it('reports the room in the lines of the solve', () => {
    const d = doc([drawn], measurements)
    const r = applyGlobal(d, { angles: 'free' })
    expect(r.report.outOfSquare?.[0].roomCode).toBe('P')
    expect(describeGlobal(r.report)).toMatch(/Out of square: room P 1,\d°/)
    // The default mode says nothing about it.
    expect(describeGlobal(applyGlobal(d).report)).not.toContain('Out of square')
  })
})

// ---- a wall at an angle seen by two rooms ----

describe('a slanted wall shared by two rooms', () => {
  // The test plan of globalSolve.test.ts, with the wall between B and C at about 5 degrees.
  // True thicknesses: the slanted wall 8 cm, every other wall 10 cm (the drawing says 10 everywhere).
  const A = room('A', [[0, 0], [304, 0], [304, 398], [0, 398]], { diagonal: [0, 2] })
  const B = room('B', [[304, 0], [601, 0], [601, 203], [304, 230]])
  const C = room('C', [[304, 230], [601, 203], [601, 398], [304, 398]])
  const values: Record<string, number> = {}
  innerOf(A).forEach((cm, i) => { values[`A-${i + 1}`] = cm })
  innerOf(B, { 2: 8 }).forEach((cm, i) => { values[`B-${i + 1}`] = cm })
  innerOf(C, { 0: 8 }).forEach((cm, i) => { values[`C-${i + 1}`] = cm })
  values['A-D'] = innerDiag(A, 0, 2)
  const s = solveGlobal({ rooms: [A, B, C], measurements: meas(values) })

  it('makes one wall of the two drawn copies of a slanted wall', () => {
    const g = s.groups.find((x) => x.walls.includes('B-3'))!
    expect(g.walls.slice().sort()).toEqual(['B-3', 'C-1'])
    expect(g.rooms).toBe(2)
    expect(g.orient).toBe('o')
  })

  it('finds its thickness with the loop of the values', () => {
    // A-2 = B-2 + thickness + C-2 along the two faces of the slanted wall: the loop finds it.
    const g = s.groups.find((x) => x.walls.includes('B-3'))!
    expect(g.determined).toBe(true)
    expect(Math.abs(g.thicknessCm - 8)).toBeLessThan(0.5)
    expect(s.rmsCm).toBeLessThan(0.2)
  })

  it('solves it in free mode too', () => {
    const f = solveGlobal({ rooms: [A, B, C], measurements: meas(values) }, { angles: 'free' })
    const g = f.groups.find((x) => x.walls.includes('B-3'))!
    expect(g.walls.slice().sort()).toEqual(['B-3', 'C-1'])
    // With the angle free the loop is weaker, but the value still moves the thickness down.
    expect(g.thicknessCm).toBeLessThan(9.5)
    expect(f.rmsCm).toBeLessThan(0.2)
  })
})

// ---- stored wall values at an angle ----

describe('stored wall values of a slanted wall', () => {
  // One room in the shape of a trapezium, so two of its stored walls are not horizontal or vertical.
  const trap = room('TR', [[0, 0], [500, 0], [400, 400], [0, 400]], { diagonal: [0, 2] })
  const g = syncStoredGraph(undefined, [trap])
  const base: PlanDoc = { ...doc([trap], meas({})), nodes: g.nodes, walls: g.walls }
  /** Stored wall that holds room wall 2 of TR ('TRv1'): the slanted one. */
  const slant = g.walls.find((w) => w.faces.some((f) => f.roomId === 'TR' && f.wallStart === 'TRv1'))!

  it('solves a value of a wall at an angle with angles = square too', () => {
    const s = solveGlobal({ ...base, measurements: meas({ [`${slant.id}-C`]: 412 }) })
    expect(s.residuals.find((r) => r.label === `${slant.id}-C`)?.kind).toBe('centre')
    expect(s.skipped.some((x) => x.reason === 'wall is not horizontal or vertical')).toBe(false)
  })

  it('solves a centre and an outside value of a wall at an angle with angles = free', () => {
    // The trapezium has a facade on the slanted side: its outside face is measurable on site.
    const s = solveGlobal({ ...base, measurements: meas({ [`${slant.id}-C`]: 412, [`${slant.id}-E`]: 430 }) }, { angles: 'free' })
    const centre = s.residuals.find((r) => r.label === `${slant.id}-C`)
    expect(centre?.kind).toBe('centre')
    expect(s.skipped.some((x) => x.reason === 'wall is not horizontal or vertical')).toBe(false)
    const outside = s.residuals.find((r) => r.label === `${slant.id}-E`)
    expect(outside?.kind).toBe('outside')
    expect(Math.abs(outside!.diffCm)).toBeLessThan(40)
  })
})

// ---- the option in the Solve tab ----

describe('the Room angles option of the Solve tab', () => {
  it('shows the two choices and the hint, Square first', () => {
    const html = renderToString(<SolvePanelView doc={doc([trapRoomForUi()], meas({}))} report={null} />)
    expect(html).toContain('Room angles')
    expect(html).toContain('aria-label=\"Room angles: Square or Free\"')
    expect(html).toContain('Free: a measured diagonal can show a room that is not square.')
    expect(html).toContain('aria-pressed=\"true\"')
  })
})

// ---- performance ----

describe('solveGlobal speed', () => {
  it('solves the demo apartment well under the limit', () => {
    const rooms = demoRooms()
    const values: Record<string, number> = {}
    for (const r of rooms) innerOf(r).forEach((cm, i) => { values[`${r.code}-${i + 1}`] = cm })
    const d = { rooms, measurements: meas(values) }
    // One warm run, then the measured one.
    solveGlobal(d)
    const t0 = performance.now()
    const s = solveGlobal(d)
    const ms = performance.now() - t0
    expect(s.groups.length).toBeGreaterThan(20)
    expect(s.rmsCm).toBeLessThan(0.2)
    // About 5 ms on a laptop: the limit of 500 ms keeps CI machines of any speed safe.
    expect(ms).toBeLessThan(500)
  })
})
