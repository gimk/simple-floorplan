// A drag of one wall of a room on the wall graph: the wall slides along its normal and the
// neighbours stretch. Through the store, with the doc rules and the end of the drag.
import { describe, expect, it } from 'vitest'
import { beginDrag, endDrag, useDoc } from '../../model/store'
import type { PlanDoc } from '../../model/types'
import { convertToV2 } from '../../model/v2/convert'
import { installMeasureRules } from './measureRules'
import { moveStoredWall } from './interaction'

const base = (): PlanDoc => convertToV2({
  projectId: 'p', title: 't', elements: [], roomNotes: {}, tapes: [],
  // A measured room: applying measured lengths locks its walls, which is why a wall "does not move".
  measurements: { 'A-1': { label: 'A-1', actualCm: 400, updatedAt: '2026-01-01T00:00:00Z' } },
  rooms: [{ id: 'A', code: 'A', name: 'A', holes: [], walls: {}, walkOrder: 1,
    vertices: [[0, 0], [400, 0], [400, 300], [0, 300]].map(([x, y], i) => ({ id: `A${i}`, x, y })) }],
}).doc

const corners = () => useDoc.getState().doc.rooms[0].vertices.map((v) => [v.x, v.y])

describe('drag of a room wall (v2)', () => {
  it('moves an unlocked wall and stretches its neighbours, at the end of the drag too', () => {
    installMeasureRules()
    useDoc.getState().replace(base())
    const top = useDoc.getState().doc.walls![0].id
    const start = beginDrag()
    useDoc.getState().updateSilent(() => moveStoredWall(start, top, { x: 0, y: -40 }))
    endDrag(start)
    expect(corners()).toEqual([[0, -40], [400, -40], [400, 300], [0, 300]])
    useDoc.temporal.getState().undo()
    expect(corners()).toEqual([[0, 0], [400, 0], [400, 300], [0, 300]])
  })
})
