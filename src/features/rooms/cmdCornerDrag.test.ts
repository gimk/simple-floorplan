// Cmd/Ctrl + drag of a corner = the room resize (the polygon is scaled, the sync rule writes it into the
// wall graph). A standalone wall that the room reused must follow, never stay at the old place.
import { describe, expect, it } from 'vitest'
import type { PlanDoc, Room } from '../../model/types'
import { convertToV2 } from '../../model/v2/convert'
import { endpointsOf } from '../../model/v2/repair'
import { v2SyncRule } from '../../model/v2/syncRule'
import { addStandaloneWall } from '../../model/v2/write'
import { oppositeVertex, scaleFactors, scaleRoom } from './transform'

const empty = (): PlanDoc => convertToV2({ projectId: 'p', title: 't', rooms: [], elements: [], measurements: {}, roomNotes: {}, tapes: [] }).doc
const room = (pts: [number, number][]): Room => ({
  id: 'R2', code: 'R2', name: 'R2', holes: [], walls: {}, walkOrder: 1,
  vertices: pts.map(([x, y], i) => ({ id: `R2-v${i}`, x, y })),
})
const props = { type: 'partition' as const, thicknessCm: 10 }
const key = (s: number[]) => s.map((n) => Math.round(n)).join(',')

/** standalone wall -> rectangle on it (the tool adds the room, the rule writes it) -> Cmd + drag of corner 0. */
function run(wallX: [number, number], rect: [number, number, number, number], to: { x: number; y: number }) {
  let doc = addStandaloneWall(empty(), { x: wallX[0], y: 191 }, { x: wallX[1], y: 191 }, props).doc
  const [x0, y0, x1, y1] = rect
  const r = room([[x0, y0], [x1, y0], [x1, y1], [x0, y1]])
  doc = v2SyncRule(doc, { ...doc, rooms: [...doc.rooms, r] })
  const room0 = doc.rooms.find((x) => x.id === 'R2')!
  const anchor = oppositeVertex(room0, 'R2-v0')!
  const f = scaleFactors(anchor, room0.vertices[0], to)
  const scaled = scaleRoom(doc, 'R2', anchor, f)
  return { before: doc, after: v2SyncRule(doc, scaled) }
}

const orphans = (d: PlanDoc) => (d.walls ?? []).filter((w) => !w.faces.some((f) => f.roomId))

describe('Cmd + drag of a corner of a room built on a standalone wall', () => {
  const cases: [string, [number, number], [number, number, number, number]][] = [
    ['same length', [121, 430], [121, 191, 430, 400]],
    ['room longer than the wall', [121, 430], [121, 191, 560, 400]],
    ['room shorter than the wall', [121, 430], [121, 191, 300, 400]],
    ['room starts inside the wall', [121, 430], [200, 191, 430, 400]],
  ]
  for (const [name, w, rect] of cases) {
    it(name + ': no wall stays at the old position', () => {
      const { before, after } = run(w, rect, { x: 101, y: 171 })
      expect(orphans(before).length).toBeLessThanOrEqual(1)
      const old = endpointsOf(after).map(key)
      // Nothing is left on the old top line y = 191 except where the room still has it (none: the corner moved up).
      const onOld = (after.walls ?? []).filter((x) => {
        const s = endpointsOf({ ...after, walls: [x] })[0]
        return Math.abs(s[1] - 191) < 1 && Math.abs(s[3] - 191) < 1
      })
      expect(onOld.map((x) => x.id), JSON.stringify(old)).toEqual([])
      expect(orphans(after).map((x) => x.id)).toEqual([])
    })
  }
})
