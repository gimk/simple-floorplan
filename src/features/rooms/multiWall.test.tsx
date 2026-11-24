// A group of stored walls (Shift + click or box): the group card, one undo step for the whole
// group, and the Delete key (a wall that a room uses stays, the others go).
import { renderToString } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import { emptyDoc, useDoc, useUi } from '../../model/store'
import type { PlanDoc, Room, Selection } from '../../model/types'
import type { SelItem } from '../../model/selection'
import { convertToV2 } from '../../model/v2/convert'
import { removeRoom } from '../../model/v2/write'
import { deleteGroup } from './interaction'
import { patchStoredWalls } from './cards'
import { RoomsPanelView } from './RoomsPanel'

const mk = (id: string, pts: [number, number][], walkOrder: number): Room => ({
  id, code: id, name: id, holes: [], walls: {}, walkOrder,
  vertices: pts.map(([x, y], i) => ({ id: `${id}-v${i}`, x, y })),
})
const rooms = (): Room[] => [
  mk('A', [[0, 0], [400, 0], [400, 300], [0, 300]], 1),
  mk('B', [[0, 300], [400, 300], [400, 600], [0, 600]], 2),
]
const v2 = (): PlanDoc => convertToV2({ ...emptyDoc(), rooms: rooms() }).doc
const items = (ids: string[]): SelItem[] => ids.map((wallId) => ({ kind: 'storedWall', wallId }))
const usedByRoom = (doc: PlanDoc, id: string) => doc.walls!.find((w) => w.id === id)!.faces.some((f) => f.roomId !== undefined)

beforeEach(() => {
  useUi.setState({ mode: 'edit', tool: 'select', selection: null, multi: [] })
  useDoc.setState({ doc: v2() })
  useDoc.temporal.getState().clear()
})

describe('group card of stored walls', () => {
  it('shows "N walls", the wall ids and the shared controls', () => {
    const doc = v2()
    const ids = doc.walls!.slice(0, 3).map((w) => w.id)
    const group = items(ids)
    const html = renderToString(
      <RoomsPanelView doc={doc} selection={group[2] as Selection} items={group} activeHole={null} />,
    )
    expect(html).toContain('3 walls')
    for (const id of ids) expect(html).toContain(id)
    expect(html).toContain('Wall type')
    expect(html).toContain('Wall status')
    expect(html).toContain('Thickness')
    expect(html).toContain('Locked')
    // One wall only: the single card, with its sides.
    expect(renderToString(<RoomsPanelView doc={doc} selection={group[0] as Selection} items={[group[0]]} activeHole={null} />))
      .toContain('Side A')
  })

  it('applies the thickness to every wall of the group in ONE undo step', () => {
    const ids = useDoc.getState().doc.walls!.slice(0, 3).map((w) => w.id)
    const before = useDoc.getState().doc
    patchStoredWalls(ids, { thicknessCm: 33, type: 'bearing', locked: true })
    const after = useDoc.getState().doc
    for (const w of after.walls!) {
      if (ids.includes(w.id)) expect([w.thicknessCm, w.type, w.locked]).toEqual([33, 'bearing', true])
      else expect(w.thicknessCm).not.toBe(33)
    }
    useDoc.temporal.getState().undo()
    expect(useDoc.getState().doc.walls).toEqual(before.walls)
  })
})

describe('Delete with a group of stored walls', () => {
  it('deletes walls that no room uses in one undo step and keeps the walls of rooms', () => {
    const kept = removeRoom(v2(), 'B')
    useDoc.setState({ doc: kept })
    useDoc.temporal.getState().clear()
    const lonely = kept.walls!.filter((w) => !usedByRoom(kept, w.id)).map((w) => w.id).slice(0, 2)
    const used = kept.walls!.find((w) => usedByRoom(kept, w.id))!.id
    expect(lonely).toHaveLength(2)
    const group = items([lonely[0], used, lonely[1]])
    useUi.setState({ selection: group[2], multi: group })
    expect(deleteGroup()).toBe(true)
    const after = useDoc.getState().doc
    expect(after.walls!.some((w) => lonely.includes(w.id))).toBe(false)
    expect(after.walls!.some((w) => w.id === used)).toBe(true)
    // The wall that stayed is the selection now.
    expect(useUi.getState().selection).toEqual({ kind: 'storedWall', wallId: used })
    useDoc.temporal.getState().undo()
    expect(useDoc.getState().doc.walls!.map((w) => w.id)).toEqual(kept.walls!.map((w) => w.id))
  })

  it('deletes all the walls of a group when no room uses them', () => {
    const kept = removeRoom(v2(), 'B')
    useDoc.setState({ doc: kept })
    const lonely = kept.walls!.filter((w) => !usedByRoom(kept, w.id)).map((w) => w.id).slice(0, 2)
    const group = items(lonely)
    useUi.setState({ selection: group[1], multi: group })
    deleteGroup()
    expect(useDoc.getState().doc.walls!.some((w) => lonely.includes(w.id))).toBe(false)
    expect(useUi.getState().selection).toBeNull()
  })
})
