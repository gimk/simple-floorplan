import { beforeEach, describe, expect, it } from 'vitest'
import type { Opening, Room } from '../../model/types'
import { createDefaultProject } from '../../model/schema'
import { useDoc } from '../../model/store'
import { addOpening, deleteOpening, flipOpeningHinge, flipOpeningSwing, updateOpening } from './actions'
import {
  computeDoorFlip, createOpening, DEFAULT_OPENING_WIDTH_CM, doorArcGeometry, FRAME_WEIGHT,
  frenchDoorGeometry, keepOpeningOrientation, LEAF_WEIGHT, MAX_OPENING_WIDTH_CM, MIN_OPENING_WIDTH_CM,
  openingEndpoints, openingSymbol, openingVariant, resizeOpeningFromEnd, snapToWall,
} from './geometry'

const rect = (id: string, x0: number, y0: number, x1: number, y1: number): Room => ({
  id, name: id,
  vertices: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }],
})
const op = (p: Partial<Opening> = {}): Opening => ({ id: 'o1', kind: 'door', xCm: 100, yCm: 50, angleDeg: 0, widthCm: 80, hinge: 'left', swing: 'in', ...p })

describe('snapToWall', () => {
  const r = rect('a', 0, 0, 400, 300)
  it('snaps to the top wall, angle from wall direction', () => {
    const s = snapToWall({ x: 200, y: 10 }, [r])!
    expect(s.xCm).toBeCloseTo(200); expect(s.yCm).toBeCloseTo(0)
    expect(s.angleDeg).toBeCloseTo(0); expect(s.roomId).toBe('a'); expect(s.edgeIndex).toBe(0)
    expect(s.t).toBeCloseTo(0.5); expect(s.wallLengthCm).toBeCloseTo(400)
  })
  it('angle follows the wall (right wall goes down = 90)', () => {
    const s = snapToWall({ x: 395, y: 150 }, [r])!
    expect(s.edgeIndex).toBe(1); expect(s.angleDeg).toBeCloseTo(90)
  })
  it('clamps the centre so the opening stays inside the wall', () => {
    const s = snapToWall({ x: 5, y: 5 }, [r], 100)!
    expect(s.xCm).toBeCloseTo(50); expect(s.t).toBeCloseTo(50 / 400)
    const e = snapToWall({ x: 390, y: 3 }, [r], 100)!
    expect(e.xCm).toBeCloseTo(350)
  })
  it('puts the opening at the middle of a wall shorter than the width', () => {
    const s = snapToWall({ x: 5, y: 0 }, [rect('s', 0, 0, 60, 200)], 100)!
    expect(s.xCm).toBeCloseTo(30); expect(s.t).toBeCloseTo(0.5)
  })
  it('returns null beyond the threshold, honours a custom threshold', () => {
    expect(snapToWall({ x: 200, y: 100 }, [r])).toBeNull()
    expect(snapToWall({ x: 200, y: 40 }, [r])).toBeNull()
    expect(snapToWall({ x: 200, y: 40 }, [r], 85, 50)).not.toBeNull()
  })
  it('picks the nearest wall across rooms', () => {
    const b = rect('b', 500, 0, 900, 300)
    expect(snapToWall({ x: 700, y: 8 }, [r, b])!.roomId).toBe('b')
    expect(snapToWall({ x: 410, y: 150 }, [r, b])!.roomId).toBe('a')
    expect(snapToWall({ x: 495, y: 150 }, [r, b])!.roomId).toBe('b')
  })
})

describe('keepOpeningOrientation', () => {
  it('keeps the wall angle when both point the same way', () => {
    expect(keepOpeningOrientation(0, 0)).toBeCloseTo(0)
    expect(keepOpeningOrientation(90, 90)).toBeCloseTo(90)
  })
  it('stays on the current side of a wall seen from its other end (shared wall of two rooms)', () => {
    // 90 and -90 are the same physical wall; the result keeps the side of the current angle
    expect(keepOpeningOrientation(-90, 90)).toBeCloseTo(90)
    expect(keepOpeningOrientation(90, -90)).toBeCloseTo(-90)
    expect(keepOpeningOrientation(180, 0)).toBeCloseTo(0)
  })
  it('keeps the wall angle on a perpendicular wall, normalized to (-180, 180]', () => {
    expect(keepOpeningOrientation(90, 0)).toBeCloseTo(90)
    expect(keepOpeningOrientation(0, 90)).toBeCloseTo(0)
    expect(keepOpeningOrientation(190, 10)).toBeCloseTo(10)
    expect(Math.abs(keepOpeningOrientation(-170, 30))).toBeLessThanOrEqual(180)
  })
})

describe('computeDoorFlip', () => {
  const c = { x: 100, y: 100 }
  it('covers all 4 quadrants (angle 0)', () => {
    expect(computeDoorFlip(c, 0, { x: 90, y: 120 })).toEqual({ hinge: 'left', swing: 'in' })
    expect(computeDoorFlip(c, 0, { x: 110, y: 120 })).toEqual({ hinge: 'right', swing: 'in' })
    expect(computeDoorFlip(c, 0, { x: 90, y: 80 })).toEqual({ hinge: 'left', swing: 'out' })
    expect(computeDoorFlip(c, 0, { x: 110, y: 80 })).toEqual({ hinge: 'right', swing: 'out' })
  })
  it('works on a rotated wall (angle 90: axis down, normal -x)', () => {
    expect(computeDoorFlip(c, 90, { x: 80, y: 90 })).toEqual({ hinge: 'left', swing: 'in' })
    expect(computeDoorFlip(c, 90, { x: 120, y: 110 })).toEqual({ hinge: 'right', swing: 'out' })
  })
})

describe('openingEndpoints', () => {
  it('horizontal', () => {
    const e = openingEndpoints({ xCm: 100, yCm: 50, angleDeg: 0, widthCm: 80 })
    expect(e.start).toEqual({ x: 60, y: 50 }); expect(e.end).toEqual({ x: 140, y: 50 })
  })
  it('vertical', () => {
    const e = openingEndpoints({ xCm: 10, yCm: 100, angleDeg: 90, widthCm: 60 })
    expect(e.start.x).toBeCloseTo(10); expect(e.start.y).toBeCloseTo(70)
    expect(e.end.x).toBeCloseTo(10); expect(e.end.y).toBeCloseTo(130)
  })
})

describe('resizeOpeningFromEnd', () => {
  const o = op() // 60..140 on y=50
  it('drags the end, keeps the start fixed', () => {
    const r = resizeOpeningFromEnd(o, 'end', { x: 180, y: 99 })
    expect(r.widthCm).toBeCloseTo(120); expect(r.xCm).toBeCloseTo(120); expect(r.yCm).toBeCloseTo(50)
  })
  it('drags the start, keeps the end fixed', () => {
    const r = resizeOpeningFromEnd(o, 'start', { x: 40, y: 0 })
    expect(r.widthCm).toBeCloseTo(100); expect(r.xCm).toBeCloseTo(90)
  })
  it('clamps to min and max', () => {
    const lo = resizeOpeningFromEnd(o, 'end', { x: 0, y: 50 })
    expect(lo.widthCm).toBe(MIN_OPENING_WIDTH_CM); expect(lo.xCm).toBeCloseTo(60 + MIN_OPENING_WIDTH_CM / 2)
    const hi = resizeOpeningFromEnd(o, 'start', { x: -1000, y: 50 })
    expect(hi.widthCm).toBe(MAX_OPENING_WIDTH_CM); expect(hi.xCm).toBeCloseTo(140 - MAX_OPENING_WIDTH_CM / 2)
  })
  it('works on a rotated opening', () => {
    const v = op({ xCm: 0, yCm: 100, angleDeg: 90, widthCm: 80 }) // y 60..140
    const r = resizeOpeningFromEnd(v, 'end', { x: 30, y: 160 })
    expect(r.widthCm).toBeCloseTo(100); expect(r.xCm).toBeCloseTo(0); expect(r.yCm).toBeCloseTo(110)
  })
})

describe('doorArcGeometry', () => {
  it('left hinge, swing in (angle 0)', () => {
    const g = doorArcGeometry(op())
    expect(g.hingePt).toEqual({ x: 60, y: 50 }); expect(g.closedTipPt).toEqual({ x: 140, y: 50 })
    expect(g.openTipPt.x).toBeCloseTo(60); expect(g.openTipPt.y).toBeCloseTo(130)
    expect(g.radius).toBe(80); expect(g.sweepFlag).toBe(1)
  })
  it('right hinge, swing out', () => {
    const g = doorArcGeometry(op({ hinge: 'right', swing: 'out' }))
    expect(g.hingePt).toEqual({ x: 140, y: 50 })
    expect(g.openTipPt.x).toBeCloseTo(140); expect(g.openTipPt.y).toBeCloseTo(-30)
    expect(g.sweepFlag).toBe(1)
  })
  it('flipping only one of hinge/swing reverses the sweep', () => {
    expect(doorArcGeometry(op({ hinge: 'right', swing: 'in' })).sweepFlag).toBe(0)
    expect(doorArcGeometry(op({ hinge: 'left', swing: 'out' })).sweepFlag).toBe(0)
  })
  it('leaf is exactly perpendicular and of length = width, on any angle', () => {
    for (const angleDeg of [0, 37, 90, 180, -125]) for (const hinge of ['left', 'right'] as const) for (const swing of ['in', 'out'] as const) {
      const g = doorArcGeometry(op({ angleDeg, hinge, swing, widthCm: 90 }))
      const u = { x: g.closedTipPt.x - g.hingePt.x, y: g.closedTipPt.y - g.hingePt.y }
      const w = { x: g.openTipPt.x - g.hingePt.x, y: g.openTipPt.y - g.hingePt.y }
      expect(u.x * w.x + u.y * w.y).toBeCloseTo(0, 6)
      expect(Math.hypot(w.x, w.y)).toBeCloseTo(90, 6)
      expect(Math.hypot(u.x, u.y)).toBeCloseTo(90, 6)
      // sweep matches the turn direction from closed tip to open tip (y-down: positive cross = sweep 1)
      expect(g.sweepFlag).toBe(u.x * w.y - u.y * w.x > 0 ? 1 : 0)
    }
  })
  it('swing in is on the +normal side, matching computeDoorFlip', () => {
    const f = computeDoorFlip({ x: 100, y: 50 }, 0, { x: 100, y: 70 })
    const g = doorArcGeometry(op({ ...f }))
    expect(g.openTipPt.y).toBeGreaterThan(50)
  })
})

describe('createOpening', () => {
  const snap = snapToWall({ x: 200, y: 5 }, [rect('a', 0, 0, 400, 300)])!
  it('door has default width, hinge and swing', () => {
    const d = createOpening('door', snap)
    expect(d).toMatchObject({ kind: 'door', xCm: snap.xCm, yCm: snap.yCm, angleDeg: 0, widthCm: DEFAULT_OPENING_WIDTH_CM.door, hinge: 'left', swing: 'in' })
    expect(d.id).toBeTruthy()
    expect(createOpening('door', snap, 'right', 'out')).toMatchObject({ hinge: 'right', swing: 'out' })
  })
  it('window and opening have no hinge/swing and their own width', () => {
    const w = createOpening('window', snap)
    expect(w.widthCm).toBe(120); expect(w.hinge).toBeUndefined(); expect(w.swing).toBeUndefined()
    expect(createOpening('opening', snap).widthCm).toBe(100)
  })
  it('width is reduced on a short wall', () => {
    const s = snapToWall({ x: 5, y: 0 }, [rect('s', 0, 0, 60, 200)])!
    expect(createOpening('door', s).widthCm).toBe(60)
  })
})

describe('store actions', () => {
  let abId: string
  const ab = () => useDoc.getState().doc.artboards.find((a) => a.id === abId)!
  beforeEach(() => {
    useDoc.getState().hydrate(createDefaultProject())
    abId = useDoc.getState().doc.artboards[0].id
  })
  it('add, update, flip, delete, with undo', () => {
    addOpening(abId, op())
    expect(ab().openings).toHaveLength(1)
    updateOpening(abId, 'o1', { widthCm: 90, xCm: 120 })
    expect(ab().openings[0]).toMatchObject({ widthCm: 90, xCm: 120 })
    flipOpeningHinge(abId, 'o1')
    expect(ab().openings[0].hinge).toBe('right')
    flipOpeningSwing(abId, 'o1')
    expect(ab().openings[0].swing).toBe('out')
    useDoc.getState().undo()
    expect(ab().openings[0].swing).toBe('in')
    useDoc.getState().undo()
    expect(ab().openings[0].hinge).toBe('left')
    deleteOpening(abId, 'o1')
    expect(ab().openings).toHaveLength(0)
    useDoc.getState().undo()
    expect(ab().openings).toHaveLength(1)
  })
  it('does nothing for unknown ids', () => {
    addOpening('nope', op())
    updateOpening(abId, 'x', { widthCm: 1 })
    flipOpeningHinge(abId, 'x'); flipOpeningSwing(abId, 'x'); deleteOpening(abId, 'x')
    expect(ab().openings).toHaveLength(0)
    expect(useDoc.temporal.getState().pastStates).toHaveLength(0)
  })
  it('flip uses defaults when hinge/swing are missing', () => {
    addOpening(abId, op({ hinge: undefined, swing: undefined }))
    flipOpeningHinge(abId, 'o1'); flipOpeningSwing(abId, 'o1')
    expect(ab().openings[0]).toMatchObject({ hinge: 'right', swing: 'out' })
  })
})

describe('frenchDoorGeometry', () => {
  it('splits the opening into two symmetric half-width leaves hinged at the two ends', () => {
    const [left, right] = frenchDoorGeometry(op()) // 60..140 on y = 50
    expect(left.hingePt).toEqual({ x: 60, y: 50 })
    expect(left.closedTipPt).toEqual({ x: 100, y: 50 })
    expect(left.openTipPt.x).toBeCloseTo(60); expect(left.openTipPt.y).toBeCloseTo(90)
    expect(left.radius).toBe(40); expect(left.sweepFlag).toBe(1)
    expect(right.hingePt).toEqual({ x: 140, y: 50 })
    expect(right.closedTipPt).toEqual({ x: 100, y: 50 })
    expect(right.openTipPt.x).toBeCloseTo(140); expect(right.openTipPt.y).toBeCloseTo(90)
    expect(right.radius).toBe(40); expect(right.sweepFlag).toBe(0)
    // Both arcs start in the middle of the opening, so they meet at the centre.
    expect(left.closedTipPt).toEqual(right.closedTipPt)
  })

  it('keeps both leaves on the same side of the wall, and ignores the hinge field', () => {
    const out = frenchDoorGeometry(op({ swing: 'out' }))
    for (const g of out) expect(g.openTipPt.y).toBeLessThan(50)
    expect(frenchDoorGeometry(op({ hinge: 'right' }))).toEqual(frenchDoorGeometry(op({ hinge: 'left' })))
  })

  it('is perpendicular to the wall on any angle, with half the opening width', () => {
    for (const angleDeg of [0, 37, 90, 180, -125]) {
      const [left, right] = frenchDoorGeometry(op({ angleDeg, widthCm: 90 }))
      for (const g of [left, right]) {
        const u = { x: g.closedTipPt.x - g.hingePt.x, y: g.closedTipPt.y - g.hingePt.y }
        const w = { x: g.openTipPt.x - g.hingePt.x, y: g.openTipPt.y - g.hingePt.y }
        expect(u.x * w.x + u.y * w.y).toBeCloseTo(0, 6)
        expect(Math.hypot(u.x, u.y)).toBeCloseTo(45, 6)
        expect(Math.hypot(w.x, w.y)).toBeCloseTo(45, 6)
        expect(g.sweepFlag).toBe(u.x * w.y - u.y * w.x > 0 ? 1 : 0)
      }
    }
  })
})

describe('openingVariant', () => {
  it('treats a missing variant as standard (old documents)', () => {
    expect(openingVariant({})).toBe('standard')
    expect(openingVariant({ variant: undefined })).toBe('standard')
    expect(openingVariant({ variant: 'french' })).toBe('french')
    expect(openingVariant({ variant: 'sliding' })).toBe('sliding')
  })
})

describe('openingSymbol', () => {
  // 2 px per cm, so the px offsets of the drawing are easy to read in cm.
  const u = (px: number) => px / 2
  const door = op() // 60..140 on y = 50, width 80, hinge left, swing in
  const win = (p: Partial<Opening> = {}) =>
    op({ kind: 'window', widthCm: 80, hinge: undefined, swing: undefined, ...p })

  it('standard door: one leaf plus one quarter-circle arc', () => {
    const s = openingSymbol(door, u)
    expect(s.wallLine).toBe(false)
    expect(s.paths).toHaveLength(1)
    expect(s.paths[0].pts).toEqual([{ x: 60, y: 50 }, { x: 60, y: 130 }])
    expect(s.paths[0].weight).toBe(LEAF_WEIGHT)
    expect(s.arcs).toHaveLength(1)
    expect(s.arcs[0]).toMatchObject({ center: { x: 60, y: 50 }, from: { x: 140, y: 50 }, to: { x: 60, y: 130 }, radius: 80, sweepFlag: 1 })
  })

  it('undefined variant and explicit standard draw the same symbol', () => {
    expect(openingSymbol(door, u)).toEqual(openingSymbol({ ...door, variant: 'standard' }, u))
  })

  it('french door: two leaves of half the width and two arcs that meet in the middle', () => {
    const s = openingSymbol({ ...door, variant: 'french' }, u)
    expect(s.wallLine).toBe(false)
    expect(s.paths).toHaveLength(2)
    expect(s.paths[0].pts).toEqual([{ x: 60, y: 50 }, { x: 60, y: 90 }])
    expect(s.paths[1].pts).toEqual([{ x: 140, y: 50 }, { x: 140, y: 90 }])
    expect(s.arcs).toHaveLength(2)
    for (const a of s.arcs) expect(a.radius).toBe(40)
    // Both arcs start at the centre of the opening.
    expect(s.arcs[0].from).toEqual({ x: 100, y: 50 })
    expect(s.arcs[1].from).toEqual({ x: 100, y: 50 })
    expect(s.arcs.map((a) => a.sweepFlag)).toEqual([1, 0])
  })

  it('pocket door: a leaf inside the opening, a dashed receiver box and a slide line on the hinge side', () => {
    const s = openingSymbol({ ...door, variant: 'pocket' }, u)
    expect(s.wallLine).toBe(true)
    expect(s.arcs).toHaveLength(0)
    expect(s.paths).toHaveLength(3)
    const [leaf, pocket, slide] = s.paths
    // The leaf is a closed panel that starts at the hinge end and runs 55% of the width inside.
    expect(leaf.closed).toBe(true)
    expect(leaf.pts[0]).toEqual({ x: 60, y: 51.25 })
    expect(leaf.pts[1].x).toBeCloseTo(104)
    expect(leaf.dashed).toBeUndefined()
    // The receiver box is dashed and sits along the wall beyond the hinge end.
    expect(pocket.closed).toBe(true)
    expect(pocket.dashed).toBe(true)
    expect(pocket.pts[0].x).toBeCloseTo(60)
    expect(pocket.pts[1].x).toBeCloseTo(36)
    // The slide line is a short segment inside the pocket, parallel to the wall.
    expect(slide.closed).toBeUndefined()
    expect(slide.pts[0].y).toBeCloseTo(52)
    expect(slide.pts[1].y).toBeCloseTo(52)
    expect(slide.pts[1].x).toBeLessThan(slide.pts[0].x)
  })

  it('pocket door: the pocket follows the hinge side', () => {
    const s = openingSymbol({ ...door, variant: 'pocket', hinge: 'right' }, u)
    const [leaf, pocket, slide] = s.paths
    expect(leaf.pts[0].x).toBeCloseTo(140)
    expect(leaf.pts[1].x).toBeCloseTo(96)
    expect(pocket.pts[1].x).toBeCloseTo(164)
    expect(slide.pts[1].x).toBeGreaterThan(slide.pts[0].x)
  })

  it('bypass-glass door: same 2D symbol as bypass', () => {
    expect(openingSymbol({ ...door, variant: 'bypass-glass' }, u)).toEqual(openingSymbol({ ...door, variant: 'bypass' }, u))
  })

  it('bypass door: two parallel panels that overlap in the middle on either side of the wall', () => {
    const s = openingSymbol({ ...door, variant: 'bypass' }, u)
    expect(s.wallLine).toBe(true)
    expect(s.arcs).toHaveLength(0)
    expect(s.paths).toHaveLength(2)
    const [first, second] = s.paths
    for (const p of s.paths) {
      expect(p.closed).toBe(true)
      expect(p.dashed).toBeUndefined()
      // Each panel is 55% of the width.
      const xs = p.pts.map((q) => q.x)
      expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(44)
    }
    // The first panel sits fully on the +normal side of the wall, the second fully on the other.
    expect(Math.min(...first.pts.map((q) => q.y))).toBeGreaterThan(50)
    expect(Math.max(...second.pts.map((q) => q.y))).toBeLessThan(50)
    // They overlap in the middle: 55% + 55% of the width.
    const span = (p: { pts: { x: number }[] }) => [Math.min(...p.pts.map((q) => q.x)), Math.max(...p.pts.map((q) => q.x))]
    const [a0, a1] = span(first), [b0, b1] = span(second)
    expect(Math.min(a1, b1) - Math.max(a0, b0)).toBeGreaterThan(0)
  })

  it('standard window: centre frame line plus one thinner line on each side', () => {
    const s = openingSymbol(win(), u)
    expect(s.wallLine).toBe(false)
    expect(s.arcs).toHaveLength(0)
    expect(s.paths).toHaveLength(3)
    expect(s.paths[0].weight).toBe(FRAME_WEIGHT)
    expect(s.paths[0].pts).toEqual([{ x: 60, y: 50 }, { x: 140, y: 50 }])
    expect(s.paths[1].pts).toEqual([{ x: 60, y: 51.25 }, { x: 140, y: 51.25 }])
    expect(s.paths[2].pts).toEqual([{ x: 60, y: 48.75 }, { x: 140, y: 48.75 }])
    expect(s.paths[1].opacity).toBe(0.6)
  })

  it('sliding window: two staggered sashes that overlap in the middle', () => {
    const s = openingSymbol(win({ variant: 'sliding' }), u)
    expect(s.wallLine).toBe(true)
    expect(s.arcs).toHaveLength(0)
    expect(s.paths).toHaveLength(2)
    const [first, second] = s.paths
    for (const p of s.paths) expect(p.closed).toBe(true)
    // One sash on each side of the wall line, 62% of the width each.
    expect(Math.min(...first.pts.map((q) => q.y))).toBeGreaterThan(50)
    expect(Math.max(...second.pts.map((q) => q.y))).toBeLessThan(50)
    expect(Math.max(...first.pts.map((q) => q.x)) - Math.min(...first.pts.map((q) => q.x))).toBeCloseTo(49.6)
    expect(first.pts[0].x).toBeCloseTo(60)
    expect(second.pts[1].x).toBeCloseTo(140)
    // They overlap slightly around the middle.
    expect(Math.max(...first.pts.map((q) => q.x))).toBeCloseTo(109.6)
    expect(Math.min(...second.pts.map((q) => q.x))).toBeCloseTo(90.4)
  })

  it('casement window: the frame plus one sash leaf and its quarter-circle swing arc', () => {
    const s = openingSymbol(win({ variant: 'casement' }), u)
    expect(s.wallLine).toBe(false)
    // The three frame lines stay, and the sash leaf is added after them.
    expect(s.paths).toHaveLength(4)
    expect(s.paths[0].weight).toBe(FRAME_WEIGHT)
    expect(s.paths[0].pts).toEqual([{ x: 60, y: 50 }, { x: 140, y: 50 }])
    expect(s.paths[3].pts).toEqual([{ x: 60, y: 50 }, { x: 60, y: 130 }])
    expect(s.paths[3].weight).toBe(LEAF_WEIGHT)
    // One full-width arc, hinged left and opening on the +normal side by default.
    expect(s.arcs).toHaveLength(1)
    expect(s.arcs[0]).toMatchObject({ center: { x: 60, y: 50 }, from: { x: 140, y: 50 }, to: { x: 60, y: 130 }, radius: 80, sweepFlag: 1 })
  })

  it('casement window: hinge right and swing out, hinge left and swing out', () => {
    const right = openingSymbol(win({ variant: 'casement', hinge: 'right' }), u)
    expect(right.paths[3].pts).toEqual([{ x: 140, y: 50 }, { x: 140, y: 130 }])
    expect(right.arcs[0]).toMatchObject({ center: { x: 140, y: 50 }, from: { x: 60, y: 50 }, to: { x: 140, y: 130 } })
    const out = openingSymbol(win({ variant: 'casement', swing: 'out' }), u)
    expect(out.paths[3].pts).toEqual([{ x: 60, y: 50 }, { x: 60, y: -30 }])
    expect(out.arcs[0].to).toEqual({ x: 60, y: -30 })
  })

  it('double-casement window: the frame plus two half-width sash leaves and two arcs meeting in the middle', () => {
    const s = openingSymbol(win({ variant: 'double-casement' }), u)
    expect(s.wallLine).toBe(false)
    expect(s.paths).toHaveLength(5)
    expect(s.paths[0].weight).toBe(FRAME_WEIGHT)
    expect(s.paths[3].pts).toEqual([{ x: 60, y: 50 }, { x: 60, y: 90 }])
    expect(s.paths[4].pts).toEqual([{ x: 140, y: 50 }, { x: 140, y: 90 }])
    for (const p of s.paths.slice(3)) expect(p.weight).toBe(LEAF_WEIGHT)
    // Two half-width arcs that both start at the centre of the opening.
    expect(s.arcs).toHaveLength(2)
    for (const a of s.arcs) expect(a.radius).toBe(40)
    expect(s.arcs[0].from).toEqual({ x: 100, y: 50 })
    expect(s.arcs[1].from).toEqual({ x: 100, y: 50 })
    expect(s.arcs.map((a) => a.sweepFlag)).toEqual([1, 0])
  })

  it('double-casement window: the hinge field is ignored, only the swing side is used', () => {
    const base = openingSymbol(win({ variant: 'double-casement' }), u)
    const hinged = openingSymbol(win({ variant: 'double-casement', hinge: 'right' }), u)
    expect(hinged).toEqual(base)
    const out = openingSymbol(win({ variant: 'double-casement', swing: 'out' }), u)
    // Both leaves open on the other side of the wall.
    expect(out.arcs[0].to).toEqual({ x: 60, y: 10 })
    expect(out.arcs[1].to).toEqual({ x: 140, y: 10 })
  })

  it('plain opening: no symbol at all, the ticks alone mark the jambs', () => {
    const s = openingSymbol(op({ kind: 'opening', hinge: undefined, swing: undefined }), u)
    expect(s).toEqual({ wallLine: false, paths: [], arcs: [] })
  })

  it('draws on a rotated wall with the same geometry', () => {
    const vertical = op({ angleDeg: 90, xCm: 100, yCm: 0 }) // y -40..40 on x = 100
    const s = openingSymbol({ ...vertical, variant: 'bypass' }, u)
    for (const p of s.paths) {
      // Panels run down the vertical wall: their x varies only by the offset, y by the length.
      expect(Math.max(...p.pts.map((q) => q.x)) - Math.min(...p.pts.map((q) => q.x))).toBeLessThan(5)
      expect(Math.max(...p.pts.map((q) => q.y)) - Math.min(...p.pts.map((q) => q.y))).toBeCloseTo(44)
    }
    const french = openingSymbol({ ...vertical, variant: 'french' }, u)
    expect(french.arcs[0].radius).toBe(40)
    // Both leaves open across the wall, so both tips move in x.
    for (const a of french.arcs) expect(Math.abs(a.to.x - a.from.x)).toBeCloseTo(40)
  })
})
