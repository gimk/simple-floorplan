import { describe, expect, it } from 'vitest'
import type { PlanDoc, Room, WallElement } from '../../model/types'
import {
  CLASH_TOLERANCE_CM2, clashFootprints, clashKey, clashText, elementClashLabel, elementFootprints,
  findClashes, fixtureDepth, overlapArea, swingSector,
} from './clash'

/** Rectangle room. Vertex i has id "<code><i>", so wall "<code>0" runs from vertex 0 to vertex 1. */
const rect = (code: string, x: number, y: number, w: number, h: number): Room => ({
  id: 'r1',
  code,
  name: code,
  vertices: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].map(([px, py], i) => ({ id: `${code}${i}`, x: px, y: py })),
  holes: [],
  walls: {},
  walkOrder: 0,
})

const docOf = (rooms: Room[], elements: WallElement[]): PlanDoc => ({
  projectId: 'test',
  title: 'Test',
  rooms,
  elements,
  measurements: {},
  roomNotes: {},
  tapes: [],
  pins: [],
})

const element = (p: Partial<WallElement> = {}): WallElement => ({
  id: 'd1', roomId: 'r1', wallStart: 'A0', kind: 'door', offsetCm: 60, widthCm: 80,
  hinge: 'start', swing: 'in',
  createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z', ...p,
})

const square = (x: number, y: number, s: number) => [
  { x, y }, { x: x + s, y }, { x: x + s, y: y + s }, { x, y: y + s },
]

describe('clearance geometry', () => {
  it('measures the overlap of two polygons', () => {
    expect(overlapArea(square(0, 0, 10), square(5, 5, 10))).toBeCloseTo(25, 6)
    expect(overlapArea(square(0, 0, 10), square(20, 0, 10))).toBe(0)
    expect(overlapArea(square(0, 0, 10), [{ x: 1, y: 1 }, { x: 2, y: 2 }])).toBe(0)
  })

  it('builds a quarter disc from the hinge', () => {
    const pts = swingSector({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, 80)
    expect(pts[0]).toEqual({ x: 0, y: 0 })
    for (const p of pts.slice(1)) {
      expect(Math.hypot(p.x, p.y)).toBeCloseTo(80, 6)
      expect(p.x).toBeGreaterThanOrEqual(0)
      expect(p.y).toBeGreaterThanOrEqual(0)
    }
    // Quarter of the disc, sampled as a polygon (slightly smaller than the true quarter).
    expect(overlapArea(pts, square(-1, -1, 200)) / (Math.PI * 80 * 80 / 4)).toBeCloseTo(1, 2)
  })

  it('defaults fixture depths', () => {
    expect(fixtureDepth({ kind: 'radiator' })).toBe(10)
    expect(fixtureDepth({ kind: 'radiator', depthCm: 35 })).toBe(35)
    expect(fixtureDepth({ kind: 'other' })).toBe(0)
  })
})

describe('elementFootprints', () => {
  const room = rect('A', 0, 0, 400, 300)

  it('gives a single door one sector on the swing side', () => {
    const doc = docOf([room], [])
    const inside = elementFootprints(doc, room, element())
    expect(inside).toHaveLength(1)
    expect(inside[0].role).toBe('door')
    expect(Math.max(...inside[0].points.map((p) => p.y))).toBeCloseTo(80, 6)

    const outside = elementFootprints(doc, room, element({ swing: 'out' }))
    expect(Math.max(...outside[0].points.map((p) => p.y))).toBeCloseTo(0, 6)
    expect(Math.min(...outside[0].points.map((p) => p.y))).toBeCloseTo(-80, 6)
  })

  it('hinges the sector at the other edge for hinge "end"', () => {
    const doc = docOf([room], [])
    const [fp] = elementFootprints(doc, room, element({ hinge: 'end' }))
    // Hinge at 60 + 80 = 140 along the wall, sector reaching back toward the start.
    expect(fp.points[0]).toEqual({ x: 140, y: 0 })
    expect(Math.min(...fp.points.map((p) => p.x))).toBeCloseTo(60, 6)
  })

  it('gives double doors and French windows two sectors, sliding doors none', () => {
    const doc = docOf([room], [])
    expect(elementFootprints(doc, room, element({ variant: 'double' }))).toHaveLength(2)
    expect(
      elementFootprints(doc, room, element({ kind: 'window', variant: 'french', offsetCm: 200, widthCm: 120 })),
    ).toHaveLength(2)
    expect(elementFootprints(doc, room, element({ kind: 'window', variant: 'standard' }))).toEqual([])
    expect(elementFootprints(doc, room, element({ kind: 'window', variant: 'fixed' }))).toEqual([])
    expect(elementFootprints(doc, room, element({ variant: 'sliding' }))).toEqual([])
    expect(elementFootprints(doc, room, element({ variant: 'pocket' }))).toEqual([])
  })

  it('gives radiators a rectangle pushed into the room', () => {
    const doc = docOf([room], [])
    const [radiator] = elementFootprints(doc, room, element({ kind: 'radiator', offsetCm: 100, widthCm: 80 }))
    expect(radiator.role).toBe('fixture')
    expect(Math.max(...radiator.points.map((p) => p.y))).toBeCloseTo(10, 6)
    const [deep] = elementFootprints(doc, room, element({ kind: 'radiator', offsetCm: 100, widthCm: 60, depthCm: 40 }))
    expect(Math.max(...deep.points.map((p) => p.y))).toBeCloseTo(40, 6)
    expect(elementFootprints(doc, room, element({ kind: 'other' }))).toEqual([])
    expect(elementFootprints(doc, room, element({ kind: 'opening' }))).toEqual([])
  })

  it('skips elements it cannot place', () => {
    const doc = docOf([room], [])
    expect(elementFootprints(doc, room, element({ widthCm: 0 }))).toEqual([])
    expect(elementFootprints(doc, room, element({ wallStart: 'zz' }))).toEqual([]) // unknown wall
  })
})

describe('findClashes', () => {
  it('flags a radiator behind a door', () => {
    const room = rect('A', 0, 0, 400, 300)
    const doc = docOf([room], [
      element({ id: 'd1', offsetCm: 50 }),
      element({ id: 'rad', kind: 'radiator', offsetCm: 60, widthCm: 80 }),
    ])
    const clashes = findClashes(doc)
    expect(clashes).toHaveLength(1)
    expect(clashes[0]).toMatchObject({ kind: 'door-fixture', a: 'd1', b: 'rad' })
    expect(clashes[0].overlapCm2).toBeGreaterThan(CLASH_TOLERANCE_CM2)
  })

  it('flags two doors facing each other across a corridor', () => {
    const corridor = rect('A', 0, 0, 400, 120)
    const doc = docOf([corridor], [
      element({ id: 'd1', wallStart: 'A0', offsetCm: 60 }),
      // Wall A-3 runs (400,120) -> (0,120): offset 260 puts the hinge at x = 140.
      element({ id: 'd2', wallStart: 'A2', offsetCm: 260 }),
    ])
    const clashes = findClashes(doc)
    expect(clashes).toHaveLength(1)
    expect(clashes[0]).toMatchObject({ kind: 'door-door', a: 'd1', b: 'd2' })
  })

  it('clears a door that swings into an empty room', () => {
    expect(findClashes(docOf([rect('A', 0, 0, 400, 300)], [element()]))).toEqual([])
  })

  it('never flags a sliding or pocket door', () => {
    const room = rect('A', 0, 0, 400, 300)
    const radiator = element({ id: 'rad', kind: 'radiator', offsetCm: 60, widthCm: 80 })
    expect(findClashes(docOf([room], [element({ variant: 'sliding' }), radiator]))).toEqual([])
    expect(findClashes(docOf([room], [element({ variant: 'pocket' }), radiator]))).toEqual([])
  })

  it('flags a door sector that reaches through another wall', () => {
    // 60 cm deep room: an 80 cm door cannot open.
    const doc = docOf([rect('A', 0, 0, 400, 60)], [element({ offsetCm: 100 })])
    const clashes = findClashes(doc)
    expect(clashes).toHaveLength(1)
    expect(clashes[0]).toMatchObject({ kind: 'door-wall', a: 'd1', b: null, roomId: 'r1', wallStart: 'A2' })
  })

  it('does not flag a door hinged in the corner it opens against', () => {
    // The leaf lies flat on the perpendicular wall: touching, not crossing it.
    expect(findClashes(docOf([rect('A', 0, 0, 400, 300)], [element({ offsetCm: 0 })]))).toEqual([])
  })

  it('reports one row per pair of elements, not one per sector', () => {
    const room = rect('A', 0, 0, 400, 300)
    const doc = docOf([room], [
      element({ id: 'd1', variant: 'double', offsetCm: 200, widthCm: 140 }),
      element({ id: 'rad', kind: 'radiator', offsetCm: 200, widthCm: 120, depthCm: 60 }),
    ])
    const clashes = findClashes(doc)
    expect(clashes).toHaveLength(1)
    expect(clashes[0]).toMatchObject({ kind: 'door-fixture', a: 'd1', b: 'rad' })
    expect(clashFootprints(doc)).toHaveLength(3) // two sectors + one rectangle
  })

  it('ignores two bodies next to each other', () => {
    const room = rect('A', 0, 0, 400, 300)
    const doc = docOf([room], [
      element({ id: 'rad1', kind: 'radiator', offsetCm: 60, widthCm: 80, depthCm: 60 }),
      element({ id: 'rad2', kind: 'radiator', offsetCm: 70, widthCm: 80 }),
    ])
    expect(findClashes(doc)).toEqual([])
  })
})

describe('clash labels', () => {
  const room = rect('A', 0, 0, 400, 300)
  const doc = docOf([room], [
    element({ id: 'd1', wallStart: 'A0', offsetCm: 50 }),
    element({ id: 'rad', kind: 'radiator', wallStart: 'A1', offsetCm: 200 }),
  ])

  it('names an element by its kind and host wall', () => {
    expect(elementClashLabel(doc, 'd1')).toBe('Door A-1')
    expect(elementClashLabel(doc, 'rad')).toBe('Radiator A-2')
    expect(elementClashLabel(doc, 'missing')).toBe('Element')
  })

  it('writes one sidebar line', () => {
    expect(clashText(doc, { kind: 'door-fixture', a: 'd1', b: 'rad', overlapCm2: 500 }))
      .toBe('Door A-1 hits radiator A-2')
    expect(clashText(doc, { kind: 'door-wall', a: 'd1', b: null, roomId: 'r1', wallStart: 'A2', overlapCm2: 500 }))
      .toBe('Door A-1 hits wall A-3')
  })

  it('gives every clash a stable key', () => {
    expect(clashKey({ kind: 'door-door', a: 'x', b: 'y', overlapCm2: 1 })).toBe('x>y')
    expect(clashKey({ kind: 'door-wall', a: 'x', b: null, roomId: 'r', wallStart: 'w', overlapCm2: 1 })).toBe('x>wall:r:w')
  })
})
