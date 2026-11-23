// Values of stored walls: labels, facade test, walls at the two ends, and the values of a wall
// that is gone (docs/walls-plan.md phase 5b). Pure, cm.
import { describe, expect, it } from 'vitest'
import { syncStoredGraph } from './storedGraph'
import type { Measurement, PlanDoc, Room, StoredWall } from './types'
import {
  firstRoomFace, outsideFaceSide, parseWallValueLabel, removedWallIds, removedWallValues,
  storedWallOfRoomWall, wallCentreCm, wallEnds, wallOutsidePlanCm, wallValueLabel,
} from './wallValues'

/** A room with a thickness per wall (by wall index), default 20 cm. */
const room = (id: string, pts: [number, number][], thicknessOf: Record<number, number> = {}): Room => ({
  id, code: id, name: id, holes: [], walkOrder: 1,
  vertices: pts.map(([x, y], i) => ({ id: `${id}v${i}`, x, y })),
  walls: Object.fromEntries(
    pts.map((_, i) => [`${id}v${i}`, { type: 'partition' as const, thicknessCm: thicknessOf[i] ?? 20 }]),
  ),
})

/**
 * Two rooms side by side: A = x 0..300, C = x 300..600, y 0..400.
 * Their outer walls are 20 cm, the wall between them 10 cm (wall 1 of A, wall 3 of C).
 */
const rooms = (): Room[] => [
  room('A', [[0, 0], [300, 0], [300, 400], [0, 400]], { 1: 10 }),
  room('C', [[300, 0], [600, 0], [600, 400], [300, 400]], { 3: 10 }),
]

const graph = (rs: Room[]) => syncStoredGraph(undefined, rs)

/** Stored wall that the room wall `wallStart` of `roomId` is part of. */
const wallOf = (walls: StoredWall[], roomId: string, wallStart: string) =>
  walls.find((w) => w.faces.some((f) => f.roomId === roomId && f.wallStart === wallStart))!

describe('wall value labels', () => {
  it('builds and reads the two labels of a wall', () => {
    expect(wallValueLabel('W12', 'centre')).toBe('W12-C')
    expect(wallValueLabel('W12', 'outside')).toBe('W12-E')
    expect(parseWallValueLabel('W12-C')).toEqual({ wallId: 'W12', kind: 'centre' })
    expect(parseWallValueLabel('W12-E')).toEqual({ wallId: 'W12', kind: 'outside' })
  })

  it('refuses every other label', () => {
    for (const label of ['W12', 'W12-T', 'W-C', 'SE-2', 'w12-c', 'W12-CC', '']) {
      expect(parseWallValueLabel(label)).toBeNull()
    }
  })
})

describe('facade walls', () => {
  const rs = rooms()
  const { walls, nodes } = graph(rs)

  it('has an outside face on the side that no room covers', () => {
    // The top wall of A: room A on the L side, no room on the R side.
    const top = wallOf(walls, 'A', 'Av0')
    const centre = wallCentreCm(nodes, top)!
    expect(centre).toBeCloseTo(300, 0)
    expect(outsideFaceSide(top, centre)).toBe('R')
  })

  it('has no outside face when a room is on both sides', () => {
    const middle = wallOf(walls, 'A', 'Av1')
    const centre = wallCentreCm(nodes, middle)!
    expect(outsideFaceSide(middle, centre)).toBeNull()
  })

  it('gives the walls at the two ends, with their thicknesses', () => {
    const top = wallOf(walls, 'A', 'Av0')
    const ends = wallEnds(rs, nodes, top)
    // The a end is the left wall of A (20 cm), the b end the wall between A and C (10 cm).
    expect(ends.a).not.toBeNull()
    expect(ends.b).not.toBeNull()
    expect(ends.a!.roomId).toBe('A')
    expect(ends.a!.thicknessCm).toBe(20)
    expect(ends.b!.roomId).toBe('A')
    expect(ends.b!.thicknessCm).toBe(10)
  })

  it('gives the outside length from outside corner to outside corner', () => {
    const top = wallOf(walls, 'A', 'Av0')
    // 300 cm of centre line, plus half of the 20 cm left wall and half of the 10 cm middle wall.
    expect(wallOutsidePlanCm(rs, nodes, top)).toBeCloseTo(315, 6)
  })

  it('gives no end wall at an end that no room wall passes through', () => {
    // One room (walls 20 cm). A stored wall that runs on past the room has a free b end.
    const rs2 = [room('S', [[0, 0], [300, 0], [300, 200], [0, 200]])]
    const g = graph(rs2)
    const top = wallOf(g.walls, 'S', 'Sv0')
    const nodes2 = [...g.nodes, { id: 'FAR', x: 600, y: 0 }]
    const ends = wallEnds(rs2, nodes2, { ...top, b: 'FAR' })
    expect(ends.a).not.toBeNull()
    expect(ends.b).toBeNull()
    // No outside corner at the b end: the planned outside length falls back to the centre length
    // plus the half thickness of the only end wall that is known.
    expect(wallOutsidePlanCm(rs2, nodes2, { ...top, b: 'FAR' })).toBeCloseTo(600 + 10, 6)
  })
})

describe('the stored wall of a room wall', () => {
  const rs = rooms()
  const { walls, nodes } = graph(rs)

  it('finds the wall by its face keys', () => {
    expect(storedWallOfRoomWall({ rooms: rs, walls, nodes }, 'A', 'Av1')!.id).toBe(
      storedWallOfRoomWall({ rooms: rs, walls, nodes }, 'C', 'Cv3')!.id,
    )
  })

  it('finds the wall by geometry when its face carries the other room wall in line', () => {
    // Room S has an extra corner in line on its top wall: the two room walls are one stored wall,
    // and its face carries the start vertex of one of them only.
    const rs2 = [room('S', [[0, 0], [150, 0], [300, 0], [300, 200], [0, 200]])]
    const g = graph(rs2)
    const first = storedWallOfRoomWall({ rooms: rs2, walls: g.walls, nodes: g.nodes }, 'S', 'Sv0')!
    const second = storedWallOfRoomWall({ rooms: rs2, walls: g.walls, nodes: g.nodes }, 'S', 'Sv1')!
    expect(second.id).toBe(first.id)
    expect(wallCentreCm(g.nodes, first)).toBeCloseTo(300, 6)
  })

  it('gives null for a wall that is not in the plan', () => {
    expect(storedWallOfRoomWall({ rooms: rs, walls, nodes }, 'A', 'nope')).toBeNull()
    expect(firstRoomFace({ id: 'W9', a: 'N1', b: 'N2', faces: [] })).toBeNull()
  })
})

describe('values of a wall that is gone', () => {
  const rs = rooms()
  const before = graph(rs)
  /** The same rooms without `C`: its walls leave the graph. */
  const after = graph([rs[0]])

  const measurement = (label: string, actualCm: number): Measurement => ({ label, actualCm, updatedAt: 'now' })

  it('lists the ids that the new graph does not have', () => {
    const gone = removedWallIds(before, after)
    expect(gone.length).toBeGreaterThan(0)
    expect(gone.every((id) => !after.walls.some((w) => w.id === id))).toBe(true)
  })

  it('moves the centre and outside values of a gone wall to the old values', () => {
    const rightWall = wallOf(before.walls, 'C', 'Cv1')
    const measurements: PlanDoc['measurements'] = {
      [`${rightWall.id}-C`]: measurement(`${rightWall.id}-C`, 400),
      [`${rightWall.id}-E`]: measurement(`${rightWall.id}-E`, 420),
      'A-1': measurement('A-1', 280),
    }
    const moved = removedWallValues(before, { walls: after.walls, measurements })!
    expect(Object.keys(moved.measurements)).toEqual(['A-1'])
    expect(moved.dropped.map((d) => d.measurement.label).sort()).toEqual(
      [`${rightWall.id}-C`, `${rightWall.id}-E`],
    )
    expect(moved.dropped.every((d) => d.reason === 'wall-removed' && d.roomCode === '')).toBe(true)
  })

  it('keeps the values of a wall that keeps its id', () => {
    const kept = wallOf(after.walls, 'A', 'Av1')
    const measurements: PlanDoc['measurements'] = { [`${kept.id}-C`]: measurement(`${kept.id}-C`, 400) }
    expect(removedWallValues(before, { walls: after.walls, measurements })).toBeNull()
  })

  it('changes nothing when no wall is gone', () => {
    const measurements: PlanDoc['measurements'] = { 'A-1': measurement('A-1', 280) }
    expect(removedWallValues(before, { walls: before.walls, measurements })).toBeNull()
  })
})
