import { describe, expect, it } from 'vitest'
import { snapPoint, snapTranslation, type SnapOpts } from './snap'
import type { Vec } from '../../model/types'

const opts: SnapOpts = { grid: true, gridCm: 5, angles: true, vertices: true }

describe('snapPoint', () => {
  it('returns the point untouched when disabled', () => {
    const r = snapPoint({ x: 12.3, y: 7.7 }, { opts, tolCm: 10, disabled: true })
    expect(r.point).toEqual({ x: 12.3, y: 7.7 })
    expect(r.snapped).toBe(false)
  })
  it('snaps to the grid', () => {
    const r = snapPoint({ x: 12.4, y: 17.6 }, { opts, tolCm: 3 })
    expect(r.point).toEqual({ x: 10, y: 20 })
  })
  it('prefers an existing vertex over everything', () => {
    const r = snapPoint({ x: 101, y: 203 }, { opts, tolCm: 5, vertices: [{ x: 100, y: 200 }] })
    expect(r.point).toEqual({ x: 100, y: 200 })
    expect(r.guides[0].kind).toBe('vertex')
  })
  it('snaps to 90° from the previous vertex and grids the free coordinate', () => {
    const r = snapPoint({ x: 203, y: 2 }, { opts, tolCm: 6, refs: [{ x: 0, y: 0 }] })
    expect(r.point.y).toBeCloseTo(0)
    expect(r.point.x).toBe(205)
    expect(r.guides.some((g) => g.kind === 'angle')).toBe(true)
  })
  it('snaps to 45°', () => {
    const r = snapPoint({ x: 101, y: 98 }, { opts, tolCm: 6, refs: [{ x: 0, y: 0 }] })
    expect(r.point.x).toBeCloseTo(r.point.y)
    expect(r.point.x).toBeCloseTo(100)
  })
  it('aligns with the x of another vertex (wall extension)', () => {
    const r = snapPoint({ x: 301, y: 77 }, { opts: { ...opts, grid: false }, tolCm: 4, vertices: [{ x: 300, y: 0 }] })
    expect(r.point.x).toBe(300)
    expect(r.point.y).toBe(77)
    expect(r.guides[0].kind).toBe('x')
  })
  it('intersects a 90° ray with an alignment line', () => {
    const r = snapPoint({ x: 298, y: 2 }, { opts, tolCm: 6, refs: [{ x: 0, y: 0 }], vertices: [{ x: 300, y: 500 }] })
    expect(r.point.x).toBeCloseTo(300)
    expect(r.point.y).toBeCloseTo(0)
  })
  it('does nothing beyond tolerance when grid is off', () => {
    const r = snapPoint({ x: 50, y: 50 }, { opts: { ...opts, grid: false }, tolCm: 3, refs: [{ x: 0, y: 20 }], vertices: [{ x: 900, y: 900 }] })
    expect(r.point).toEqual({ x: 50, y: 50 })
    expect(r.snapped).toBe(false)
  })
})

describe('snapPoint on walls', () => {
  const wall: [Vec, Vec] = [{ x: 0, y: 0 }, { x: 0, y: 100 }]
  it('snaps a point onto a wall, before the grid', () => {
    const r = snapPoint({ x: 3.2, y: 50.3 }, { opts, tolCm: 5, edges: [wall] })
    expect(r.point.x).toBeCloseTo(0)
    expect(r.point.y).toBeCloseTo(50.3)
    expect(r.guides[0]).toEqual({ kind: 'edge', from: wall[0], to: wall[1] })
  })
  it('ignores a wall beyond its ends', () => {
    const r = snapPoint({ x: 3, y: 120 }, { opts, tolCm: 5, edges: [wall] })
    expect(r.guides.some((g) => g.kind === 'edge')).toBe(false)
    expect(r.point).toEqual({ x: 5, y: 120 })
  })
  it('a vertex beats a wall', () => {
    const r = snapPoint({ x: 1, y: 20.5 }, { opts, tolCm: 5, edges: [wall], vertices: [{ x: 0, y: 20 }] })
    expect(r.point).toEqual({ x: 0, y: 20 })
    expect(r.guides[0].kind).toBe('vertex')
  })
  it('a wall crossed by a 0° ray from a ref wins over the nearest point', () => {
    const r = snapPoint({ x: 198, y: 3 }, {
      opts: { ...opts, grid: false }, tolCm: 5, refs: [{ x: 0, y: 0 }], edges: [[{ x: 200, y: -100 }, { x: 200, y: 100 }]],
    })
    expect(r.point.x).toBeCloseTo(200)
    expect(r.point.y).toBeCloseTo(0)
  })
  it('walls are ignored when the vertices flag is off', () => {
    const r = snapPoint({ x: 3.2, y: 50.3 }, { opts: { ...opts, vertices: false, grid: false }, tolCm: 5, edges: [wall] })
    expect(r.snapped).toBe(false)
  })
})

describe('snapTranslation', () => {
  const sq: Vec[] = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
  const movingEdges: [Vec, Vec][] = [[sq[0], sq[1]], [sq[1], sq[2]], [sq[2], sq[3]], [sq[3], sq[0]]]
  // Neighbour room on the right, its left wall spans y -50..150 (no corner within tolerance of the moved square).
  const nVerts: Vec[] = [{ x: 200, y: -50 }, { x: 300, y: -50 }, { x: 300, y: 150 }, { x: 200, y: 150 }]
  const nEdges: [Vec, Vec][] = [
    [nVerts[0], nVerts[1]], [nVerts[1], nVerts[2]], [nVerts[2], nVerts[3]], [nVerts[3], nVerts[0]],
  ]

  it('a right wall 3 cm from a neighbour left wall snaps flush, where the grid would round elsewhere', () => {
    const r = snapTranslation(sq, { x: 97, y: 0 }, { opts, tolCm: 5, vertices: nVerts, edges: nEdges, movingEdges })
    expect(r.d.x).toBeCloseTo(100)
    expect(r.d.y).toBeCloseTo(0)
    expect(r.guides.some((g) => g.kind === 'edge')).toBe(true)
  })
  it('a vertex on a vertex beats a wall, and fixes both axes', () => {
    const r = snapTranslation(sq, { x: 97, y: 2 }, {
      opts, tolCm: 5, vertices: [{ x: 200, y: 3 }], edges: nEdges, movingEdges,
    })
    expect(r.d.x).toBeCloseTo(100)
    expect(r.d.y).toBeCloseTo(3)
    expect(r.guides[0].kind).toBe('vertex')
  })
  it('the grid applies when nothing else is in tolerance', () => {
    const r = snapTranslation(sq, { x: 12.4, y: 7.7 }, { opts, tolCm: 3 })
    expect(r.d).toEqual({ x: 10, y: 10 })
    expect(r.guides).toEqual([])
  })
  it('the grid is not used when the vertices flag is off and walls are ignored', () => {
    const r = snapTranslation(sq, { x: 97, y: 0 }, { opts: { ...opts, vertices: false }, tolCm: 5, edges: nEdges, movingEdges })
    expect(r.d.x).toBeCloseTo(95)
  })
  it('returns d unchanged when disabled', () => {
    const d = { x: 97, y: 2 }
    const r = snapTranslation(sq, d, { opts, tolCm: 5, vertices: nVerts, edges: nEdges, movingEdges, disabled: true })
    expect(r.d).toEqual(d)
    expect(r.guides).toEqual([])
  })
})
