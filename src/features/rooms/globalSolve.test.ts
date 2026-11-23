import { describe, expect, it } from 'vitest'
import type { Measurement, PlanDoc, Room, SurfaceReference } from '../../model/types'
import { applyGlobal, describeGlobal, type GlobalReport } from './applyGlobal'
import { solveGlobal, type SurfaceMode } from './globalSolve'

const room = (id: string, pts: [number, number][], diagonal?: [number, number]): Room => ({
  id, code: id, name: id,
  vertices: pts.map(([x, y], i) => ({ id: `${id}v${i}`, x, y })),
  holes: [], walls: {}, walkOrder: 1,
  ...(diagonal ? { diagonal } : {}),
})

const meas = (v: Record<string, number>): Record<string, Measurement> =>
  Object.fromEntries(Object.entries(v).map(([label, actualCm]) => [label, { label, actualCm, updatedAt: '' }]))

// True plan (centre lines): A = x 0..300, y 0..400. B = x 300..600, y 0..200. C = x 300..600, y 200..400.
// Outside walls 20 cm, wall A|B+C 10 cm, wall B|C 8 cm. The drawing is a bit wrong and uses 10 cm everywhere.
const rooms = [
  room('A', [[0, 0], [304, 0], [304, 398], [0, 398]], [0, 2]),
  room('B', [[304, 0], [601, 0], [601, 203], [304, 203]]),
  room('C', [[304, 203], [601, 203], [601, 398], [304, 398]]),
]
// Inside faces of the true plan.
const A = { w: 300 - 10 - 5, h: 400 - 10 - 10 }
const B = { w: 300 - 5 - 10, h: 200 - 10 - 4 }
const C = { w: 300 - 5 - 10, h: 200 - 4 - 10 }
const measurements = meas({
  'A-1': A.w, 'A-2': A.h, 'A-3': A.w, 'A-4': A.h, 'A-D': Math.hypot(A.w, A.h),
  'B-1': B.w, 'B-2': B.h, 'B-3': B.w, 'B-4': B.h,
  'C-1': C.w, 'C-2': C.h, 'C-3': C.w, 'C-4': C.h,
})

describe('solveGlobal', () => {
  const s = solveGlobal({ rooms, measurements })
  const wallOf = (label: string) => s.groups.find((g) => g.walls.includes(label))!

  it('makes one wall of the two sides of a shared wall', () => {
    expect(wallOf('B-3').walls.sort()).toEqual(['B-3', 'C-1'])
    expect(wallOf('A-2').walls.sort()).toEqual(['A-2', 'B-4', 'C-4'])
  })

  it('finds the thickness of a wall that a loop crosses', () => {
    const g = wallOf('B-3')
    expect(g.determined).toBe(true)
    expect(g.thicknessCm).toBeCloseTo(8, 0)
  })

  it('says when the data does not find a thickness', () => {
    expect(wallOf('A-2').determined).toBe(false)
    expect(wallOf('A-1').determined).toBe(false)
  })

  it('fits the measured values', () => {
    expect(s.rmsCm).toBeLessThan(0.2)
    expect(s.skipped).toEqual([])
  })

  it('places the shared wall between the rooms', () => {
    const b = s.rooms.B, a = s.rooms.A
    expect(b[0].x).toBeCloseTo(a[1].x, 6)
    // B + wall + C = A, so B|C wall is at A's top face + B height + half the wall.
    expect(s.inner.C[0].y - s.inner.B[3].y).toBeCloseTo(8, 0)
  })
})

describe('solveGlobal pairing', () => {
  it('does not join a wall to two room faces that are not in line', () => {
    // T above, L and R below. R's top is drawn 23 cm lower than L's top: only L shares T's wall.
    const s = solveGlobal({
      rooms: [
        room('T', [[0, 0], [400, 0], [400, 200], [0, 200]]),
        room('L', [[0, 200], [200, 200], [200, 400], [0, 400]]),
        room('R', [[200, 223], [400, 223], [400, 400], [200, 400]]),
      ],
      measurements: meas({}),
    })
    const t3 = s.groups.find((g) => g.walls.includes('T-3'))!
    expect(t3.walls).toContain('L-1')
    expect(t3.walls).not.toContain('R-1')
  })
})

describe('solveGlobal face alignment', () => {
  // A and B side by side. Top walls continue each other: A's is 30 cm, B's is 10 cm.
  // True plan: flush inside at y = 15 (A top centre y = 0, B top centre y = 10).
  const withTop = (r: Room, cm: number, align?: 'room' | 'center' | 'other'): Room =>
    ({ ...r, walls: { [r.vertices[0].id]: { type: 'partition', thicknessCm: cm, ...(align ? { align } : {}) } } })
  const A = withTop(room('A', [[0, 0], [300, 0], [300, 300], [0, 300]]), 30)
  const B = withTop(room('B', [[300, 10], [600, 10], [600, 300], [300, 300]]), 10)

  it('keeps the faces in the rooms in line by default', () => {
    const s = solveGlobal({ rooms: [A, B], measurements: meas({}) })
    expect(s.inner.A[0].y).toBeCloseTo(s.inner.B[0].y, 1)
    expect(s.rooms.B[0].y - s.rooms.A[0].y).toBeCloseTo(10, 0)
  })

  it('keeps the centre lines in line when the walls say so', () => {
    const rooms = [withTop(A, 30, 'center'), withTop({ ...B, vertices: B.vertices.map((v) => ({ ...v, y: v.y === 10 ? 0 : v.y })) }, 10, 'center')]
    const s = solveGlobal({ rooms, measurements: meas({}) })
    expect(s.rooms.A[0].y).toBeCloseTo(s.rooms.B[0].y, 1)
    expect(s.inner.A[0].y - s.inner.B[0].y).toBeCloseTo(10, 0)
  })

  it('moves a wall that is drawn wrong when the values say so', () => {
    // B's top is drawn 8 cm too low. Both rooms are 280 high inside and their bottoms are flush:
    // the solver moves B's top wall up, so the faces in the rooms are flush again.
    const Bwrong = { ...B, vertices: B.vertices.map((v) => ({ ...v, y: v.y === 10 ? 18 : v.y })) }
    const s = solveGlobal({ rooms: [A, Bwrong], measurements: meas({ 'A-2': 280, 'A-4': 280, 'B-2': 280, 'B-4': 280 }) })
    expect(s.inner.B[0].y).toBeCloseTo(s.inner.A[0].y, 0)
    expect(s.rmsCm).toBeLessThan(0.3)
  })
})

// ---- surface references (docs/walls-plan.md phase 2) ----

/** Area of a polygon in m² (shoelace, cm corners). */
const polyAreaM2 = (p: { x: number; y: number }[]) =>
  Math.abs(p.reduce((s, a, i) => {
    const b = p[(i + 1) % p.length]
    return s + a.x * b.y - b.x * a.y
  }, 0)) / 2 / 10000

const ref = (over: Partial<SurfaceReference> & { surfaceM2: number }): SurfaceReference =>
  ({ id: 'ref1', source: 'dpe', ...over })

describe('solveGlobal surface references', () => {
  // One room 400 x 300 with 10 cm walls: the inside faces make 390 x 290 = 11,31 m².
  const sale = room('SE', [[0, 0], [400, 0], [400, 300], [0, 300]])
  /** Inside lengths of the drawn plan: what a perfect tape would give. */
  const drawn = { 'SE-1': 390, 'SE-2': 290, 'SE-3': 390, 'SE-4': 290 }
  const dpe = [ref({ surfaceM2: 12, label: 'DPE 2023', roomCode: 'SE' })]
  const solve = (mode: SurfaceMode, refs: SurfaceReference[], values: Record<string, number> = {}, options = {}) =>
    solveGlobal(
      { rooms: [sale], measurements: meas(values), apartment: { references: refs } },
      { surfaceMode: mode, ...options },
    )

  it('reports the drawn area, the solved area and the reference of each surface', () => {
    const s = solve('match', dpe)
    expect(s.surfaces).toHaveLength(1)
    const [surface] = s.surfaces
    expect(surface.label).toBe('DPE 2023')
    expect(surface.roomCode).toBe('SE')
    expect(surface.referenceM2).toBe(12)
    expect(surface.beforeM2).toBeCloseTo(11.31, 6)
  })

  it('Match pulls an unmeasured room toward its reference', () => {
    const s = solve('match', dpe)
    expect(s.surfaces[0].afterM2).toBeCloseTo(12, 1)
    expect(Math.abs(s.surfaces[0].diffPct)).toBeLessThan(1)
    // The room really grew: the inside faces are bigger than the drawn plan.
    expect(polyAreaM2(s.inner.SE)).toBeGreaterThan(11.9)
  })

  it('Off gives the same result as a solve without references', () => {
    const plain = solveGlobal({ rooms: [sale], measurements: meas(drawn) })
    const off = solve('off', dpe, drawn)
    expect(off.rooms).toEqual(plain.rooms)
    expect(off.inner).toEqual(plain.inner)
    expect(off.rmsCm).toBe(plain.rmsCm)
    expect(off.surfaces).toEqual([])
    expect(off.residuals.filter((r) => r.kind === 'surface')).toEqual([])
  })

  it('keeps the surface rows out of rmsCm', () => {
    // No measured wall, so the fit error stays 0 even though the surface row pulls.
    const s = solve('match', dpe)
    expect(s.rmsCm).toBe(0)
    expect(s.residuals.some((r) => r.kind === 'surface')).toBe(true)
  })

  it('gives a measured wall the win over the reference', () => {
    const s = solve('match', dpe, drawn)
    for (const r of s.residuals.filter((r) => r.kind === 'wall')) expect(Math.abs(r.diffCm)).toBeLessThan(0.6)
    // 5,5 % below the reference: the reference is too weak to move a measured wall.
    expect(s.surfaces[0].afterM2).toBeCloseTo(11.33, 1)
    expect(s.surfaces[0].diffPct).toBeLessThan(-5)
  })

  it('Guide does not shrink a room that is already below its reference', () => {
    // The plan is 11,31 m², the reference is 12 m². The measured walls ask for 380 x 280
    // (10,64 m²), so the values push the surface down. The hinge of the Guide row must pull back.
    const smaller = { 'SE-1': 380, 'SE-2': 280, 'SE-3': 380, 'SE-4': 280 }
    const off = solve('off', dpe, smaller)
    const guide = solve('guide', dpe, smaller)
    expect(guide.surfaces[0].beforeM2).toBeCloseTo(11.31, 6)
    expect(polyAreaM2(off.inner.SE)).toBeCloseTo(10.64, 1)
    // Same values, but the area stays larger than without the reference.
    expect(guide.surfaces[0].afterM2).toBeGreaterThan(polyAreaM2(off.inner.SE))
    // The row is reported, and its residual uses the drawn area as the hinge target.
    const row = guide.residuals.find((r) => r.kind === 'surface')!
    expect(row.measuredCm).toBeCloseTo(113100, 6)
  })

  it('Guide blocks the shrink with a tight sigma', () => {
    // 0,1 % instead of 1,5 % shows the hinge: the area stays at the drawn 11,31 m² and the
    // measured walls move instead.
    const smaller = { 'SE-1': 380, 'SE-2': 280, 'SE-3': 380, 'SE-4': 280 }
    const off = solve('off', dpe, smaller)
    const guide = solve('guide', dpe, smaller, { surfaceSigmaPct: 0.1 })
    expect(polyAreaM2(off.inner.SE)).toBeCloseTo(10.64, 1)
    expect(guide.surfaces[0].afterM2).toBeGreaterThan(11.2)
    expect(guide.surfaces[0].afterM2).toBeLessThanOrEqual(11.31)
  })

  it('Guide does not grow a room that is already above its reference', () => {
    // The plan is 11,31 m², the reference is 10,5 m². The measured walls ask for 400 x 300
    // (12 m²), so the values push the surface up. The hinge must not let it grow.
    const bigger = [ref({ surfaceM2: 10.5, roomCode: 'SE' })]
    const larger = { 'SE-1': 400, 'SE-2': 300, 'SE-3': 400, 'SE-4': 300 }
    const off = solve('off', bigger, larger)
    const guide = solve('guide', bigger, larger, { surfaceSigmaPct: 0.1 })
    expect(polyAreaM2(off.inner.SE)).toBeGreaterThan(11.9)
    // The hinge holds the area at the drawn 11,31 m² (a few cm² more, the measured walls win).
    expect(guide.surfaces[0].afterM2).toBeGreaterThan(11.2)
    expect(guide.surfaces[0].afterM2).toBeLessThan(11.45)
  })

  it('uses the label of the source when the reference has none', () => {
    expect(solve('match', [ref({ surfaceM2: 12, roomCode: 'SE' })]).surfaces[0].label).toBe('DPE')
    expect(solve('match', [ref({ surfaceM2: 12, source: 'carrez' })]).surfaces[0].label).toBe('Loi Carrez')
  })

  it('skips a room reference whose room has a wall that is not horizontal or vertical', () => {
    const slant: Room = room('SE', [[0, 0], [400, 0], [380, 300], [0, 300]])
    const s = solveGlobal(
      { rooms: [slant], measurements: meas({}), apartment: { references: dpe } },
      { surfaceMode: 'match' },
    )
    expect(s.surfaces).toEqual([])
    expect(s.residuals.filter((r) => r.kind === 'surface')).toEqual([])
    expect(s.skipped).toEqual([{ label: 'DPE 2023', reason: 'room SE has a wall that is not horizontal or vertical' }])
  })

  it('skips a room reference that names a room the plan does not have', () => {
    const s = solve('match', [ref({ surfaceM2: 12, roomCode: 'ZZ' })])
    expect(s.surfaces).toEqual([])
    expect(s.skipped).toEqual([{ label: 'DPE', reason: 'the plan has no room ZZ' }])
  })

  it('adds the inside areas of the indoor rooms for a reference with no room code', () => {
    const rooms = [
      sale,
      room('CU', [[1000, 0], [1400, 0], [1400, 300], [1000, 300]]),
      { ...room('BA', [[2000, 0], [2400, 0], [2400, 300], [2000, 300]]), outdoor: true },
    ]
    const s = solveGlobal(
      { rooms, measurements: meas({}), apartment: { references: [ref({ surfaceM2: 24, source: 'carrez' })] } },
      { surfaceMode: 'match' },
    )
    expect(s.surfaces).toHaveLength(1)
    expect(s.surfaces[0].roomCode).toBeUndefined()
    expect(s.surfaces[0].label).toBe('Loi Carrez')
    // Two indoor rooms of 11,31 m²; the balcony is outdoor and stays out of the sum.
    expect(s.surfaces[0].beforeM2).toBeCloseTo(22.62, 6)
    expect(s.surfaces[0].afterM2).toBeCloseTo(24, 1)
  })
})

// ---- applyGlobal + report ----

describe('applyGlobal surface references', () => {
  const base: PlanDoc = {
    projectId: 'local',
    title: 'Test',
    rooms: [room('SE', [[0, 0], [400, 0], [400, 300], [0, 300]])],
    elements: [],
    measurements: meas({ 'SE-1': 390, 'SE-2': 290, 'SE-3': 390, 'SE-4': 290 }),
    roomNotes: {},
    tapes: [],
    pins: [],
  }
  const withRefs: PlanDoc = {
    ...base,
    apartment: { references: [ref({ surfaceM2: 12, label: 'DPE 2023', roomCode: 'SE' })] },
  }

  it('puts the surface mode of the call through to the solver', () => {
    expect(applyGlobal(withRefs).report.surfaces).toEqual([])
    const r = applyGlobal(withRefs, { surfaceMode: 'match' })
    expect(r.report.surfaces).toHaveLength(1)
    expect(r.report.surfaces[0].roomCode).toBe('SE')
    expect(r.report.surfaces[0].referenceM2).toBe(12)
  })

  it('prints one line per surface under the summary line', () => {
    const report: GlobalReport = {
      rooms: 1,
      rmsCm: 0.4,
      lockedKept: 0,
      foundThicknesses: [],
      surfaces: [
        { label: 'DPE 2023', roomCode: 'SE', referenceM2: 13, beforeM2: 12.4, afterM2: 12.9, diffPct: -0.769 },
        { label: 'Loi Carrez', referenceM2: 40, beforeM2: 39, afterM2: 40.2, diffPct: 0.5 },
      ],
    }
    const lines = describeGlobal(report).split('\n')
    expect(lines).toHaveLength(3)
    expect(lines[0]).toContain('Solved 1 rooms together')
    expect(lines[1]).toBe('DPE 2023 (SE): 12,4 -> 12,9 m2, ref 13,0 m2 (-0,8 %)')
    expect(lines[2]).toBe('Loi Carrez: 39,0 -> 40,2 m2, ref 40,0 m2 (+0,5 %)')
  })

  it('has no surface line when no surface reference is used', () => {
    const report: GlobalReport = { rooms: 1, rmsCm: 0.2, lockedKept: 0, foundThicknesses: [], surfaces: [] }
    expect(describeGlobal(report).split('\n')).toHaveLength(1)
  })
})

describe('solveGlobal measurement sources', () => {
  // One room, two values for its width that do not agree: wall 1 = 300, wall 3 = 306.
  const one = [room('S', [[0, 0], [310, 0], [310, 210], [0, 210]])]
  const width = (src1?: Measurement['source'], src3?: Measurement['source']) => {
    const m = meas({ 'S-1': 300, 'S-2': 200, 'S-3': 306, 'S-4': 200 })
    if (src1) m['S-1'] = { ...m['S-1'], source: src1 }
    if (src3) m['S-3'] = { ...m['S-3'], source: src3 }
    const s = solveGlobal({ rooms: one, measurements: m })
    return s.residuals.find((r) => r.label === 'S-1')!.solvedCm
  }

  it('gives the same weight to two values with the same source', () => {
    expect(width()).toBeCloseTo(303, 0)
  })

  it('makes a laser value win over a tape value', () => {
    // Weights 1 / 0.3² against 1 / 1²: the mean moves near the laser value.
    expect(width('laser')).toBeLessThan(301)
  })

  it('makes a plan value weaker than a tape value', () => {
    expect(width('plan')).toBeGreaterThan(305)
  })

  it('gives each residual the accuracy of its source', () => {
    const m = { ...meas({ 'S-1': 300 }), 'S-2': { label: 'S-2', actualCm: 200, updatedAt: '', source: 'plan' as const } }
    const s = solveGlobal({ rooms: one, measurements: m })
    expect(s.residuals.find((r) => r.label === 'S-1')!.sigmaCm).toBe(1)
    expect(s.residuals.find((r) => r.label === 'S-2')!.sigmaCm).toBe(3)
  })
})
