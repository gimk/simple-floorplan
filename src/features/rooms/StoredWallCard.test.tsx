// UI of the wall as ONE object (docs/walls-plan.md, "Walls in the interface"): the Inspect card of
// a stored wall (the wall once, then its two sides) and the wall list of the room card.
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Measurement, PlanDoc, Room, WallElement } from '../../model/types'
import { convertToV2 } from '../../model/v2/convert'
import { removeRoom } from '../../model/v2/write'
import { useUi } from '../../model/store'
import { RoomsPanelView } from './RoomsPanel'
import { refusedDeleteText, setStoredWallSide } from './cards'
import { StoredWallCard } from './StoredWallCard'

/** One room of a test plan: polygon in cm, one corner id per point. */
const mk = (id: string, pts: [number, number][], walkOrder: number): Room => ({
  id,
  code: id,
  name: id === 'A' ? 'Entrée' : 'Couloir',
  vertices: pts.map(([x, y], i) => ({ id: `${id}-v${i}`, x, y })),
  holes: [],
  walls: {},
  walkOrder,
})

/** Room A above room B, sharing the wall A-1 / B-3; A is 400 cm wide, 300 tall. */
const rooms = (): Room[] => [
  mk('A', [[0, 0], [400, 0], [400, 300], [0, 300]], 1),
  mk('B', [[0, 300], [400, 300], [400, 600], [0, 600]], 2),
]

/** The v2 document of the two rooms, with optional values and elements. */
const plan = (measurements: Record<string, Measurement> = {}, elements: WallElement[] = []): PlanDoc =>
  convertToV2({ projectId: 'p', title: 't', rooms: rooms(), elements, measurements, roomNotes: {}, tapes: [] }).doc

/** The wall between the two rooms. */
const sharedWall = (doc: PlanDoc) =>
  doc.walls!.find((w) => w.faces.some((f) => f.roomId === 'A') && w.faces.some((f) => f.roomId === 'B'))!

/** A facade wall: the left wall of A has no room on its outside side. */
const facadeWall = (doc: PlanDoc) =>
  doc.walls!.find((w) => w.faces.some((f) => f.roomId === 'A') && w.faces.every((f) => f.roomId === undefined || f.side === 'L' || f.side === 'R') && w.faces.some((f) => f.roomId === undefined))!

const render = (doc: PlanDoc, wallId: string, side?: 'L' | 'R') =>
  renderToString(<StoredWallCard doc={doc} wallId={wallId} side={side} />)

const element = (over: Partial<WallElement>): WallElement => ({
  id: 'el-1', roomId: 'A', wallStart: 'A-v0', kind: 'door', variant: 'single', offsetCm: 100, widthCm: 83,
  createdAt: '', updatedAt: '', ...over,
})

describe('StoredWallCard', () => {
  it('shows the wall once, then the two sides with the faces in order', () => {
    const doc = plan()
    const id = sharedWall(doc).id
    const html = render(doc, id, 'L')
    expect(html).toContain(`Wall ${id}`)
    expect(html).toContain('Side A')
    expect(html).toContain('Side B')
    // The wall properties are on the card once, not once per room.
    expect(html.match(/In line on/g)).toHaveLength(1)
    expect(html.match(/Thickness/g)).toHaveLength(1)
    // One face of each room, with the room code, its name and the survey label of the face.
    expect(html).toContain('Entrée')
    expect(html).toContain('Couloir')
    expect(html).toMatch(/data-wall-face="A-\d"/)
    expect(html).toMatch(/data-wall-face="B-\d"/)
    // The length of the wall on its centre line, and the centre value 'W12-C'.
    expect(html).toContain('Length (centre)')
    expect(html).toContain(`${id}-C`)
    // The rooms of the two sides, as links.
    expect(html).toContain(`data-wall-rooms="${id}"`)
  })

  it('marks the side the user clicked on the canvas', () => {
    const doc = plan()
    const id = sharedWall(doc).id
    expect(render(doc, id, 'R')).toContain('data-wall-side="R" data-wall-side-active="true"')
    expect(render(doc, id, 'R')).toContain('data-wall-side="L" data-wall-side-active="false"')
    expect(render(doc, id, 'L')).toContain('data-wall-side="L" data-wall-side-active="true"')
  })

  it('shows the measured value and the solved value of a face', () => {
    const doc = plan()
    const id = sharedWall(doc).id
    // The face of A on the shared wall, with its label.
    const face = doc.rooms.find((r) => r.code === 'A')!.cycle!.find((f) => f.wallId === id)!
    const index = doc.rooms.find((r) => r.code === 'A')!.cycle!.findIndex((f) => f.cornerId === face.cornerId)
    const label = `A-${index + 1}`
    const withValue = plan({ [label]: { label, actualCm: 398, updatedAt: '' } })
    const html = render(withValue, id, 'L')
    expect(html).toContain(label)
    expect(html).toContain('398')
    expect(html).toContain('Measured')
  })

  it('shows an outside span, with the facade value when the whole side is outside', () => {
    const doc = plan()
    const wall = facadeWall(doc)
    const html = render(doc, wall.id)
    expect(html).toContain('Outside (facade)')
    expect(html).toContain(`${wall.id}-E`)
    // The planned outside length is the placeholder of the field: longer than the centre line.
    expect(html).toContain('No room on this side.')
  })

  it('lists the doors and windows of the wall', () => {
    const doc = plan()
    const wall = sharedWall(doc)
    const face = doc.rooms.find((r) => r.code === 'A')!.cycle!.find((f) => f.wallId === wall.id)!
    const el = element({ wallId: wall.id, roomId: 'A', wallStart: face.cornerId, alongCm: 120 })
    const html = render(plan({}, [el]), wall.id, 'L')
    expect(html).toContain('Doors and windows on this wall')
    expect(html).toContain('Door')
    expect(html).toContain('83')
  })

  it('says which rooms a deletion is refused for', () => {
    const doc = plan()
    const wall = sharedWall(doc)
    // No element on this wall: the card shows its empty hint.
    expect(render(doc, wall.id)).toContain('No door, window or fixture on this wall.')
    expect(refusedDeleteText(wall.id, ['A', 'B'])).toBe(`Wall ${wall.id} is part of rooms A, B.`)
  })

  it('has a Side A and a Side B button that select that side of the wall', () => {
    const doc = plan()
    const id = sharedWall(doc).id
    const html = render(doc, id, 'L')
    // The header of each side is a button (aria-pressed), so either side can be chosen at will.
    expect(html).toContain('aria-pressed="true" data-wall-side-button="L"')
    expect(html).toContain('aria-pressed="false" data-wall-side-button="R"')
    expect(render(doc, id, 'R')).toContain('aria-pressed="true" data-wall-side-button="R"')
    // The button writes the side of the selection, which the plan draws stronger.
    setStoredWallSide(id, 'R')
    expect(useUi.getState().selection).toEqual({ kind: 'storedWall', wallId: id, side: 'R' })
    setStoredWallSide(id, 'L')
    expect(useUi.getState().selection).toEqual({ kind: 'storedWall', wallId: id, side: 'L' })
    useUi.setState({ selection: null, multi: [] })
  })

  it('shows both sides of a single wall as Outside, and keeps its Delete wall button', () => {
    // A room deleted: its walls stay, and no room sees them any more.
    const doc = removeRoom(plan(), 'B')
    const lonely = doc.walls!.find((w) => w.faces.every((f) => f.roomId === undefined))!
    const html = render(doc, lonely.id)
    expect(html.match(/data-wall-outside=/g)).toHaveLength(2)
    expect(html.match(/No room on this side\./g)).toHaveLength(2)
    expect(html).toContain('Delete wall')
    // The facets of a wall that a room uses are not on this card.
    expect(html).not.toContain('data-wall-face=')
  })
})

describe('Room card: one line per face', () => {
  it('names the stored wall and the room on its other side', () => {
    const doc = plan()
    const wall = sharedWall(doc)
    const html = renderToString(<RoomsPanelView doc={doc} selection={{ kind: 'room', roomId: 'A' }} activeHole={null} />)
    expect(html).toContain(`data-room-wall-link="${wall.id}"`)
    // Server rendering puts an HTML comment between two text nodes: the parts are checked alone.
    expect(html).toContain('shared with Couloir')
  })

  it('says facade for the wall that has the outside on its other side', () => {
    const doc = plan()
    const wall = facadeWall(doc)
    const html = renderToString(<RoomsPanelView doc={doc} selection={{ kind: 'room', roomId: 'A' }} activeHole={null} />)
    expect(html).toContain(`data-room-wall-link="${wall.id}"`)
    expect(html).toContain('facade')
  })

  it('opens the stored wall card for a stored wall selection', () => {
    const doc = plan()
    const wall = sharedWall(doc)
    const html = renderToString(<RoomsPanelView doc={doc} selection={{ kind: 'storedWall', wallId: wall.id, side: 'R' }} activeHole={null} />)
    expect(html).toContain(`Wall ${wall.id}`)
    expect(html).toContain('data-wall-side="R" data-wall-side-active="true"')
    // The v1 per-room wall card is not used for a v2 document.
    expect(html).not.toContain('Solve whole plan')
  })
})
