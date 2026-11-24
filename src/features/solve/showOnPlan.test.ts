// "Show on plan" of the Solve tab (review findings 4 and 12): a click must select the thing the
// label measures. In a v2 document that is the STORED wall, on the side the value is on, so the
// breadcrumb, the wall card and the wall band on the plan agree. A v1 document keeps the room wall.
import { beforeEach, describe, expect, it } from 'vitest'
import { useUi } from '../../model/store'
import { emptyDoc } from '../../model/store'
import type { PlanDoc, Room } from '../../model/types'
import { convertToV2 } from '../../model/v2/convert'
import { showLabelOnPlan } from './MeasureNext'

const rect = (): Room => ({
  id: 'r1',
  code: 'SE',
  name: 'Séjour',
  holes: [],
  walls: {},
  walkOrder: 1,
  vertices: [
    { id: 'v0', x: 0, y: 0 },
    { id: 'v1', x: 400, y: 0 },
    { id: 'v2', x: 400, y: 300 },
    { id: 'v3', x: 0, y: 300 },
  ],
})

/** A v1 document: rooms only, no stored walls. */
const v1 = (): PlanDoc => ({ ...emptyDoc(), rooms: [rect()] })

/** A v2 document of the same room, with stored walls and a cycle. */
const v2 = (): PlanDoc =>
  convertToV2({ projectId: 'p', title: 't', rooms: [rect()], elements: [], measurements: {}, roomNotes: {}, tapes: [] }).doc

const selection = () => useUi.getState().selection

beforeEach(() => useUi.setState({ selection: null, multi: [] }))

describe('showLabelOnPlan', () => {
  it('selects the stored wall of a face, on the side the face is on', () => {
    const doc = v2()
    const face = doc.rooms[0].cycle![0]
    expect(face).toBeDefined()
    showLabelOnPlan(doc, 'SE-1')
    // The face of the label is selected too: the plan draws the strong line along it only.
    expect(selection()).toEqual({
      kind: 'storedWall', wallId: face.wallId, side: face.side, face: `room:r1:${face.cornerId}`,
    })
  })

  it('selects the stored wall of a centre value, with no side', () => {
    const doc = v2()
    const wallId = doc.walls![0].id
    showLabelOnPlan(doc, `${wallId}-C`)
    expect(selection()).toEqual({ kind: 'storedWall', wallId, side: undefined })
  })

  it('selects the room of a diagonal', () => {
    const doc = v2()
    showLabelOnPlan(doc, 'SE-D')
    expect(selection()).toEqual({ kind: 'room', roomId: 'r1' })
  })

  it('keeps the per-room wall of a v1 document', () => {
    showLabelOnPlan(v1(), 'SE-2')
    expect(selection()).toEqual({ kind: 'wall', roomId: 'r1', wallStart: 'v1' })
    // A label that names no wall selects its room.
    showLabelOnPlan(v1(), 'SE-H')
    expect(selection()).toEqual({ kind: 'room', roomId: 'r1' })
  })
})
