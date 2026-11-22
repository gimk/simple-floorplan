import { describe, expect, it } from 'vitest'
import { parsePlan } from './schema'
import { applyBatch } from './commands'
import { runQuery } from './queries'
import { renderPlanSvg } from './export'
import { allSurveyIds, surveyIds } from '../model/survey'

function sampleDoc() {
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
  return applyBatch(base, [
    { type: 'add_room', code: 'SE', name: 'Living', rect: { x: 0, y: 0, w: 400, h: 300 }, ceilingCm: 260, walkOrder: 1 },
    { type: 'add_room', code: 'CU', name: 'Kitchen', rect: { x: 400, y: 0, w: 200, h: 300 }, ceilingCm: 260, walkOrder: 2 },
    { type: 'add_room', code: 'BA', name: 'Balcony', rect: { x: 0, y: 300, w: 400, h: 100 }, outdoor: true, walkOrder: 3 },
    { type: 'set_wall_props', wall: 'SE-2', wallType: 'partition', thicknessCm: 10 },
    { type: 'set_wall_props', wall: 'SE-3', wallType: 'bearing', thicknessCm: 25 },
    { type: 'place_element', id: 'el_door', wall: 'SE-2', kind: 'door', offsetCm: 100, widthCm: 80, heightCm: 204 },
    { type: 'set_measurement', label: 'SE-1', actualCm: 400 },
  ]).doc
}

describe('queries & SVG export', () => {
  it('summary computes indoor/outdoor areas, progress, and takeoff', () => {
    const res = runQuery(sampleDoc(), { query: 'summary' }) as {
      totalIndoorAreaM2: number
      totalOutdoorAreaM2: number
      roomCount: number
      takeoff: { totals: { floorM2: number; baseboardM: number; paintL: number } }
    }
    expect(res.totalIndoorAreaM2).toBe(18)
    expect(res.totalOutdoorAreaM2).toBe(4)
    expect(res.roomCount).toBe(3)
    expect(res.takeoff.totals.floorM2).toBe(18)
    expect(res.takeoff.totals.baseboardM).toBeGreaterThan(20)
    expect(res.takeoff.totals.paintL).toBeGreaterThan(0)
  })

  it('unmeasured returns missing survey IDs in walk order', () => {
    const res = runQuery(sampleDoc(), { query: 'unmeasured' }) as {
      done: number
      total: number
      remaining: { label: string }[]
    }
    expect(res.done).toBe(1)
    expect(res.total).toBe(18) // 3 rooms x (4 walls + D + H)
    // SE-1 is measured, so first remaining must be SE-2
    expect(res.remaining[0].label).toBe('SE-2')
  })

  it('validate catches discrepancies, squareness, opposite walls, overflow, overlap, and self-intersection', () => {
    let doc = sampleDoc()
    doc = applyBatch(doc, [
      // Discrepancy > 2 cm on SE-1 (400 vs 410) + opposite wall diff (SE-1=410 vs SE-3=400)
      { type: 'set_measurement', label: 'SE-1', actualCm: 410 },
      { type: 'set_measurement', label: 'SE-2', actualCm: 300 },
      { type: 'set_measurement', label: 'SE-3', actualCm: 400 },
      { type: 'set_measurement', label: 'SE-4', actualCm: 300 },
      // Not square: expected sqrt(410^2 + 300^2) ~= 508, give 520
      { type: 'set_measurement', label: 'SE-D', actualCm: 520 },
      // Overlapping element on SE-2 (el_door is 100..180, place another at 150..230)
      { type: 'place_element', id: 'el_overlap', wall: 'SE-2', kind: 'radiator', offsetCm: 150, widthCm: 80 },
      // Overflowing element on CU-1 (length 200, offset 150 + width 100 = 250)
      { type: 'place_element', id: 'el_overflow', wall: 'CU-1', kind: 'cupboard', offsetCm: 150, widthCm: 100 },
    ]).doc

    // Add a bowtie self-intersecting room directly
    doc = {
      ...doc,
      rooms: [
        ...doc.rooms,
        {
          id: 'r_bow',
          code: 'BW',
          name: 'Bowtie',
          vertices: [
            { id: 'b1', x: 1000, y: 0 },
            { id: 'b2', x: 1200, y: 200 },
            { id: 'b3', x: 1200, y: 0 },
            { id: 'b4', x: 1000, y: 200 },
          ],
          holes: [],
          walls: {},
          walkOrder: 4,
        },
      ],
    }

    const res = runQuery(doc, { query: 'validate' }) as {
      valid: boolean
      errors: { code: string }[]
      warnings: { code: string }[]
    }
    expect(res.valid).toBe(false)
    const errCodes = new Set(res.errors.map((e) => e.code))
    const warnCodes = new Set(res.warnings.map((w) => w.code))
    expect(errCodes.has('ELEMENT_OVERFLOW')).toBe(true)
    expect(errCodes.has('ELEMENT_OVERLAP')).toBe(true)
    expect(errCodes.has('SELF_INTERSECTION')).toBe(true)
    expect(warnCodes.has('DISCREPANCY')).toBe(true)
    expect(warnCodes.has('NOT_SQUARE')).toBe(true)
    expect(warnCodes.has('OPPOSITE_WALL_DIFF')).toBe(true)
  })

  it('shared_walls detects adjacent walls and bearing flag', () => {
    const res = runQuery(sampleDoc(), { query: 'shared_walls' }) as {
      sharedWalls: { wallA: string; wallB: string; overlapCm: number; isBearing: boolean }[]
    }
    expect(res.sharedWalls.length).toBeGreaterThanOrEqual(2)
    const seCu = res.sharedWalls.find((s) => s.wallA === 'SE-2' && s.wallB === 'CU-4')
    expect(seCu).toBeDefined()
    expect(seCu!.overlapCm).toBe(300)
    expect(seCu!.isBearing).toBe(false)

    const seBa = res.sharedWalls.find((s) => s.wallA === 'SE-3' && s.wallB === 'BA-1')
    expect(seBa).toBeDefined()
    expect(seBa!.isBearing).toBe(true)
  })

  it('room query returns detailed room structure', () => {
    const res = runQuery(sampleDoc(), { query: 'room', args: { roomCode: 'SE' } }) as {
      code: string
      areaM2: number
      walls: unknown[]
      elements: unknown[]
    }
    expect(res.code).toBe('SE')
    expect(res.areaM2).toBe(12)
    expect(res.walls).toHaveLength(4)
    expect(res.elements).toHaveLength(1)
  })

  it('renderPlanSvg produces valid standalone SVG with optional background', () => {
    const doc = sampleDoc()
    const { svg } = renderPlanSvg(doc)
    expect(svg.startsWith('<svg ')).toBe(true)
    expect(svg).toContain('Apt 4B')
    expect(svg).toContain('data-room-code="SE"')
    expect(svg).toContain('data-wall-label="SE-2"')
    expect(svg).toContain('data-element-id="el_door"')
    expect(svg).not.toContain('<image ')

    const withBg = renderPlanSvg(
      {
        ...doc,
        background: {
          src: 'data:image/png;base64,AAAA',
          naturalWidth: 1000,
          naturalHeight: 800,
          xCm: 0,
          yCm: 0,
          cmPerPx: 0.5,
          rotationDeg: 0,
          opacity: 0.5,
          visible: true,
          locked: true,
        },
      },
      { background: true },
    )
    expect(withBg.svg).toContain('<image href="data:image/png;base64,AAAA"')
  })
})

describe('queries: apartment default ceiling height', () => {
  function docWithoutHeights() {
    const base = parsePlan({ projectId: 'p1', title: 'Apt', rooms: [] })
    return applyBatch(base, [
      { type: 'add_room', code: 'SE', name: 'Living', rect: { x: 0, y: 0, w: 400, h: 300 } },
      { type: 'add_room', code: 'CU', name: 'Kitchen', rect: { x: 400, y: 0, w: 200, h: 300 }, ceilingCm: 265 },
      { type: 'set_apartment', defaultCeilingCm: 250 },
    ]).doc
  }

  it('applies the default to rooms without their own height in summary and room queries', () => {
    const doc = docWithoutHeights()
    const summary = runQuery(doc, { query: 'summary' }) as {
      rooms: { code: string; ceilingCm: number | null; ceilingFromApartment: boolean }[]
      takeoff: { totals: { missingCeiling: number; wallM2: number } }
    }
    const byCode = Object.fromEntries(summary.rooms.map((r) => [r.code, r]))
    expect(byCode.SE.ceilingCm).toBe(250)
    expect(byCode.SE.ceilingFromApartment).toBe(true)
    expect(byCode.CU.ceilingCm).toBe(265)
    expect(byCode.CU.ceilingFromApartment).toBe(false)
    expect(summary.takeoff.totals.missingCeiling).toBe(0)
    expect(summary.takeoff.totals.wallM2).toBeGreaterThan(0)

    const room = runQuery(doc, { query: 'room', args: { roomCode: 'SE' } }) as {
      ceilingCm: number | null
      takeoff: { ceilingCm: number | null; wallM2: number | null }
    }
    expect(room.ceilingCm).toBe(250)
    expect(room.takeoff.ceilingCm).toBe(250)
    expect(room.takeoff.wallM2).toBeCloseTo(14 * 2.5 - 0, 5)
  })

  it('leaves the height unknown when there is no default', () => {
    const base = parsePlan({ projectId: 'p1', rooms: [] })
    const doc = applyBatch(base, [
      { type: 'add_room', code: 'SE', name: 'Living', rect: { x: 0, y: 0, w: 400, h: 300 } },
    ]).doc
    const summary = runQuery(doc, { query: 'summary' }) as {
      rooms: { ceilingCm: number | null }[]
      takeoff: { totals: { missingCeiling: number } }
    }
    expect(summary.rooms[0].ceilingCm).toBeNull()
    expect(summary.takeoff.totals.missingCeiling).toBe(1)
  })
})

describe('surveyIds: planned ceiling height uses the apartment default', () => {
  /** One room "SE"; any of the three height inputs can be left out. */
  function docWith(opts: { roomCeilingCm?: number; apartmentCeilingCm?: number; measuredCm?: number } = {}) {
    const base = parsePlan({ projectId: 'p1', title: 'Apt', rooms: [] })
    const cmds: unknown[] = [
      {
        type: 'add_room',
        code: 'SE',
        name: 'Living',
        rect: { x: 0, y: 0, w: 400, h: 300 },
        ...(opts.roomCeilingCm !== undefined ? { ceilingCm: opts.roomCeilingCm } : {}),
      },
    ]
    if (opts.apartmentCeilingCm !== undefined) cmds.push({ type: 'set_apartment', defaultCeilingCm: opts.apartmentCeilingCm })
    if (opts.measuredCm !== undefined) cmds.push({ type: 'set_measurement', label: 'SE-H', actualCm: opts.measuredCm })
    return applyBatch(base, cmds).doc
  }

  const heightId = (ids: { label: string; kind: string; plannedCm?: number }[]) => ids.find((s) => s.kind === 'height')!

  it('falls back to the apartment default when the room has no own height', () => {
    const doc = docWith({ apartmentCeilingCm: 250 })
    const h = heightId(surveyIds(doc.rooms[0], doc.apartment?.defaultCeilingCm))
    expect(h.label).toBe('SE-H')
    expect(h.plannedCm).toBe(250)
  })

  it('prefers the room height over the apartment default', () => {
    const doc = docWith({ roomCeilingCm: 265, apartmentCeilingCm: 250 })
    expect(heightId(surveyIds(doc.rooms[0], doc.apartment?.defaultCeilingCm)).plannedCm).toBe(265)
  })

  it('leaves the planned height unset when there is no room height and no default', () => {
    const doc = docWith()
    expect(heightId(surveyIds(doc.rooms[0], doc.apartment?.defaultCeilingCm)).plannedCm).toBeUndefined()
    // Old call style (no second argument) still compiles and behaves the same.
    expect(heightId(surveyIds(doc.rooms[0])).plannedCm).toBeUndefined()
  })

  it('never takes the measured height as the planned value', () => {
    const doc = docWith({ apartmentCeilingCm: 250, measuredCm: 273 })
    const h = heightId(surveyIds(doc.rooms[0], doc.apartment?.defaultCeilingCm))
    expect(h.plannedCm).toBe(250)

    const own = docWith({ roomCeilingCm: 260, apartmentCeilingCm: 250, measuredCm: 273 })
    expect(heightId(surveyIds(own.rooms[0], own.apartment?.defaultCeilingCm)).plannedCm).toBe(260)
  })

  it('applies the document default in allSurveyIds and in the unmeasured query', () => {
    const doc = docWith({ apartmentCeilingCm: 250 })
    expect(heightId(allSurveyIds(doc)).plannedCm).toBe(250)

    const unmeasured = runQuery(doc, { query: 'unmeasured' }) as {
      remaining: { label: string; kind: string; plannedCm: number | null }[]
    }
    const h = unmeasured.remaining.find((s) => s.kind === 'height')!
    expect(h.label).toBe('SE-H')
    expect(h.plannedCm).toBe(250)

    const perRoom = runQuery(doc, { query: 'unmeasured', args: { roomCode: 'SE' } }) as {
      remaining: { label: string; plannedCm: number | null }[]
    }
    expect(perRoom.remaining.find((s) => s.label === 'SE-H')!.plannedCm).toBe(250)
    expect(unmeasured.remaining.find((s) => s.kind === 'height')!.plannedCm).toBe(250)
  })

  it('reports the default as the height in Measuring Mode progress and flags', () => {
    // A measured height far from the apartment default is a discrepancy, not a missing plan value.
    const doc = docWith({ apartmentCeilingCm: 250, measuredCm: 273 })
    const summary = runQuery(doc, { query: 'validate', args: { roomCode: 'SE' } }) as {
      warnings: { code: string; label?: string }[]
    }
    expect(summary.warnings.some((w) => w.code === 'DISCREPANCY' && w.label === 'SE-H')).toBe(true)
  })
})
