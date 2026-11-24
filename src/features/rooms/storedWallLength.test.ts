// Drawn length of a stored wall (decision (f)): the card field moves the far end of the wall, so a
// single wall (no room face) can be given its real length on the plan.
import { describe, expect, it } from 'vitest'
import { dist } from '../../model/geometry'
import type { PlanDoc, Room } from '../../model/types'
import { convertToV2 } from '../../model/v2/convert'
import { removeRoom } from '../../model/v2/write'
import { setStoredWallLength } from './cards'

const mk = (id: string, pts: [number, number][], walkOrder: number): Room => ({
  id,
  code: id,
  name: id,
  vertices: pts.map(([x, y], i) => ({ id: `${id}-v${i}`, x, y })),
  holes: [],
  walls: {},
  walkOrder,
})

const plan = (): PlanDoc =>
  convertToV2({
    projectId: 'p',
    title: 't',
    rooms: [
      mk('A', [[0, 0], [400, 0], [400, 300], [0, 300]], 1),
      mk('B', [[0, 300], [400, 300], [400, 600], [0, 600]], 2),
    ],
    elements: [],
    measurements: {},
    roomNotes: {},
    tapes: [],
  }).doc

const nodesOf = (doc: PlanDoc, wallId: string) => {
  const wall = doc.walls!.find((w) => w.id === wallId)!
  return { a: doc.nodes!.find((n) => n.id === wall.a)!, b: doc.nodes!.find((n) => n.id === wall.b)! }
}

describe('setStoredWallLength', () => {
  it('moves the far end of the wall along the wall, and keeps the near end', () => {
    const doc = plan()
    const wallId = doc.walls![0].id
    const before = nodesOf(doc, wallId)
    const next = setStoredWallLength(doc, wallId, 250)
    const after = nodesOf(next, wallId)
    expect(after.a).toEqual(before.a)
    expect(Math.round(dist(after.a, after.b) * 10) / 10).toBe(250)
    // A point on the same line: the direction of the wall did not change.
    const u = { x: (before.b.x - before.a.x) / dist(before.a, before.b), y: (before.b.y - before.a.y) / dist(before.a, before.b) }
    expect(Math.round((after.b.x - before.a.x) * u.y - (after.b.y - before.a.y) * u.x)).toBe(0)
  })

  it('works on a single wall that no room sees any more', () => {
    // Room B deleted: its walls stay, and no room sees some of them.
    const doc = removeRoom(plan(), 'B')
    const lonely = doc.walls!.find((w) => w.faces.every((f) => f.roomId === undefined))!
    const next = setStoredWallLength(doc, lonely.id, 120)
    const { a, b } = nodesOf(next, lonely.id)
    expect(Math.round(dist(a, b) * 10) / 10).toBe(120)
  })

  it('writes nothing for a bad length or a wall that is not there', () => {
    const doc = plan()
    expect(setStoredWallLength(doc, doc.walls![0].id, 0)).toBe(doc)
    expect(setStoredWallLength(doc, doc.walls![0].id, -10)).toBe(doc)
    expect(setStoredWallLength(doc, 'W999', 300)).toBe(doc)
  })
})
