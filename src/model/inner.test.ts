import { describe, expect, it } from 'vitest'
import { innerRing, innerWallLengths } from './geometry'
import type { Room } from './types'

const rect = (w: number, h: number, t?: number[]): Room => {
  const vs = [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: w, y: 0 }, { id: 'c', x: w, y: h }, { id: 'd', x: 0, y: h }]
  return {
    id: 'r', code: 'R', name: 'R', walkOrder: 0, holes: [], vertices: vs,
    walls: t ? Object.fromEntries(vs.map((v, i) => [v.id, { type: 'partition' as const, thicknessCm: t[i] }])) : {},
  }
}

describe('inside faces', () => {
  it('a 400 × 300 room with 10 cm walls is 390 × 290 inside', () => {
    expect(innerWallLengths(rect(400, 300)).map((x) => Math.round(x * 1000) / 1000)).toEqual([390, 290, 390, 290])
  })
  it('uses each wall thickness', () => {
    // Walls: top 20, right 10, bottom 30, left 10 -> inside 390 wide, 300 - 10 - 15 = 275 high.
    const l = innerWallLengths(rect(400, 300, [20, 10, 30, 10]))
    expect(l[0]).toBeCloseTo(390)
    expect(l[1]).toBeCloseTo(275)
  })
  it('works in both winding directions and at a reflex corner', () => {
    const L = [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 200 }, { x: 200, y: 200 }, { x: 200, y: 400 }, { x: 0, y: 400 }]
    const a = innerRing(L, L.map(() => 5))
    const b = innerRing([...L].reverse(), L.map(() => 5)).reverse()
    a.forEach((p, i) => { expect(p.x).toBeCloseTo(b[i].x); expect(p.y).toBeCloseTo(b[i].y) })
    expect(a[3]).toEqual({ x: 195, y: 195 }) // reflex corner: the inside face goes past the centre line
    expect(a[0]).toEqual({ x: 5, y: 5 })
  })
})

describe('inside faces with duplicate corners', () => {
  it('a corner repeated twice (zero-length wall) makes no spike', () => {
    // 600 × 300 with (400,0) and (400,300) twice, like a merged outline.
    const pts = [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 300 }, { x: 400, y: 300 }, { x: 400, y: 300 }, { x: 0, y: 300 }]
    const q = innerRing(pts, pts.map(() => 5))
    expect(q[1]).toEqual({ x: 400, y: 5 })
    expect(q[2]).toEqual({ x: 400, y: 5 })
    expect(q[5].y).toBeCloseTo(295)
    expect(q[6].y).toBeCloseTo(295)
  })
})
