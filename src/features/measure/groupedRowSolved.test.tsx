// A grouped row (one visible straight wall stored as 2+ faces, e.g. "R1-2+3") is solved when the
// solver changed ANY of its faces (round 2 finding 5): the first face alone does not tell.
//
// The two faces of the row point at two DIFFERENT stored walls here: that is the case the card got
// wrong (it read the first face only). The plan does not need the walls for this test: the card reads
// the values of the row and the recorded solver changes.
import { renderToString } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import { emptyDoc, useDoc, useUi } from '../../model/store'
import type { Measurement, PlanDoc, Room, SolverState } from '../../model/types'
import { ESTIMATED_TEXT, SOLVED_TEXT } from '../../shell/panel/styles'
import { measureRows } from './logic'
import { RoomCard } from './RoomCard'

/** 400 x 300 room; the right wall (x = 400) is split at y = 100 by a T junction: faces 2 and 3. */
const room: Room = {
  id: 'a', code: 'R1', name: 'Cuisine', walkOrder: 0, holes: [], walls: {},
  vertices: [[0, 0], [400, 0], [400, 100], [400, 300], [0, 300]].map(([x, y], i) => ({ id: `a${i}`, x, y })),
}

/** Wall id of a face of the grouped row: one per piece, so the two pieces differ. */
const wallOfPiece = (i: number) => `W-run-${i}`

const measurement = (label: string, actualCm: number, wallId: string): Measurement => ({
  label, actualCm, updatedAt: '', target: { wallId, side: 'L', kind: 'face' },
})

/**
 * The plan with both pieces of the grouped row measured, and the solver On. `changeOn` says which
 * piece the solver moved (null: no change at all).
 */
function plan(changeOn: 'first' | 'second' | null = 'second'): PlanDoc {
  const row = measureRows(room).find((r) => r.labels.length === 2)!
  const [first, second] = row.labels
  const measurements = {
    [first]: measurement(first, row.pieces[0].plannedCm, wallOfPiece(0)),
    [second]: measurement(second, row.pieces[1].plannedCm, wallOfPiece(1)),
  }
  const changeOnIndex = changeOn === 'first' ? 0 : changeOn === 'second' ? 1 : -1
  const solver: SolverState = {
    enabled: true,
    changes: changeOnIndex < 0
      ? []
      : [{ kind: 'position', wallId: wallOfPiece(changeOnIndex), label: row.labels[changeOnIndex], moveCm: 5, dir: 'E' }],
    revoked: [],
    baseNodes: {},
    baseThickness: {},
  }
  return { ...emptyDoc(), schemaVersion: 2, rooms: [room], measurements, solver }
}

const render = (doc: PlanDoc) => renderToString(<RoomCard doc={doc} room={doc.rooms[0]} allLabels={[]} hideDrawing />)

beforeEach(() => {
  useDoc.setState({ doc: emptyDoc() })
  useUi.setState({ mode: 'measure', selection: null, multi: [], hoverLabel: null })
})

describe('a grouped row and the solver (round 2 finding 5)', () => {
  it('is solved (purple) when the solver changed its SECOND face only', () => {
    const html = render(plan('second'))
    // The line under the measured value of the row: purple, not grey.
    expect(html).toContain(`class="text-xs ${SOLVED_TEXT}"`)
    expect(html).not.toContain(`class="text-xs ${ESTIMATED_TEXT}"`)
  })

  it('is solved too when the solver changed its first face', () => {
    expect(render(plan('first'))).toContain(`class="text-xs ${SOLVED_TEXT}"`)
  })

  it('stays estimated (grey) when the solver changed none of its faces', () => {
    const html = render(plan(null))
    expect(html).not.toContain(`class="text-xs ${SOLVED_TEXT}"`)
    expect(html).toContain(`class="text-xs ${ESTIMATED_TEXT}"`)
  })
})
