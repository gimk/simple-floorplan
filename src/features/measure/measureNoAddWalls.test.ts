// Entering a measurement in Measuring Mode must never add walls or create overlaps, and typing a
// value never moves the plan (docs/solver-plan.md: no auto-apply). Applying the values is a
// separate action (the button at the bottom of the mode), and that must not add walls either.
import { describe, expect, it } from 'vitest'
import { cross, dist, dot, sub } from '../../model/geometry'
import { emptyDoc, useDoc } from '../../model/store'
import type { PlanDoc, Room, StoredNode, StoredWall } from '../../model/types'
import { deriveWallFaces, materializeRooms } from '../../model/v2/materialize'
import { overlaps } from '../../model/v2/overlapHelper'
import { applyMeasuredAll } from '../rooms/apply'
import { installMeasureRules } from '../rooms/measureRules'
import { setMeasurement, setRunMeasurement } from './actions'
import { measureRows } from './logic'

function finalizeV2(nodes: StoredNode[], walls: StoredWall[], rooms: Room[]): PlanDoc {
  const base: PlanDoc = { ...emptyDoc(), schemaVersion: 2, nodes, walls, rooms }
  const withFaces: PlanDoc = { ...base, walls: deriveWallFaces(base) }
  return { ...withFaces, rooms: materializeRooms(withFaces) }
}

/**
 * Room R1 (300 x 235.5) whose right side (x = 300) is split at N2 (y = 200.5) by a T-junction
 * where an outside wall W_ext meets it.
 */
function tSplitDoc(): PlanDoc {
  const nodes: StoredNode[] = [
    { id: 'N0', x: 0, y: 0 },
    { id: 'N1', x: 300, y: 0 },
    { id: 'N2', x: 300, y: 200.5 },
    { id: 'N3', x: 300, y: 235.5 },
    { id: 'N4', x: 0, y: 235.5 },
    { id: 'N5', x: 500, y: 200.5 },
  ]
  const wall = (id: string, a: string, b: string, standalone?: boolean): StoredWall => ({
    id, a, b, faces: [], type: 'partition', thicknessCm: 10, ...(standalone ? { standalone: true } : {}),
  })
  const walls: StoredWall[] = [
    wall('W1', 'N0', 'N1'),
    wall('W2', 'N1', 'N2'),
    wall('W3', 'N2', 'N3'),
    wall('W4', 'N3', 'N4'),
    wall('W5', 'N4', 'N0'),
    wall('W_ext', 'N2', 'N5', true),
  ]
  const room: Room = {
    id: 'r1', code: 'R1', name: 'Kitchen', walkOrder: 0, vertices: [], holes: [], walls: {},
    cycle: [
      { wallId: 'W1', side: 'L', from: 0, to: 300, cornerId: 'v0' },
      { wallId: 'W2', side: 'L', from: 0, to: 200.5, cornerId: 'v1' },
      { wallId: 'W3', side: 'L', from: 0, to: 35, cornerId: 'v2' },
      { wallId: 'W4', side: 'L', from: 0, to: 300, cornerId: 'v3' },
      { wallId: 'W5', side: 'L', from: 0, to: 235.5, cornerId: 'v4' },
    ],
  }
  return finalizeV2(nodes, walls, [room])
}

/**
 * Same geometry, but the right side is ONE stored wall W_right (N1 -> N3) with two faces on R1's
 * side meeting at interior T-junction node N2 (where W_ext starts).
 */
function unsplitHostTDoc(): PlanDoc {
  const nodes: StoredNode[] = [
    { id: 'N0', x: 0, y: 0 },
    { id: 'N1', x: 300, y: 0 },
    { id: 'N2', x: 300, y: 200.5 },
    { id: 'N3', x: 300, y: 235.5 },
    { id: 'N4', x: 0, y: 235.5 },
    { id: 'N5', x: 500, y: 200.5 },
  ]
  const wall = (id: string, a: string, b: string, standalone?: boolean): StoredWall => ({
    id, a, b, faces: [], type: 'partition', thicknessCm: 10, ...(standalone ? { standalone: true } : {}),
  })
  const walls: StoredWall[] = [
    wall('W1', 'N0', 'N1'),
    wall('W_right', 'N1', 'N3'),
    wall('W4', 'N3', 'N4'),
    wall('W5', 'N4', 'N0'),
    wall('W_ext', 'N2', 'N5', true),
  ]
  const room: Room = {
    id: 'r1', code: 'R1', name: 'Kitchen', walkOrder: 0, vertices: [], holes: [], walls: {},
    cycle: [
      { wallId: 'W1', side: 'L', from: 0, to: 300, cornerId: 'v0' },
      { wallId: 'W_right', side: 'L', from: 0, to: 200.5, cornerId: 'v1' },
      { wallId: 'W_right', side: 'L', from: 200.5, to: 235.5, cornerId: 'v2' },
      { wallId: 'W4', side: 'L', from: 0, to: 300, cornerId: 'v3' },
      { wallId: 'W5', side: 'L', from: 0, to: 235.5, cornerId: 'v4' },
    ],
  }
  return finalizeV2(nodes, walls, [room])
}

/** The Apply button's action: one undo step, the same path as src/features/measure/ApplyMeasuredButton.tsx. */
function applyAll() {
  const doc = useDoc.getState().doc
  const r = applyMeasuredAll(doc)
  if (r.doc !== doc) useDoc.getState().update(() => r.doc)
}

function distToLine(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const len = dist(a, b)
  if (len < 1e-6) return dist(p, a)
  const d = { x: (b.x - a.x) / len, y: (b.y - a.y) / len }
  return Math.abs(cross(d, sub(p, a)))
}

describe('measuring in v2 never adds walls', () => {
  it('measuring the first piece of a T-split wall with the whole side length adds no wall and keeps the T node on the line', () => {
    installMeasureRules()
    const before = tSplitDoc()
    useDoc.setState({ doc: before })
    const beforeIds = (before.walls ?? []).map((w) => w.id)

    setMeasurement('R1-2', 235.5)
    // Typing alone moves nothing.
    expect(useDoc.getState().doc.nodes).toEqual(before.nodes)
    applyAll()

    const after = useDoc.getState().doc
    expect((after.walls ?? []).map((w) => w.id)).toEqual(beforeIds)
    expect(overlaps(after)).toEqual([])
    expect(after.rooms[0].vertices).toHaveLength(5)

    const pos = new Map((after.nodes ?? []).map((n) => [n.id, n]))
    const n1 = pos.get('N1')!
    const n2 = pos.get('N2')!
    const n3 = pos.get('N3')!
    expect(distToLine(n2, n1, n3)).toBeLessThan(0.01)
    const dir = { x: (n3.x - n1.x) / dist(n1, n3), y: (n3.y - n1.y) / dist(n1, n3) }
    const along = dot(sub(n2, n1), dir)
    expect(along).toBeGreaterThan(0)
    expect(along).toBeLessThan(dist(n1, n3))
  })

  it('measuring an unsplit wall with an interior T-junction node adds no wall and slides the T node along the wall line', () => {
    installMeasureRules()
    const before = unsplitHostTDoc()
    useDoc.setState({ doc: before })
    const beforeIds = (before.walls ?? []).map((w) => w.id)

    const row = measureRows(before.rooms[0]).find((r) => r.labels.length === 2)!
    setRunMeasurement(row, 260)
    // Typing alone moves nothing.
    expect(useDoc.getState().doc.nodes).toEqual(before.nodes)
    applyAll()

    const after = useDoc.getState().doc
    expect((after.walls ?? []).map((w) => w.id)).toEqual(beforeIds)
    expect(overlaps(after)).toEqual([])

    const pos = new Map((after.nodes ?? []).map((n) => [n.id, n]))
    const n1 = pos.get('N1')!
    const n2 = pos.get('N2')!
    const n3 = pos.get('N3')!
    expect(distToLine(n2, n1, n3)).toBeLessThan(0.01)
    const along = dot(sub(n2, n1), { x: (n3.x - n1.x) / dist(n1, n3), y: (n3.y - n1.y) / dist(n1, n3) })
    expect(along).toBeGreaterThan(0)
    expect(along).toBeLessThan(dist(n1, n3))
  })
})
