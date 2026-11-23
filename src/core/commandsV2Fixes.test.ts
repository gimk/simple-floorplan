// Server commands on a v2 document (docs/walls-plan.md phases 5c and 7), review findings 3 and 8:
// an element moved to another wall stays there, `set_wall_props` keeps the line of the wall,
// `update_room` renames the old values too, and `delete_room` keeps a door of a shared wall.
import { describe, expect, it } from 'vitest'
import { demoRooms } from '../features/measure/demo'
import { allSurveyIds } from '../model/survey'
import { emptyDoc } from '../model/store'
import type { Measurement, PlanDoc, Room } from '../model/types'
import { ensureV2 } from '../model/v2/ensure'
import { apply } from './commands'

const AT = '2026-11-24T09:00:00.000Z'

/** The demo apartment as a v2 document (what the client holds after a load). */
function demoV2(): PlanDoc {
  const rooms = demoRooms()
  const base: PlanDoc = { ...emptyDoc(), title: 'Demo', rooms }
  const measurements: Record<string, Measurement> = {}
  allSurveyIds(base).forEach((s, i) => { measurements[s.label] = { label: s.label, actualCm: 100 + i, updatedAt: AT } })
  return ensureV2({ ...base, measurements }, { now: AT })
}

/** A demo room by its id ('demo-SE'), as commandsV2.test.ts does. */
const roomOf = (doc: PlanDoc, id: string) => doc.rooms.find((r) => r.id === id)!
/** Label of the room wall that holds `wallId`, e.g. 'SE-2'. */
const labelOfWall = (room: Room, wallId: string): string => {
  const face = (room.cycle ?? []).find((f) => f.wallId === wallId)!
  return `${room.code}-${room.vertices.findIndex((v) => v.id === face.cornerId) + 1}`
}

describe('update_element to another wall on a v2 document (review finding 3)', () => {
  it('stays on the new wall (its wall and its distance from node a follow the view)', () => {
    const doc = demoV2()
    const se = roomOf(doc, 'demo-SE')
    const placed = apply(doc, { type: 'place_element', id: 'd1', wall: 'SE-1', kind: 'door', offsetCm: 50, widthCm: 80 }).doc
    const door = placed.elements.find((e) => e.id === 'd1')!
    expect(door.wallId).toBe(se.cycle![0].wallId)
    expect(door.wallStart).toBe(se.vertices[0].id)

    const moved = apply(placed, { type: 'update_element', elementId: 'd1', wall: 'SE-2', offsetCm: 10 }).doc
    const after = moved.elements.find((e) => e.id === 'd1')!
    // The view is the second wall of the room, and the wall of the element is that wall, not the
    // first one (before the fix the element snapped back to SE-1).
    expect(after.roomId).toBe(se.id)
    expect(after.wallStart).toBe(se.vertices[1].id)
    expect(after.offsetCm).toBe(10)
    expect(after.wallId).toBe(se.cycle![1].wallId)
    expect(after.wallId).not.toBe(door.wallId)
    // One element only: the door did not come back as a copy.
    expect(moved.elements).toHaveLength(placed.elements.length)
    // Its wall holds a face of the room that the view names.
    const wall = (moved.walls ?? []).find((w) => w.id === after.wallId)!
    expect(wall.faces.some((f) => f.roomId === se.id && f.wallStart === se.vertices[1].id)).toBe(true)
    expect(labelOfWall(se, after.wallId!)).toBe('SE-2')
  })
})

describe('a value without a target does not stop the relabel of a command (review finding 1)', () => {
  it('the values of a deleted room still go to the old values', () => {
    const doc = demoV2()
    // A value that came from the server without its target (an old client, PUT /measurements).
    const { target: _gone, ...noTarget } = doc.measurements['SE-2']
    const withOneMissing: PlanDoc = { ...doc, measurements: { ...doc.measurements, 'SE-2': noTarget } }
    expect(withOneMissing.measurements['SE-2'].target).toBeUndefined()

    const out = apply(withOneMissing, { type: 'delete_room', roomCode: 'WC' })
    // The values of WC are not in `measurements` any more, and they are not lost.
    expect(Object.keys(out.doc.measurements).some((k) => k.startsWith('WC-'))).toBe(false)
    expect((out.doc.oldMeasurements ?? []).some((m) => m.roomCode === 'WC' && m.reason === 'room-deleted')).toBe(true)
    // The value without a target got one, and it is still on its face.
    expect(out.doc.measurements['SE-2'].target).toBeDefined()
  })
})

describe('set_wall_props keeps the line of the wall (review finding 8)', () => {
  it('keeps `align` on the stored wall and on both rooms', () => {
    const doc = demoV2()
    const se = roomOf(doc, 'demo-SE')
    const corner = se.vertices[0].id
    const wallId = se.cycle![0].wallId
    // A wall that lines up with the next one (the align row of phase 4b), on the room and on the
    // stored wall.
    const before: PlanDoc = {
      ...doc,
      rooms: doc.rooms.map((r) => (r.id === se.id ? { ...r, walls: { ...r.walls, [corner]: { ...r.walls[corner], align: 'center' as const } } } : r)),
      walls: (doc.walls ?? []).map((w) => (w.id === wallId ? { ...w, align: 'center' as const } : w)),
    }
    expect((before.walls ?? []).find((w) => w.id === wallId)!.align).toBe('center')

    const out = apply(before, { type: 'set_wall_props', wall: 'SE-1', thicknessCm: 18 })
    const wall = (out.doc.walls ?? []).find((w) => w.id === wallId)!
    expect(wall.thicknessCm).toBe(18)
    expect(wall.align).toBe('center')
    expect(roomOf(out.doc, 'demo-SE').walls[corner].align).toBe('center')
  })
})

describe('update_room renames the old values (review finding 8)', () => {
  it('an old value of the room follows the new code', () => {
    const doc = demoV2()
    const se = roomOf(doc, 'demo-SE')
    const withOld: PlanDoc = {
      ...doc,
      oldMeasurements: [{ label: 'SE-9', actualCm: 123, updatedAt: AT, roomCode: 'SE', reason: 'wall-split', droppedAt: AT }],
    }
    const out = apply(withOld, { type: 'update_room', roomCode: 'SE', code: 'SA' })
    expect(out.doc.rooms.find((r) => r.code === 'SA')!.id).toBe(se.id)
    expect(out.doc.oldMeasurements).toEqual([
      { label: 'SA-9', actualCm: 123, updatedAt: AT, roomCode: 'SA', reason: 'wall-split', droppedAt: AT },
    ])
    // The values of the room follow the new code too (as before).
    expect(Object.keys(out.doc.measurements).some((k) => k.startsWith('SA-'))).toBe(true)
  })
})

describe('delete_room keeps a door of a shared wall (review finding 8)', () => {
  /** Two rooms DG and SD that share a wall, with a door on that wall, as a v2 document. */
  function twoRoomsWithDoor(): { doc: PlanDoc; sharedWallId: string; dgId: string; sdId: string } {
    const doc = demoV2()
    const dg = roomOf(doc, 'demo-DG')
    const sd = roomOf(doc, 'demo-SD')
    const shared = (doc.walls ?? []).find(
      (w) => w.faces.some((f) => f.roomId === dg.id) && w.faces.some((f) => f.roomId === sd.id),
    )!
    // The door is placed from the SIDE OF THE ROOM THAT IS DELETED (it opens into SD).
    const withDoor = apply(doc, {
      type: 'place_element', id: 'd-shared', wall: labelOfWall(sd, shared.id), kind: 'door', offsetCm: 40, widthCm: 80,
    }).doc
    const door = withDoor.elements.find((e) => e.id === 'd-shared')!
    expect(door.wallId).toBe(shared.id)
    expect(door.roomId).toBe(sd.id)
    return { doc: withDoor, sharedWallId: shared.id, dgId: dg.id, sdId: sd.id }
  }

  it('the door stays on its wall and opens into the room that is left', () => {
    const { doc, sharedWallId, sdId } = twoRoomsWithDoor()
    const out = apply(doc, { type: 'delete_room', roomId: sdId })
    expect(out.doc.rooms.some((r) => r.id === sdId)).toBe(false)
    // The wall stays (the other room uses it) and the door with it, as ONE element.
    expect((out.doc.walls ?? []).some((w) => w.id === sharedWallId)).toBe(true)
    const door = out.doc.elements.find((e) => e.id === 'd-shared')!
    expect(door).toBeDefined()
    expect(door.wallId).toBe(sharedWallId)
    // The door opens into a room that still exists (the room on the other side of its wall).
    expect(door.roomId).not.toBe(sdId)
    expect(out.doc.rooms.some((r) => r.id === door.roomId)).toBe(true)
    // The removed list does not name it: the answer of the command says what it removed.
    expect(out.result.removedElements).toEqual([])
  })

  it('an element on a wall that goes away with the room goes too', () => {
    const { doc } = twoRoomsWithDoor()
    // A window on a wall that only room C1 uses (an outer wall): it goes with the room.
    const c1 = roomOf(doc, 'demo-C1')
    const own = (doc.walls ?? []).find(
      (w) => w.faces.some((f) => f.roomId === c1.id) && !w.faces.some((f) => f.roomId !== undefined && f.roomId !== c1.id),
    )!
    const withWindow = apply(doc, {
      type: 'place_element', id: 'w-own', wall: labelOfWall(c1, own.id), kind: 'window', offsetCm: 20, widthCm: 60,
    }).doc
    const out = apply(withWindow, { type: 'delete_room', roomId: c1.id })
    expect(out.result.removedElements).toContain('w-own')
    expect(out.doc.elements.some((e) => e.id === 'w-own')).toBe(false)
    // The door of the shared wall stays.
    expect(out.doc.elements.some((e) => e.id === 'd-shared')).toBe(true)
  })
})
