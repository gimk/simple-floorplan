import { describe, expect, it } from 'vitest'
import { signedArea } from '../../model/geometry'
import type { Artboard, FurnitureItem, Opening, Room } from '../../model/types'
import {
  DEFAULT_WALL_INNER_COLOR, DEFAULT_WALL_OUTER_COLOR, buildScene, clipSpanToHeight, computeWallTargetHeights, splitWallPieces,
} from './buildScene'
import type { WallSegmentData } from './buildScene'

type P = { x: number; y: number }
const box = (x0: number, y0: number, x1: number, y1: number): P[] => [
  { x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 },
] // clockwise on screen (signedArea > 0)
const room = (id: string, vertices: P[], extra: Partial<Room> = {}): Room => ({ id, name: id, vertices, ...extra })
const door = (p: Partial<Opening> = {}): Opening => ({
  id: 'd', kind: 'door', xCm: 200, yCm: 0, angleDeg: 0, widthCm: 90, hinge: 'left', swing: 'in', ...p,
})
const windowOp = (p: Partial<Opening> = {}): Opening => ({
  id: 'w', kind: 'window', xCm: 200, yCm: 0, angleDeg: 0, widthCm: 120, ...p,
})
const item = (p: Partial<FurnitureItem> = {}): FurnitureItem => ({
  id: 'f', name: 'Sofa', shape: 'rect', xCm: 100, yCm: 50, widthCm: 60, depthCm: 40, rotationDeg: 0, color: '#abc', ...p,
})
const board = (p: Partial<Artboard> = {}): Artboard => ({
  id: 'a', name: 'A', xCm: 1000, yCm: 2000, ceilingHeightCm: 250, precisionCm: 1,
  rooms: [], openings: [], furniture: [], ...p,
})
const one = (p: Partial<Artboard> = {}) => board({ rooms: [room('r', box(0, 0, 400, 300))], ...p })
const wallOf = (a: Artboard, id: string) => {
  const w = buildScene(a).walls.find((x) => x.id === id)
  if (!w) throw new Error(`no wall ${id}`)
  return w
}
const twoRooms = (p: Partial<Artboard> = {}) =>
  board({ rooms: [room('A', box(0, 0, 400, 300)), room('B', box(400, 0, 800, 300))], ...p })

describe('coordinate mapping', () => {
  it('maps 2D (x, y) to 3D (X, Z) and ignores the artboard position', () => {
    const s = buildScene(one({ furniture: [item({ xCm: 120, yCm: 70 })] }))
    expect(s.furniture[0].x).toBe(120)
    expect(s.furniture[0].z).toBe(70)
    expect(s.floors[0].vertices[0]).toEqual({ x: 0, z: 0 })
    expect(s.bounds.minX).toBeLessThan(1) // not shifted by xCm = 1000
  })

  it('uses a negative Y rotation for a positive 2D angle', () => {
    const s = buildScene(one({ furniture: [item({ rotationDeg: 90 }), item({ id: 'g', rotationDeg: -45 }), item({ id: 'h' })] }))
    expect(s.furniture[0].rotationY).toBeCloseTo(-Math.PI / 2)
    expect(s.furniture[1].rotationY).toBeCloseTo(Math.PI / 4)
    expect(s.furniture[2].rotationY).toBeCloseTo(0)
  })
})

describe('winding normalization', () => {
  it('gives every floor a positive signed area, clockwise or counter-clockwise input', () => {
    const cw = box(0, 0, 400, 300)
    const ccw = [...cw].reverse()
    for (const verts of [cw, ccw]) {
      const f = buildScene(board({ rooms: [room('r', verts)] })).floors[0]
      expect(signedArea(f.vertices.map((p) => ({ x: p.x, y: p.z })))).toBeGreaterThan(0)
      expect(f.vertices).toHaveLength(4)
    }
  })

  it('points wall outward normals away from the room for both windings', () => {
    const cw = box(0, 0, 400, 300)
    for (const verts of [cw, [...cw].reverse()]) {
      const s = buildScene(board({ rooms: [room('r', verts)] }))
      expect(s.walls).toHaveLength(4)
      for (const w of s.walls) {
        const away = (w.center.x - 200) * w.outwardNormal.x + (w.center.z - 150) * w.outwardNormal.z
        expect(away).toBeGreaterThan(0)
        expect(Math.hypot(w.outwardNormal.x, w.outwardNormal.z)).toBeCloseTo(1)
      }
    }
  })

  it('keeps original edge indices, so wallColors follow their edge', () => {
    const ccw = [...box(0, 0, 400, 300)].reverse()
    const a = board({ rooms: [room('r', ccw, { wallColors: { '1': '#ff0000' } })] })
    const s = buildScene(a)
    expect(s.walls.find((w) => w.edgeIndex === 1)?.innerColor).toBe('#ff0000')
    expect(s.walls.find((w) => w.edgeIndex === 0)?.innerColor).toBe(DEFAULT_WALL_INNER_COLOR)
    expect(s.walls[0].outerColor).toBe(DEFAULT_WALL_OUTER_COLOR)
  })

  it('copies fill, pattern and angle onto the floor', () => {
    const a = board({ rooms: [room('r', box(0, 0, 100, 100), { fill: '#123456', floorPattern: 'wood', floorPatternAngleDeg: 30 })] })
    expect(buildScene(a).floors[0]).toMatchObject({ roomId: 'r', name: 'r', fill: '#123456', floorPattern: 'wood', floorPatternAngleDeg: 30 })
  })
})

describe('walls', () => {
  it('builds thick walls outward from the room edge', () => {
    const w = wallOf(one(), 'r:0') // top edge, (0,0) -> (400,0)
    expect(w.lengthCm).toBeCloseTo(400)
    expect(w.thicknessCm).toBe(10)
    expect(w.heightCm).toBe(250)
    expect(w.outwardNormal).toEqual({ x: 0, z: -1 })
    expect(w.center.x).toBeCloseTo(200)
    expect(w.center.z).toBeCloseTo(-5)
    expect(w.isInterior).toBe(false)
    expect(w.cutawayGroupId).toBe('r:0')
    expect(w.pieces).toEqual([{ u0: 0, u1: 400, y0: 0, y1: 250 }])
  })

  it('uses the artboard thickness and a 6 cm fallback when thickness is 0', () => {
    expect(wallOf(one({ wallThicknessCm: 20 }), 'r:0').thicknessCm).toBe(20)
    expect(wallOf(one({ wallThicknessCm: 0 }), 'r:0').thicknessCm).toBe(6)
  })

  it('skips zero-length edges and rooms with fewer than 3 vertices', () => {
    const s = buildScene(board({ rooms: [
      room('r', [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }]),
      room('line', [{ x: 0, y: 0 }, { x: 10, y: 0 }]),
    ] }))
    expect(s.walls.map((w) => w.id)).toEqual(['r:1', 'r:2', 'r:3'])
    expect(s.floors.map((f) => f.roomId)).toEqual(['r'])
  })
})

describe('wall pieces and openings', () => {
  it('splits a wall into 3 solids around a door', () => {
    const w = wallOf(one({ openings: [door()] }), 'r:0')
    expect(w.pieces).toHaveLength(3)
    expect(w.pieces).toContainEqual({ u0: 0, u1: 155, y0: 0, y1: 250 })
    expect(w.pieces).toContainEqual({ u0: 245, u1: 400, y0: 0, y1: 250 })
    expect(w.pieces).toContainEqual({ u0: 155, u1: 245, y0: 205, y1: 250 })
    expect(w.windowPanes).toEqual([])
  })

  it('splits a wall into 4 solids around a window and emits a glass pane', () => {
    const w = wallOf(one({ openings: [windowOp()] }), 'r:0')
    expect(w.pieces).toHaveLength(4)
    expect(w.pieces).toContainEqual({ u0: 140, u1: 260, y0: 0, y1: 90 })
    expect(w.pieces).toContainEqual({ u0: 140, u1: 260, y0: 210, y1: 250 })
    expect(w.windowPanes).toEqual([{ openingId: 'w', u0: 140, u1: 260, y0: 90, y1: 210 }])
  })

  it('does not emit a pane for a door or an open passage, and cuts a passage like a door', () => {
    const w = wallOf(one({ openings: [door({ id: 'o', kind: 'opening', widthCm: 100 })] }), 'r:0')
    expect(w.windowPanes).toEqual([])
    expect(w.pieces).toContainEqual({ u0: 150, u1: 250, y0: 210, y1: 250 })
  })

  it('handles several openings on one wall', () => {
    const w = wallOf(one({ openings: [door({ id: 'd1', xCm: 80 }), windowOp({ id: 'w1', xCm: 300, widthCm: 100 })] }), 'r:0')
    // door 35..125 (above 205), window 250..350 (below 90, above 210), solids between and after.
    expect(w.pieces).toContainEqual({ u0: 0, u1: 35, y0: 0, y1: 250 })
    expect(w.pieces).toContainEqual({ u0: 35, u1: 125, y0: 205, y1: 250 })
    expect(w.pieces).toContainEqual({ u0: 125, u1: 250, y0: 0, y1: 250 })
    expect(w.pieces).toContainEqual({ u0: 250, u1: 350, y0: 0, y1: 90 })
    expect(w.pieces).toContainEqual({ u0: 250, u1: 350, y0: 210, y1: 250 })
    expect(w.pieces).toContainEqual({ u0: 350, u1: 400, y0: 0, y1: 250 })
    expect(w.pieces).toHaveLength(6)
    expect(w.windowPanes.map((p) => p.openingId)).toEqual(['w1'])
  })

  it('covers the whole wall surface minus the cuts (no gaps, no overlaps)', () => {
    const w = wallOf(one({ openings: [door({ xCm: 80 }), windowOp({ id: 'w1', xCm: 300 })] }), 'r:0')
    const solid = w.pieces.reduce((s, p) => s + (p.u1 - p.u0) * (p.y1 - p.y0), 0)
    expect(solid).toBeCloseTo(400 * 250 - 90 * 205 - 120 * 120)
  })

  it('clamps openings to the ceiling', () => {
    // Door 205 high under a 200 cm ceiling: nothing above it.
    const low = wallOf(one({ ceilingHeightCm: 200, openings: [door()] }), 'r:0')
    expect(low.pieces).toHaveLength(2)
    expect(low.pieces.every((p) => p.y1 <= 200)).toBe(true)
    // Window 90..210 under a 150 cm ceiling: cut to 90..150, no piece above, pane clamped.
    const win = wallOf(one({ ceilingHeightCm: 150, openings: [windowOp()] }), 'r:0')
    expect(win.pieces).toHaveLength(3)
    expect(win.pieces).toContainEqual({ u0: 140, u1: 260, y0: 0, y1: 90 })
    expect(win.windowPanes[0]).toMatchObject({ y0: 90, y1: 150 })
  })

  it('keeps a wall solid when an opening sill is at or above the ceiling', () => {
    const w = wallOf(one({ ceilingHeightCm: 100, openings: [windowOp({ sillCm: 120 })] }), 'r:0')
    expect(w.pieces).toEqual([{ u0: 0, u1: 400, y0: 0, y1: 100 }])
    expect(w.windowPanes).toEqual([])
  })

  it('uses opening sillCm and heightCm overrides', () => {
    const w = wallOf(one({ openings: [windowOp({ sillCm: 50, heightCm: 100 })] }), 'r:0')
    expect(w.pieces).toContainEqual({ u0: 140, u1: 260, y0: 0, y1: 50 })
    expect(w.pieces).toContainEqual({ u0: 140, u1: 260, y0: 150, y1: 250 })
  })

  it('clips an opening that overhangs the end of the wall', () => {
    const w = wallOf(one({ openings: [door({ xCm: 380 })] }), 'r:0')
    expect(w.pieces).toContainEqual({ u0: 0, u1: 335, y0: 0, y1: 250 })
    expect(w.pieces.every((p) => p.u1 <= 400)).toBe(true)
  })

  it('splitWallPieces merges overlapping cuts of different heights', () => {
    const pieces = splitWallPieces(100, 250, [
      { u0: 20, u1: 60, y0: 0, y1: 200 },
      { u0: 40, u1: 80, y0: 100, y1: 250 },
    ])
    expect(pieces).toContainEqual({ u0: 0, u1: 20, y0: 0, y1: 250 })
    expect(pieces).toContainEqual({ u0: 20, u1: 40, y0: 200, y1: 250 })
    expect(pieces).toContainEqual({ u0: 60, u1: 80, y0: 0, y1: 100 })
    expect(pieces).toContainEqual({ u0: 80, u1: 100, y0: 0, y1: 250 })
    expect(pieces).toHaveLength(4)
  })
})

describe('door thresholds', () => {
  it('adds a floor quad across a thick wall at a door, with the room finish', () => {
    const a = one({ openings: [door()] })
    a.rooms[0].fill = '#222222'
    const t = buildScene(a).thresholds
    expect(t).toHaveLength(1)
    expect(t[0].roomId).toBe('r')
    expect(t[0].fill).toBe('#222222')
    const zs = t[0].vertices.map((v) => v.z)
    expect(Math.min(...zs)).toBeCloseTo(-10)
    expect(Math.max(...zs)).toBeCloseTo(0.25)
    const xs = t[0].vertices.map((v) => v.x)
    expect(Math.min(...xs)).toBeCloseTo(155)
    expect(Math.max(...xs)).toBeCloseTo(245)
  })

  it('has none for windows or when walls are thin', () => {
    expect(buildScene(one({ openings: [windowOp()] })).thresholds).toHaveLength(0)
    expect(buildScene(one({ wallThicknessCm: 0, openings: [door()] })).thresholds).toHaveLength(0)
  })
})

const SH = 'shared:A:1|B:3'

describe('touching rooms', () => {
  it('flush rooms share ONE centered interior wall with both paints and no middle seam', () => {
    const a = board({
      rooms: [
        room('A', box(0, 0, 400, 300), { wallColors: { '1': '#ff0000' } }),
        room('B', box(400, 0, 800, 300), { wallColors: { '3': '#00ff00' } }),
      ],
    })
    const sc = buildScene(a)
    const shared = sc.walls.filter((w) => w.isInterior)
    expect(shared).toHaveLength(1)
    const w = shared[0]
    expect(w.id).toBe(SH)
    expect(sc.walls.some((x) => x.id === 'A:1' || x.id === 'B:3')).toBe(false)
    expect(sc.walls).toHaveLength(7) // 3 + 3 exterior + 1 shared
    expect(w.thicknessSide).toBe('centered')
    expect(w.thicknessCm).toBe(6)
    expect(w.center.x).toBeCloseTo(400)
    expect(w.lengthCm).toBeCloseTo(300)
    expect(w.innerColor).toBe('#ff0000')
    expect(w.oppositeColor).toBe('#00ff00')
    expect(w.outerColor).toBe(DEFAULT_WALL_OUTER_COLOR)
    expect(w.cutawayGroupId).toBe(w.id)
    expect(w.pairedWallIds).toEqual(['A:1', 'B:3'])
    // Exterior walls have no opposite colour and sit outward.
    const others = sc.walls.filter((x) => x !== w)
    expect(others.every((x) => !x.isInterior && x.oppositeColor === undefined && x.thicknessCm === 10 && x.thicknessSide === 'outward')).toBe(true)
  })

  it('defaults both faces of the shared wall to the default inner colour', () => {
    const w = buildScene(twoRooms()).walls.find((x) => x.isInterior)!
    expect(w.innerColor).toBe(DEFAULT_WALL_INNER_COLOR)
    expect(w.oppositeColor).toBe(DEFAULT_WALL_INNER_COLOR)
  })

  it('keeps the bounds of two flush rooms free of any protrusion', () => {
    const b = buildScene(twoRooms()).bounds
    expect(b).toMatchObject({ minX: -10, maxX: 810, minZ: -10, maxZ: 310 })
  })

  it('does not share rooms that only touch at a corner or are apart', () => {
    const apart = buildScene(board({ rooms: [room('A', box(0, 0, 400, 300)), room('B', box(500, 0, 900, 300))] }))
    expect(apart.walls.some((w) => w.isInterior)).toBe(false)
    const corner = buildScene(board({ rooms: [room('A', box(0, 0, 400, 300)), room('B', box(400, 300, 800, 600))] }))
    expect(corner.walls.some((w) => w.isInterior)).toBe(false)
    expect(corner.walls).toHaveLength(8)
  })

  it('T-junction: a long wall touching two short rooms gives one shared wall per span and no exterior left', () => {
    const s = buildScene(board({ rooms: [
      room('A', box(0, 0, 400, 300)),
      room('B', box(400, 0, 800, 150)),
      room('C', box(400, 150, 800, 300)),
    ] }))
    const shared = s.walls.filter((w) => w.isInterior)
    // B and C also touch along z = 150: a third shared wall.
    expect(shared.map((w) => w.id).sort()).toEqual(['shared:A:1|B:3', 'shared:A:1|C:3', 'shared:B:2|C:0'])
    const ab = shared.find((w) => w.id === 'shared:A:1|B:3')!
    const ac = shared.find((w) => w.id === 'shared:A:1|C:3')!
    expect(ab.lengthCm).toBeCloseTo(150)
    expect(ac.lengthCm).toBeCloseTo(150)
    expect(ab.cutawayGroupId).not.toBe(ac.cutawayGroupId)
    expect(s.walls.some((w) => w.id.startsWith('A:1'))).toBe(false)
  })

  it('partial overlap: the uncovered part of the long wall stays an exterior wall', () => {
    // Hallway H right edge x = 400, z 0..600. K covers z 0..250, D covers z 250..600 on the east side.
    const s = buildScene(board({ rooms: [
      room('H', box(0, 0, 400, 600)),
      room('K', box(400, 0, 700, 250)),
      room('D', box(400, 250, 700, 600)),
    ] }))
    const shared = s.walls.filter((w) => w.isInterior)
    // H|K (250), H|D (350) and K|D (300, along z = 250).
    expect(shared).toHaveLength(3)
    expect(shared.map((w) => Math.round(w.lengthCm)).sort((a, b) => a - b)).toEqual([250, 300, 350])
    expect(s.walls.filter((w) => !w.isInterior && w.roomId === 'H' && w.edgeIndex === 1)).toHaveLength(0)
    // Shorter neighbour: hallway wall of 600 touching only a 250 cm room leaves 350 cm of exterior wall.
    const t = buildScene(board({ rooms: [room('H', box(0, 0, 400, 600)), room('K', box(400, 0, 700, 250))] }))
    const ext = t.walls.filter((w) => !w.isInterior && w.roomId === 'H' && w.edgeIndex === 1)
    expect(ext).toHaveLength(1)
    expect(ext[0].isInterior).toBe(false)
    expect(ext[0].lengthCm).toBeCloseTo(350)
    expect(ext[0].start.z).toBeCloseTo(250)
    expect(ext[0].end.z).toBeCloseTo(600)
    expect(ext[0].thicknessCm).toBe(10)
    const sh = t.walls.filter((w) => w.isInterior)
    expect(sh).toHaveLength(1)
    expect(sh[0].lengthCm).toBeCloseTo(250)
    // Covered surface: shared + exterior spans add up to the whole 600 cm edge.
    expect(sh[0].lengthCm + ext[0].lengthCm).toBeCloseTo(600)
  })

  it('cuts an opening of one room through the single shared wall', () => {
    const s = buildScene(twoRooms({ openings: [door({ xCm: 400, yCm: 150, angleDeg: 90, roomId: 'A' })] }))
    const w = s.walls.find((x) => x.id === SH)! // (400,0) -> (400,300), u = y
    expect(w.pieces).toHaveLength(3)
    expect(w.pieces).toContainEqual({ u0: 105, u1: 195, y0: 205, y1: 250 })
    expect(w.pieces).toContainEqual({ u0: 0, u1: 105, y0: 0, y1: 250 })
    expect(w.pieces).toContainEqual({ u0: 195, u1: 300, y0: 0, y1: 250 })
  })

  it('cuts the shared wall for an opening hosted by room B and does not double it for two openings', () => {
    const s = buildScene(twoRooms({ openings: [
      door({ id: 'd1', xCm: 400, yCm: 150, angleDeg: 90, roomId: 'A' }),
      door({ id: 'd2', xCm: 400, yCm: 150, angleDeg: 90, roomId: 'B' }),
    ] }))
    const w = s.walls.find((x) => x.id === SH)!
    expect(w.pieces).toHaveLength(3)
  })

  it('emits a window pane once for a window on a shared wall', () => {
    const s = buildScene(twoRooms({ openings: [windowOp({ xCm: 400, yCm: 150, angleDeg: 90, roomId: 'A' })] }))
    expect(s.walls.flatMap((w) => w.windowPanes)).toHaveLength(1)
    expect(s.walls.find((w) => w.id === SH)!.pieces).toHaveLength(4)
  })

  it('makes no door threshold on a flush shared wall', () => {
    const s = buildScene(twoRooms({ openings: [door({ xCm: 400, yCm: 150, angleDeg: 90, roomId: 'A' })] }))
    expect(s.thresholds).toHaveLength(0)
  })
})

describe('corner posts', () => {
  it('puts a post at each convex corner of a rectangle, linked to both walls', () => {
    const s = buildScene(one())
    expect(s.cornerPosts).toHaveLength(4)
    const p0 = s.cornerPosts.find((p) => p.vertexIndex === 0)!
    expect(p0.wallIds).toEqual(['r:3', 'r:0'])
    expect(p0.heightCm).toBe(250)
    expect(p0.roomId).toBe('r')
    // The outside corner of a 90 degree turn is a 10 x 10 square next to the room corner (0,0).
    const key = (v: { x: number; z: number }) => `${Math.round(v.x)},${Math.round(v.z)}`
    expect(p0.vertices.map(key).sort()).toEqual(['-10,-10', '-10,0', '0,-10', '0,0'])
    for (const p of s.cornerPosts) expect(s.walls.map((w) => w.id)).toEqual(expect.arrayContaining(p.wallIds))
  })

  it('follows the wall thickness and works for counter-clockwise rooms', () => {
    const s = buildScene(board({ wallThicknessCm: 20, rooms: [room('r', [...box(0, 0, 400, 300)].reverse())] }))
    expect(s.cornerPosts).toHaveLength(4)
    for (const p of s.cornerPosts) {
      const xs = p.vertices.map((v) => v.x), zs = p.vertices.map((v) => v.z)
      expect((Math.max(...xs) - Math.min(...xs)) * (Math.max(...zs) - Math.min(...zs))).toBeCloseTo(400)
    }
  })

  it('makes no post at a reflex corner of an L-shaped room', () => {
    const l = [
      { x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 150 }, { x: 200, y: 150 }, { x: 200, y: 300 }, { x: 0, y: 300 },
    ]
    const s = buildScene(board({ rooms: [room('L', l)] }))
    expect(s.cornerPosts.map((p) => p.vertexIndex).sort()).toEqual([0, 1, 2, 4, 5])
    expect(s.cornerPosts.some((p) => p.vertexIndex === 3)).toBe(false)
  })

  it('makes none at corners that touch a shared wall', () => {
    const s = buildScene(twoRooms())
    expect(s.cornerPosts.filter((p) => p.roomId === 'A').map((p) => p.vertexIndex).sort()).toEqual([0, 3])
    expect(s.cornerPosts.filter((p) => p.roomId === 'B').map((p) => p.vertexIndex).sort()).toEqual([1, 2])
  })
})

describe('corner posts on degenerate input', () => {
  it('keeps the post at a corner next to a zero-length edge, linked to the real previous wall', () => {
    const s = buildScene(board({ rooms: [room('r', [
      { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 },
    ])] }))
    const p = s.cornerPosts.find((q) => q.vertexIndex === 1)!
    expect(p.wallIds).toEqual(['r:4', 'r:1'])
    expect(s.cornerPosts.some((q) => q.vertexIndex === 0)).toBe(false)
  })

  it('bevels a very sharp corner instead of a long mitre spike', () => {
    const tri = [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 0, y: 40 }]
    const s = buildScene(board({ rooms: [room('t', tri)] }))
    const sharp = s.cornerPosts.find((q) => q.vertexIndex === 1)!
    const reach = Math.max(...sharp.vertices.map((v) => Math.hypot(v.x - 1000, v.z)))
    expect(reach).toBeLessThanOrEqual(6 * 10 + 1e-6)
    expect(sharp.vertices).toHaveLength(3)
  })
})

describe('furniture solids', () => {
  it('builds a rect solid standing on the floor', () => {
    const f = buildScene(one({ furniture: [item({ heightCm: 90 })] })).furniture[0]
    expect(f).toMatchObject({ id: 'f', name: 'Sofa', shape: 'rect', x: 100, y: 45, z: 50, widthCm: 60, depthCm: 40, heightCm: 90, color: '#abc' })
    expect(f.cornerRadiiCm).toEqual([0, 0, 0, 0])
  })

  it('uses the default height when none is set', () => {
    const f = buildScene(one({ furniture: [item()] })).furniture[0]
    expect(f.heightCm).toBe(80)
    expect(f.y).toBe(40)
  })

  it('resolves a single corner radius and clamps it to half the short side', () => {
    expect(buildScene(one({ furniture: [item({ cornerRadiusCm: 8 })] })).furniture[0].cornerRadiiCm).toEqual([8, 8, 8, 8])
    expect(buildScene(one({ furniture: [item({ cornerRadiusCm: 500 })] })).furniture[0].cornerRadiiCm).toEqual([20, 20, 20, 20])
  })

  it('lets per-corner radii win over the single radius, with clamping and sanitising', () => {
    const f = buildScene(one({ furniture: [item({ cornerRadiusCm: 3, cornerRadiiCm: [5, 10, 100, -4] })] })).furniture[0]
    expect(f.cornerRadiiCm).toEqual([5, 10, 20, 0])
  })

  it('mirrors per-corner radii with flipX and flipY', () => {
    const radii: [number, number, number, number] = [1, 2, 3, 4]
    const at = (p: Partial<FurnitureItem>) => buildScene(one({ furniture: [item({ cornerRadiiCm: radii, ...p })] })).furniture[0].cornerRadiiCm
    expect(at({ flipX: true })).toEqual([2, 1, 4, 3])
    expect(at({ flipY: true })).toEqual([4, 3, 2, 1])
    expect(at({ flipX: true, flipY: true })).toEqual([3, 4, 1, 2])
  })

  it('builds a circle solid, fully rounded', () => {
    const f = buildScene(one({ furniture: [item({ shape: 'circle', widthCm: 80, depthCm: 80 })] })).furniture[0]
    expect(f.shape).toBe('circle')
    expect(f.cornerRadiiCm).toEqual([40, 40, 40, 40])
  })

  it('lifts flat items (rugs) by 0.5 cm to avoid z-fighting with the floor', () => {
    const [rug, edge, thick] = buildScene(one({ furniture: [
      item({ id: 'rug', heightCm: 1 }), item({ id: 'edge', heightCm: 2 }), item({ id: 'thick', heightCm: 3 }),
    ] })).furniture
    expect(rug.y).toBeCloseTo(1)
    expect(rug.heightCm).toBe(1)
    expect(edge.y).toBeCloseTo(1.5)
    expect(thick.y).toBeCloseTo(1.5)
    expect(rug.y - rug.heightCm / 2).toBeGreaterThan(0)
    const zero = buildScene(one({ furniture: [item({ heightCm: 0 })] })).furniture[0]
    expect(zero.y).toBeCloseTo(0.5)
  })
})

describe('bounds', () => {
  it('falls back to 400 x 400 centred on the origin for an empty artboard', () => {
    const s = buildScene(board())
    expect(s.bounds).toEqual({
      minX: -200, maxX: 200, minZ: -200, maxZ: 200, centerX: 0, centerZ: 0, sizeX: 400, sizeZ: 400, maxY: 250,
    })
    expect(s.floors).toEqual([])
    expect(s.walls).toEqual([])
    expect(s.cornerPosts).toEqual([])
    expect(s.furniture).toEqual([])
  })

  it('covers the rooms and their outward walls', () => {
    const b = buildScene(one()).bounds
    expect(b).toMatchObject({ minX: -10, maxX: 410, minZ: -10, maxZ: 310, centerX: 200, centerZ: 150, sizeX: 420, sizeZ: 320, maxY: 250 })
  })

  it('grows to include furniture outside the rooms and raises maxY for tall items', () => {
    const b = buildScene(one({ furniture: [item({ xCm: 600, yCm: 100, widthCm: 100, depthCm: 100, heightCm: 400 })] })).bounds
    expect(b.maxX).toBeCloseTo(650)
    expect(b.maxY).toBe(400)
  })

  it('uses the ceiling height as maxY', () => {
    expect(buildScene(one({ ceilingHeightCm: 300 })).bounds.maxY).toBe(300)
  })
})

describe('computeWallTargetHeights', () => {
  const cam = (x: number, z: number, y = 500) => ({ x, y, z })
  const target = { x: 200, y: 0, z: 150 }
  const rectWalls = () => buildScene(one()).walls // r:0 top, r:1 right, r:2 bottom, r:3 left
  const heights = (m: Map<string, number>) => Object.fromEntries(m)

  it("keeps full height in 'on' mode", () => {
    const m = computeWallTargetHeights(rectWalls(), cam(-300, -300), target, 'on')
    expect(heights(m)).toEqual({ 'r:0': 250, 'r:1': 250, 'r:2': 250, 'r:3': 250 })
  })

  it("drops every wall to the curb in 'off' mode, 10 cm by default", () => {
    expect(heights(computeWallTargetHeights(rectWalls(), cam(-300, -300), target, 'off'))).toEqual({
      'r:0': 10, 'r:1': 10, 'r:2': 10, 'r:3': 10,
    })
    const m = computeWallTargetHeights(rectWalls(), cam(0, 0), target, 'off', { curbCm: 4 })
    expect([...m.values()]).toEqual([4, 4, 4, 4])
  })

  it("never raises a wall above its own height in 'off' mode", () => {
    const m = computeWallTargetHeights(buildScene(one({ ceilingHeightCm: 5 })).walls, cam(0, 0), target, 'off')
    expect([...m.values()]).toEqual([5, 5, 5, 5])
  })

  // [camera x, camera z, walls that face the camera]
  const quadrants: [string, number, number, string[]][] = [
    ['north-east', 700, -400, ['r:0', 'r:1']],
    ['north-west', -300, -400, ['r:0', 'r:3']],
    ['south-east', 700, 700, ['r:1', 'r:2']],
    ['south-west', -300, 700, ['r:2', 'r:3']],
  ]
  it.each(quadrants)("cuts the two exterior walls that face the camera in 'cutaway' mode (%s)", (_name, x, z, facing) => {
    const m = computeWallTargetHeights(rectWalls(), cam(x, z), target, 'cutaway')
    for (const id of ['r:0', 'r:1', 'r:2', 'r:3']) expect(m.get(id)).toBe(facing.includes(id) ? 30 : 250)
  })

  it("uses a custom stub height in 'cutaway' mode", () => {
    const m = computeWallTargetHeights(rectWalls(), cam(700, -400), target, 'cutaway', { cutawayStubCm: 50 })
    expect(m.get('r:0')).toBe(50)
    expect(m.get('r:2')).toBe(250)
  })

  it('keeps every wall full when the camera is inside the room', () => {
    const m = computeWallTargetHeights(rectWalls(), cam(200, 150, 300), target, 'cutaway')
    expect([...m.values()]).toEqual([250, 250, 250, 250])
  })

  it('lowers the single interior wall that blocks the view, and only that one', () => {
    const walls = buildScene(twoRooms()).walls
    const m = computeWallTargetHeights(walls, cam(-300, 150), { x: 600, y: 0, z: 150 }, 'cutaway')
    expect(m.get(SH)).toBe(30)
    expect(m.get('A:3')).toBe(30) // exterior wall facing the camera
    expect(m.get('B:1')).toBe(250) // back wall
    expect(m.get('A:0')).toBe(250)
    expect(m.get('B:2')).toBe(250)
  })

  it('keeps an interior wall full when it is not between the camera and the target', () => {
    const walls = buildScene(twoRooms()).walls
    const m = computeWallTargetHeights(walls, cam(600, -500), { x: 600, y: 0, z: 150 }, 'cutaway')
    expect(m.get(SH)).toBe(250)
    expect(m.get('A:0')).toBe(30)
    expect(m.get('B:0')).toBe(30)
  })

  it('does not drop an interior wall when the camera looks over it from high above', () => {
    const walls = buildScene(twoRooms()).walls
    const m = computeWallTargetHeights(walls, { x: -50, y: 3000, z: 150 }, { x: 600, y: 0, z: 150 }, 'cutaway')
    expect(m.get(SH)).toBe(250)
  })

  it('keeps every wall of a room full for a camera straight above the target', () => {
    const walls = buildScene(twoRooms()).walls
    const m = computeWallTargetHeights(walls, { x: 600, y: 2000, z: 150 }, { x: 600, y: 0, z: 150 }, 'cutaway')
    expect([...m.values()]).toEqual(walls.map(() => 250))
  })

  it('covers all walls with one entry each', () => {
    const walls: WallSegmentData[] = buildScene(twoRooms()).walls
    for (const mode of ['on', 'off', 'cutaway'] as const) {
      expect(computeWallTargetHeights(walls, cam(0, 0), target, mode).size).toBe(walls.length)
    }
  })
})

describe('lowered walls keep doorways open', () => {
  it('clips a lintel away when the wall drops to a curb or a cutaway stub', () => {
    const w = wallOf(one({ openings: [door()] }), 'r:0')
    const lintel = w.pieces.find((p) => p.u0 === 155 && p.u1 === 245)!
    expect(lintel.y0).toBe(205)
    for (const h of [10, 30, 205]) expect(clipSpanToHeight(lintel.y0, lintel.y1, h)).toBeNull()
    expect(clipSpanToHeight(lintel.y0, lintel.y1, 220)).toEqual({ y0: 205, y1: 220 })
    expect(clipSpanToHeight(lintel.y0, lintel.y1, 250)).toEqual({ y0: 205, y1: 250 })
  })

  it('has no solid piece in the doorway below the door height, so the door reaches the floor', () => {
    const w = wallOf(one({ openings: [door()] }), 'r:0')
    const inDoor = w.pieces.filter((p) => p.u0 < 245 && p.u1 > 155)
    expect(inDoor.every((p) => p.y0 >= 205)).toBe(true)
  })

  it('clips low window pieces and panes to the wall height', () => {
    const w = wallOf(one({ openings: [windowOp()] }), 'r:0')
    const sill = w.pieces.find((p) => p.y0 === 0 && p.u0 === 140)!
    expect(clipSpanToHeight(sill.y0, sill.y1, 30)).toEqual({ y0: 0, y1: 30 })
    expect(clipSpanToHeight(sill.y0, sill.y1, 10)).toEqual({ y0: 0, y1: 10 })
    const pane = w.windowPanes[0]
    expect(clipSpanToHeight(pane.y0, pane.y1, 30)).toBeNull()
  })

  it('never overlaps pieces of one wall', () => {
    const w = wallOf(one({ openings: [door({ xCm: 80 }), windowOp({ id: 'w1', xCm: 300 })] }), 'r:0')
    for (const a of w.pieces) for (const b of w.pieces) {
      if (a === b) continue
      const ou = Math.min(a.u1, b.u1) - Math.max(a.u0, b.u0), oy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0)
      expect(ou > 1e-6 && oy > 1e-6).toBe(false)
    }
  })
})

describe('rooms separated by a wall-thickness gap', () => {
  const gapped = (gap: number, p: Partial<Artboard> = {}) =>
    board({ rooms: [room('A', box(0, 0, 400, 300)), room('B', box(400 + gap, 0, 800 + gap, 300))], ...p })

  it.each([10, 15, 19])('builds ONE shared wall of %s cm that spans exactly from room A to room B', (gap) => {
    const s = buildScene(gapped(gap))
    const shared = s.walls.filter((w) => w.isInterior)
    expect(shared).toHaveLength(1)
    const w = shared[0]
    expect(w.id).toBe(SH)
    expect(w.thicknessCm).toBeCloseTo(gap)
    expect(w.thicknessSide).toBe('outward')
    expect(w.center.x).toBeCloseTo(400 + gap / 2)
    expect(w.center.x - w.thicknessCm / 2).toBeCloseTo(400) // flush with A's edge
    expect(w.center.x + w.thicknessCm / 2).toBeCloseTo(400 + gap) // flush with B's edge
    expect(w.cutawayGroupId).toBe(w.id)
    expect(s.walls.some((x) => x.id === 'A:1' || x.id === 'B:3')).toBe(false)
    expect(s.walls).toHaveLength(7)
  })

  it('keeps both room paints on the gap wall', () => {
    const s = buildScene(gapped(10, { rooms: [
      room('A', box(0, 0, 400, 300), { wallColors: { '1': '#111111' } }),
      room('B', box(410, 0, 810, 300), { wallColors: { '3': '#222222' } }),
    ] }))
    const w = s.walls.find((x) => x.isInterior)!
    expect(w.innerColor).toBe('#111111')
    expect(w.oppositeColor).toBe('#222222')
  })

  it('keeps two separate full-thickness walls when the gap is two thicknesses or more', () => {
    const s = buildScene(gapped(20))
    expect(s.walls.some((w) => w.isInterior)).toBe(false)
    expect(s.walls.find((w) => w.id === 'A:1')!.thicknessCm).toBe(10)
    expect(s.walls.find((w) => w.id === 'B:3')!.thicknessCm).toBe(10)
  })

  it('cuts a door of room A cleanly through the single gap wall down to the floor', () => {
    const s = buildScene(gapped(10, { openings: [door({ xCm: 400, yCm: 150, angleDeg: 90, roomId: 'A' })] }))
    const w = s.walls.find((x) => x.isInterior)!
    expect(w.pieces.some((p) => p.y0 < 205 && p.u0 < 195 && p.u1 > 105)).toBe(false)
    expect(w.pieces).toContainEqual({ u0: 105, u1: 195, y0: 205, y1: 250 })
    expect(w.pieces).toHaveLength(3)
  })

  it('cuts a door hosted by room B through the same wall, and the doorway floor threshold exists', () => {
    const s = buildScene(gapped(10, { openings: [door({ xCm: 410, yCm: 150, angleDeg: 90, roomId: 'B' })] }))
    const w = s.walls.find((x) => x.isInterior)!
    expect(w.pieces).toContainEqual({ u0: 105, u1: 195, y0: 205, y1: 250 })
    expect(s.thresholds.length).toBeGreaterThan(0)
  })

  it('emits one window pane for a window on a gap wall', () => {
    const s = buildScene(gapped(10, { openings: [windowOp({ xCm: 400, yCm: 150, angleDeg: 90, roomId: 'A' })] }))
    expect(s.walls.flatMap((w) => w.windowPanes)).toHaveLength(1)
  })

  it('lowers and raises the gap wall as one unit in cutaway', () => {
    const walls = buildScene(gapped(10)).walls
    const blocked = computeWallTargetHeights(walls, { x: -300, y: 100, z: 150 }, { x: 600, y: 0, z: 150 }, 'cutaway')
    expect(blocked.get(SH)).toBe(30)
    const free = computeWallTargetHeights(walls, { x: 600, y: 100, z: -500 }, { x: 600, y: 0, z: 150 }, 'cutaway')
    expect(free.get(SH)).toBe(250)
    const above = computeWallTargetHeights(walls, { x: -50, y: 3000, z: 150 }, { x: 600, y: 0, z: 150 }, 'cutaway')
    expect(above.get(SH)).toBe(250)
    // Only one entry for the shared wall: it cannot be half up and half down.
    expect(walls.filter((w) => w.isInterior)).toHaveLength(1)
  })

  it('bounds cover the gap wall without protrusion', () => {
    expect(buildScene(gapped(10)).bounds).toMatchObject({ minX: -10, maxX: 820, minZ: -10, maxZ: 310 })
  })
})
