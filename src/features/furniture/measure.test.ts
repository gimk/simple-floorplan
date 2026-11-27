import { describe, expect, it } from 'vitest'
import { createArtboard } from '../../model/schema'
import type { Artboard, FurnitureItem, Room } from '../../model/types'
import {
  computeDistanceGuides,
  computeDistanceGuidesForBox,
  computeMeasureGuides,
  computeMeasureGuidesForBox,
  pickMeasureTarget,
} from './geometry'
import { groupBounds } from './groupTransform'

// ---------- helpers ----------

const item = (p: Partial<FurnitureItem> = {}): FurnitureItem => ({
  id: 'f1', name: 'Sofa', shape: 'rect', xCm: 0, yCm: 0, widthCm: 100, depthCm: 60, rotationDeg: 0, color: '#4b5563', ...p,
})

const rect = (id: string, x0: number, y0: number, x1: number, y1: number): Room => ({
  id, name: id,
  vertices: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }],
})

const board = (rooms: Room[] = [], furniture: FurnitureItem[] = [], precisionCm: 0.1 | 0.5 | 1 = 1): Artboard => ({
  ...createArtboard('Plan A'),
  precisionCm,
  rooms,
  furniture,
})

// ---------- pickMeasureTarget ----------

describe('pickMeasureTarget', () => {
  it('hits a rotated rect item only inside its rotated box', () => {
    // 100 x 20 at 90 deg: the footprint becomes 20 wide and 100 tall.
    const it = item({ widthCm: 100, depthCm: 20, rotationDeg: 90 })
    const ab = board([], [it])
    expect(pickMeasureTarget({ x: 0, y: 40 }, ab, 'sel', 8)).toEqual({ kind: 'furniture', item: it })
    // Inside the unrotated box but outside the rotated one.
    expect(pickMeasureTarget({ x: 40, y: 0 }, ab, 'sel', 8)).toEqual({ kind: 'none' })
  })

  it('hits a circle only inside the ellipse', () => {
    const it = item({ shape: 'circle', widthCm: 100, depthCm: 40 })
    const ab = board([], [it])
    expect(pickMeasureTarget({ x: 45, y: 0 }, ab, 'sel', 8).kind).toBe('furniture')
    expect(pickMeasureTarget({ x: 30, y: 15 }, ab, 'sel', 8).kind).toBe('furniture')
    // Corner of the bounding box: outside the ellipse.
    expect(pickMeasureTarget({ x: 20, y: 20 }, ab, 'sel', 8).kind).toBe('none')
  })

  it('prefers the later (top of the stack) item', () => {
    const under = item({ id: 'under' })
    const over = item({ id: 'over' })
    const ab = board([], [under, over])
    const hit = pickMeasureTarget({ x: 0, y: 0 }, ab, 'sel', 8)
    expect(hit).toEqual({ kind: 'furniture', item: over })
  })

  it('skips the selected item', () => {
    const ab = board([], [item({ id: 'sel' })])
    expect(pickMeasureTarget({ x: 0, y: 0 }, ab, 'sel', 8)).toEqual({ kind: 'none' })
  })

  it('returns the nearest wall within the tolerance', () => {
    const ab = board([rect('r1', 0, 0, 400, 300)])
    const t = pickMeasureTarget({ x: 200, y: -5 }, ab, 'sel', 8)
    expect(t.kind).toBe('wall')
    if (t.kind !== 'wall') throw new Error('expected a wall')
    expect(t.a.y).toBe(0)
    expect(t.b.y).toBe(0)
  })

  it('returns none for the floor far from every wall', () => {
    const ab = board([rect('r1', 0, 0, 400, 300)])
    expect(pickMeasureTarget({ x: 200, y: 150 }, ab, 'sel', 8)).toEqual({ kind: 'none' })
  })
})

// ---------- computeMeasureGuides ----------

describe('computeMeasureGuides', () => {
  const ab = board([], [])

  it('side by side, 30 cm apart: one x guide of 30', () => {
    const a = item({ id: 'a', xCm: 50 }) // bounds x [0, 100]
    const b = item({ id: 'b', xCm: 180 }) // bounds x [130, 230]
    const guides = computeMeasureGuides(a, { kind: 'furniture', item: b }, ab)
    expect(guides).toHaveLength(1)
    expect(guides[0]).toEqual({ axis: 'x', x1: 100, y1: 0, x2: 130, y2: 0, distCm: 30 })
  })

  it('diagonal: separated on both axes gives 2 guides', () => {
    const a = item({ id: 'a', xCm: 50 }) // x [0, 100], y [-30, 30]
    const b = item({ id: 'b', xCm: 200, yCm: 150 }) // x [150, 250], y [120, 180]
    const guides = computeMeasureGuides(a, { kind: 'furniture', item: b }, ab)
    expect(guides).toHaveLength(2)
    expect(guides.find((g) => g.axis === 'x')).toEqual({ axis: 'x', x1: 100, y1: 0, x2: 150, y2: 0, distCm: 50 })
    expect(guides.find((g) => g.axis === 'y')).toEqual({ axis: 'y', x1: 50, y1: 30, x2: 50, y2: 120, distCm: 90 })
  })

  it('nested item: the inner edge distances, up to 4', () => {
    const a = item({ id: 'a' }) // x [-50, 50], y [-30, 30]
    const b = item({ id: 'b', xCm: 20, yCm: 10, widthCm: 40, depthCm: 20 }) // x [0, 40], y [0, 20]
    const guides = computeMeasureGuides(a, { kind: 'furniture', item: b }, ab)
    expect(guides).toHaveLength(4)
    const byAxis = (axis: 'x' | 'y') => guides.filter((g) => g.axis === axis).map((g) => g.distCm).sort((p, q) => p - q)
    expect(byAxis('x')).toEqual([10, 50])
    expect(byAxis('y')).toEqual([10, 30])
    // Every guide has a positive length.
    for (const g of guides) expect(g.distCm).toBeGreaterThan(0)
  })

  it('horizontal wall above: one y guide with the right distance', () => {
    const a = item({ id: 'a', yCm: 100 }) // y [70, 130]
    const guides = computeMeasureGuides(a, { kind: 'wall', a: { x: 0, y: 0 }, b: { x: 400, y: 0 } }, ab)
    expect(guides).toEqual([{ axis: 'y', x1: 0, y1: 70, x2: 0, y2: 0, distCm: 70 }])
  })

  it('wall crossing the item: no guide', () => {
    const a = item({ id: 'a' }) // y [-30, 30]
    expect(computeMeasureGuides(a, { kind: 'wall', a: { x: 0, y: 0 }, b: { x: 400, y: 0 } }, ab)).toEqual([])
  })

  it("'none' equals computeDistanceGuides", () => {
    const a = item({ id: 'a', xCm: 200, yCm: 150 })
    const room = board([rect('r1', 0, 0, 400, 300)], [a])
    expect(computeMeasureGuides(a, { kind: 'none' }, room)).toEqual(computeDistanceGuides(a, room))
  })
})

// ---------- multi-selection / group measure ----------

describe('multi-selection / group measure', () => {
  it('excludes all members of the selection as targets', () => {
    const g1 = item({ id: 'g1', xCm: 50, yCm: 50, groupId: 'grp' })
    const g2 = item({ id: 'g2', xCm: 200, yCm: 50, groupId: 'grp' })
    const other = item({ id: 'other', xCm: 350, yCm: 50 })
    const ab = board([], [g1, g2, other])
    const excluded = new Set(['g1', 'g2'])

    expect(pickMeasureTarget({ x: 50, y: 50 }, ab, excluded, 8)).toEqual({ kind: 'none' })
    expect(pickMeasureTarget({ x: 200, y: 50 }, ab, excluded, 8)).toEqual({ kind: 'none' })
    expect(pickMeasureTarget({ x: 350, y: 50 }, ab, excluded, 8)).toEqual({ kind: 'furniture', item: other })
  })

  it('measures gap from the selection box to an external item', () => {
    const g1 = item({ id: 'g1', xCm: 50, yCm: 100, widthCm: 60, depthCm: 40 }) // x [20, 80], y [80, 120]
    const g2 = item({ id: 'g2', xCm: 130, yCm: 160, widthCm: 40, depthCm: 40 }) // x [110, 150], y [140, 180]
    const box = groupBounds([g1, g2])! // x [20, 150], y [80, 180]
    const other = item({ id: 'other', xCm: 230, yCm: 130, widthCm: 60, depthCm: 60 }) // x [200, 260], y [100, 160]
    const ab = board([], [g1, g2, other])

    const guides = computeMeasureGuidesForBox(box, { kind: 'furniture', item: other }, ab)
    expect(guides).toEqual([{ axis: 'x', x1: 150, y1: 130, x2: 200, y2: 130, distCm: 50 }])
  })

  it('measures distance from the selection box to a wall', () => {
    const g1 = item({ id: 'g1', xCm: 100, yCm: 100, widthCm: 60, depthCm: 40 }) // y [80, 120]
    const g2 = item({ id: 'g2', xCm: 200, yCm: 150, widthCm: 40, depthCm: 60 }) // y [120, 180]
    const box = groupBounds([g1, g2])! // x [70, 220], y [80, 180]
    const ab = board([rect('r1', 0, 0, 400, 300)], [g1, g2])

    const topGuides = computeMeasureGuidesForBox(box, { kind: 'wall', a: { x: 0, y: 0 }, b: { x: 400, y: 0 } }, ab)
    expect(topGuides).toEqual([{ axis: 'y', x1: 145, y1: 80, x2: 145, y2: 0, distCm: 80 }])

    const rightGuides = computeMeasureGuidesForBox(box, { kind: 'wall', a: { x: 400, y: 0 }, b: { x: 400, y: 300 } }, ab)
    expect(rightGuides).toEqual([{ axis: 'x', x1: 220, y1: 130, x2: 400, y2: 130, distCm: 180 }])
  })

  it('measures floor distances from the selection box to the enclosing room walls', () => {
    const g1 = item({ id: 'g1', xCm: 100, yCm: 100, widthCm: 60, depthCm: 40 }) // x [70, 130], y [80, 120]
    const g2 = item({ id: 'g2', xCm: 200, yCm: 160, widthCm: 40, depthCm: 40 }) // x [180, 220], y [140, 180]
    const box = groupBounds([g1, g2])! // x [70, 220], y [80, 180], center (145, 130)
    const ab = board([rect('r1', 0, 0, 400, 300)], [g1, g2])

    const guides = computeMeasureGuidesForBox(box, { kind: 'none' }, ab)
    expect(guides).toHaveLength(4)
    expect(guides).toEqual(computeDistanceGuidesForBox(box, ab))
    expect(guides.find((g) => g.axis === 'x' && g.x2 < g.x1)?.distCm).toBe(70)
    expect(guides.find((g) => g.axis === 'x' && g.x2 > g.x1)?.distCm).toBe(180)
    expect(guides.find((g) => g.axis === 'y' && g.y2 < g.y1)?.distCm).toBe(80)
    expect(guides.find((g) => g.axis === 'y' && g.y2 > g.y1)?.distCm).toBe(120)
  })

  it('returns no floor distances when the selection box center is outside all rooms', () => {
    const g1 = item({ id: 'g1', xCm: -100, yCm: 150, widthCm: 40, depthCm: 40 })
    const g2 = item({ id: 'g2', xCm: -40, yCm: 150, widthCm: 40, depthCm: 40 })
    const box = groupBounds([g1, g2])! // center (-70, 150) outside room [0..400, 0..300]
    const ab = board([rect('r1', 0, 0, 400, 300)], [g1, g2])

    expect(computeMeasureGuidesForBox(box, { kind: 'none' }, ab)).toEqual([])
  })
})
