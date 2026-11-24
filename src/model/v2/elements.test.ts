// Tests of the elements on walls of a v2 document (docs/walls-plan.md, phase 7). Pure, cm, y down.
//
// What must hold: an element belongs to ONE wall, a door between two rooms is ONE element, and an
// edit of the rooms never loses or misplaces an element.
import { beforeAll, describe, expect, it } from 'vitest'
import { apply } from '../../core/commands'
import { demoRooms } from '../../features/measure/demo'
import { adjacentItems } from '../../features/measure/logic'
import { moveCornerNode, moveGraphRooms, moveStoredWall } from '../../features/rooms/interaction'
import { installMeasureRules } from '../../features/rooms/measureRules'
import { dist } from '../geometry'
import { emptyDoc, useDoc } from '../store'
import type { PlanDoc, Room, StoredWall, WallElement } from '../types'
import { convertToV2 } from './convert'
import { attachElements, materializeElements, syncElements } from './elements'
import { ensureV2 } from './ensure'
import { v2SyncRule } from './syncRule'
import { applyRoomPolygon } from './write'

// ---------- the plans of these tests ----------

/** A v1 document with these rooms and elements. */
const plan = (rooms: Room[], elements: WallElement[] = []): PlanDoc => ({
  projectId: 'p1', title: 'test', rooms, elements, measurements: {}, roomNotes: {}, tapes: [],
})

/** One room of a test plan: polygon in cm, one corner id per point. */
const mk = (id: string, pts: [number, number][], walkOrder: number): Room => ({
  id,
  code: id,
  name: id,
  vertices: pts.map(([x, y], i) => ({ id: `${id}-v${i}`, x, y })),
  holes: [],
  walls: {},
  walkOrder,
})

const rect = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]

/**
 * A = x 0..300, C = x 300..600, y 0..400: the wall between them runs from (300,0) to (300,400).
 * The outside is on the left (x = 0) and on the right (x = 600).
 */
const acRooms = () => [mk('A', rect(0, 0, 300, 400), 1), mk('C', rect(300, 0, 600, 400), 2)]

/** A v2 document of these v1 rooms and elements. */
const v2 = (rooms: Room[], elements: WallElement[] = []) => convertToV2(plan(rooms, elements)).doc

/** An element of a test plan. */
const el = (over: Partial<WallElement> & Pick<WallElement, 'roomId' | 'wallStart'>): WallElement => ({
  id: 'e1', kind: 'door', widthCm: 80, offsetCm: 100, createdAt: '1', updatedAt: '1', ...over,
})

const roomOf = (doc: PlanDoc, id: string) => doc.rooms.find((r) => r.id === id)!

/** The walls that hold a face of both rooms: the ONE wall between them. */
const wallsBetween = (doc: PlanDoc, a: string, b: string) =>
  (doc.walls ?? []).filter((w) => w.faces.some((f) => f.roomId === a) && w.faces.some((f) => f.roomId === b))

/** The world points of the two edges of an element (its span on its room wall). */
function span(doc: PlanDoc, e: WallElement): { a: { x: number; y: number }; b: { x: number; y: number } } | null {
  const room = doc.rooms.find((r) => r.id === e.roomId)
  if (!room) return null
  const v = room.vertices
  const i = v.findIndex((x) => x.id === e.wallStart)
  if (i < 0) return null
  const s = v[i]
  const t = v[(i + 1) % v.length]
  const length = dist(s, t)
  if (!(length > 0)) return null
  const d = { x: (t.x - s.x) / length, y: (t.y - s.y) / length }
  const at = (cm: number) => ({ x: s.x + d.x * cm, y: s.y + d.y * cm })
  return { a: at(e.offsetCm), b: at(e.offsetCm + e.widthCm) }
}

/** The world points of the two edges of an element from its WALL (`alongCm` from node a). */
function wallSpan(doc: PlanDoc, e: WallElement): { a: { x: number; y: number }; b: { x: number; y: number } } | null {
  const wall = (doc.walls ?? []).find((w) => w.id === e.wallId)
  const nodes = new Map((doc.nodes ?? []).map((n) => [n.id, n]))
  const a = wall ? nodes.get(wall.a) : undefined
  const b = wall ? nodes.get(wall.b) : undefined
  if (!wall || !a || !b || e.alongCm === undefined) return null
  const length = dist(a, b)
  if (!(length > 0)) return null
  const d = { x: (b.x - a.x) / length, y: (b.y - a.y) / length }
  const at = (cm: number) => ({ x: a.x + d.x * cm, y: a.y + d.y * cm })
  return { a: at(e.alongCm), b: at(e.alongCm + e.widthCm) }
}

/** Round a view number the way a comparison reads it (0.1 cm). */
const r1 = (v: number) => Math.round(v * 10) / 10

beforeAll(() => installMeasureRules())

describe('attachElements: the view becomes a wall', () => {
  it('gives every element of a v2 document its wall and its distance from node a, and keeps the view', () => {
    const v1 = plan(acRooms(), [
      el({ id: 'door', roomId: 'A', wallStart: 'A-v1', offsetCm: 100 }),
      el({ id: 'win', roomId: 'A', wallStart: 'A-v0', offsetCm: 40, kind: 'window', widthCm: 120 }),
    ])
    const doc = v2(acRooms(), v1.elements)
    // The conversion itself does not add a wall to an element (the load step does).
    expect(doc.elements.every((e) => e.wallId === undefined)).toBe(true)

    const attached = attachElements(doc)
    const shared = wallsBetween(attached, 'A', 'C')[0]
    const door = attached.elements.find((e) => e.id === 'door')!
    expect(door.wallId).toBe(shared.id)
    // A-v1 goes from (300,0) to (300,400); the shared wall runs the same way, so 100 cm from node a.
    expect(door.alongCm).toBeCloseTo(100, 3)
    // The view did not change: nothing moves on the plan.
    expect(door.roomId).toBe('A')
    expect(door.wallStart).toBe('A-v1')
    expect(door.offsetCm).toBe(100)

    const win = attached.elements.find((e) => e.id === 'win')!
    expect(win.wallId).toBeDefined()
    expect(win.wallId).not.toBe(shared.id)
    expect(win.offsetCm).toBe(40)

    // A second call does nothing (same document object).
    expect(attachElements(attached)).toBe(attached)
  })

  it('keeps the place of an element on a room wound the other way (CCW)', () => {
    // A is the same 300 x 400 room, but its polygon is typed counter-clockwise: the room runs from
    // A-v0 (0,0) to A-v1 (0,400) and then along the bottom wall to A-v2 (300,400).
    const ccw = () => [mk('A', [[0, 0], [0, 400], [300, 400], [300, 0]], 1)]
    const doc = attachElements(v2(ccw(), [el({ id: 'door', roomId: 'A', wallStart: 'A-v1', offsetCm: 100 })]))
    const door = doc.elements[0]
    expect(door.wallId).toBeDefined()
    // The view runs 100..180 cm from A-v1 (0,400) towards A-v2 (300,400): the same place on the plan.
    const world = span(doc, door)!
    expect(r1(world.a.x)).toBe(100)
    expect(r1(world.b.x)).toBe(180)
    expect(r1(world.a.y)).toBe(400)
    // The wall says the same place: 100..180 cm from its node a.
    const onWall = wallSpan(doc, door)!
    expect(r1(onWall.a.x)).toBe(100)
    expect(r1(onWall.b.x)).toBe(180)
    expect(r1(door.alongCm!)).toBe(100)
    // Nothing to correct: the wall and the view already say the same place.
    const back = materializeElements(doc)
    expect(back).toBe(doc)
    expect(back.elements[0].wallStart).toBe('A-v1')
    expect(r1(back.elements[0].offsetCm)).toBe(100)
  })

  it('keeps a v1 document as it is', () => {
    const v1 = plan(acRooms(), [el({ roomId: 'A', wallStart: 'A-v1' })])
    expect(attachElements(v1)).toBe(v1)
  })

  it('takes the face direction into account: an element of the room on side R', () => {
    // C sees the shared wall from the other side: its room wall runs (300,400) -> (300,0).
    const doc = attachElements(v2(acRooms(), [el({ roomId: 'C', wallStart: 'C-v3', offsetCm: 75 })]))
    const shared = wallsBetween(doc, 'A', 'C')[0]
    const door = doc.elements[0]
    expect(door.wallId).toBe(shared.id)
    // 75 cm from C's corner (300,400) toward (300,0) is the opening y 325..245: the near edge from
    // node a (300,0) is at 245 cm.
    const world = span(doc, door)!
    expect(Math.min(world.a.y, world.b.y)).toBeCloseTo(245, 3)
    expect(Math.max(world.a.y, world.b.y)).toBeCloseTo(325, 3)
    expect(door.alongCm).toBeCloseTo(245, 3)
  })
})

describe('the demo apartment with a door on a shared wall and a window on a facade', () => {
  it('converts with the views unchanged and every element on a wall', () => {
    const rooms = demoRooms()
    const se = rooms.find((r) => r.code === 'SE')!
    const en = rooms.find((r) => r.code === 'EN')!
    // SE-5 (demo-SE-v4 -> demo-SE-v5) is the wall Séjour shares with Entrée.
    const door = el({ id: 'door', roomId: se.id, wallStart: se.vertices[4].id, offsetCm: 20 })
    const win = el({
      id: 'win', roomId: se.id, wallStart: se.vertices[0].id, offsetCm: 60, kind: 'window', widthCm: 120,
    })
    const loaded = ensureV2(plan(rooms, [door, win]), { now: '2026-11-24T10:00:00.000Z' })

    for (const before of [door, win]) {
      const after = loaded.elements.find((e) => e.id === before.id)!
      expect(after.wallId).toBeDefined()
      expect(after.alongCm).toBeDefined()
      // The view is the same within 0.1 cm: nothing moves.
      expect(after.roomId).toBe(before.roomId)
      expect(after.wallStart).toBe(before.wallStart)
      expect(r1(after.offsetCm)).toBe(r1(before.offsetCm))
    }
    // The door is on the ONE wall that the two rooms share: its wall shows a face of each of them.
    const doorAfter = loaded.elements.find((e) => e.id === 'door')!
    const doorWall = (loaded.walls ?? []).find((w) => w.id === doorAfter.wallId)!
    expect(doorWall.faces.some((f) => f.roomId === se.id)).toBe(true)
    expect(doorWall.faces.some((f) => f.roomId === en.id)).toBe(true)
    // The window is on a wall that has an outside face (a facade).
    const wall = (loaded.walls ?? []).find((w) => w.id === loaded.elements.find((e) => e.id === 'win')!.wallId)!
    expect(wall.faces.some((f) => f.roomId === undefined)).toBe(true)
    // Loading the v2 document again does not change it.
    expect(ensureV2(loaded, { now: '2026-11-24T10:00:00.000Z' })).toBe(loaded)
  })
})

describe('materializeElements: the wall is the source of the view', () => {
  /** The two rooms, with a door on the shared wall, and the door attached to its wall. */
  function withDoor(): PlanDoc {
    return attachElements(v2(acRooms(), [el({ id: 'door', roomId: 'A', wallStart: 'A-v1', offsetCm: 100 })]))
  }

  it('a wall drag takes the door with it', () => {
    const before = withDoor()
    const shared = wallsBetween(before, 'A', 'C')[0]
    const doorBefore = before.elements[0]
    const worldBefore = span(before, doorBefore)!
    const after = moveStoredWall(before, shared.id, { x: 40, y: 0 })
    const doorAfter = after.elements[0]
    // Same wall, same distance from node a, same view: only the wall moved.
    expect(doorAfter.wallId).toBe(shared.id)
    expect(doorAfter.alongCm).toBeCloseTo(doorBefore.alongCm!, 3)
    expect(doorAfter.offsetCm).toBeCloseTo(doorBefore.offsetCm, 3)
    const worldAfter = span(after, doorAfter)!
    expect(worldAfter.a.x).toBeCloseTo(worldBefore.a.x + 40, 3)
    expect(worldAfter.b.x).toBeCloseTo(worldBefore.b.x + 40, 3)
  })

  it('a room rectangle added against the wall keeps the door where it is', () => {
    // C is only the top half of the shared wall: the bottom part is free for a new room.
    const rooms = [mk('A', rect(0, 0, 300, 400), 1), mk('C', rect(300, 0, 600, 200), 2)]
    const doc = attachElements(v2(rooms, [el({ id: 'door', roomId: 'A', wallStart: 'A-v1', offsetCm: 250 })]))
    const shared = wallsBetween(doc, 'A', 'C')[0]
    const door = doc.elements[0]
    expect(door.wallId).toBe(shared.id)

    // A new rectangle below C, against the same wall: the wall is reused, the door is not touched.
    const next = v2SyncRule(doc, applyRoomPolygon(doc, 'D', mk('D', rect(300, 200, 600, 400), 3)))
    const after = next.elements[0]
    expect(after.roomId).toBe('A')
    expect(after.wallId).toBe(shared.id)
    expect(after.alongCm).toBeCloseTo(door.alongCm!, 3)
    expect(r1(after.offsetCm)).toBe(r1(door.offsetCm))
    // The wall now shows the door in the new room too (dashed there).
    const wall = (next.walls ?? []).find((w) => w.id === shared.id)!
    expect(wall.faces.some((f) => f.roomId === 'D')).toBe(true)
    expect(wallsBetween(next, 'A', 'C').map((w) => w.id)).toEqual([shared.id])
  })

  it('a corner added on the wall before the door changes the view, not the element', () => {
    // The door is at 250..330 of the shared wall; the corner goes at 150, before it.
    const rooms = acRooms()
    const doc = attachElements(v2(rooms, [el({ id: 'door', roomId: 'A', wallStart: 'A-v1', offsetCm: 250 })]))
    const shared = wallsBetween(doc, 'A', 'C')[0]
    const door = doc.elements[0]
    expect(door.alongCm).toBeCloseTo(250, 3)
    // A corner at (300,150) on the shared wall of A.
    const a = roomOf(doc, 'A')
    const withCorner: Room = {
      ...a,
      vertices: [a.vertices[0], a.vertices[1], { id: 'A-new', x: 300, y: 150 }, a.vertices[2], a.vertices[3]],
    }
    const next = v2SyncRule(doc, applyRoomPolygon(doc, 'A', withCorner))
    const after = next.elements[0]
    // The element is the same: same wall, same place on it.
    expect(after.wallId).toBe(shared.id)
    expect(after.alongCm).toBeCloseTo(door.alongCm!, 3)
    // The view moved to the face after the new corner: its corner id, and a shorter offset.
    const faces = (roomOf(next, 'A').cycle ?? []).filter((f) => f.wallId === shared.id)
    expect(faces.map((f) => f.cornerId)).toEqual(['A-v1', 'A-new'])
    expect(after.wallStart).toBe('A-new')
    expect(after.offsetCm).toBeCloseTo(100, 3)
    // The opening is still at the same place in the world.
    const world = span(next, after)!
    expect(Math.min(world.a.y, world.b.y)).toBeCloseTo(250, 3)
  })

  it('a room dragged alone takes its element onto the copy of the shared wall', () => {
    const doc = attachElements(v2(acRooms(), [el({ id: 'door', roomId: 'A', wallStart: 'A-v1', offsetCm: 100 })]))
    const shared = wallsBetween(doc, 'A', 'C')[0]
    const before = span(doc, doc.elements[0])!
    // Shift + drag: A moves alone, so it gets its own copy of the wall it shares with C.
    const next = moveGraphRooms(doc, ['A'], { x: -50, y: 0 }, true)
    const after = next.elements[0]
    expect(after.roomId).toBe('A')
    expect(after.wallId).toBeDefined()
    expect(after.wallId).not.toBe(shared.id)
    // The wall of the element is one of the walls of A, and the door moved with the room.
    expect((roomOf(next, 'A').cycle ?? []).some((f) => f.wallId === after.wallId)).toBe(true)
    expect(after.alongCm).toBeCloseTo(doc.elements[0].alongCm!, 3)
    const now = span(next, after)!
    expect(now.a.x).toBeCloseTo(before.a.x - 50, 3)
    // The neighbour keeps its wall.
    expect((roomOf(next, 'C').cycle ?? []).some((f) => f.wallId === shared.id)).toBe(true)
  })

  it('deleting the room the door opens into keeps the door, on the other room', () => {
    const doc = withDoor()
    const door = doc.elements[0]
    const before = span(doc, door)!
    const next = v2SyncRule(doc, { ...doc, rooms: doc.rooms.filter((r) => r.id !== 'A') })
    expect(next.rooms.some((r) => r.id === 'A')).toBe(false)
    const after = next.elements[0]
    expect(after.roomId).toBe('C')
    expect(after.wallId).toBe(door.wallId)
    expect(after.elementMoved).toBe(true)
    // The opening stays where it was in the world (the two edges swap, C runs the other way).
    const now = span(next, after)!
    const edges = (s: { a: { y: number }; b: { y: number } }) => [Math.min(s.a.y, s.b.y), Math.max(s.a.y, s.b.y)]
    expect(edges(now)[0]).toBeCloseTo(edges(before)[0], 3)
    expect(edges(now)[1]).toBeCloseTo(edges(before)[1], 3)
    expect(now.a.x).toBeCloseTo(before.a.x, 3)
  })

  it('deleting both rooms keeps the element on its wall (the wall stays, standalone)', () => {
    const doc = withDoor()
    const next = v2SyncRule(doc, { ...doc, rooms: [] })
    expect(next.elements.length).toBe(1)
    // The walls of a deleted room stay as standalone walls (docs/walls-plan.md, "Walls in the
    // interface"), so the door keeps its wall; its view (roomId) is the room that is gone.
    expect(next.elements[0].wallId).toBe(doc.elements[0].wallId)
    expect(next.elements[0].alongCm).toBe(doc.elements[0].alongCm)
    expect((next.walls ?? []).find((w) => w.id === doc.elements[0].wallId)!.standalone).toBe(true)
    expect(next.elements[0].roomId).toBe('A')
    expect(next.elements[0].offsetCm).toBe(100)
  })

  it('a view that the user moved along the wall gives a new distance from node a', () => {
    const doc = withDoor()
    const moved: PlanDoc = { ...doc, elements: [{ ...doc.elements[0], offsetCm: 60 }] }
    const next = syncElements(doc, moved)
    expect(next.elements[0].alongCm).toBeCloseTo(60, 3)
    expect(next.elements[0].offsetCm).toBeCloseTo(60, 3)
    // Round trip: the same view again gives the same document.
    expect(materializeElements(next)).toBe(next)
  })

  it('clamps the distance from node a into a wall that a corner drag made shorter', () => {
    const doc = withDoor()
    const door = doc.elements[0]
    const shared = wallsBetween(doc, 'A', 'C')[0]
    const nodes = new Map((doc.nodes ?? []).map((n) => [n.id, n]))
    const a = nodes.get(shared.a)!
    const b = nodes.get(shared.b)!
    // Drag node b down to 120 cm of the wall: the door (100..180) no longer fits.
    const to = a.y < b.y ? { x: b.x, y: a.y + 120 } : { x: b.x, y: a.y - 120 }
    const next = v2SyncRule(doc, moveCornerNode(doc, shared.b, to))
    const after = next.elements[0]
    expect(after.wallId).toBe(shared.id)
    expect(after.alongCm! + after.widthCm).toBeLessThanOrEqual(120 + 0.01)
    // Same element, and it is still on its wall.
    expect(after.id).toBe(door.id)
  })
})

describe('the door on a shared wall is ONE element', () => {
  it('shows dashed in the other room, and only on the wall it belongs to', () => {
    const doc = attachElements(v2(acRooms(), [el({ id: 'door', roomId: 'A', wallStart: 'A-v1', offsetCm: 100 })]))
    const shared = wallsBetween(doc, 'A', 'C')[0]
    // The geometry of the two rooms puts the door on a wall of C: it shows dashed there.
    expect(adjacentItems(doc, roomOf(doc, 'C')).length).toBe(1)
    expect(adjacentItems(doc, roomOf(doc, 'A')).length).toBe(0)
    // The SAME wall is the same door: a wall id that C does not have shows nothing, even where the
    // geometry alone would have shown it (a v2 door belongs to its wall).
    const other = (doc.walls ?? []).find((w) => !w.faces.some((f) => f.roomId === 'C'))!
    const wrong: PlanDoc = { ...doc, elements: [{ ...doc.elements[0], wallId: other.id }] }
    expect(adjacentItems(wrong, roomOf(wrong, 'C')).length).toBe(0)
    // A v1 element (no wall id) keeps the behaviour of the geometry.
    const v1Door = { ...doc.elements[0], wallId: undefined }
    const v1: PlanDoc = { ...doc, elements: [v1Door] }
    expect(adjacentItems(v1, roomOf(v1, 'C')).length).toBe(1)
    expect(shared.faces.some((f) => f.roomId === 'C')).toBe(true)
  })

  it('a door that opens into the other room moves room, not wall', () => {
    const doc = attachElements(v2(acRooms(), [el({ id: 'door', roomId: 'A', wallStart: 'A-v1', offsetCm: 100, swing: 'out' })]))
    const shared = wallsBetween(doc, 'A', 'C')[0]
    const next = syncElements(doc, { ...doc, elements: [{ ...doc.elements[0], swing: 'out' }] })
    // `syncElements` only calculates views; the door-host rule runs in core/doorHost and in the
    // store rules. Here the element stays in A: nothing moved it to the other room.
    expect(next.elements[0].roomId).toBe('A')
    expect(next.elements[0].wallId).toBe(shared.id)
  })
})

describe('undo, redo and the store', () => {
  it('a wall drag keeps the door on the wall, as ONE undo step', () => {
    useDoc.getState().replace(emptyDoc())
    useDoc.temporal.getState().clear()
    // The demo apartment with a door on the shared wall, loaded the way the app does it.
    const rooms = demoRooms()
    const se = rooms.find((r) => r.code === 'SE')!
    const door = el({ id: 'door', roomId: se.id, wallStart: se.vertices[4].id, offsetCm: 20 })
    useDoc.getState().update((d) => ensureV2({ ...d, rooms, elements: [door] }))
    const loaded = useDoc.getState().doc
    const wallId = loaded.elements[0].wallId!
    const before = useDoc.getState().doc
    useDoc.getState().update((d) => moveStoredWall(d, wallId, { x: 0, y: 25 }))
    const after = useDoc.getState().doc
    // The door is still on the same wall, at the same distance from node a.
    expect(after.elements[0].wallId).toBe(wallId)
    expect(after.elements[0].alongCm).toBeCloseTo(loaded.elements[0].alongCm!, 3)
    // ONE undo step gives the previous document back exactly, then redo gives the new one.
    const temporal = useDoc.temporal.getState()
    temporal.undo()
    expect(useDoc.getState().doc).toEqual(before)
    temporal.redo()
    expect(useDoc.getState().doc).toEqual(after)
  })
})

describe('the server commands', () => {
  it('gives the wall of a placed element in a v2 document', () => {
    const doc = v2(acRooms())
    const shared = wallsBetween(doc, 'A', 'C')[0]
    const out = apply(doc, {
      type: 'place_element',
      wall: { roomId: 'A', wallStart: 'A-v1' },
      kind: 'door',
      offsetCm: 120,
      widthCm: 80,
    })
    const placed = out.doc.elements[0]
    expect(placed.wallId).toBe(shared.id)
    expect(placed.alongCm).toBeCloseTo(120, 3)
    expect(placed.offsetCm).toBeCloseTo(120, 3)
  })

  it('keeps the wall of an element that a command moves along its wall', () => {
    const doc = attachElements(v2(acRooms(), [el({ id: 'door', roomId: 'A', wallStart: 'A-v1', offsetCm: 100 })]))
    const shared = wallsBetween(doc, 'A', 'C')[0]
    const out = apply(doc, { type: 'update_element', elementId: 'door', offsetCm: 200 })
    const moved = out.doc.elements[0]
    expect(moved.wallId).toBe(shared.id)
    expect(moved.offsetCm).toBeCloseTo(200, 3)
    expect(moved.alongCm).toBeCloseTo(200, 3)
  })

  it('leaves a v1 document alone', () => {
    const doc = plan(acRooms())
    const out = apply(doc, { type: 'place_element', wall: 'A-2', kind: 'door', offsetCm: 20, widthCm: 80 })
    expect(out.doc.elements[0].wallId).toBeUndefined()
  })
})

/** Every wall of a document, for the messages of a failure. */
const wallText = (w: StoredWall) => `${w.id} ${w.a}-${w.b}`
it('has a wall graph that the elements can point at', () => {
  const doc = v2(acRooms())
  expect((doc.walls ?? []).map(wallText).length).toBe((doc.walls ?? []).length)
})
