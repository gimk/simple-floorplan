import { describe, expect, it } from 'vitest'
import { applyBatch } from './commands'
import { parsePlan, type PlanDocV1 } from './schema'
import { planToDsl, dslToPlan, DslParseError } from './dsl'
import type { PlanDoc, Room } from '../model/types'

const NOW = '2026-01-01T00:00:00.000Z'

const sampleDsl = `plan "Apt 4B" version=1 unit=cm

room SE "Living Room" rect(0,0 400x300) ceiling=260 walk=1
  wall SE-2 bearing
  door SE-2 at=100 w=80 h=204 single hinge=start swing=in
  measure SE-1=400.5 SE-D=500 SE-H=260
  note "Sofa wall"

room CU "Kitchen" rect(400,0 200x300) ceiling=265 walk=2
  wall CU-1 exterior 30cm locked
  window CU-2 at=40 w=120 h=140 sill=90 french
  cupboard CU-3 at=10 w=100 depth=60 wall-cabinet
  hole poly(500,200 560,200 560,260 500,260)

room BA "Balcony" poly(0,300 400,300 400,400 0,400) walk=3 outdoor

tape from(0,150) to(400,150) =401 label="Cross room" room=SE
pin at(10,0) wall=SE-1 text="Electrical panel"
`

function sampleDoc(): PlanDocV1 {
  const base = parsePlan({
    projectId: 'p1',
    title: 'Apt 4B',
    rooms: [],
    elements: [],
    measurements: {},
    roomNotes: {},
    tapes: [],
    pins: [],
  })
  const doc = applyBatch(base, [
    { type: 'add_room', code: 'SE', name: 'Living Room', rect: { x: 0, y: 0, w: 400, h: 300 }, ceilingCm: 260, walkOrder: 1 },
    { type: 'add_room', code: 'CU', name: 'Kitchen', rect: { x: 400, y: 0, w: 200, h: 300 }, ceilingCm: 265, walkOrder: 2 },
    { type: 'add_room', code: 'BA', name: 'Balcony', rect: { x: 0, y: 300, w: 400, h: 100 }, outdoor: true, walkOrder: 3 },
    { type: 'set_wall_props', wall: 'SE-2', wallType: 'bearing', thicknessCm: 25 },
    { type: 'set_wall_props', wall: 'CU-1', wallType: 'exterior', thicknessCm: 30, locked: true },
    { type: 'place_element', id: 'el_door', wall: 'SE-2', kind: 'door', offsetCm: 100, widthCm: 80, heightCm: 204 },
    { type: 'place_element', id: 'el_win', wall: 'CU-2', kind: 'window', variant: 'french', offsetCm: 40, widthCm: 120, heightCm: 140, sillCm: 90 },
    { type: 'place_element', id: 'el_cup', wall: 'CU-3', kind: 'cupboard', variant: 'wall-cabinet', offsetCm: 10, widthCm: 100, depthCm: 60 },
    { type: 'cutout_room', roomCode: 'CU', rect: { x: 500, y: 200, w: 60, h: 60 } },
    { type: 'set_measurement', label: 'SE-1', actualCm: 400.5 },
    { type: 'set_measurement', label: 'SE-D', actualCm: 500 },
    { type: 'set_measurement', label: 'CU-H', actualCm: 265 },
    { type: 'set_room_note', roomCode: 'CU', text: 'Water shutoff under sink' },
    { type: 'add_pin', roomCode: 'SE', wall: 'SE-1', at: { x: 10, y: 0 }, text: 'Electrical panel' },
    { type: 'add_tape', roomCode: 'SE', a: { x: 0, y: 150 }, b: { x: 400, y: 150 }, actualCm: 401, label: 'Cross room' },
  ]).doc
  doc.rooms[0].diagonal = [0, 2]
  return doc
}

/** Strip generated ids/timestamps so two docs can be compared on geometry + values only. */
function normalize(doc: PlanDoc) {
  const rooms = [...doc.rooms]
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((r: Room) => ({
      code: r.code,
      name: r.name,
      vertices: r.vertices.map((v) => ({ x: v.x, y: v.y })),
      holes: (r.holes ?? []).map((h) => h.map((v) => ({ x: v.x, y: v.y }))),
      walls: r.vertices.map((v, i) => {
        const p = r.walls[v.id]
        return p && (p.type !== 'partition' || p.thicknessCm !== 10 || p.locked)
          ? { index: i + 1, type: p.type, thicknessCm: p.thicknessCm, locked: Boolean(p.locked) }
          : null
      }),
      ceilingCm: r.ceilingCm ?? null,
      outdoor: Boolean(r.outdoor),
      walkOrder: r.walkOrder,
      diagonal: r.diagonal ?? null,
    }))
  const roomById = new Map(doc.rooms.map((r) => [r.id, r]))
  const elements = (doc.elements ?? [])
    .map((e) => {
      const room = roomById.get(e.roomId)
      const wallIndex = room ? room.vertices.findIndex((v) => v.id === e.wallStart) + 1 : 0
      return {
        roomCode: room?.code ?? e.roomId,
        wall: wallIndex,
        kind: e.kind,
        variant: e.variant ?? null,
        offsetCm: e.offsetCm,
        widthCm: e.widthCm,
        heightCm: e.heightCm ?? null,
        sillCm: e.sillCm ?? null,
        depthCm: e.depthCm ?? null,
        hinge: e.hinge ?? null,
        swing: e.swing ?? null,
        note: e.note ?? null,
      }
    })
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  const measurements = Object.fromEntries(
    Object.entries(doc.measurements ?? {})
      .map(([label, m]): [string, number] => [label, m.actualCm])
      .sort(([a], [b]) => a.localeCompare(b)),
  )
  const pins = (doc.pins ?? [])
    .map((p) => ({
      roomCode: p.roomId ? roomById.get(p.roomId)?.code ?? null : null,
      wall: p.roomId && p.wallStart ? (roomById.get(p.roomId)?.vertices.findIndex((v) => v.id === p.wallStart) ?? -1) + 1 : 0,
      at: p.at,
      text: p.text ?? null,
      photoKeys: p.photoKeys,
    }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  const tapes = (doc.tapes ?? []).map((t) => ({
    a: t.a,
    b: t.b,
    actualCm: t.actualCm ?? null,
    label: t.label ?? null,
    roomCode: t.roomId ? roomById.get(t.roomId)?.code ?? null : null,
    note: t.note ?? null,
  }))
  return {
    title: doc.title,
    rooms,
    elements,
    measurements,
    roomNotes: Object.fromEntries(Object.entries(doc.roomNotes ?? {}).sort(([a], [b]) => a.localeCompare(b))),
    tapes,
    pins,
  }
}

describe('dsl: planToDsl / dslToPlan', () => {
  it('round-trips geometry and values (ids may be regenerated)', () => {
    const doc = sampleDoc()
    const dsl = planToDsl(doc)
    const back = dslToPlan(dsl, undefined, { now: NOW })
    expect(normalize(back)).toEqual(normalize(doc))
  })

  it('produces stable text across a double round-trip', () => {
    const doc = sampleDoc()
    const dsl1 = planToDsl(doc)
    const dsl2 = planToDsl(dslToPlan(dsl1, undefined, { now: NOW }))
    expect(dsl2).toBe(dsl1)
  })

  it('is much more compact than JSON (deterministic ids omitted)', () => {
    // A doc parsed from DSL has the deterministic default ids, so planToDsl omits them.
    const doc = dslToPlan(sampleDsl, undefined, { now: NOW })
    const dsl = planToDsl(doc)
    const json = JSON.stringify(doc)
    expect(dsl.length).toBeLessThan(json.length / 3)
    expect(dsl.split('\n').length).toBeLessThan(40)
  })

  it('keeps vertex/element ids stable when they are the deterministic defaults', () => {
    const text = [
      'plan "T" version=1 unit=cm',
      '',
      'room SE "Living" rect(0,0 400x300) ceiling=260',
      '  wall SE-2 bearing',
      '  door SE-2 at=100 w=80 h=204 single hinge=start swing=in',
      '  measure SE-1=400.5 SE-H=260',
    ].join('\n')
    const doc = dslToPlan(text, undefined, { now: NOW })
    expect(doc.rooms[0].id).toBe('room_SE')
    expect(doc.rooms[0].vertices[0].id).toBe('v_SE_0')
    expect(doc.rooms[0].walls['v_SE_1']).toEqual({ type: 'bearing', thicknessCm: 25 })
    expect(doc.elements[0].id).toBe('el_SE_2_0')
    expect(doc.elements[0].wallStart).toBe('v_SE_1')
    expect(doc.measurements['SE-1'].updatedAt).toBe(NOW)
    // Re-serializing the parsed doc yields the same text (no explicit ids needed).
    expect(planToDsl(doc)).toBe(text + '\n')
  })

  it('preserves baseDoc updatedAt for existing measurements and keeps background', () => {
    const base = sampleDoc()
    const dsl = planToDsl(base)
    const back = dslToPlan(dsl, base, { now: NOW })
    expect(back.projectId).toBe('p1')
    for (const [label, m] of Object.entries(base.measurements)) {
      expect(back.measurements[label].updatedAt).toBe(m.updatedAt)
    }
  })

  it('emits rect() for axis-aligned rooms and poly() otherwise', () => {
    const doc = sampleDoc()
    const dsl = planToDsl(doc)
    expect(dsl).toContain('room SE "Living Room" rect(0,0 400x300)')
    // CU has a hole but is still a rect outline.
    expect(dsl).toContain('room CU "Kitchen" rect(400,0 200x300)')
    expect(dsl).toContain('hole poly(')
  })

  it('reports parse errors with line numbers', () => {
    const bad = ['plan "T"', 'room SE "Living" rect(0,0 400x300)', '  wall XX-9 bearing'].join('\n')
    try {
      dslToPlan(bad)
      expect.unreachable('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(DslParseError)
      expect((err as DslParseError).line).toBe(3)
      expect((err as Error).message).toContain('line 3')
    }
  })

  it('rejects a bad header and unknown statements', () => {
    expect(() => dslToPlan('hello "T"')).toThrow(/line 1/)
    expect(() => dslToPlan('plan "T"\nfrobnicate 1')).toThrow(/line 2: unknown statement "frobnicate"/)
  })

  it('supports comments, blank lines and top-level measure/pin/tape', () => {
    const text = [
      '# a comment',
      'plan "T" unit=cm',
      '',
      'room EN "Entry" poly(0,0 180,0 180,240 0,240) ceiling=265 walk=1 outdoor',
      '  note "Panel near EN-4"',
      'measure EN-1=181',
      'pin at(10,10) room=EN text="meter"',
      'tape from(0,0) to(100,0) =100 label="check"',
    ].join('\n')
    const doc = dslToPlan(text, undefined, { now: NOW })
    expect(doc.rooms[0].outdoor).toBe(true)
    expect(doc.roomNotes.EN).toBe('Panel near EN-4')
    expect(doc.measurements['EN-1'].actualCm).toBe(181)
    expect(doc.pins?.[0].roomId).toBe(doc.rooms[0].id)
    expect(doc.tapes[0].actualCm).toBe(100)
    expect(doc.tapes[0].label).toBe('check')
  })
})
