import { describe, expect, it } from 'vitest'
import { dot, innerWallLengths, norm, roomWalls, sub } from '../../model/geometry'
import type { Room } from '../../model/types'
import { solveRoom, solveRoomLsq } from './solve'

const P = (x: number, y: number) => ({ x, y })

/** A room from drawn points. Diagonal given as vertex indexes, if any. */
function roomOf(pts: { x: number; y: number }[], diagonal?: [number, number]): Room {
  return {
    id: 'r1',
    code: 'R1',
    name: 'Room',
    vertices: pts.map((p, i) => ({ id: 'v' + i, x: p.x, y: p.y })),
    holes: [],
    walls: {},
    walkOrder: 1,
    ...(diagonal ? { diagonal } : {}),
  }
}

const lengths = (pts: { x: number; y: number }[]) => roomWalls({ ...roomOf(pts) }).map((w) => w.length)

/** Inside face length of each wall (default 10 cm walls): measured values are compared with these. */
const innerLengths = (pts: { x: number; y: number }[]) => innerWallLengths(roomOf(pts))

/** Dot of the two edges at each corner: 0 for a right angle. */
function cornerDots(pts: { x: number; y: number }[]): number[] {
  const n = pts.length
  return pts.map((p, i) => {
    const a = pts[(i + n - 1) % n], c = pts[(i + 1) % n]
    return dot(norm(sub(a, p)), norm(sub(c, p)))
  })
}

describe('solveRoomLsq', () => {
  it('1. rectangle with unequal opposite walls: right angles kept, walls meet in the middle', () => {
    const drawn = [P(0, 0), P(400, 0), P(400, 300), P(0, 300)]
    const s = solveRoom(roomOf(drawn), [410, 305, 414, 305])
    expect(s.mode).toBe('lsq')
    for (const d of cornerDots(s.points)) expect(Math.abs(d)).toBeLessThan(1e-3)
    // Inside faces meet in the middle: (410 + 414) / 2 = 412. Centre line = 412 + 10 = 422.
    const l = innerLengths(s.points)
    expect(l[0]).toBeCloseTo(412, 0)
    expect(l[2]).toBeCloseTo(412, 0)
    const r0 = s.residuals.find((x) => x.index === 0)!
    const r2 = s.residuals.find((x) => x.index === 2)!
    expect(Math.abs(r0.diffCm + 2)).toBeLessThan(0.5)
    expect(Math.abs(r2.diffCm - 2)).toBeLessThan(0.5)
    expect(s.points[0]).toMatchObject({ x: 0, y: 0 })
  })

  it('2. rectangle with exact walls and a diagonal 10 cm too long: right angles kept, diagonal reported', () => {
    const drawn = [P(0, 0), P(400, 0), P(400, 300), P(0, 300)]
    const s = solveRoomLsq(roomOf(drawn, [0, 2]), [400, 300, 400, 300], 510)
    for (const d of cornerDots(s.points)) expect(Math.abs(d)).toBeLessThan(1e-3)
    const dr = s.residuals.find((x) => x.index === 'D')!
    expect(dr.measuredCm).toBe(510)
    // Inside corners of exact 400 x 300 walls: diagonal = sqrt(400^2 + 300^2) = 500, so 510 is 10 cm too long.
    // Walls and diagonal share the error: the diagonal residual is about +6.7 (measured minus solved).
    expect(Math.abs(dr.diffCm - 6.7)).toBeLessThan(1.5)
    const l = innerLengths(s.points)
    expect(Math.abs(l[0] - 400)).toBeLessThan(3)
    expect(Math.abs(l[1] - 300)).toBeLessThan(3)
  })

  it('3. L shape, walls 1 and 6 measured: right angles kept, measured walls hold, polygon closes', () => {
    const drawn = [P(0, 0), P(400, 0), P(400, 150), P(200, 150), P(200, 300), P(0, 300)]
    const s = solveRoom(roomOf(drawn), [410, null, null, null, null, 304])
    for (const d of cornerDots(s.points)) expect(Math.abs(d)).toBeLessThan(1e-3)
    const l = innerLengths(s.points)
    expect(Math.abs(l[0] - 410)).toBeLessThan(0.1)
    expect(Math.abs(l[5] - 304)).toBeLessThan(0.1)
    expect(s.points).toHaveLength(6)
    expect(s.points[0]).toMatchObject({ x: 0, y: 0 })
  })

  it('4. L shape, all walls measured with a 3 cm inconsistency on the x axis: spread over the 3 x walls', () => {
    const drawn = [P(0, 0), P(400, 0), P(400, 150), P(200, 150), P(200, 300), P(0, 300)]
    const s = solveRoom(roomOf(drawn), [403, 150, 200, 150, 200, 300])
    for (const d of cornerDots(s.points)) expect(Math.abs(d)).toBeLessThan(1e-3)
    for (const i of [0, 2, 4]) expect(Math.abs(Math.abs(s.residuals.find((x) => x.index === i)!.diffCm) - 1)).toBeLessThan(0.1)
    for (const i of [1, 3, 5]) expect(Math.abs(s.residuals.find((x) => x.index === i)!.diffCm)).toBeLessThan(0.05)
    // Least squares over six residuals with three of size 1: rms = sqrt(3 / 6).
    expect(Math.abs(s.closingErrorCm - Math.sqrt(0.5))).toBeLessThan(0.05)
  })

  it('5. free polygon with one slanted wall: slanted wall stays slanted, measured wall holds', () => {
    const drawn = [P(0, 0), P(400, 0), P(400, 150), P(200, 300), P(0, 300)]
    const s = solveRoom(roomOf(drawn), [410, null, null, null, null])
    const l = innerLengths(s.points)
    expect(Math.abs(l[0] - 410)).toBeLessThan(0.5)
    const slant = norm(sub(s.points[3], s.points[2]))
    expect(Math.abs(dot(slant, P(1, 0)))).toBeLessThan(0.99)
    expect(Math.abs(dot(slant, P(0, 1)))).toBeLessThan(0.99)
  })

  it('6. Joinville C3: rectangle 376x330 with 371/289/371/289 and diagonal 468', () => {
    const drawn = [P(0, 0), P(376, 0), P(376, 330), P(0, 330)]
    const s = solveRoomLsq(roomOf(drawn, [0, 2]), [371, 289, 371, 289], 468)
    for (const d of cornerDots(s.points)) expect(Math.abs(d)).toBeLessThan(1e-3)
    const l = innerLengths(s.points)
    expect(Math.abs(l[0] - 371)).toBeLessThan(1)
    expect(Math.abs(l[1] - 289)).toBeLessThan(1)
    // The diagonal of 371 x 289 is 470.3: the fit reports the diagonal residual (measured minus solved).
    const dr = s.residuals.find((x) => x.index === 'D')!
    expect(dr.diffCm).toBeLessThan(0)
    expect(Math.abs(dr.diffCm + 1.5)).toBeLessThan(0.5)
  })

  it('no measurements and no diagonal: keeps the drawn shape', () => {
    const drawn = [P(0, 0), P(400, 0), P(400, 300), P(0, 300)]
    const s = solveRoom(roomOf(drawn), [null, null, null, null])
    expect(s.residuals).toEqual([])
    expect(s.closingErrorCm).toBe(0)
    expect(lengths(s.points)).toEqual([400, 300, 400, 300].map((x) => expect.closeTo(x, 4)))
  })
})
