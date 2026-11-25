import { describe, expect, it } from 'vitest'
import { roomAreaM2, roomWalls } from '../model/geometry'
import { parsePlan, type PlanDocV1 } from './schema'
import { apply, applyBatch, CommandError, CommandsBatchRequestSchema } from './commands'
import { commandScope, requiredScopeForCommands, summarizeCommand } from './access'

const emptyDoc = (): PlanDocV1 =>
  parsePlan({
    projectId: 'test',
    title: 'Test Apt',
    rooms: [],
    elements: [],
    measurements: {},
    roomNotes: {},
    tapes: [],
    pins: [],
  })

describe('commands: room lifecycle', () => {
  it('add_room with rect and with polygon vertices', () => {
    const r1 = apply(emptyDoc(), {
      type: 'add_room',
      code: 'SE',
      name: 'Living',
      rect: { x: 0, y: 0, w: 400, h: 300 },
      ceilingCm: 265,
    })
    expect(r1.doc.rooms).toHaveLength(1)
    // Inside faces with 10 cm walls: (400 - 10) x (300 - 10) = 390 x 290 cm = 11.31 m2
    expect(r1.result.areaM2).toBe(11.31)
    expect(r1.result.walls).toEqual(['SE-1', 'SE-2', 'SE-3', 'SE-4'])

    const r2 = apply(r1.doc, {
      type: 'add_room',
      code: 'TRI',
      name: 'Corner',
      vertices: [
        { x: 500, y: 0 },
        { x: 700, y: 0 },
        { x: 500, y: 200 },
      ],
    })
    expect(r2.doc.rooms).toHaveLength(2)
    // Inside triangle: inradius r = 20000 / s = 58.58 cm (s = 341.42), inside r - 5 = 53.58, area = 20000 x (53.58 / 58.58)^2 = 16 731 cm2
    expect(r2.result.areaM2).toBe(1.67)
  })

  it('update_room renames code and migrates measurements and roomNotes', () => {
    let doc = apply(emptyDoc(), {
      type: 'add_room',
      code: 'CU',
      name: 'Kitchen',
      rect: { x: 0, y: 0, w: 300, h: 250 },
    }).doc
    doc = apply(doc, { type: 'set_measurement', label: 'CU-1', actualCm: 302 }).doc
    doc = apply(doc, { type: 'set_room_note', roomCode: 'CU', text: 'Gas line' }).doc

    const res = apply(doc, {
      type: 'update_room',
      roomCode: 'CU',
      code: 'K1',
      name: 'Open Kitchen',
      ceilingCm: 260,
      outdoor: false,
      walkOrder: 5,
    })
    expect(res.doc.rooms[0].code).toBe('K1')
    expect(res.doc.rooms[0].name).toBe('Open Kitchen')
    expect(res.doc.rooms[0].ceilingCm).toBe(260)
    expect(res.doc.rooms[0].walkOrder).toBe(5)
    expect(res.doc.measurements['K1-1']?.actualCm).toBe(302)
    expect(res.doc.measurements['CU-1']).toBeUndefined()
    expect(res.doc.roomNotes['K1']).toBe('Gas line')
    expect(res.doc.roomNotes['CU']).toBeUndefined()
  })

  it('delete_room removes the room and its elements', () => {
    let doc = apply(emptyDoc(), {
      type: 'add_room',
      code: 'SE',
      rect: { x: 0, y: 0, w: 400, h: 300 },
    }).doc
    doc = apply(doc, { type: 'place_element', wall: 'SE-1', kind: 'door', offsetCm: 50, widthCm: 80 }).doc
    expect(doc.elements).toHaveLength(1)

    const res = apply(doc, { type: 'delete_room', roomCode: 'SE' })
    expect(res.doc.rooms).toHaveLength(0)
    expect(res.doc.elements).toHaveLength(0)
  })
})

describe('commands: measurements follow their wall', () => {
  it('slice_room keeps whole walls measured, drops split walls with a warning', () => {
    let doc = apply(emptyDoc(), { type: 'add_room', code: 'SE', name: 'Living', rect: { x: 0, y: 0, w: 600, h: 400 } }).doc
    for (const [label, cm] of [['SE-1', 601], ['SE-2', 402], ['SE-3', 603], ['SE-4', 404], ['SE-H', 250]] as const) {
      doc = apply(doc, { type: 'set_measurement', label, actualCm: cm }).doc
    }
    const res = apply(doc, { type: 'slice_room', roomCode: 'SE', a: { x: 200, y: -10 }, b: { x: 200, y: 410 }, newRoomCode: 'EN', newRoomName: 'Entry' })
    const w = res.warnings.find((x) => x.code === 'MEASUREMENT_DROPPED')
    expect(w?.details).toEqual({ labels: ['SE-1', 'SE-3'] })
    const values = Object.values(res.doc.measurements).map((m) => m.actualCm).sort()
    expect(values).toEqual([250, 250, 402, 404]) // 2 whole walls + the height copied to both rooms
    expect(res.doc.measurements['EN-H']?.actualCm).toBe(250)
  })
})

describe('commands: geometry ops (slice, cutout, merge)', () => {
  it('slice_room splits a room and preserves elements', () => {
    let doc = apply(emptyDoc(), {
      type: 'add_room',
      code: 'SE',
      name: 'Living',
      rect: { x: 0, y: 0, w: 600, h: 400 },
    }).doc
    doc = apply(doc, { type: 'place_element', wall: 'SE-1', kind: 'window', offsetCm: 50, widthCm: 100 }).doc

    const res = apply(doc, {
      type: 'slice_room',
      roomCode: 'SE',
      a: { x: 200, y: -10 },
      b: { x: 200, y: 410 },
      newRoomCode: 'EN',
      newRoomName: 'Entry',
    })
    expect(res.doc.rooms).toHaveLength(2)
    expect(res.doc.rooms.map((r) => r.code).sort()).toEqual(['EN', 'SE'])
    expect(res.doc.elements).toHaveLength(1)
    expect(res.result.elementsMoved).toBe(1)
  })

  it('cutout_room subtracts a shaft from a room', () => {
    const doc = apply(emptyDoc(), {
      type: 'add_room',
      code: 'CU',
      rect: { x: 0, y: 0, w: 300, h: 300 },
    }).doc
    const res = apply(doc, {
      type: 'cutout_room',
      roomCode: 'CU',
      rect: { x: 0, y: 0, w: 100, h: 100 },
    })
    // Inside outline: 290 x 290 minus the 100 x 100 notch at the inside corner: 84 100 - 10 000 = 74 100 cm2
    expect(roomAreaM2(res.doc.rooms[0])).toBeCloseTo(7.41, 2)
  })

  it('merge_rooms unions two adjacent rooms, drops shared-wall elements, and blocks bearing walls unless overridden', () => {
    let doc = apply(emptyDoc(), {
      type: 'add_room',
      code: 'SE',
      name: 'Living',
      rect: { x: 0, y: 0, w: 400, h: 300 },
    }).doc
    doc = apply(doc, {
      type: 'add_room',
      code: 'CU',
      name: 'Kitchen',
      rect: { x: 400, y: 0, w: 200, h: 300 },
    }).doc
    // Door on shared wall SE-2 (x=400, y=0..300) and window on outer wall SE-1
    doc = apply(doc, { type: 'place_element', id: 'el_door', wall: 'SE-2', kind: 'door', offsetCm: 100, widthCm: 80 }).doc
    doc = apply(doc, { type: 'place_element', id: 'el_win', wall: 'SE-1', kind: 'window', offsetCm: 50, widthCm: 120 }).doc

    // Mark shared wall bearing -> should block merge
    const bearingDoc = apply(doc, { type: 'set_wall_props', wall: 'SE-2', wallType: 'bearing', thicknessCm: 25 }).doc
    expect(() => apply(bearingDoc, { type: 'merge_rooms', roomCodes: ['SE', 'CU'] })).toThrow(CommandError)

    // Partition merge succeeds
    const merged = apply(doc, {
      type: 'merge_rooms',
      roomCodes: ['SE', 'CU'],
      keepCode: 'SE',
      newName: 'Open Living',
    })
    expect(merged.doc.rooms).toHaveLength(1)
    expect(merged.doc.rooms[0].code).toBe('SE')
    expect(merged.doc.rooms[0].name).toBe('Open Living')
    expect(roomAreaM2(merged.doc.rooms[0])).toBeCloseTo(17.11, 2) // inside: 590 × 290 (centre line 600 × 300)
    // Shared-wall door dropped; outer-wall window kept
    expect(merged.doc.elements.map((e) => e.id)).toEqual(['el_win'])
    expect(merged.result.elementsRemovedOnSharedWall).toHaveLength(1)

    // Bearing override succeeds with warning
    const forced = apply(bearingDoc, {
      type: 'merge_rooms',
      roomCodes: ['SE', 'CU'],
      allowBearingRemoval: true,
    })
    expect(forced.doc.rooms).toHaveLength(1)
    expect(forced.warnings.some((w) => w.code === 'BEARING_WALL_REMOVED')).toBe(true)
  })

  it('merge_rooms bridges a 10 cm partition gap between two rooms', () => {
    let doc = apply(emptyDoc(), {
      type: 'add_room',
      code: 'A',
      rect: { x: 0, y: 0, w: 300, h: 300 },
    }).doc
    doc = apply(doc, {
      type: 'add_room',
      code: 'B',
      rect: { x: 310, y: 0, w: 200, h: 300 },
    }).doc
    const merged = apply(doc, { type: 'merge_rooms', roomCodes: ['A', 'B'] })
    expect(merged.doc.rooms).toHaveLength(1)
    // Centre outline 510 x 300. Inside faces: (510 - 10) x (300 - 10) = 500 x 290 = 145 000 cm2 = 14.50 m2
    expect(roomAreaM2(merged.doc.rooms[0])).toBeCloseTo(14.5, 2)
  })
})

describe('commands: walls, vertices, elements, measurements, notes, pins, tapes', () => {
  it('set_wall_props addresses walls by label and by {roomId, wallStart}', () => {
    const doc = apply(emptyDoc(), {
      type: 'add_room',
      code: 'SE',
      rect: { x: 0, y: 0, w: 400, h: 300 },
    }).doc
    const r1 = apply(doc, { type: 'set_wall_props', wall: 'SE-2', wallType: 'bearing', thicknessCm: 25, locked: true })
    const room = r1.doc.rooms[0]
    const w2 = roomWalls(room)[1]
    expect(room.walls[w2.start.id]).toEqual({ type: 'bearing', thicknessCm: 25, locked: true })

    const r2 = apply(r1.doc, {
      type: 'set_wall_props',
      wall: { roomId: room.id, wallStart: w2.start.id },
      locked: false,
    })
    expect(r2.doc.rooms[0].walls[w2.start.id].locked).toBe(false)
  })

  it('set_wall_length and move_vertex update coordinates and respect locks', () => {
    let doc = apply(emptyDoc(), {
      type: 'add_room',
      code: 'SE',
      rect: { x: 0, y: 0, w: 400, h: 300 },
    }).doc
    doc = apply(doc, { type: 'set_wall_length', wall: 'SE-1', lengthCm: 450, anchor: 'start' }).doc
    expect(roomWalls(doc.rooms[0])[0].length).toBeCloseTo(450, 1)

    doc = apply(doc, { type: 'move_vertex', roomCode: 'SE', vertexIndex: 2, x: 450, y: 320 }).doc
    expect(doc.rooms[0].vertices[2]).toMatchObject({ x: 450, y: 320 })

    const lockedDoc = apply(doc, { type: 'set_wall_props', wall: 'SE-1', locked: true }).doc
    expect(() => apply(lockedDoc, { type: 'set_wall_length', wall: 'SE-1', lengthCm: 500 })).toThrow(CommandError)
  })

  it('place_element, update_element, delete_element + overflow warning', () => {
    const doc = apply(emptyDoc(), {
      type: 'add_room',
      code: 'CU',
      rect: { x: 0, y: 0, w: 200, h: 200 },
    }).doc

    const p1 = apply(doc, {
      type: 'place_element',
      id: 'el_1',
      wall: 'CU-1',
      kind: 'window',
      variant: 'standard',
      offsetCm: 150,
      widthCm: 100,
    })
    expect(p1.warnings.some((w) => w.code === 'ELEMENT_OVERFLOW')).toBe(true)

    const p2 = apply(p1.doc, {
      type: 'update_element',
      elementId: 'el_1',
      offsetCm: 40,
      widthCm: 120,
      sillCm: 95,
    })
    expect(p2.warnings).toHaveLength(0)
    expect(p2.doc.elements[0].offsetCm).toBe(40)
    expect(p2.doc.elements[0].sillCm).toBe(95)

    const p3 = apply(p2.doc, { type: 'delete_element', elementId: 'el_1' })
    expect(p3.doc.elements).toHaveLength(0)
  })

  it('set_measurement, clear_measurement, apply_measurements', () => {
    let doc = apply(emptyDoc(), {
      type: 'add_room',
      code: 'CU',
      rect: { x: 0, y: 0, w: 300, h: 200 },
    }).doc
    doc = apply(doc, { type: 'set_measurement', label: 'CU-1', actualCm: 310 }).doc
    doc = apply(doc, { type: 'set_measurement', label: 'CU-2', actualCm: 205 }).doc
    doc = apply(doc, { type: 'set_measurement', label: 'CU-H', actualCm: 264 }).doc

    const applied = apply(doc, { type: 'apply_measurements', roomCode: 'CU', lockVerifiedWalls: true })
    const walls = roomWalls(applied.doc.rooms[0])
    // Measured values are inside faces: centre line = inside + 10 (5 cm per end, square corners).
    expect(walls[0].length).toBeCloseTo(320, 1) // 310 inside
    expect(walls[1].length).toBeCloseTo(215, 1) // 205 inside
    expect(applied.doc.rooms[0].walls[walls[0].start.id]?.locked).toBe(true)

    const cleared = apply(applied.doc, { type: 'clear_measurement', label: 'CU-H' })
    expect(cleared.doc.measurements['CU-H']).toBeUndefined()
  })

  it('set_room_note, add_pin, add_tape', () => {
    let doc = apply(emptyDoc(), {
      type: 'add_room',
      code: 'EN',
      rect: { x: 0, y: 0, w: 200, h: 200 },
    }).doc

    doc = apply(doc, { type: 'set_room_note', roomCode: 'EN', text: 'Fuse box' }).doc
    expect(doc.roomNotes['EN']).toBe('Fuse box')

    doc = apply(doc, {
      type: 'add_pin',
      id: 'pin_1',
      wall: 'EN-1',
      at: { x: 100, y: 0 },
      text: 'Panel',
    }).doc
    expect(doc.pins).toHaveLength(1)
    expect(doc.pins[0].wallStart).toBe(doc.rooms[0].vertices[0].id)

    const tapeRes = apply(doc, {
      type: 'add_tape',
      id: 'tape_1',
      roomCode: 'EN',
      a: { x: 0, y: 50 },
      b: { x: 120, y: 50 },
      actualCm: 121,
      label: 'Hallway width',
    })
    expect(tapeRes.doc.tapes).toHaveLength(1)
    expect(tapeRes.result.lengthCm).toBe(120)
  })

  it('applyBatch executes in order and throws with commandIndex on failure', () => {
    const ok = applyBatch(emptyDoc(), [
      { type: 'add_room', code: 'SE', rect: { x: 0, y: 0, w: 400, h: 300 } },
      { type: 'set_measurement', label: 'SE-1', actualCm: 402 },
    ])
    expect(ok.doc.rooms).toHaveLength(1)
    expect(ok.results).toHaveLength(2)

    try {
      applyBatch(emptyDoc(), [
        { type: 'add_room', code: 'SE', rect: { x: 0, y: 0, w: 400, h: 300 } },
        { type: 'delete_room', roomCode: 'NOPE' },
      ])
      expect.unreachable('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(CommandError)
      expect((err as Error & { commandIndex?: number }).commandIndex).toBe(1)
    }
  })
})

// ---------- one happy-path test per command type (all 18) ----------

/** Two adjacent rooms: SE (0,0 400x300) and CU (400,0 200x300) sharing the wall x=400. */
const twoRooms = (): PlanDocV1 =>
  apply(
    apply(emptyDoc(), { type: 'add_room', id: 'r-se', code: 'SE', name: 'Living', rect: { x: 0, y: 0, w: 400, h: 300 }, ceilingCm: 265 }).doc,
    { type: 'add_room', id: 'r-cu', code: 'CU', name: 'Kitchen', rect: { x: 400, y: 0, w: 200, h: 300 } },
  ).doc

describe('commands: happy path for every command type', () => {
  it('add_room', () => {
    const res = apply(twoRooms(), { type: 'add_room', code: 'WC', rect: { x: 600, y: 0, w: 100, h: 100 } })
    expect(res.doc.rooms.map((r) => r.code)).toEqual(['SE', 'CU', 'WC'])
    expect(res.result.code).toBe('WC')
  })

  it('update_room (incl. ceilingCm: null to remove it)', () => {
    let res = apply(twoRooms(), { type: 'update_room', roomCode: 'SE', name: 'Séjour', outdoor: false })
    expect(res.doc.rooms[0].name).toBe('Séjour')
    res = apply(res.doc, { type: 'update_room', roomCode: 'SE', ceilingCm: null })
    expect(res.doc.rooms[0].ceilingCm).toBeUndefined()
  })

  it('delete_room (also removes its elements)', () => {
    let doc = apply(twoRooms(), { type: 'place_element', id: 'e1', wall: 'CU-1', kind: 'door', offsetCm: 20, widthCm: 80 }).doc
    const res = apply(doc, { type: 'delete_room', roomId: 'r-cu' })
    expect(res.doc.rooms.map((r) => r.code)).toEqual(['SE'])
    expect(res.doc.elements).toHaveLength(0)
  })

  it('slice_room', () => {
    const res = apply(twoRooms(), { type: 'slice_room', roomCode: 'SE', a: { x: 200, y: -10 }, b: { x: 200, y: 310 }, newRoomCode: 'EN' })
    expect(res.doc.rooms.map((r) => r.code).sort()).toEqual(['CU', 'EN', 'SE'])
  })

  it('cutout_room', () => {
    const res = apply(twoRooms(), { type: 'cutout_room', roomCode: 'SE', rect: { x: 0, y: 0, w: 100, h: 100 } })
    // Inside outline: 103 100 cm2 = 10.31 m2 (see cutout_room in the geometry section)
    expect(roomAreaM2(res.doc.rooms.find((r) => r.code === 'SE')!)).toBeCloseTo(10.31, 2)
  })

  it('merge_rooms (by roomIds)', () => {
    const res = apply(twoRooms(), { type: 'merge_rooms', roomIds: ['r-se', 'r-cu'], keepCode: 'SE' })
    expect(res.doc.rooms).toHaveLength(1)
    expect(roomAreaM2(res.doc.rooms[0])).toBeCloseTo(17.11, 2) // inside: 590 × 290
  })

  it('set_wall_props', () => {
    const res = apply(twoRooms(), { type: 'set_wall_props', wall: 'SE-1', wallType: 'exterior', locked: true })
    const w = roomWalls(res.doc.rooms[0])[0]
    expect(res.doc.rooms[0].walls[w.start.id]).toMatchObject({ type: 'exterior', locked: true })
  })

  it('set_wall_length (anchors start / end / center)', () => {
    const doc = twoRooms()
    for (const anchor of ['start', 'end', 'center'] as const) {
      const res = apply(doc, { type: 'set_wall_length', wall: 'SE-1', lengthCm: 500, anchor })
      expect(roomWalls(res.doc.rooms[0])[0].length).toBeCloseTo(500, 1)
    }
  })

  it('move_vertex (moves the linked vertex of the adjacent room too)', () => {
    const res = apply(twoRooms(), { type: 'move_vertex', roomCode: 'SE', vertexIndex: 1, x: 400, y: 50 })
    const se = res.doc.rooms.find((r) => r.code === 'SE')!
    const cu = res.doc.rooms.find((r) => r.code === 'CU')!
    expect(se.vertices[1]).toMatchObject({ x: 400, y: 50 })
    expect(cu.vertices[0]).toMatchObject({ x: 400, y: 50 })
    expect(res.result.linkedMoved).toBe(1)
  })

  it('place_element', () => {
    const res = apply(twoRooms(), { type: 'place_element', id: 'd1', wall: 'SE-1', kind: 'door', offsetCm: 50, widthCm: 80, hinge: 'start', swing: 'in' })
    expect(res.doc.elements).toHaveLength(1)
    expect(res.result.wallLabel).toBe('SE-1')
    expect(res.warnings).toHaveLength(0)
  })

  it('update_element (incl. moving to another wall and clearing a field with null)', () => {
    let doc = apply(twoRooms(), { type: 'place_element', id: 'd1', wall: 'SE-1', kind: 'door', offsetCm: 50, widthCm: 80, note: 'hinge left' }).doc
    const res = apply(doc, { type: 'update_element', elementId: 'd1', wall: 'SE-2', offsetCm: 10, note: null })
    expect(res.doc.elements[0].wallStart).toBe(res.doc.rooms[0].vertices[1].id)
    expect(res.doc.elements[0].note).toBeUndefined()
    expect(res.doc.elements[0].offsetCm).toBe(10)
  })

  it('delete_element', () => {
    const doc = apply(twoRooms(), { type: 'place_element', id: 'd1', wall: 'SE-1', kind: 'window', offsetCm: 0, widthCm: 100 }).doc
    const res = apply(doc, { type: 'delete_element', elementId: 'd1' })
    expect(res.doc.elements).toHaveLength(0)
    expect(res.result.deletedElementId).toBe('d1')
  })

  it('set_measurement + clear_measurement', () => {
    let res = apply(twoRooms(), { type: 'set_measurement', label: 'SE-1', actualCm: 402, updatedAt: '2026-01-01T00:00:00.000Z' })
    expect(res.doc.measurements['SE-1']).toMatchObject({ actualCm: 402, updatedAt: '2026-01-01T00:00:00.000Z' })
    res = apply(res.doc, { type: 'clear_measurement', label: 'SE-1' })
    expect(res.doc.measurements['SE-1']).toBeUndefined()
    expect(res.result.cleared).toBe(true)
  })

  it('apply_measurements (by roomIds, locks verified walls)', () => {
    let doc = apply(twoRooms(), { type: 'set_measurement', label: 'SE-1', actualCm: 410 }).doc
    doc = apply(doc, { type: 'set_measurement', label: 'SE-2', actualCm: 310 }).doc
    const res = apply(doc, { type: 'apply_measurements', roomIds: ['r-se'] })
    const walls = roomWalls(res.doc.rooms.find((r) => r.code === 'SE')!)
    // Inside values 410 and 310: centre line = inside + 10
    expect(walls[0].length).toBeCloseTo(420, 1)
    expect(walls[1].length).toBeCloseTo(320, 1)
    expect(res.doc.rooms[0].walls[walls[0].start.id]?.locked).toBe(true)
    expect(res.result.reports).toHaveLength(1)
  })

  it('set_room_note (empty text removes the note)', () => {
    let res = apply(twoRooms(), { type: 'set_room_note', roomCode: 'CU', text: 'gas' })
    expect(res.doc.roomNotes['CU']).toBe('gas')
    res = apply(res.doc, { type: 'set_room_note', roomCode: 'CU', text: '' })
    expect(res.doc.roomNotes['CU']).toBeUndefined()
  })

  it('add_pin (on a wall, and free in a room by code)', () => {
    let res = apply(twoRooms(), { type: 'add_pin', id: 'p1', wall: 'SE-1', at: { x: 100, y: 0 }, text: 'panel' })
    expect(res.doc.pins[0].wallStart).toBe(res.doc.rooms[0].vertices[0].id)
    res = apply(res.doc, { type: 'add_pin', id: 'p2', roomCode: 'CU', at: { x: 500, y: 150 }, photoKeys: ['k1'] })
    expect(res.doc.pins).toHaveLength(2)
    expect(res.doc.pins[1].roomId).toBe('r-cu')
    expect(res.doc.pins[1].photoKeys).toEqual(['k1'])
  })

  it('add_tape', () => {
    const res = apply(twoRooms(), { type: 'add_tape', id: 't1', roomCode: 'SE', a: { x: 0, y: 50 }, b: { x: 300, y: 50 }, actualCm: 301 })
    expect(res.doc.tapes).toHaveLength(1)
    expect(res.doc.tapes[0].roomId).toBe('r-se')
    expect(res.result.lengthCm).toBe(300)
  })
})

// ---------- error cases ----------

describe('commands: error cases', () => {
  it('unknown wall label: bad format, unknown room code, out-of-range wall index', () => {
    const doc = twoRooms()
    const codeOf = (wall: unknown) => {
      try { apply(doc, { type: 'set_wall_props', wall: wall as never, locked: true }); return null }
      catch (err) { return err instanceof CommandError ? err.code : 'not-a-CommandError' }
    }
    expect(codeOf('garbage')).toBe('INVALID_WALL_REF')
    expect(codeOf('XX-1')).toBe('ROOM_NOT_FOUND')
    expect(codeOf('SE-99')).toBe('WALL_NOT_FOUND')
    expect(codeOf({ roomCode: 'SE', wallIndex: 42 })).toBe('WALL_NOT_FOUND')
    expect(codeOf({ roomId: 'nope', wallStart: 'v' })).toBe('ROOM_NOT_FOUND')
  })

  it('merge_rooms across a bearing wall is blocked without allowBearingRemoval', () => {
    const bearing = apply(twoRooms(), { type: 'set_wall_props', wall: 'SE-2', wallType: 'bearing', thicknessCm: 25 }).doc
    try {
      apply(bearing, { type: 'merge_rooms', roomCodes: ['SE', 'CU'] })
      expect.unreachable('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(CommandError)
      expect((err as CommandError).code).toBe('BEARING_WALL_BLOCKED')
    }
  })

  it('place_element / update_element wider than the wall throw ELEMENT_TOO_WIDE', () => {
    const doc = twoRooms() // CU-1 is 200 cm long
    try {
      apply(doc, { type: 'place_element', wall: 'CU-1', kind: 'window', offsetCm: 0, widthCm: 250 })
      expect.unreachable('should have thrown')
    } catch (err) {
      expect((err as CommandError).code).toBe('ELEMENT_TOO_WIDE')
    }
    const withEl = apply(doc, { type: 'place_element', id: 'w1', wall: 'CU-1', kind: 'window', offsetCm: 0, widthCm: 100 }).doc
    try {
      apply(withEl, { type: 'update_element', elementId: 'w1', widthCm: 300 })
      expect.unreachable('should have thrown')
    } catch (err) {
      expect((err as CommandError).code).toBe('ELEMENT_TOO_WIDE')
    }
    // ...but an offset overflow (fits if clamped) stays a warning, not an error
    const res = apply(doc, { type: 'place_element', wall: 'CU-1', kind: 'window', offsetCm: 150, widthCm: 100 })
    expect(res.warnings.some((w) => w.code === 'ELEMENT_OVERFLOW')).toBe(true)
    expect(res.doc.elements).toHaveLength(1)
  })

  it('dryRun batches never mutate the input doc (pure apply layer)', () => {
    const commands = [
      { type: 'add_room', code: 'SE', rect: { x: 0, y: 0, w: 400, h: 300 } },
      { type: 'set_measurement', label: 'SE-1', actualCm: 402 },
    ] as const
    // The wire schema accepts dryRun and the pure layer has no side effects on the input.
    expect(CommandsBatchRequestSchema.parse({ commands, dryRun: true }).dryRun).toBe(true)

    const input = emptyDoc()
    const before = JSON.stringify(input)
    const ok = applyBatch(input, [...commands])
    expect(JSON.stringify(input)).toBe(before) // input doc untouched
    expect(ok.doc).not.toBe(input)
    expect(ok.doc.rooms).toHaveLength(1)

    // A failing batch leaves the input untouched as well (all-or-nothing, no partial writes).
    const failing = [...commands, { type: 'delete_room', roomCode: 'NOPE' }] as unknown[]
    try { applyBatch(input, failing); expect.unreachable('should have thrown') } catch { /* expected */ }
    expect(JSON.stringify(input)).toBe(before)
  })
})

// ---------- apartment data ----------

describe('commands: set_apartment', () => {
  it('sets and clears the default ceiling height', () => {
    let res = apply(emptyDoc(), { type: 'set_apartment', defaultCeilingCm: 250 })
    expect(res.doc.apartment?.defaultCeilingCm).toBe(250)
    expect(res.result.defaultCeilingCm).toBe(250)

    // null removes it, without touching the rest of the document.
    res = apply(res.doc, { type: 'set_apartment', defaultCeilingCm: null })
    expect(res.doc.apartment?.defaultCeilingCm).toBeUndefined()
    expect(res.doc.title).toBe('Test Apt')
  })

  it('adds, replaces and removes reference surfaces', () => {
    let res = apply(emptyDoc(), {
      type: 'set_apartment',
      addReference: { id: 'ref_dpe', source: 'dpe', surfaceM2: 62.4, label: 'DPE 2023', date: '2023-04-01' },
    })
    expect(res.doc.apartment?.references).toEqual([
      { id: 'ref_dpe', source: 'dpe', surfaceM2: 62.4, label: 'DPE 2023', date: '2023-04-01' },
    ])

    // Ids are generated when the client omits them.
    res = apply(res.doc, { type: 'set_apartment', addReference: { source: 'carrez', surfaceM2: 60.1 } })
    expect(res.doc.apartment?.references).toHaveLength(2)
    expect(res.doc.apartment?.references?.[1].id).toMatch(/^ref_/)

    // Full replacement.
    res = apply(res.doc, { type: 'set_apartment', references: [{ id: 'r1', source: 'deed', surfaceM2: 61 }] })
    expect(res.doc.apartment?.references).toEqual([{ id: 'r1', source: 'deed', surfaceM2: 61 }])

    // Removal by id.
    res = apply(res.doc, { type: 'set_apartment', removeReferenceId: 'r1' })
    expect(res.doc.apartment?.references).toEqual([])
  })

  it('rejects duplicate, unknown or malformed references', () => {
    const withRef = apply(emptyDoc(), {
      type: 'set_apartment',
      addReference: { id: 'r1', source: 'dpe', surfaceM2: 50 },
    }).doc
    const codeOf = (cmd: unknown) => {
      try { apply(withRef, cmd); return null } catch (err) { return err instanceof CommandError ? err.code : 'zod' }
    }
    expect(codeOf({ type: 'set_apartment', addReference: { id: 'r1', source: 'other', surfaceM2: 10 } })).toBe('DUPLICATE_REFERENCE_ID')
    expect(codeOf({
      type: 'set_apartment',
      references: [{ id: 'a', source: 'dpe', surfaceM2: 10 }, { id: 'a', source: 'carrez', surfaceM2: 10 }],
    })).toBe('DUPLICATE_REFERENCE_ID')
    expect(codeOf({ type: 'set_apartment', removeReferenceId: 'nope' })).toBe('REFERENCE_NOT_FOUND')
    // Zod: unknown source, non-positive surface, bad date, unknown field combination.
    expect(codeOf({ type: 'set_apartment', addReference: { source: 'tax', surfaceM2: 10 } })).toBe('zod')
    expect(codeOf({ type: 'set_apartment', addReference: { source: 'dpe', surfaceM2: -1 } })).toBe('zod')
    expect(codeOf({ type: 'set_apartment', addReference: { source: 'dpe', surfaceM2: 10, date: '01/04/2023' } })).toBe('zod')
    expect(codeOf({ type: 'set_apartment', defaultCeilingCm: 0 })).toBe('zod')
    // An empty set_apartment does nothing, so it is rejected.
    expect(codeOf({ type: 'set_apartment' })).toBe('zod')
  })

  it('warns when a reference points to an unknown room code but keeps it', () => {
    const res = apply(emptyDoc(), {
      type: 'set_apartment',
      references: [{ id: 'r1', source: 'carrez', surfaceM2: 12, roomCode: 'SE' }],
    })
    expect(res.doc.apartment?.references?.[0].roomCode).toBe('SE')
    expect(res.warnings.some((w) => w.code === 'UNKNOWN_ROOM_CODE')).toBe(true)
  })

  it('keeps documents without apartment data valid and needs edit scope', () => {
    expect(parsePlan({ projectId: 'p', rooms: [] }).apartment).toBeUndefined()
    expect(requiredScopeForCommands(['set_apartment'])).toBe('edit')
    expect(requiredScopeForCommands(['set_apartment', 'set_measurement'])).toBe('edit')
  })
})

describe('commands: door-host rule (a door belongs to the room it opens into)', () => {
  // SE = (0,0)-(400,300), CU = (400,0)-(600,300): the shared wall is SE-2 / CU-4, run in opposite directions.
  it('place_element moves an out-door onto the neighbour room and reports a warning', () => {
    const res = apply(twoRooms(), {
      type: 'place_element', id: 'd1', wall: 'SE-2', kind: 'door', offsetCm: 50, widthCm: 80, hinge: 'start', swing: 'out',
    })
    const el = res.doc.elements[0]
    expect(el.id).toBe('d1')
    expect(el.roomId).toBe('r-cu')
    expect(el.swing).toBe('in')
    expect(el.hinge).toBe('end') // the hinge stays at the same world point (the y = 50 end)
    expect(el.offsetCm).toBeCloseTo(170, 6)
    expect(res.warnings.some((w) => w.code === 'DOOR_REHOSTED')).toBe(true)
    expect((res.result.element as { roomId: string }).roomId).toBe('r-cu')
  })

  it('update_element moves the door when the swing becomes out', () => {
    let doc = apply(twoRooms(), {
      type: 'place_element', id: 'd1', wall: 'SE-2', kind: 'door', offsetCm: 50, widthCm: 80,
    }).doc
    expect(doc.elements[0].roomId).toBe('r-se')
    const res = apply(doc, { type: 'update_element', elementId: 'd1', swing: 'out' })
    expect(res.doc.elements[0].roomId).toBe('r-cu')
    expect(res.doc.elements[0].swing).toBe('in')
    expect(res.warnings.some((w) => w.code === 'DOOR_REHOSTED')).toBe(true)
    doc = res.doc
    // A second update finds nothing left to move.
    const again = apply(doc, { type: 'update_element', elementId: 'd1', note: 'keep' })
    expect(again.doc.elements[0].roomId).toBe('r-cu')
    expect(again.warnings.some((w) => w.code === 'DOOR_REHOSTED')).toBe(false)
  })

  it('leaves an in-door, a window and an exterior out-door in place', () => {
    const inDoor = apply(twoRooms(), {
      type: 'place_element', id: 'd1', wall: 'SE-2', kind: 'door', offsetCm: 50, widthCm: 80, swing: 'in',
    })
    expect(inDoor.doc.elements[0].roomId).toBe('r-se')
    expect(inDoor.warnings.some((w) => w.code === 'DOOR_REHOSTED')).toBe(false)

    const window = apply(twoRooms(), {
      type: 'place_element', id: 'w1', wall: 'SE-2', kind: 'window', offsetCm: 50, widthCm: 80, swing: 'out',
    })
    expect(window.doc.elements[0].roomId).toBe('r-se')

    const exterior = apply(twoRooms(), {
      type: 'place_element', id: 'd2', wall: 'SE-1', kind: 'door', offsetCm: 50, widthCm: 80, swing: 'out',
    })
    expect(exterior.doc.elements[0].roomId).toBe('r-se')
    expect(exterior.warnings.some((w) => w.code === 'DOOR_REHOSTED')).toBe(false)
  })

  it('applyBatch keeps the doc canonical after a batch', () => {
    const res = applyBatch(twoRooms(), [
      { type: 'place_element', id: 'd1', wall: 'SE-2', kind: 'door', offsetCm: 50, widthCm: 80 },
      { type: 'update_element', elementId: 'd1', swing: 'out' },
    ])
    expect(res.doc.elements[0].roomId).toBe('r-cu')
    expect(res.warnings.some((w) => w.code === 'DOOR_REHOSTED')).toBe(true)
  })
})

describe('commands: renovation wall status (7.4)', () => {
  const flat = () => {
    let doc = apply(emptyDoc(), { type: 'add_room', code: 'SE', name: 'Living', rect: { x: 0, y: 0, w: 400, h: 300 } }).doc
    doc = apply(doc, { type: 'add_room', code: 'CU', name: 'Kitchen', rect: { x: 400, y: 0, w: 200, h: 300 } }).doc
    return doc
  }

  it('stores demolish and new on a partition without a warning', () => {
    const r1 = apply(flat(), { type: 'set_wall_props', wall: 'CU-1', status: 'demolish' })
    expect(r1.doc.rooms[1].walls[roomWalls(r1.doc.rooms[1])[0].start.id].status).toBe('demolish')
    expect(r1.warnings).toHaveLength(0)

    const r2 = apply(r1.doc, { type: 'set_wall_props', wall: 'CU-2', status: 'new' })
    expect(r2.result.props).toMatchObject({ type: 'partition', thicknessCm: 10, status: 'new' })
    expect(r2.warnings).toHaveLength(0)
  })

  it('keeps existing as an absent field and keeps the other props', () => {
    const bearing = apply(flat(), { type: 'set_wall_props', wall: 'SE-2', wallType: 'bearing', thicknessCm: 25 }).doc
    const demolished = apply(bearing, { type: 'set_wall_props', wall: 'SE-2', status: 'demolish' }).doc
    const back = apply(demolished, { type: 'set_wall_props', wall: 'SE-2', status: 'existing' })
    const wall = roomWalls(back.doc.rooms[0])[1]
    expect(back.doc.rooms[0].walls[wall.start.id]).toEqual({ type: 'bearing', thicknessCm: 25 })
    expect(back.warnings).toHaveLength(0)
  })

  it('keeps the thickness when only the type changes', () => {
    const thick = apply(flat(), { type: 'set_wall_props', wall: 'SE-2', thicknessCm: 18 }).doc
    const bearing = apply(thick, { type: 'set_wall_props', wall: 'SE-2', wallType: 'bearing' }).doc
    const wall = roomWalls(bearing.rooms[0])[1]
    expect(bearing.rooms[0].walls[wall.start.id]).toEqual({ type: 'bearing', thicknessCm: 18 })
  })

  it('warns when a bearing or exterior wall is marked for demolition', () => {
    const doc = apply(flat(), { type: 'set_wall_props', wall: 'SE-2', wallType: 'bearing', thicknessCm: 25 }).doc
    const res = apply(doc, { type: 'set_wall_props', wall: 'SE-2', status: 'demolish' })
    expect(res.doc.rooms[0].walls[roomWalls(res.doc.rooms[0])[1].start.id].status).toBe('demolish')
    expect(res.warnings).toHaveLength(1)
    expect(res.warnings[0].code).toBe('STRUCTURAL_DEMOLITION')
    expect(res.warnings[0].message).toBe('STRUCTURAL: bearing wall marked for demolition')
    expect(res.warnings[0].details).toMatchObject({ roomCode: 'SE', wallLabel: 'SE-2', wallType: 'bearing' })

    const ext = apply(flat(), { type: 'set_wall_props', wall: 'SE-1', wallType: 'exterior', thicknessCm: 30 }).doc
    const extRes = apply(ext, { type: 'set_wall_props', wall: 'SE-1', status: 'demolish' })
    expect(extRes.warnings[0].message).toBe('STRUCTURAL: exterior wall marked for demolition')
  })

  it('rejects an unknown status', () => {
    expect(() => apply(flat(), { type: 'set_wall_props', wall: 'SE-1', status: 'remove' })).toThrow()
  })
})

describe('commands: document solver (docs/solver-plan.md)', () => {
  /** Two adjacent rooms with on-site values that the drawn plan does not match, so the solve moves walls. */
  const measuredPlan = (): PlanDocV1 => {
    let doc = apply(emptyDoc(), { type: 'add_room', code: 'SE', name: 'Living', rect: { x: 0, y: 0, w: 400, h: 300 } }).doc
    doc = apply(doc, { type: 'add_room', code: 'CU', name: 'Kitchen', rect: { x: 400, y: 0, w: 300, h: 300 } }).doc
    doc = apply(doc, { type: 'set_measurement', label: 'SE-1', actualCm: 412 }).doc
    doc = apply(doc, { type: 'set_measurement', label: 'SE-2', actualCm: 292 }).doc
    doc = apply(doc, { type: 'set_measurement', label: 'CU-1', actualCm: 308 }).doc
    doc = apply(doc, { type: 'set_measurement', label: 'CU-2', actualCm: 296 }).doc
    return doc
  }

  it('set_solver on solves the plan, and off restores the base geometry', () => {
    const on = apply(measuredPlan(), { type: 'set_solver', enabled: true })
    expect(on.doc.solver?.enabled).toBe(true)
    expect(on.result.changeCount).toBeGreaterThan(0)
    expect(on.result.message).toMatch(/^Solver on: \d+ changes, average mismatch [\d.]+ cm\.$/)
    expect(on.result.message).toContain(`Solver on: ${on.result.changeCount} changes, average mismatch `)

    const base = on.doc.solver?.baseNodes ?? {}
    expect(Object.keys(base).length).toBeGreaterThan(0)
    const solvedNodes = new Map((on.doc.nodes ?? []).map((n) => [n.id, n]))
    // The solve moved the walls away from the drawn plan.
    const moved = Object.entries(base).filter(([id, p]) => {
      const n = solvedNodes.get(id)
      return !!n && Math.hypot(n.x - p.x, n.y - p.y) > 0.01
    })
    expect(moved.length).toBeGreaterThan(0)

    const off = apply(on.doc, { type: 'set_solver', enabled: false })
    expect(off.doc.solver?.enabled).toBe(false)
    expect(off.doc.solver?.changes).toEqual([])
    expect(off.result.message).toBe('Solver off: plan back to estimated and measured values.')
    // Round trip: every node the solve moved is back at its base position.
    const offNodes = new Map((off.doc.nodes ?? []).map((n) => [n.id, n]))
    for (const [id, p] of Object.entries(base)) {
      const n = offNodes.get(id)
      expect(n?.x).toBeCloseTo(p.x, 6)
      expect(n?.y).toBeCloseTo(p.y, 6)
    }
  })

  it('set_solver takes the same options as the Solve tab', () => {
    const on = apply(measuredPlan(), { type: 'set_solver', enabled: true, keepLocked: false, snapThickness: true, angles: 'free' })
    expect(on.doc.solver?.enabled).toBe(true)
    expect(on.result.changeCount).toBeGreaterThan(0)
    // An unknown option value is rejected by the schema.
    expect(() => apply(measuredPlan(), { type: 'set_solver', enabled: true, angles: 'any' })).toThrow()
  })

  it('solver_revoke holds one change and solver_restore lets that wall move again', () => {
    const on = apply(measuredPlan(), { type: 'set_solver', enabled: true })
    const change = on.doc.solver!.changes[0]
    expect(change).toBeDefined()

    const rev = apply(on.doc, { type: 'solver_revoke', wallId: change.wallId, kind: change.kind })
    expect(rev.doc.solver?.revoked).toEqual(
      expect.arrayContaining([{ kind: change.kind, wallId: change.wallId, by: 'revoke' }]),
    )
    // A revoked change leaves the change list: the wall stays at its base value.
    expect(
      (rev.doc.solver?.changes ?? []).some((c) => c.kind === change.kind && c.wallId === change.wallId),
    ).toBe(false)
    expect(rev.result.message).toBe(`Revoked: wall ${change.wallId} ${change.kind} stays at its base value.`)

    const res = apply(rev.doc, { type: 'solver_restore', wallId: change.wallId, kind: change.kind })
    expect(
      (res.doc.solver?.revoked ?? []).some((h) => h.kind === change.kind && h.wallId === change.wallId),
    ).toBe(false)
    expect(res.result.message).toBe(`Restored: wall ${change.wallId} ${change.kind} can move again.`)
  })

  it('solver_revoke accepts a wall label and refuses an unknown wall', () => {
    const on = apply(measuredPlan(), { type: 'set_solver', enabled: true })
    const byLabel = apply(on.doc, { type: 'solver_revoke', wallId: 'SE-1', kind: 'position' })
    const wallId = byLabel.result.wallId as string
    expect((on.doc.walls ?? []).some((w) => w.id === wallId)).toBe(true)
    expect((byLabel.doc.solver?.revoked ?? []).some((h) => h.wallId === wallId && h.kind === 'position')).toBe(true)

    expect(() => apply(on.doc, { type: 'solver_revoke', wallId: 'W-NOPE', kind: 'position' })).toThrow(CommandError)
    expect(() => apply(on.doc, { type: 'solver_restore', wallId: 'W-NOPE', kind: 'thickness' })).toThrow(CommandError)
  })

  it('is an edit command with a short event-log summary', () => {
    expect(commandScope('set_solver')).toBe('edit')
    expect(commandScope('solver_revoke')).toBe('edit')
    expect(commandScope('solver_restore')).toBe('edit')
    expect(requiredScopeForCommands(['set_solver'])).toBe('edit')
    expect(summarizeCommand({ type: 'set_solver', enabled: true })).toBe('set_solver on')
    expect(summarizeCommand({ type: 'set_solver', enabled: false })).toBe('set_solver off')
    expect(summarizeCommand({ type: 'solver_revoke', wallId: 'W12', kind: 'position' })).toBe(
      'solver_revoke W12 position',
    )
    expect(summarizeCommand({ type: 'solver_restore', wallId: 'W12', kind: 'thickness' })).toBe(
      'solver_restore W12 thickness',
    )
  })

  it('drops the change of a wall that a command edits while the solver is On', () => {
    const on = apply(measuredPlan(), { type: 'set_solver', enabled: true })
    const before = on.doc.solver!.changes.length
    expect(before).toBeGreaterThan(0)

    // A user command that moves geometry. The vertex stays on the line of its wall, so the wall
    // graph keeps its nodes and the walls win on a v2 document.
    const edited = apply(on.doc, { type: 'move_vertex', roomCode: 'SE', vertexIndex: 1, x: 409, y: 0 })
    expect(edited.doc.solver?.enabled).toBe(true)
    const holds = (edited.doc.solver?.revoked ?? []).filter((h) => h.by === 'edit')
    expect(holds.length).toBeGreaterThan(0)
    // The edited walls are base now: they have no recorded change any more.
    for (const h of holds) {
      expect(
        (edited.doc.solver?.changes ?? []).some((c) => c.kind === h.kind && c.wallId === h.wallId),
      ).toBe(false)
    }
    expect((edited.doc.solver?.changes ?? []).length).toBeLessThan(before)
  })

  it('prunes deleted wall changes, baseNodes, baseThickness, and revoked on MCP delete_wall while On', () => {
    const on = apply(measuredPlan(), { type: 'set_solver', enabled: true })
    // Find the shared partition wall between SE and CU (SE-2) which has a recorded position change.
    const se = on.doc.rooms.find((r) => r.code === 'SE')!
    const sharedWallId = se.cycle![1].wallId
    expect(on.doc.solver!.changes.some((c) => c.wallId === sharedWallId)).toBe(true)

    const deleted = apply(on.doc, { type: 'delete_wall', wall: 'SE-2' })
    expect((deleted.doc.walls ?? []).some((w) => w.id === sharedWallId)).toBe(false)
    expect(deleted.doc.solver!.changes.some((c) => c.wallId === sharedWallId)).toBe(false)
    expect(sharedWallId in deleted.doc.solver!.baseThickness).toBe(false)
    expect(deleted.doc.solver!.revoked.some((h) => h.wallId === sharedWallId)).toBe(false)
    const liveNodeIds = new Set((deleted.doc.nodes ?? []).map((n) => n.id))
    for (const nid of Object.keys(deleted.doc.solver!.baseNodes)) {
      expect(liveNodeIds.has(nid)).toBe(true)
    }
  })

  it('uses "average mismatch" wording in apply_measurements CLOSING_ERROR warning', () => {
    let doc = apply(emptyDoc(), { type: 'add_room', code: 'SE', name: 'Living', rect: { x: 0, y: 0, w: 400, h: 300 } }).doc
    doc = apply(doc, { type: 'set_measurement', label: 'SE-1', actualCm: 400 }).doc
    doc = apply(doc, { type: 'set_measurement', label: 'SE-2', actualCm: 300 }).doc
    doc = apply(doc, { type: 'set_measurement', label: 'SE-3', actualCm: 460 }).doc
    doc = apply(doc, { type: 'set_measurement', label: 'SE-4', actualCm: 300 }).doc
    const res = apply(doc, { type: 'apply_measurements', roomCode: 'SE' })
    const warn = res.warnings.find((w) => w.code === 'CLOSING_ERROR')
    expect(warn).toBeDefined()
    expect(warn!.message).toMatch(/^Room SE has an average mismatch of [\d.]+ cm\.$/)
    expect(warn!.message).not.toContain('fit error')
    expect(warn!.message).not.toContain('rms')
  })
})
