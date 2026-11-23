import { describe, expect, it } from 'vitest'
import type { Room, WallProps } from './types'
import { buildWallGraph, type WallGraph } from './wallGraph'

type Pt = [number, number]

const room = (id: string, pts: Pt[], walkOrder = 1, walls: Record<string, WallProps> = {}): Room => ({
  id, code: id, name: id,
  vertices: pts.map(([x, y], i) => ({ id: `${id}v${i}`, x, y })),
  holes: [], walls, walkOrder,
})

const props = (type: WallProps['type'], thicknessCm: number, extra: Partial<WallProps> = {}): WallProps =>
  ({ type, thicknessCm, ...extra })

/** Faces of one wall, in output order. */
const facesOf = (g: WallGraph, wallId: string) => g.faces.filter((f) => f.wallId === wallId)

/** The one wall that both rooms see. */
const sharedWall = (g: WallGraph, a: string, b: string) =>
  g.walls.filter((w) => {
    const rooms = new Set(facesOf(g, w.id).map((f) => f.roomId))
    return rooms.has(a) && rooms.has(b)
  })

describe('buildWallGraph', () => {
  // Two rooms side by side. The wall between them is drawn twice (once per room).
  const A2 = room('A', [[0, 0], [300, 0], [300, 400], [0, 400]], 1)
  const B2 = room('B', [[300, 0], [600, 0], [600, 400], [300, 400]], 2)

  it('makes one wall of the two drawn copies of a shared wall', () => {
    const g = buildWallGraph([A2, B2])
    // 4 walls each, one of them shared.
    expect(g.walls).toHaveLength(7)
    const shared = sharedWall(g, 'A', 'B')
    expect(shared).toHaveLength(1)
    const faces = facesOf(g, shared[0].id)
    expect(faces).toHaveLength(2)
    expect(faces.map((f) => f.roomId)).toEqual(['A', 'B'])
    // One face per side, both as long as the wall.
    expect(new Set(faces.map((f) => f.side)).size).toBe(2)
    for (const f of faces) {
      expect(f.from).toBe(0)
      expect(f.to).toBeCloseTo(400, 6)
    }
    expect(shared[0].thicknessCm).toBe(10)
  })

  it('gives every room wall a face in roomFaces', () => {
    const g = buildWallGraph([A2, B2])
    expect(Object.keys(g.roomFaces).sort()).toEqual(['A', 'B'])
    for (const code of ['A', 'B']) {
      expect(g.roomFaces[code]).toHaveLength(4)
      expect(g.roomFaces[code].map((r) => r.wallStart)).toEqual(['Av0', 'Av1', 'Av2', 'Av3'].map((id) => id.replace('Av', `${code}v`)))
      for (const r of g.roomFaces[code]) {
        expect(r.faceIndexes).toHaveLength(1)
        const face = g.faces[r.faceIndexes[0]]
        expect(face.roomId).toBe(code)
      }
    }
    // Both views of the shared wall point at the same two faces.
    const aSide = g.roomFaces.A.find((r) => r.wallStart === 'Av1')!
    const bSide = g.roomFaces.B.find((r) => r.wallStart === 'Bv3')!
    expect(g.faces[aSide.faceIndexes[0]].wallId).toBe(g.faces[bSide.faceIndexes[0]].wallId)
    expect(g.faces[aSide.faceIndexes[0]].side).not.toBe(g.faces[bSide.faceIndexes[0]].side)
  })

  it('takes the max thickness and the properties of the first room in walk order', () => {
    const A = room('A', [[0, 0], [300, 0], [300, 400], [0, 400]], 1, {
      Av1: props('bearing', 12, { locked: true, align: 'center' }),
    })
    const B = room('B', [[300, 0], [600, 0], [600, 400], [300, 400]], 2, {
      Bv3: props('exterior', 20),
    })
    const g = buildWallGraph([A, B])
    const shared = sharedWall(g, 'A', 'B')
    expect(shared).toHaveLength(1)
    expect(shared[0].thicknessCm).toBe(20)
    expect(shared[0].type).toBe('bearing')
    expect(shared[0].locked).toBe(true)
    expect(shared[0].align).toBe('center')
    expect(shared[0].status).toBeUndefined()

    // The same two rooms in walk order B, A: B owns the wall.
    const g2 = buildWallGraph([room('A', [[0, 0], [300, 0], [300, 400], [0, 400]], 2, { Av1: props('bearing', 12) }),
      room('B', [[300, 0], [600, 0], [600, 400], [300, 400]], 1, { Bv3: props('exterior', 20) })])
    const shared2 = sharedWall(g2, 'A', 'B')
    expect(shared2[0].type).toBe('exterior')
    expect(shared2[0].thicknessCm).toBe(20)
  })

  it('splits the faces at a T junction, but keeps one wall', () => {
    // A on top, B and C below, with the wall between A and B+C drawn one time.
    const A = room('A', [[0, 0], [600, 0], [600, 400], [0, 400]], 1)
    const B = room('B', [[0, 400], [300, 400], [300, 600], [0, 600]], 2)
    const C = room('C', [[300, 400], [600, 400], [600, 600], [300, 600]], 3)
    const g = buildWallGraph([A, B, C])
    expect(g.walls).toHaveLength(9)

    const wall = g.walls.find((w) => {
      const ids = new Set(facesOf(g, w.id).map((f) => f.roomId))
      return ids.has('A') && ids.has('B') && ids.has('C')
    })!
    expect(wall).toBeDefined()
    const faces = facesOf(g, wall.id)
    expect(faces).toHaveLength(3)
    // The long side of A is ONE face.
    const sideA = faces.find((f) => f.roomId === 'A')!
    expect(faces.filter((f) => f.side === sideA.side)).toHaveLength(1)
    expect(sideA.from).toBe(0)
    expect(sideA.to).toBeCloseTo(600, 6)
    // The other side has one face per room, in order along the wall.
    const other = faces.filter((f) => f.side !== sideA.side).sort((p, q) => p.from - q.from)
    expect(other.map((f) => f.roomId)).toEqual(['B', 'C'])
    expect(other[0].from).toBe(0)
    expect(other[0].to).toBeCloseTo(300, 6)
    expect(other[1].from).toBeCloseTo(300, 6)
    expect(other[1].to).toBeCloseTo(600, 6)

    // The T point is a node, and the wall that ends there sees it.
    const t = g.nodes.find((n) => Math.abs(n.x - 300) < 1 && Math.abs(n.y - 400) < 1)!
    expect(t).toBeDefined()
    const nodeIds = new Set(g.walls.flatMap((w) => [w.a, w.b]))
    expect(nodeIds.has(t.id)).toBe(true)
    expect([wall.a, wall.b]).not.toContain(t.id)
  })

  it('cuts the two faces of a side at the T junction when the rooms overlap a little', () => {
    // B and C are drawn 4 cm into each other: their faces are cut at the T point, not at random.
    const A = room('A', [[0, 0], [600, 0], [600, 400], [0, 400]], 1)
    const B = room('B', [[0, 400], [302, 400], [302, 600], [0, 600]], 2)
    const C = room('C', [[298, 400], [600, 400], [600, 600], [298, 600]], 3)
    const g = buildWallGraph([A, B, C])
    const wall = g.walls.find((w) => {
      const ids = new Set(facesOf(g, w.id).map((f) => f.roomId))
      return ids.has('A') && ids.has('B') && ids.has('C')
    })!
    expect(wall).toBeDefined()
    const faces = facesOf(g, wall.id)
    expect(faces).toHaveLength(3)
    const below = faces.filter((f) => f.roomId === 'B' || f.roomId === 'C').sort((p, q) => p.from - q.from)
    expect(below.map((f) => f.roomId)).toEqual(['B', 'C'])
    expect(below[0].to).toBeCloseTo(300, 6)
    expect(below[1].from).toBeCloseTo(300, 6)
  })

  it('gives outside faces to a lone room', () => {
    const g = buildWallGraph([room('A', [[0, 0], [300, 0], [300, 400], [0, 400]])])
    expect(g.walls).toHaveLength(4)
    expect(g.faces).toHaveLength(8)
    for (const w of g.walls) {
      const faces = facesOf(g, w.id)
      const inside = faces.filter((f) => f.roomId === 'A')
      const outside = faces.filter((f) => f.roomId === undefined)
      expect(inside).toHaveLength(1)
      expect(outside).toHaveLength(1)
      expect(inside[0].side).not.toBe(outside[0].side)
      for (const f of faces) {
        expect(f.from).toBe(0)
        expect(f.to).toBeGreaterThan(1)
      }
    }
    expect(g.conflicts).toEqual([])
  })

  it('keeps a wall that is not horizontal or vertical as its own wall', () => {
    // One slanted wall (400,400) -> (0,300).
    const g = buildWallGraph([room('A', [[0, 0], [400, 0], [400, 400], [0, 300]])])
    expect(g.walls).toHaveLength(4)
    const slant = g.walls.find((w) => {
      const n = new Map(g.nodes.map((x) => [x.id, x]))
      const a = n.get(w.a)!, b = n.get(w.b)!
      return Math.abs(b.x - a.x) > 1 && Math.abs(b.y - a.y) > 1
    })!
    expect(slant).toBeDefined()
    const faces = facesOf(g, slant.id)
    expect(faces).toHaveLength(2)
    expect(new Set(faces.map((f) => f.side)).size).toBe(2)
    expect(faces.map((f) => f.roomId).sort()).toEqual(['A', undefined].sort())
    expect(faces[0].to).toBeCloseTo(Math.hypot(400, 100), 2)
  })

  it('makes one wall of the two drawn copies of a wall at an angle', () => {
    // Two rooms side by side, the wall between them at about 10 degrees (docs/walls-plan.md 4b).
    const A = room('A', [[0, 0], [304, 0], [375, 398], [0, 398]], 1)
    const B = room('B', [[304, 0], [601, 0], [601, 398], [375, 398]], 2)
    const g = buildWallGraph([A, B])
    const shared = sharedWall(g, 'A', 'B')
    expect(shared).toHaveLength(1)
    const faces = facesOf(g, shared[0].id)
    expect(faces.map((f) => f.roomId).sort()).toEqual(['A', 'B'])
    expect(new Set(faces.map((f) => f.side)).size).toBe(2)
    for (const f of faces) expect(f.to).toBeCloseTo(Math.hypot(71, 398), 1)
    // The centre line is the mean of the two drawn lines: the same line here.
    const byId = new Map(g.nodes.map((n) => [n.id, n]))
    expect(byId.get(shared[0].a)!.x).toBeCloseTo(304, 6)
    expect(byId.get(shared[0].b)!.x).toBeCloseTo(375, 6)
  })

  it('keeps two walls apart when they are more than 2 degrees from parallel', () => {
    // The same two rooms, but B's left wall is 5 degrees away from A's right wall.
    const A = room('A', [[0, 0], [304, 0], [375, 398], [0, 398]], 1)
    const B = room('B', [[304, 0], [601, 0], [601, 398], [402, 398]], 2)
    const g = buildWallGraph([A, B])
    expect(sharedWall(g, 'A', 'B')).toEqual([])
    // Every room keeps its 4 walls, and no pair is reported: the two walls are not candidates
    // to be one wall, because they are not parallel.
    expect(g.walls).toHaveLength(8)
    expect(g.conflicts).toEqual([])
  })

  it('makes one wall of two in-line walls of one room', () => {
    // A straight corner at (200, 0): walls 1 and 2 are on one line.
    const g = buildWallGraph([room('A', [[0, 0], [200, 0], [400, 0], [400, 400], [0, 400]])])
    expect(g.walls).toHaveLength(4)
    const top = g.walls.find((w) => {
      const faces = facesOf(g, w.id).filter((f) => f.roomId === 'A')
      return faces.length === 1 && faces[0].to === 400
    })
    expect(top).toBeDefined()
    // Both room walls point at the one face of the merged wall.
    const refs = g.roomFaces.A
    expect(refs).toHaveLength(5)
    expect(refs[0].faceIndexes).toEqual(refs[1].faceIndexes)
  })

  it('puts the centre line of a shared wall between the two drawn lines', () => {
    // The two copies of the wall are drawn 20 cm apart: one wall at x = 310.
    const A = room('A', [[0, 0], [300, 0], [300, 400], [0, 400]], 1)
    const B = room('B', [[320, 0], [620, 0], [620, 400], [320, 400]], 2)
    const g = buildWallGraph([A, B])
    const shared = sharedWall(g, 'A', 'B')
    expect(shared).toHaveLength(1)
    const byId = new Map(g.nodes.map((n) => [n.id, n]))
    expect(byId.get(shared[0].a)!.x).toBeCloseTo(310, 6)
    expect(byId.get(shared[0].b)!.x).toBeCloseTo(310, 6)
    // A wider tolerance keeps the two drawn lines as two walls.
    expect(sharedWall(buildWallGraph([A, B], { pairTolCm: 10 }), 'A', 'B')).toEqual([])
  })

  it('puts the line of a merged wall at the exact mean of copies under 1 cm apart', () => {
    // The two copies of the wall are drawn 1,5 cm apart, so their ends are under the 1 cm node snap
    // of the corner walls: the node is the crossing of the centre lines, not the first end found.
    const A = room('A', [[0, 0], [300, 0], [300, 400], [0, 400]], 1)
    const B = room('B', [[301.5, 0], [601.5, 0], [601.5, 400], [301.5, 400]], 2)
    const g = buildWallGraph([A, B])
    const shared = sharedWall(g, 'A', 'B')
    expect(shared).toHaveLength(1)
    const byId = new Map(g.nodes.map((n) => [n.id, n]))
    expect(byId.get(shared[0].a)!.x).toBeCloseTo(300.75, 6)
    expect(byId.get(shared[0].b)!.x).toBeCloseTo(300.75, 6)
    // The corner of both rooms is on that line too, so no room is left on a copy.
    for (const f of facesOf(g, shared[0].id)) expect(f.to).toBeCloseTo(400, 6)
  })

  it('reports two facing walls that cannot be one wall', () => {
    // B and C are drawn 10 cm apart on the same side of A, so C cannot join the wall of A and B.
    const A = room('A', [[0, 0], [600, 0], [600, 400], [0, 400]], 1)
    const B = room('B', [[0, 400], [300, 400], [300, 600], [0, 600]], 2)
    const C = room('C', [[300, 410], [600, 410], [600, 610], [300, 610]], 3)
    const g = buildWallGraph([A, B, C])
    const c = g.conflicts.filter((x) => x.kind === 'unpaired-near')
    expect(c.length).toBeGreaterThan(0)
    expect(c[0].roomIds.sort()).toEqual(['A', 'C'])
    expect(c[0].detail).toMatch(/face each other/)
  })

  it('is deterministic for the same input, in any array order', () => {
    const make = () => [
      room('A', [[0, 0], [300, 0], [300, 400], [0, 400]], 1),
      room('B', [[300, 0], [600, 0], [600, 400], [300, 400]], 2),
      room('C', [[300, 400], [600, 400], [600, 800], [300, 800]], 3),
    ]
    const one = buildWallGraph(make())
    const two = buildWallGraph(make())
    expect(two).toEqual(one)
    // The order of the rooms in the array does not change the graph.
    expect(buildWallGraph(make().reverse())).toEqual(one)
    expect(buildWallGraph([make()[1], make()[2], make()[0]])).toEqual(one)
    // The ids are built from the room and vertex ids.
    expect(one.nodes.every((n) => n.id.startsWith('n:'))).toBe(true)
    expect(one.walls.every((w) => w.id.startsWith('w:'))).toBe(true)
    expect(new Set(one.nodes.map((n) => n.id)).size).toBe(one.nodes.length)
    expect(new Set(one.walls.map((w) => w.id)).size).toBe(one.walls.length)
  })

  it('gives one node where four walls meet', () => {
    // A 2 x 2 grid. The four walls of the cross meet at (300, 400).
    const g = buildWallGraph([
      room('A', [[0, 0], [300, 0], [300, 400], [0, 400]], 1),
      room('B', [[300, 0], [600, 0], [600, 400], [300, 400]], 2),
      room('C', [[0, 400], [300, 400], [300, 800], [0, 800]], 3),
      room('D', [[300, 400], [600, 400], [600, 800], [300, 800]], 4),
    ])
    expect(g.nodes).toHaveLength(9)
    const cross = g.nodes.filter((n) => Math.abs(n.x - 300) < 1 && Math.abs(n.y - 400) < 1)
    expect(cross).toHaveLength(1)
    expect(g.walls.filter((w) => w.a === cross[0].id || w.b === cross[0].id)).toHaveLength(4)

    // The wall at y = 400 is drawn as two halves: no room wall crosses the T point, so the two
    // halves do not overlap and stay two walls (same rule as the solver).
    const byId = new Map(g.nodes.map((n) => [n.id, n]))
    const at400 = g.walls.filter((w) => Math.abs(byId.get(w.a)!.y - 400) < 1 && Math.abs(byId.get(w.b)!.y - 400) < 1)
    expect(at400).toHaveLength(2)
    for (const w of at400) {
      const faces = facesOf(g, w.id).sort((p, q) => (p.side < q.side ? -1 : 1))
      expect(faces).toHaveLength(2)
      expect(new Set(faces.map((f) => f.side)).size).toBe(2)
      expect(faces.map((f) => f.roomId)).toHaveLength(2)
    }
    expect(g.conflicts).toEqual([])
  })

  it('reports two rooms drawn on top of each other on the same side', () => {
    // The same room drawn two times, 30 cm off: the walls lie on the same side of each other.
    const A = room('A', [[0, 0], [300, 0], [300, 400], [0, 400]], 1)
    const B = room('B', [[30, 30], [330, 30], [330, 430], [30, 430]], 2)
    const g = buildWallGraph([A, B])
    // Same side: no pair can be one wall, so the 8 drawn walls stay 8 walls.
    expect(g.walls).toHaveLength(8)
    expect(g.conflicts.every((x) => x.kind === 'same-side-overlap')).toBe(true)
    const c = g.conflicts.filter((x) => x.kind === 'same-side-overlap')
    expect(c.length).toBeGreaterThan(0)
    expect(c[0].roomIds.sort()).toEqual(['A', 'B'])
    expect(c[0].detail).toMatch(/overlap/)
  })

  it('does not report a clean plan', () => {
    const A = room('A', [[0, 0], [600, 0], [600, 400], [0, 400]], 1)
    const B = room('B', [[0, 400], [300, 400], [300, 600], [0, 600]], 2)
    const C = room('C', [[300, 400], [600, 400], [600, 600], [300, 600]], 3)
    expect(buildWallGraph([A, B, C]).conflicts).toEqual([])
  })
})
