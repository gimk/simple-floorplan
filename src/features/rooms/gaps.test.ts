import { describe, expect, it } from 'vitest'
import type { Room } from '../../model/types'
import { gapAreas } from './gaps'

const box = (id: string, x0: number, y0: number, x1: number, y1: number): Room => ({
  id, code: id, name: id, walkOrder: 0, holes: [], walls: {},
  vertices: [{ id: id + 'a', x: x0, y: y0 }, { id: id + 'b', x: x1, y: y0 }, { id: id + 'c', x: x1, y: y1 }, { id: id + 'd', x: x0, y: y1 }],
})

const areaOf = (m: ReturnType<typeof gapAreas>) => {
  let total = 0
  for (const poly of m) poly.forEach((rg, i) => {
    let s = 0
    for (let k = 0; k + 1 < rg.length; k++) s += rg[k][0] * rg[k + 1][1] - rg[k + 1][0] * rg[k][1]
    total += (i === 0 ? 1 : -1) * Math.abs(s) / 2
  })
  return total
}

describe('gapAreas', () => {
  it('fills the wall gap between two rooms, and nothing outside', () => {
    const g = gapAreas([box('a', 0, 0, 400, 300), box('b', 420, 0, 800, 300)])
    expect(areaOf(g)).toBeCloseTo(20 * 300, 0)
  })
  it('leaves wide gaps empty', () => {
    expect(gapAreas([box('a', 0, 0, 400, 300), box('b', 600, 0, 1000, 300)])).toEqual([])
  })
  it('fills a room hole', () => {
    const r = { ...box('a', 0, 0, 400, 300), holes: [[{ id: 'h1', x: 100, y: 100 }, { id: 'h2', x: 150, y: 100 }, { id: 'h3', x: 150, y: 150 }, { id: 'h4', x: 100, y: 150 }]] }
    expect(areaOf(gapAreas([r]))).toBeCloseTo(2500, 0)
  })
  it('is empty with no rooms', () => {
    expect(gapAreas([])).toEqual([])
  })
})

describe('gapAreas (L-shaped building)', () => {
  it('keeps the inner corner of the building empty', () => {
    // Two rooms form an L; the notch outside the corner is not a gap.
    expect(gapAreas([box('a', 0, 0, 400, 300), box('b', 0, 300, 200, 600)])).toEqual([])
  })
})
