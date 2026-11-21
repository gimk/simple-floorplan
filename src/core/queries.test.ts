import { describe, expect, it } from 'vitest'
import { parsePlan } from './schema'
import { applyBatch } from './commands'
import { runQuery } from './queries'
import { renderPlanSvg } from './export'

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
