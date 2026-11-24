import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { PlanDoc, Room, Selection } from '../../model/types'
import { RoomsPanelView, type ActiveHole } from './RoomsPanel'
import { adjacentWallStart } from './cards'

const rect = (over: Partial<Room> = {}): Room => ({
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
  ...over,
})

const doc = (over: Partial<PlanDoc> = {}): PlanDoc => ({
  projectId: 'local',
  title: 'Test',
  rooms: [rect()],
  elements: [
    { id: 'e1', roomId: 'r1', wallStart: 'v0', kind: 'door', variant: 'single', offsetCm: 20, widthCm: 83, createdAt: '', updatedAt: '' },
    { id: 'e2', roomId: 'r1', wallStart: 'v2', kind: 'window', variant: 'french', offsetCm: 40, widthCm: 140, createdAt: '', updatedAt: '' },
  ],
  measurements: {},
  roomNotes: {},
  tapes: [],
  pins: [],
  apartment: { defaultCeilingCm: 250 },
  ...over,
})

const render = (selection: Selection, d: PlanDoc = doc(), activeHole: ActiveHole = null) =>
  renderToString(<RoomsPanelView doc={d} selection={selection} activeHole={activeHole} />)

describe('RoomsPanelView with a Shift + click group', () => {
  it('lists the selected walls, applies to all, and hides Length', () => {
    const items: Selection[] = [{ kind: 'wall', roomId: 'r1', wallStart: 'v0' }, { kind: 'wall', roomId: 'r1', wallStart: 'v2' }]
    const html = renderToString(<RoomsPanelView doc={doc()} selection={items[1]} items={items.filter((x) => !!x)} activeHole={null} />)
    expect(html).toContain('2 walls')
    expect(html).toContain('SE-1, SE-3')
    expect(html).toContain('name="thickness"')
    expect(html).not.toContain('name="length"')
  })
  it('shows a summary for a group of rooms', () => {
    const d = doc({ rooms: [rect(), rect({ id: 'r2', code: 'C1', name: 'Chambre' })] })
    const items: Selection[] = [{ kind: 'room', roomId: 'r1' }, { kind: 'room', roomId: 'r2' }]
    const html = renderToString(<RoomsPanelView doc={d} selection={items[1]} items={items.filter((x) => !!x)} activeHole={null} />)
    expect(html).toContain('2 rooms selected')
  })
})

describe('RoomsPanelView shows one context at a time', () => {
  it('hides the Room card, the lists and the measured values with a wall selected', () => {
    const html = render({ kind: 'wall', roomId: 'r1', wallStart: 'v0' })
    expect(html).toContain('aria-label="Wall SE-1"')
    expect(html).toContain('aria-label="On this wall"')
    expect(html).not.toContain('aria-label="Room"')
    expect(html).not.toContain('aria-label="Walls"')
    expect(html).not.toContain('aria-label="Elements"')
    expect(html).not.toContain('aria-label="Measured lengths"')
    expect(html).not.toContain('id="room-walls"')
    expect(html).not.toContain('id="room-elements"')
    expect(html).not.toContain('name="name"')
    expect(html).not.toContain('aria-label="Select wall SE-2"')
  })

  it('hides the wall card and its wall steps with a room selected', () => {
    const html = render({ kind: 'room', roomId: 'r1' })
    expect(html).toContain('aria-label="Room"')
    expect(html).not.toContain('aria-label="Wall SE-1"')
    expect(html).not.toContain('aria-label="On this wall"')
    expect(html).not.toContain('aria-label="Previous wall"')
    expect(html).not.toContain('aria-label="Next wall"')
    expect(html).not.toContain('name="thickness"')
  })

  it('shows the vertex card alone for a point selection', () => {
    const html = render({ kind: 'vertex', roomId: 'r1', vertexId: 'v1' })
    expect(html).toContain('aria-label="Vertex"')
    expect(html).not.toContain('aria-label="Room"')
    expect(html).not.toContain('aria-label="Walls"')
    expect(html).not.toContain('aria-label="On this wall"')
  })

  it('shows the group card alone for a group of walls', () => {
    const items: Selection[] = [{ kind: 'wall', roomId: 'r1', wallStart: 'v0' }, { kind: 'wall', roomId: 'r1', wallStart: 'v2' }]
    const html = renderToString(<RoomsPanelView doc={doc()} selection={items[1]} items={items.filter((x) => !!x)} activeHole={null} />)
    expect(html).toContain('2 walls')
    expect(html).not.toContain('aria-label="Room"')
    expect(html).not.toContain('aria-label="On this wall"')
    // A wall group has no single wall to step to.
    expect(html).not.toContain('aria-label="Previous wall"')
    expect(html).not.toContain('aria-label="Next wall"')
  })

  it('shows the group card alone for a group of points', () => {
    const items: Selection[] = [{ kind: 'vertex', roomId: 'r1', vertexId: 'v1' }, { kind: 'vertex', roomId: 'r1', vertexId: 'v2' }]
    const html = renderToString(<RoomsPanelView doc={doc()} selection={items[1]} items={items.filter((x) => !!x)} activeHole={null} />)
    expect(html).toContain('2 points selected')
    expect(html).not.toContain('aria-label="Vertex"')
    expect(html).not.toContain('id="vertex-x"')
  })
})

describe('wall steps (previous / next wall of the same room)', () => {
  it('wraps around in polygon order', () => {
    const room = rect()
    expect(adjacentWallStart(room, 'v0', 1)).toBe('v1')
    expect(adjacentWallStart(room, 'v0', -1)).toBe('v3')
    expect(adjacentWallStart(room, 'v3', 1)).toBe('v0')
    expect(adjacentWallStart(room, 'v3', -1)).toBe('v2')
  })

  it('gives nothing when the wall is gone', () => {
    expect(adjacentWallStart(rect(), 'nope', 1)).toBeNull()
    expect(adjacentWallStart(rect({ vertices: [] }), 'v0', 1)).toBeNull()
  })

  it('renders both step buttons on a wall card, in the header', () => {
    const html = render({ kind: 'wall', roomId: 'r1', wallStart: 'v1' })
    expect(html).toContain('aria-label="Previous wall"')
    expect(html).toContain('aria-label="Next wall"')
    expect(html).toContain('aria-label="Wall SE-2"')
  })
})

describe('RoomsPanelView', () => {
  it('keeps the room field names, the delete action and the lists', () => {
    const html = render({ kind: 'room', roomId: 'r1' })
    expect(html).toContain('name="name"')
    expect(html).toContain('name="code-unique-"')
    expect(html).toContain('name="walk-order"')
    expect(html).toContain('name="ceiling-height"')
    expect(html).toContain('name="roomOutdoor"')
    expect(html).toContain('name="lockVerifiedWalls"')
    expect(html).toContain('aria-label="Delete room Séjour"')
    expect(html).toContain('aria-label="Walls"')
    expect(html).toContain('aria-label="Elements"')
    expect(html).toContain('aria-label="Measured lengths"')
    expect(html).toContain('aria-label="Select wall SE-2"')
    expect(html).toContain('aria-label="Select element Door SE-1"')
    expect(html).toContain('aria-label="Select element Window SE-3"')
  })

  it('shows the stats, with the volume from the apartment default ceiling', () => {
    const html = render({ kind: 'room', roomId: 'r1' })
    expect(html).toContain('11,31 m²') // inside face: 390 x 290 cm
    expect(html).toContain('1360 cm') // perimeter on the inside faces: 2 × (390 + 290)
    expect(html).toContain('28,27 m³') // 11.31 m² × 2,50 m = 28.275, shown rounded down (binary float 28.27499...)
    expect(html).toContain('(apartment default)')
    expect(html).toContain('placeholder="250"')
    expect(html).toContain('Apartment default: 250 cm')
  })

  it('uses the room ceiling and drops the inherited hint when it has one', () => {
    const html = render({ kind: 'room', roomId: 'r1' }, doc({ rooms: [rect({ ceilingCm: 270 })] }))
    expect(html).toContain('30,54 m³') // 11.31 m² × 2,70 m = 30.537
    expect(html).not.toContain('(apartment default)')
    expect(html).not.toContain('Apartment default:')
  })

  it('gives no volume when no ceiling is known', () => {
    const html = render({ kind: 'room', roomId: 'r1' }, doc({ apartment: undefined }))
    expect(html).toContain('—')
    expect(html).not.toContain('m³')
  })

  it('shows the wall type, the lock and the elements on the wall', () => {
    const html = render({ kind: 'wall', roomId: 'r1', wallStart: 'v0' }, doc({
      rooms: [rect({ walls: { v0: { type: 'bearing', thicknessCm: 25, locked: true } } })],
    }))
    expect(html).toContain('Wall SE-1')
    expect(html).toContain('aria-label="Wall type"')
    expect(html).toContain('aria-pressed="true"')
    expect(html).toContain('name="wallLocked"')
    expect(html).toContain('aria-label="On this wall"')
    expect(html).toContain('Key B: bearing / partition')
    // Locked wall: the length field is disabled.
    expect(html).toMatch(/id="wall-length"[^>]*disabled/)
  })

  it('marks a measured length in green', () => {
    const html = render({ kind: 'room', roomId: 'r1' }, doc({
      measurements: { 'SE-2': { label: 'SE-2', actualCm: 305, updatedAt: '' } },
    }))
    expect(html).toContain('305')
    expect(html).toContain('aria-label="measured"')
    expect(html).toContain('text-emerald-700')
  })

  it('shows the old values of the room in Edit Mode too', () => {
    // A value that left the room when a wall changed (decision (e)).
    const html = render({ kind: 'room', roomId: 'r1' }, doc({
      oldMeasurements: [{
        label: 'SE-2', actualCm: 302, updatedAt: '', roomCode: 'SE', reason: 'wall-split', droppedAt: '2026-11-24T10:00:00.000Z',
      }],
    }))
    // react-dom/server separates the count from its text: check the opening words.
    expect(html).toContain('Old values (')
    expect(html).toContain('302')
  })

  it('keeps the vertex texts and the hole text', () => {
    const vertex = render({ kind: 'vertex', roomId: 'r1', vertexId: 'v1' })
    // react-dom/server separates interpolated text nodes with <!-- -->, so match fragments.
    expect(vertex).toContain('aria-label="Vertex"')
    expect(vertex).toContain('id="vertex-x"')
    expect(vertex).toContain('id="vertex-y"')
    expect(vertex).toContain('Press Delete to remove it')
    expect(vertex).not.toContain('a room needs 3 vertices')
    const hole = render({ kind: 'room', roomId: 'r1' }, doc(), { roomId: 'r1', holeIndex: 0 })
    expect(hole).toContain('Hole selected. Drag its handles to reshape it.')
  })

  it('keeps the room tools in Measured lengths and points to the Solve tab', () => {
    const html = render({ kind: 'room', roomId: 'r1' })
    expect(html).toContain('>Apply measured lengths</button>')
    expect(html).toContain('name="lockVerifiedWalls"')
    // The whole-plan tools moved to the Solve tab (docs/sidebar-plan-3.md).
    expect(html).not.toContain('Apply to all rooms')
    expect(html).not.toContain('Solve whole plan')
    expect(html).not.toContain('name="solveKeepLocked"')
    expect(html).toContain('Whole plan: Solve tab.')
    expect(html).toContain('data-goto-solve')
  })

  it('renders nothing without a room selection', () => {
    expect(render(null)).toBe('')
    expect(render({ kind: 'element', elementId: 'e1' })).toBe('')
  })
})
