import { describe, expect, it } from 'vitest'
import { findEnclosingCycle } from './faces'
import type { FaceSegment } from './faces'
import { signedArea } from './geometry'
import type { Vec } from './types'

const seg = (id: string, ax: number, ay: number, bx: number, by: number): FaceSegment =>
  ({ id, a: { x: ax, y: ay }, b: { x: bx, y: by } })
const at = (x: number, y: number): Vec => ({ x, y })

/** Area of the result, rounded to 0.01 cm². */
const areaOf = (c: { points: Vec[] } | null) => (c ? Math.round(signedArea(c.points) * 100) / 100 : null)

/** The 400 × 300 square, as four segments. */
const square4 = (): FaceSegment[] => [
  seg('top', 0, 0, 400, 0),
  seg('right', 400, 0, 400, 300),
  seg('bottom', 400, 300, 0, 300),
  seg('left', 0, 300, 0, 0),
]

describe('findEnclosingCycle: simple closed areas', () => {
  it('finds the square of 4 segments', () => {
    const c = findEnclosingCycle(square4(), at(200, 150))
    expect(c).not.toBeNull()
    const pts = c!.points
    expect(pts).toHaveLength(4)
    expect(areaOf(c)).toBe(120000)
    // Positive shoelace area: the documented order.
    expect(signedArea(pts)).toBeGreaterThan(0)
    // Same 4 corners as the input, in trace order.
    const corners = pts.map((q) => `${q.x},${q.y}`).sort()
    expect(corners).toEqual(['0,0', '0,300', '400,0', '400,300'])
  })

  it('gives one segment id per edge, and the edge holds the points[i] -> points[i+1] segment', () => {
    const c = findEnclosingCycle(square4(), at(200, 150))!
    expect(c.segmentIds).toHaveLength(c.points.length)
    const byId: Record<string, string> = {}
    c.points.forEach((q, i) => {
      const r = c.points[(i + 1) % c.points.length]
      byId[c.segmentIds[i]] = `${q.x},${q.y}->${r.x},${r.y}`
    })
    expect(byId.top).toBe('0,0->400,0')
    expect(byId.right).toBe('400,0->400,300')
    expect(byId.bottom).toBe('400,300->0,300')
    expect(byId.left).toBe('0,300->0,0')
  })

  it('finds the square drawn as 2 long L-shaped chains', () => {
    const segs = [
      seg('c1a', 0, 0, 400, 0),
      seg('c1b', 400, 0, 400, 300),
      seg('c2a', 400, 300, 0, 300),
      seg('c2b', 0, 300, 0, 0),
    ]
    const c = findEnclosingCycle(segs, at(200, 150))!
    expect(c.points).toHaveLength(4)
    expect(areaOf(c)).toBe(120000)
    expect(new Set(c.segmentIds).size).toBe(4)
  })

  it('returns null for a point outside everything', () => {
    expect(findEnclosingCycle(square4(), at(-50, 150))).toBeNull()
    expect(findEnclosingCycle(square4(), at(500, 500))).toBeNull()
  })

  it('returns null when there is no closed area at all', () => {
    expect(findEnclosingCycle([seg('a', 0, 0, 400, 0)], at(200, 1))).toBeNull()
    expect(findEnclosingCycle([], at(0, 0))).toBeNull()
  })
})

describe('findEnclosingCycle: inner walls', () => {
  it('a middle wall splits the square: click left -> left half, right -> right half', () => {
    const segs = [...square4(), seg('mid', 200, 0, 200, 300)]
    const left = findEnclosingCycle(segs, at(100, 150))!
    expect(left.points).toHaveLength(4)
    expect(areaOf(left)).toBe(60000)
    expect(left.points.map((q) => `${q.x},${q.y}`).sort()).toEqual(['0,0', '0,300', '200,0', '200,300'])

    const right = findEnclosingCycle(segs, at(300, 150))!
    expect(right.points).toHaveLength(4)
    expect(areaOf(right)).toBe(60000)
    expect(right.points.map((q) => `${q.x},${q.y}`).sort()).toEqual(['200,0', '200,300', '400,0', '400,300'])
  })

  it('a T junction: a wall ends on the middle of another wall', () => {
    // Stem outside the square, so the square is still one room.
    const segs = [...square4(), seg('stem', 200, 0, 200, -150)]
    const c = findEnclosingCycle(segs, at(200, 150))!
    expect(areaOf(c)).toBe(120000)
    // The corner at 200,0 stays: two different segment ids meet there (per-wall thickness).
    expect(c.points.some((q) => q.x === 200 && q.y === 0)).toBe(true)
    expect(c.points).toHaveLength(5) // the top wall is now two edges
    expect(c.segmentIds).toHaveLength(c.points.length)
    expect(new Set(c.segmentIds).size).toBe(4)
  })

  it('crossing walls: a + inside the square gives 4 rooms', () => {
    const segs = [...square4(), seg('h', 0, 150, 400, 150), seg('v', 200, 0, 200, 300)]
    const clicks = [[100, 75], [300, 75], [100, 225], [300, 225]]
    for (const [x, y] of clicks) {
      const c = findEnclosingCycle(segs, at(x, y))
      expect(c, `click ${x},${y}`).not.toBeNull()
      expect(areaOf(c)).toBe(30000)
      expect(c!.points).toHaveLength(4)
    }
    // Spot check one of them by hand.
    const tl = findEnclosingCycle(segs, at(100, 75))!
    expect(tl.points.map((p) => `${p.x},${p.y}`).sort()).toEqual(['0,0', '0,150', '200,0', '200,150'])
    // All 6 segments are used by one room or another.
    const allIds = new Set<string>()
    for (const pt of [[100, 75], [300, 75], [100, 225], [300, 225]]) {
      for (const id of findEnclosingCycle(segs, at(pt[0], pt[1]))!.segmentIds) allIds.add(id)
    }
    expect([...allIds].sort()).toEqual(['bottom', 'h', 'left', 'right', 'top', 'v'])
  })
})

describe('findEnclosingCycle: dangling walls', () => {
  it('a dangling wall inside a room does not break the room and leaves no spike', () => {
    const segs = [...square4(), seg('spur', 200, 0, 200, 150)]
    const c = findEnclosingCycle(segs, at(100, 200))!
    expect(c).not.toBeNull()
    expect(areaOf(c)).toBe(120000)
    // No spike: a point is never repeated two steps later, and no edge is walked twice in a row.
    for (let i = 0; i < c.points.length; i++) {
      const a = c.points[i], b = c.points[(i + 1) % c.points.length], n = c.points[(i + 2) % c.points.length]
      expect(a.x === n.x && a.y === n.y).toBe(false)
      const forward = `${a.x},${a.y}->${b.x},${b.y}`
      const back = `${n.x},${n.y}->${b.x},${b.y}`
      expect(forward).not.toBe(back)
    }
    // The spur is not part of the room.
    expect(c.segmentIds).not.toContain('spur')
  })

  it('ignores the degenerate face of the dangling edge alone', () => {
    // A spur that hangs in the open: the only face it makes has no area.
    expect(findEnclosingCycle([seg('a', 0, 0, 100, 0)], at(50, 0.5))).toBeNull()
  })

  it('two nested dangling walls are still cleaned', () => {
    const segs = [...square4(), seg('s1', 200, 0, 200, 100), seg('s2', 200, 100, 100, 200)]
    const c = findEnclosingCycle(segs, at(300, 250))!
    expect(areaOf(c)).toBe(120000)
    expect(c.points).toHaveLength(5)
  })
})

describe('findEnclosingCycle: tolerance and gaps', () => {
  const gapped = (gap: number): FaceSegment[] => [
    seg('top', 0, 0, 400, 0),
    seg('right', 400, 0, 400, 300),
    seg('bottom', 400, 300, 0, 300),
    seg('left', 0, 300, 0, gap), // stops `gap` cm short of the top left corner
  ]

  it('closes a 0.5 cm gap with tolCm = 1', () => {
    const c = findEnclosingCycle(gapped(0.5), at(200, 150), 1)
    expect(c).not.toBeNull()
    // The closed corner sits on the first seen point (0,0); the area is almost the full square.
    expect(areaOf(c)).toBeCloseTo(120000, -2)
    expect(Math.abs(120000 - areaOf(c)!)).toBeLessThan(250)
  })

  it('does not close a 0.5 cm gap with tolCm = 0.1', () => {
    expect(findEnclosingCycle(gapped(0.5), at(200, 150), 0.1)).toBeNull()
  })

  it('does not close a 5 cm gap with tolCm = 1 (null)', () => {
    expect(findEnclosingCycle(gapped(5), at(200, 150), 1)).toBeNull()
    expect(findEnclosingCycle(gapped(5), at(200, 150))).toBeNull()
  })

  it('closes a 5 cm gap with tolCm = 10', () => {
    const c = findEnclosingCycle(gapped(5), at(200, 150), 10)
    expect(c).not.toBeNull()
    expect(Math.abs(120000 - areaOf(c)!)).toBeLessThan(2500)
  })
})

describe('findEnclosingCycle: walls not on the axes', () => {
  it('finds a trapezoid room with a slanted side', () => {
    const segs = [
      seg('top', 0, 0, 400, 0),
      seg('slant', 400, 0, 300, 300),
      seg('bottom', 300, 300, 100, 300),
      seg('left', 100, 300, 0, 0),
    ]
    const c = findEnclosingCycle(segs, at(200, 150))!
    expect(areaOf(c)).toBe(90000)
    expect(c.points).toHaveLength(4)
  })

  it('finds both halves of a square split by a slanted wall', () => {
    const segs = [...square4(), seg('slant', 100, 0, 300, 300)]
    const left = findEnclosingCycle(segs, at(50, 150))!
    expect(areaOf(left)).toBe(60000)
    const right = findEnclosingCycle(segs, at(350, 150))!
    expect(areaOf(right)).toBe(60000)
  })

  it('handles a slanted T junction', () => {
    // `slash` goes from the top wall to the bottom wall's corner at (300,300); `half` runs from a
    // point on `slash` down to the bottom wall. It splits the left room in two.
    const segs = [...square4(), seg('slash', 100, 0, 300, 300), seg('half', 200, 150, 200, 300)]
    const right = findEnclosingCycle(segs, at(320, 220))!
    expect(areaOf(right)).toBe(60000)
    const big = findEnclosingCycle(segs, at(150, 250))!
    expect(areaOf(big)).toBe(52500)
    const small = findEnclosingCycle(segs, at(250, 270))!
    expect(areaOf(small)).toBe(7500)
    expect(small.points).toHaveLength(3)
  })
})

describe('findEnclosingCycle: overlapping pieces', () => {
  it('keeps one edge for two segments on the same span and reports the first id', () => {
    const segs = [
      seg('dupB', 0, 0, 400, 0), // same span, first in the array
      seg('dupA', 0, 0, 400, 0),
      seg('right', 400, 0, 400, 300),
      seg('bottom', 400, 300, 0, 300),
      seg('left', 0, 300, 0, 0),
    ]
    const c = findEnclosingCycle(segs, at(200, 150))!
    expect(c.points).toHaveLength(4)
    expect(c.segmentIds.filter((id) => id === 'dupB')).toHaveLength(1)
    expect(c.segmentIds).not.toContain('dupA')
  })

  it('splits a partly overlapping segment at the end of the other one', () => {
    const segs = [seg('top', 0, 0, 400, 0), seg('topB', 100, 0, 400, 0), seg('right', 400, 0, 400, 300), seg('bottom', 400, 300, 0, 300), seg('left', 0, 300, 0, 0)]
    const c = findEnclosingCycle(segs, at(200, 150))!
    expect(areaOf(c)).toBe(120000)
    // No corner at 100,0: nothing connects there, so the two pieces of 'top' are one edge.
    expect(c.points.some((q) => q.x === 100 && q.y === 0)).toBe(false)
  })
})

describe('findEnclosingCycle: several faces around the point', () => {
  it('takes the smallest area when two faces contain the point (nested squares)', () => {
    const segs = [...square4(), seg('i1', 100, 100, 300, 100), seg('i2', 300, 100, 300, 200), seg('i3', 300, 200, 100, 200), seg('i4', 100, 200, 100, 100)]
    // Inside both: the inner square (200 × 100) wins.
    const inner = findEnclosingCycle(segs, at(200, 150))!
    expect(areaOf(inner)).toBe(20000)
    expect(inner.points).toHaveLength(4)
    // In the ring between them: only the outer square contains it.
    const outer = findEnclosingCycle(segs, at(50, 150))!
    expect(areaOf(outer)).toBe(120000)
  })

  it('ignores zero-length segments and duplicate end points', () => {
    const segs = [...square4(), seg('dot', 200, 150, 200, 150), seg('dot2', 0, 0, 0, 0)]
    const c = findEnclosingCycle(segs, at(200, 150), 1)
    // The click point is on the zero-length segments, which add nothing.
    expect(areaOf(c)).toBe(120000)
  })
})

describe('findEnclosingCycle: performance', () => {
  it('handles 300 random segments in under 1000 ms', () => {
    // Deterministic pseudo random lines on a 50 cm grid, so many end points and crossings coincide.
    let s = 12345
    const rnd = () => {
      s = (s * 1103515245 + 12345) & 0x7fffffff
      return s / 0x7fffffff
    }
    const grid = () => Math.round((rnd() * 4000) / 50) * 50
    const segs: FaceSegment[] = []
    for (let i = 0; i < 300; i++) {
      let ax = grid(), ay = grid(), bx = grid(), by = grid()
      if (ax === bx && ay === by) bx = ax + 50
      segs.push({ id: `s${i}`, a: at(ax, ay), b: at(bx, by) })
    }
    const t0 = performance.now()
    const c = findEnclosingCycle(segs, at(2000, 2000), 1)
    const ms = performance.now() - t0
    // No promise on the result (random lines), only on the time.
    expect(c === null || c.points.length >= 3).toBe(true)
    expect(ms).toBeLessThan(1000)
  })

  it('handles a 300-segment grid of rooms in under 1000 ms', () => {
    // 15 × 10 cells of 200 × 200 cm: 300 walls, many rooms.
    const segs: FaceSegment[] = []
    const W = 15, H = 10, step = 200
    for (let i = 0; i <= W; i++) segs.push(seg(`v${i}`, i * step, 0, i * step, H * step))
    for (let j = 0; j <= H; j++) segs.push(seg(`h${j}`, 0, j * step, W * step, j * step))
    const t0 = performance.now()
    const c = findEnclosingCycle(segs, at(300, 300), 1)
    const ms = performance.now() - t0
    expect(c).not.toBeNull()
    expect(areaOf(c)).toBe(40000)
    expect(ms).toBeLessThan(1000)
  })
})
