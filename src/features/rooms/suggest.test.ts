import { describe, expect, it } from 'vitest'
import type { Measurement, PlanDoc, Room, WallProps } from '../../model/types'
import { suggestMeasurements } from './suggest'

const room = (id: string, pts: [number, number][], over: Partial<Room> = {}): Room => ({
  id, code: id, name: id,
  vertices: pts.map(([x, y], i) => ({ id: `${id}v${i}`, x, y })),
  holes: [], walls: {}, walkOrder: 1,
  ...over,
})

const meas = (v: Record<string, number>): Record<string, Measurement> =>
  Object.fromEntries(Object.entries(v).map(([label, actualCm]) => [label, { label, actualCm, updatedAt: '' }]))

const doc = (rooms: Room[], measurements: Record<string, Measurement> = {}): PlanDoc => ({
  projectId: 'p', title: 't', rooms, elements: [], measurements, roomNotes: {}, tapes: [], pins: [],
  apartment: {},
})

const labels = (d: PlanDoc, opts = {}) => suggestMeasurements(d, opts).suggestions.map((s) => s.label)

// Room SE: centre lines 400 x 300, 10 cm walls, so the inside face ring is 390 x 290.
const SE = room('SE', [[0, 0], [400, 0], [400, 300], [0, 300]])
// Two rooms side by side. The wall between them is 10 cm, the outside walls are 20 cm.
const thick = (r: Room, cms: number[], type: WallProps['type']): Room => ({
  ...r,
  walls: Object.fromEntries(r.vertices.map((v, i) => [v.id, { type, thicknessCm: cms[i] ?? 10 }])),
})
const L = thick(room('L', [[0, 0], [300, 0], [300, 400], [0, 400]]), [20, 10, 20, 20], 'exterior')
const R = thick(room('R', [[300, 0], [600, 0], [600, 400], [300, 400]]), [20, 20, 20, 10], 'exterior')
// Inside faces of the true plan: 300 - 10 - 5 = 285 wide, 400 - 10 - 10 = 380 high.
const sideBySide = { 'L-1': 285, 'L-2': 380, 'L-3': 285, 'L-4': 380, 'R-1': 285, 'R-2': 380, 'R-3': 285, 'R-4': 380 }

describe('suggestMeasurements order', () => {
  it('suggests the walls of a room that has no value, most useful first', () => {
    const { suggestions } = suggestMeasurements(doc([SE]))
    expect(suggestions.length).toBeGreaterThan(1)
    // A wall value also places the wall: the biggest gain of all, by far.
    expect(suggestions[0].kind).toBe('wall')
    expect(suggestions[1].kind).toBe('wall')
    expect(suggestions[0].label).toBe('SE-1')
    expect(suggestions[0].wallStart).toBe('SEv0')
    expect(suggestions[0].plannedCm).toBeCloseTo(390, 1)
    expect(suggestions[0].nowSdCm).toBeGreaterThan(100)
    expect(suggestions[0].reason).toBe('position only from the drawing')
    expect(suggestions[0].gain).toBeGreaterThan(suggestions[2].gain * 100)
  })

  it('is greedy: the opposite wall adds nothing once the width is measured', () => {
    // With no value, one wall per direction is offered (SE-1 and SE-2), not the opposite one.
    expect(labels(doc([SE]))).not.toContain('SE-3')
    expect(labels(doc([SE]))).not.toContain('SE-4')
    // The width is known: the other direction comes first, and both opposite walls stay out.
    const after = suggestMeasurements(doc([SE], meas({ 'SE-1': 390 }))).suggestions
    expect(after[0].label).toBe('SE-2')
    expect(after.map((s) => s.label)).not.toContain('SE-3')
  })
})

describe('suggestMeasurements diagonal', () => {
  // A step-shaped room (600 x 400 with a notch): every length is measured once, so the shape is
  // found and the diagonal is only a check. Its gain is small, and the cutoff is 0.25 cm² (the
  // variance of 0.5 cm). A tape (1 cm) scores about 0.13, so the list keeps it out; a laser
  // (0.3 cm) makes it worth measuring.
  const STEP = room('ST', [[0, 0], [400, 0], [400, 100], [600, 100], [600, 400], [0, 400]])
  const stepWalls = meas({ 'ST-1': 390, 'ST-2': 90, 'ST-3': 190, 'ST-4': 290, 'ST-5': 590, 'ST-6': 380 })

  it('offers the diagonal of a fully measured room as a check value', () => {
    const { suggestions } = suggestMeasurements(doc([STEP], stepWalls), { sigmaCm: 0.3 })
    const d = suggestions.find((s) => s.label === 'ST-D')!
    expect(d).toBeDefined()
    expect(d.kind).toBe('diagonal')
    expect(d.diagonal).toEqual([0, 4]) // the longest one: (0, 0) to (600, 400)
    expect(d.reason).toBe('check value (adds redundancy)')
    expect(d.nowSdCm).toBeLessThan(5)
    // The solved inside size is a little under the drawn one: the six values are not perfectly
    // consistent (390 + 190 is not 590), so the fit shares the difference.
    expect(d.plannedCm).toBeCloseTo(699, 0)
    expect(d.gain).toBeGreaterThan(0.25)
  })

  it('offers that diagonal as a check value with a tape, after the main list', () => {
    const s = suggestMeasurements(doc([STEP], stepWalls)).suggestions.find((x) => x.label === 'ST-D')
    expect(s?.reason).toBe('check value (adds redundancy)')
  })

  it('keeps check values out when their gain is below checkMinGainCm', () => {
    expect(labels(doc([STEP], stepWalls), { checkMinGainCm: 1 })).not.toContain('ST-D')
  })

  it('uses the diagonal that the room already holds', () => {
    const withPair = { ...STEP, diagonal: [0, 3] as [number, number] }
    const d = suggestMeasurements(doc([withPair], stepWalls), { sigmaCm: 0.3 }).suggestions.find((s) => s.label === 'ST-D')!
    expect(d.diagonal).toEqual([0, 3])
  })
})

describe('suggestMeasurements thickness', () => {
  it('asks for the thickness of a shared wall that the data does not find, one label per wall', () => {
    const list = labels(doc([L, R], meas(sideBySide)), { limit: 20 })
    // The wall between L and R has two room faces but ONE thickness: held by room L.
    expect(list).toContain('L-2-T')
    expect(list).not.toContain('R-4-T')
    const t = suggestMeasurements(doc([L, R], meas(sideBySide)), { limit: 20 }).suggestions.find((s) => s.label === 'L-2-T')!
    expect(t.kind).toBe('thickness')
    expect(t.reason).toBe('thickness not found by the data')
    expect(t.wallStart).toBe('Lv1')
    expect(t.plannedCm).toBeCloseTo(10, 0)
    expect(t.nowSdCm).toBeGreaterThan(4) // the prior of the wall type only
  })

  it('does not suggest a thickness that has a value', () => {
    const list = labels(doc([L, R], meas({ ...sideBySide, 'L-2-T': 8 })), { limit: 20 })
    expect(list).not.toContain('L-2-T')
    expect(list).toContain('L-1-T')
  })
})

describe('suggestMeasurements remeasure', () => {
  it('has nothing to measure again in a plan that fits', () => {
    expect(suggestMeasurements(doc([L, R], meas(sideBySide))).remeasure).toEqual([])
  })

  it('lists a measured value that the plan cannot fit, biggest difference first', () => {
    // Both walls of one dimension cannot be right: the solver puts them in between.
    const { remeasure } = suggestMeasurements(doc([SE], meas({ 'SE-1': 390, 'SE-3': 402 })))
    expect(remeasure.map((r) => r.label).sort()).toEqual(['SE-1', 'SE-3'])
    const byLabel = (l: string) => remeasure.find((r) => r.label === l)!
    expect(byLabel('SE-1').measuredCm).toBe(390)
    expect(byLabel('SE-3').measuredCm).toBe(402)
    for (const r of remeasure) {
      expect(r.solvedCm).toBeCloseTo(396, 0)
      expect(Math.abs(r.diffCm)).toBeCloseTo(6, 0)
    }
    // Biggest difference first.
    expect(Math.abs(remeasure[0].diffCm)).toBeGreaterThanOrEqual(Math.abs(remeasure[1].diffCm))
  })

  it('needs a difference of more than three sigma', () => {
    // 2 cm on 390: inside three sigma of a tape (1 cm), so no row.
    expect(suggestMeasurements(doc([SE], meas({ 'SE-1': 390, 'SE-3': 392 }))).remeasure).toEqual([])
  })
})

describe('suggestMeasurements options', () => {
  it('respects the limit', () => {
    expect(suggestMeasurements(doc([SE]), { limit: 2 }).suggestions).toHaveLength(2)
    expect(suggestMeasurements(doc([SE]), { limit: 0 }).suggestions).toEqual([])
    expect(suggestMeasurements(doc([L, R]), { limit: 3 }).suggestions).toHaveLength(3)
    // The default limit is 10: this plan has more candidates than that.
    const many = doc([SE, L, R])
    expect(suggestMeasurements(many, { limit: 20 }).suggestions.length).toBeGreaterThan(10)
    expect(suggestMeasurements(many).suggestions).toHaveLength(10)
  })

  it('is deterministic', () => {
    const d = doc([SE, L, R], meas({ 'SE-1': 390 }))
    expect(suggestMeasurements(d)).toEqual(suggestMeasurements(d))
  })

  it('agrees with the solve: the planned value is the solved value of the quantity', () => {
    const s = suggestMeasurements(doc([SE], meas({ 'SE-1': 390 }))).suggestions[0]
    expect(s.plannedCm).toBeCloseTo(290, 1) // the inside height of SE, from the drawing
  })

  it('has nothing to suggest when every target has a value', () => {
    const all = meas({
      'SE-1': 390, 'SE-2': 290, 'SE-3': 390, 'SE-4': 290, 'SE-D': 486,
      'SE-1-T': 10, 'SE-2-T': 10, 'SE-3-T': 10, 'SE-4-T': 10,
    })
    expect(suggestMeasurements(doc([SE], all)).suggestions).toEqual([])
  })
})


describe('suggestMeasurements remeasure on locked walls', () => {
  it('does not flag a small difference on a locked wall (the lock sigma is not the source sigma)', () => {
    const r: Room = {
      id: 'K', code: 'K', name: 'K', holes: [], walkOrder: 1,
      vertices: [[0, 0], [310, 0], [310, 210], [0, 210]].map(([x, y], i) => ({ id: `Kv${i}`, x, y })),
      walls: {},
    }
    r.walls = Object.fromEntries(r.vertices.map((v) => [v.id, { type: 'partition' as const, thicknessCm: 10, locked: true }]))
    const m = (label: string, actualCm: number) => [label, { label, actualCm, updatedAt: '' }] as const
    // Inside lengths are 300 x 200; the values differ by 0.3 cm.
    const measurements = Object.fromEntries([m('K-1', 300.3), m('K-2', 200), m('K-3', 300), m('K-4', 200)])
    expect(suggestMeasurements({ rooms: [r], measurements }).remeasure).toEqual([])
  })
})
