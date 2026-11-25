// UI of the wall values (docs/walls-plan.md phase 5b): the Inspect wall card fields, the Facade
// section of Measuring Mode, and the old values of removed walls.
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { syncStoredGraph } from '../../model/storedGraph'
import { emptyDoc } from '../../model/store'
import type { Measurement, PlanDoc, Room } from '../../model/types'
import { FacadeSection } from '../measure/FacadeCard'
import { RemovedWallsOldValues, oldOfDeletedRooms, oldOfRemovedWalls } from '../measure/OldValues'
import { SOLVED_TEXT } from '../../shell/panel/styles'
import { RoomsPanelView } from './RoomsPanel'

const room = (id: string, pts: [number, number][], thicknessOf: Record<number, number> = {}): Room => ({
  id, code: id, name: id, holes: [], walkOrder: 1,
  vertices: pts.map(([x, y], i) => ({ id: `${id}v${i}`, x, y })),
  walls: Object.fromEntries(
    pts.map((_, i) => [`${id}v${i}`, { type: 'partition' as const, thicknessCm: thicknessOf[i] ?? 20 }]),
  ),
})

/** A = x 0..300, C = x 300..600, y 0..400. The wall between them is 10 cm. */
const plan = (measurements: Record<string, Measurement> = {}): PlanDoc => {
  const rooms = [
    room('A', [[0, 0], [300, 0], [300, 400], [0, 400]], { 1: 10 }),
    room('C', [[300, 0], [600, 0], [600, 400], [300, 400]], { 3: 10 }),
  ]
  const g = syncStoredGraph(undefined, rooms)
  return { ...emptyDoc(), projectId: 'ui', title: 'Wall values', rooms, nodes: g.nodes, walls: g.walls, measurements }
}

/** Stored wall id of the room wall `wallStart` of room `roomId`. */
const wallIdOf = (doc: PlanDoc, roomId: string, wallStart: string) =>
  doc.walls!.find((w) => w.faces.some((f) => f.roomId === roomId && f.wallStart === wallStart))!.id

describe('Inspect wall card: wall values', () => {
  it('shows the centre and outside face fields of a facade wall', () => {
    const doc = plan()
    // Wall 4 of A: the left facade wall.
    const html = renderToString(<RoomsPanelView doc={doc} selection={{ kind: 'wall', roomId: 'A', wallStart: 'Av3' }} activeHole={null} />)
    expect(html).toContain('Centre (plan)')
    expect(html).toContain('Outside face')
    expect(html).toContain(wallIdOf(doc, 'A', 'Av3'))
    // The planned outside length is the placeholder: 400 cm of centre line, plus half of the two
    // 20 cm end walls (top and bottom of A).
    expect(html).toContain('420')
  })

  it('shows no outside face field for a wall between two rooms', () => {
    const doc = plan()
    const html = renderToString(<RoomsPanelView doc={doc} selection={{ kind: 'wall', roomId: 'A', wallStart: 'Av1' }} activeHole={null} />)
    expect(html).toContain('Centre (plan)')
    expect(html).not.toContain('Outside face')
  })

  it('shows the measured and plan/solved value when a centre value exists', () => {
    const doc = plan()
    const id = wallIdOf(doc, 'A', 'Av3')
    const withValue = plan({ [`${id}-C`]: { label: `${id}-C`, actualCm: 400, updatedAt: '' } })
    const htmlOff = renderToString(<RoomsPanelView doc={withValue} selection={{ kind: 'wall', roomId: 'A', wallStart: 'Av3' }} activeHole={null} />)
    // Server rendering puts comment marks between two text nodes, so the parts are checked alone.
    expect(htmlOff).toContain('Measured')
    expect(htmlOff).toContain('400')
    expect(htmlOff).toContain('Plan')

    const withSolved: PlanDoc = {
      ...withValue,
      solver: {
        enabled: true,
        changes: [{ kind: 'position', wallId: id, label: 'A-4', moveCm: 1, dir: 'W' }],
        revoked: [],
        baseNodes: {},
        baseThickness: {},
      },
    }
    const htmlOn = renderToString(<RoomsPanelView doc={withSolved} selection={{ kind: 'wall', roomId: 'A', wallStart: 'Av3' }} activeHole={null} />)
    expect(htmlOn).toContain('Measured')
    expect(htmlOn).toContain('Solved')
  })

  it('shows a purple solved line on WallCard for an unmeasured solved wall and none when Off', () => {
    const doc = plan()
    const id = wallIdOf(doc, 'A', 'Av3')
    expect(
      renderToString(<RoomsPanelView doc={doc} selection={{ kind: 'wall', roomId: 'A', wallStart: 'Av3' }} activeHole={null} />),
    ).not.toContain('data-wall-solved=')

    const moved: PlanDoc = {
      ...doc,
      solver: {
        enabled: true,
        changes: [{ kind: 'position', wallId: id, label: 'A-4', moveCm: 2.5, dir: 'W', lengthFromCm: 400, lengthToCm: 400 }],
        revoked: [],
        baseNodes: {},
        baseThickness: {},
      },
    }
    const htmlMoved = renderToString(
      <RoomsPanelView doc={moved} selection={{ kind: 'wall', roomId: 'A', wallStart: 'Av3' }} activeHole={null} />,
    ).replace(/<!-- -->/g, '')
    expect(htmlMoved).toContain(`data-wall-solved="${id}"`)
    expect(htmlMoved).toContain(SOLVED_TEXT)
    expect(htmlMoved).toContain('Solver moved it 2,5 cm west')
  })
})

describe('Measuring Mode: Facade section', () => {
  it('lists the outside face of every facade wall, with its planned value', () => {
    const doc = plan()
    const html = renderToString(<FacadeSection doc={doc} />)
    expect(html).toContain('Facade')
    const facade = doc.walls!.filter((w) => w.faces.every((f) => f.side !== 'L' || f.roomId === undefined) || w.faces.some((f) => f.roomId === undefined))
    expect(facade.length).toBeGreaterThan(0)
    // One field per facade wall, with the label 'W12-E'.
    for (const w of facade) expect(html).toContain(`${w.id}-E`)
    // A wall between two rooms is not in the list.
    expect(html).not.toContain(`${wallIdOf(doc, 'A', 'Av1')}-E`)
  })

  it('has no section when the plan has no facade wall', () => {
    expect(renderToString(<FacadeSection doc={{ ...emptyDoc() }} />)).toBe('')
  })
})

describe('old values of removed walls', () => {
  const doc = plan({
    'W1-C': { label: 'W1-C', actualCm: 300, updatedAt: '2026-11-01T10:00:00.000Z' },
    'SE-2': { label: 'SE-2', actualCm: 412, updatedAt: '2026-11-01T10:00:00.000Z' },
  })
  const withOld: PlanDoc = {
    ...doc,
    oldMeasurements: [
      { label: 'W9-C', actualCm: 500, updatedAt: 'now', roomCode: '', reason: 'wall-removed', droppedAt: '2026-11-02T10:00:00.000Z' },
      { label: 'SB-1', actualCm: 236, updatedAt: 'now', roomCode: 'SB', reason: 'room-deleted', droppedAt: '2026-11-02T10:00:00.000Z' },
    ],
  }

  it('puts the values of a removed wall in their own list', () => {
    expect(oldOfRemovedWalls(withOld).map((e) => e.label)).toEqual(['W9-C'])
    expect(oldOfDeletedRooms(withOld).map((e) => e.label)).toEqual(['SB-1'])
  })

  it('renders them under "Old values of removed walls"', () => {
    const html = renderToString(<RemovedWallsOldValues doc={withOld} />)
    expect(html).toContain('Old values of removed walls')
    expect(html).toContain('W9-C')
    expect(html).toContain('wall removed')
    expect(html).not.toContain('SB-1')
  })
})
