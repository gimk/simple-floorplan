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
        const status = p?.status && p.status !== 'existing' ? p.status : null
        return p && (p.type !== 'partition' || p.thicknessCm !== 10 || p.locked || status)
          ? { index: i + 1, type: p.type, thicknessCm: p.thicknessCm, locked: Boolean(p.locked), status }
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

  it('round-trips the renovation wall status (7.4)', () => {
    const doc = applyBatch(sampleDoc(), [
      { type: 'set_wall_props', wall: 'SE-2', status: 'demolish' },
      { type: 'set_wall_props', wall: 'CU-2', status: 'new' },
    ]).doc
    const dsl = planToDsl(doc)
    expect(dsl).toContain('wall SE-2 bearing demolish')
    expect(dsl).toContain('wall CU-2 new')
    const back = dslToPlan(dsl, undefined, { now: NOW })
    expect(normalize(back)).toEqual(normalize(doc))
    // 'existing' is the default state: never written, and dropped on parse.
    const existing = applyBatch(doc, [{ type: 'set_wall_props', wall: 'SE-2', status: 'existing' }]).doc
    expect(planToDsl(existing)).not.toContain('existing')
    expect(dslToPlan(planToDsl(existing), undefined, { now: NOW }).rooms[0].walls['v_SE_1'].status).toBeUndefined()
  })

  it('rejects an unknown word on a wall line', () => {
    const text = ['plan "T"', 'room SE "Living" rect(0,0 400x300)', '  wall SE-1 remove'].join('\n')
    expect(() => dslToPlan(text, undefined, { now: NOW })).toThrow(DslParseError)
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

describe('dsl: apartment data', () => {
  function apartmentDoc(): PlanDocV1 {
    return applyBatch(sampleDoc(), [
      { type: 'set_apartment', defaultCeilingCm: 250 },
      {
        type: 'set_apartment',
        addReference: { id: 'ref_0', source: 'dpe', surfaceM2: 62.4, label: 'DPE 2023', date: '2023-04-01' },
      },
      {
        type: 'set_apartment',
        addReference: { id: 'ref_carrez', source: 'carrez', surfaceM2: 60.1, roomCode: 'SE', note: 'excludes lower 1.8 m' },
      },
    ]).doc
  }

  it('writes apartment ceiling and reference lines', () => {
    const dsl = planToDsl(apartmentDoc())
    expect(dsl).toContain('apartment ceiling 250')
    expect(dsl).toContain('ref dpe 62.4 "DPE 2023" date="2023-04-01"')
    expect(dsl).toContain('ref carrez 60.1 id=ref_carrez room=SE note="excludes lower 1.8 m"')
    // The deterministic id (ref_0) is omitted, like pins and tapes.
    expect(dsl).not.toContain('id=ref_0')
    // Apartment lines come before the rooms.
    expect(dsl.indexOf('apartment ceiling')).toBeLessThan(dsl.indexOf('room SE'))
  })

  it('round-trips the apartment block', () => {
    const doc = apartmentDoc()
    const back = dslToPlan(planToDsl(doc), undefined, { now: NOW })
    expect(back.apartment).toEqual(doc.apartment)
    expect(planToDsl(back)).toBe(planToDsl(doc))
  })

  it('parses both "ceiling 250" and "ceiling=250" and a missing apartment block', () => {
    const a = dslToPlan('plan "T"\napartment ceiling 250', undefined, { now: NOW })
    const b = dslToPlan('plan "T"\napartment ceiling=250', undefined, { now: NOW })
    expect(a.apartment?.defaultCeilingCm).toBe(250)
    expect(b.apartment).toEqual(a.apartment)
    expect(dslToPlan('plan "T"', undefined, { now: NOW }).apartment).toBeUndefined()
  })

  it('reports invalid apartment and ref lines', () => {
    const line = (text: string) => {
      try { dslToPlan(text); return null } catch (err) { return err as DslParseError }
    }
    expect(line('plan "T"\napartment')?.line).toBe(2)
    expect(line('plan "T"\napartment floor 250')?.message).toMatch(/unknown apartment attribute/)
    expect(line('plan "T"\nref tax 62.4')?.message).toMatch(/invalid reference source/)
    expect(line('plan "T"\nref dpe 0')?.message).toMatch(/surface must be positive/)
    expect(line('plan "T"\nref dpe 62.4 foo=1')?.message).toMatch(/unknown reference attribute/)
    // Indented outside a room block: the generic indentation error wins.
    expect(line('plan "T"\n  ref dpe 62.4')?.message).toMatch(/indented line outside of a room block/)
    expect(line('plan "T"\nroom SE "L" rect(0,0 400x300)\n  ref dpe 62.4')?.message).toMatch(/must start at the beginning/)
    expect(line('plan "T"\nroom SE "L" rect(0,0 400x300)\n  apartment ceiling 250')?.message).toMatch(/must start at the beginning/)
  })
})

describe('dsl: pin photo sketches', () => {
  const NOW2 = '2026-02-02T00:00:00.000Z'
  const mark = { id: 'mk1', a: { x: 0.125, y: 0.5 }, b: { x: 0.875, y: 0.5 }, valueCm: 250.5, label: 'SE-2', note: 'radiator' }

  const withSketch = (): PlanDocV1 =>
    parsePlan({
      projectId: 'p1',
      title: 'T',
      rooms: [
        {
          id: 'r1',
          code: 'SE',
          name: 'Living Room',
          vertices: [
            { id: 'v0', x: 0, y: 0 },
            { id: 'v1', x: 400, y: 0 },
            { id: 'v2', x: 400, y: 300 },
          ],
        },
      ],
      elements: [],
      measurements: {},
      roomNotes: {},
      tapes: [],
      pins: [
        {
          id: 'p1',
          roomId: 'r1',
          at: { x: 10, y: 10 },
          photoKeys: ['proj/a.jpg', 'proj/b.jpg'],
          sketches: { 'proj/b.jpg': [mark] },
          createdAt: NOW2,
          updatedAt: NOW2,
        },
      ],
    })

  it('writes one sketch token that points at the photo index', () => {
    const dsl = planToDsl(withSketch())
    expect(dsl).toContain('photos=proj/a.jpg,proj/b.jpg')
    expect(dsl).toContain('sketch=')
    expect(dsl).toContain('\\"p\\":1')
    // One line for the pin, as before.
    expect(dsl.split('\n').filter((l) => l.includes('pin at('))).toHaveLength(1)
  })

  it('round-trips the marks of each photo, and stays stable', () => {
    const dsl = planToDsl(withSketch())
    const back = dslToPlan(dsl, undefined, { now: NOW2 })
    expect(back.pins?.[0].sketches).toEqual({ 'proj/b.jpg': [mark] })
    expect(planToDsl(back)).toBe(dsl)
  })

  it('omits the token when a pin has no mark', () => {
    const doc = withSketch()
    const plain: PlanDoc = { ...doc, pins: [{ ...doc.pins[0], sketches: undefined }] as PlanDocV1['pins'] }
    expect(planToDsl(plain)).not.toContain('sketch=')
  })

  it('reads a hand-written sketch and drops the marks of a missing photo', () => {
    const spec = (photo: number) => JSON.stringify(`[{"p":${photo},"id":"mk1","a":[0.1,0.2],"b":[0.5,0.5]}]`)
    const text = (photo: number) => `plan "T"\nroom SE "L" rect(0,0 400x300)\npin at(0,0) photos=proj/a.jpg sketch=${spec(photo)}`
    const doc = dslToPlan(text(0), undefined, { now: NOW2 })
    expect(doc.pins?.[0].sketches).toEqual({ 'proj/a.jpg': [{ id: 'mk1', a: { x: 0.1, y: 0.2 }, b: { x: 0.5, y: 0.5 } }] })
    // Mark 3 of a pin that only has one photo: dropped, not an error.
    expect(dslToPlan(text(3), undefined, { now: NOW2 }).pins?.[0].sketches).toBeUndefined()
  })

  it('keeps every photo key of a photos= list', () => {
    const doc = dslToPlan('plan "T"\nroom SE "L" rect(0,0 400x300)\npin at(0,0) photos=proj/a.jpg,proj/b.jpg text="two"', undefined, { now: NOW2 })
    expect(doc.pins?.[0].photoKeys).toEqual(['proj/a.jpg', 'proj/b.jpg'])
    expect(doc.pins?.[0].text).toBe('two')
  })

  it('reports an invalid sketch token', () => {
    const line = (body: string) => {
      try {
        dslToPlan(`plan "T"\nroom SE "L" rect(0,0 400x300)\npin at(0,0) photos=proj/a.jpg sketch=${JSON.stringify(body)}`)
        return null
      } catch (err) {
        return err as DslParseError
      }
    }
    expect(line('not json')?.message).toMatch(/not valid JSON/)
    expect(line('{}')?.message).toMatch(/JSON array/)
    expect(line('[1]')?.message).toMatch(/must be objects/)
    expect(line('[{"p":0,"a":[0,0],"b":[1,1]}]')?.message).toMatch(/needs an id/)
    expect(line('[{"id":"m","a":[0,0],"b":[1,1]}]')?.message).toMatch(/photo index/)
    expect(line('[{"id":"m","a":[0],"b":[1,1],"p":0}]')?.message).toMatch(/\[x,y\]/)
    expect(line('[{"id":"m","a":[0,0],"b":[1,1],"p":0,"v":0}]')?.message).toMatch(/positive/)
  })
})

describe('DSL wall thickness IDs', () => {
  it('reads and writes CODE-n-T in the room block', () => {
    const doc = dslToPlan('plan "T" version=1 unit=cm\n\nroom SE "Living" rect(0,0 400x300) walk=1\n  measure SE-1=390 SE-2-T=14\n')
    expect(doc.measurements['SE-2-T']?.actualCm).toBe(14)
    expect(planToDsl(doc)).toContain('measure SE-1=390 SE-2-T=14')
  })
})
