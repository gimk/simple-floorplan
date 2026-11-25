// A corner drag of a room must MOVE the walls of the corner, never leave a wall at the old place
// (a 95 x 110 rectangle that stays drawn while the moved walls go diagonal).
import { describe, expect, it } from 'vitest'
import type { PlanDoc, Room } from '../../model/types'
import { convertToV2 } from '../../model/v2/convert'
import { ensureV2 } from '../../model/v2/ensure'
import { endpointsOf, repairGraph } from '../../model/v2/repair'
import { v2SyncRule } from '../../model/v2/syncRule'
import { moveCornerNode } from './interaction'
import { moveVertices } from './ops'

const room = (id: string, pts: [number, number][], walkOrder: number): Room => ({
  id, code: id, name: id, holes: [], walls: {}, walkOrder,
  vertices: pts.map(([x, y], i) => ({ id: `${id}-v${i}`, x, y })),
})
const plan = (rooms: Room[]): PlanDoc => ({ projectId: 'p', title: 't', rooms, elements: [], measurements: {}, roomNotes: {}, tapes: [] })
const v2 = (rooms: Room[]) => convertToV2(plan(rooms)).doc

/** Wall segments [x1,y1,x2,y2] of a document, rounded. */
const segs = (d: PlanDoc) => endpointsOf(d).map((s) => s.map((n) => Math.round(n * 10) / 10).join(','))

describe('corner drag keeps the wall count', () => {
  it('node drag (moveCornerNode): 4 walls stay 4, none stays at the old corner', () => {
    const doc = v2([room('A', [[0, 0], [95, 0], [95, 110], [0, 110]], 1)])
    expect(doc.walls).toHaveLength(4)
    const node = doc.nodes!.find((n) => n.x === 95 && n.y === 110)!
    const moved = moveCornerNode(doc, node.id, { x: 140, y: 150 })
    expect(moved.walls).toHaveLength(4)
    expect(moved.nodes).toHaveLength(4)
    const s = segs(moved)
    expect(s.some((w) => w.includes('95,110'))).toBe(false)
    expect(s.filter((w) => w.includes('140,150'))).toHaveLength(2)
  })

  it('polygon drag (moveVertices + the sync rule): 4 walls stay 4', () => {
    const doc = v2([room('A', [[0, 0], [95, 0], [95, 110], [0, 110]], 1)])
    const next = moveVertices(doc, [{ roomId: 'A', vertexId: 'A-v2', x: 140, y: 150 }])
    const out = v2SyncRule(doc, next)
    expect(out.walls).toHaveLength(4)
    expect(segs(out).some((w) => w.includes('95,110'))).toBe(false)
  })

  it('a corner shared with a neighbour: the neighbour walls follow, no wall stays behind', () => {
    const doc = v2([room('A', [[0, 0], [95, 0], [95, 110], [0, 110]], 1), room('B', [[95, 0], [200, 0], [200, 110], [95, 110]], 2)])
    expect(doc.walls).toHaveLength(7)
    const node = doc.nodes!.find((n) => n.x === 95 && n.y === 110)!
    const moved = moveCornerNode(doc, node.id, { x: 120, y: 140 })
    expect(moved.walls).toHaveLength(7)
    expect(segs(moved).some((w) => w.includes('95,110'))).toBe(false)
  })
})

describe('the real cause: walls that were stored twice before the drag', () => {
  /** The 95 x 110 room with a second set of 4 walls on its outline, on nodes 0.8 cm away. */
  const duplicated = (): PlanDoc => {
    const doc = v2([room('A', [[0, 0], [95, 0], [95, 110], [0, 110]], 1)])
    const nodes = doc.nodes!.map((n) => ({ id: `${n.id}x`, x: n.x + 0.8, y: n.y }))
    const walls = doc.walls!.map((w) => ({ ...w, id: `${w.id}x`, a: `${w.a}x`, b: `${w.b}x`, faces: [], standalone: true }))
    return { ...doc, nodes: [...doc.nodes!, ...nodes], walls: [...doc.walls!, ...walls] }
  }

  it('without the repair, the drag moves one copy and the other copy stays at the old place (the case of the user)', () => {
    const doc = duplicated()
    const node = doc.nodes!.find((n) => n.x === 95 && n.y === 110)!
    const moved = moveCornerNode(doc, node.id, { x: 140, y: 150 })
    expect(moved.walls).toHaveLength(8)
    // The copy of the left wall is still drawn at the old place (a 0.8 x 110 sliver of the old rectangle).
    expect(segs(moved)).toContain('0.8,0,0.8,110')
  })

  it('the repair on load removes the copy: the drag leaves 4 walls and nothing at the old place', () => {
    const loaded = ensureV2(duplicated())
    expect(loaded.walls).toHaveLength(4)
    expect(repairGraph(loaded).doc).toBe(loaded)
    const node = loaded.nodes!.find((n) => Math.abs(n.x - 95) < 1 && Math.abs(n.y - 110) < 1)!
    const moved = moveCornerNode(loaded, node.id, { x: 140, y: 150 })
    expect(moved.walls).toHaveLength(4)
    expect(segs(moved).some((w) => /9[5-6](\.\d)?,110/.test(w))).toBe(false)
  })
})
