import { beforeEach, describe, expect, it } from 'vitest'
import type { Opening, Room } from '../../model/types'
import { createDefaultProject } from '../../model/schema'
import { useDoc } from '../../model/store'
import { addOpening, deleteOpening, flipOpeningHinge, flipOpeningSwing, updateOpening } from './actions'
import {
  computeDoorFlip, createOpening, DEFAULT_OPENING_WIDTH_CM, doorArcGeometry, keepOpeningOrientation,
  MAX_OPENING_WIDTH_CM, MIN_OPENING_WIDTH_CM, openingEndpoints, resizeOpeningFromEnd, snapToWall,
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
