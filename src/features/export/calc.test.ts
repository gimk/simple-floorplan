import { describe, expect, it } from 'vitest'
import type { PlanDoc, Room } from '../../model/types'
import { calcAll, calcRoom, DEFAULT_INPUTS, effectiveCeilingCm, hasOwnCeiling } from './calc'
import { csvEscape, toCsv } from './csv'
import { surveyCsv } from './surveyExport'
import { buildPlanSvg, fitStandardScale } from './svgExport'

// 400 x 300 cm room, 250 cm ceiling, one door 90x210, one window 100x120.
const mkRoom = (over: Partial<Room> = {}): Room => ({
  id: 'r1', code: 'SE', name: 'Living', walkOrder: 0, ceilingCm: 250, holes: [], walls: {},
  vertices: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 400, y: 0 }, { id: 'c', x: 400, y: 300 }, { id: 'd', x: 0, y: 300 }],
  ...over,
})
const now = '2026-01-01T00:00:00Z'
const mkDoc = (room = mkRoom()): PlanDoc => ({
  projectId: 'p', title: 'Test, "flat"', rooms: [room], measurements: {}, roomNotes: {}, tapes: [],
  elements: [
    { id: 'e1', roomId: 'r1', wallStart: 'a', kind: 'door', variant: 'single', offsetCm: 10, widthCm: 90, heightCm: 210, createdAt: now, updatedAt: now },
    { id: 'e2', roomId: 'r1', wallStart: 'b', kind: 'window', variant: 'standard', offsetCm: 50, widthCm: 100, heightCm: 120, createdAt: now, updatedAt: now },
  ],
})

describe('calc', () => {
  it('computes floor, flooring, baseboard, walls, paint', () => {
    const r = calcRoom(mkDoc(), mkRoom(), DEFAULT_INPUTS)
    expect(r.floorM2).toBeCloseTo(12)
    expect(r.flooringM2).toBeCloseTo(13.2)
    expect(r.perimeterM).toBeCloseTo(14)
    expect(r.baseboardM).toBeCloseTo(13.1) // 14 - 0.9 door
    const walls = 14 * 2.5 - 0.9 * 2.1 - 1 * 1.2
    expect(r.wallM2).toBeCloseTo(walls)
    expect(r.paintL).toBeCloseTo((walls * 2) / 10)
  })
  it('subtracts holes from floor area', () => {
    const room = mkRoom({ holes: [[{ id: 'h1', x: 0, y: 0 }, { id: 'h2', x: 100, y: 0 }, { id: 'h3', x: 100, y: 100 }, { id: 'h4', x: 0, y: 100 }]] })
    expect(calcRoom(mkDoc(room), room, DEFAULT_INPUTS).floorM2).toBeCloseTo(11)
  })
  it('uses verified lengths and ceiling', () => {
    const d = mkDoc()
    d.measurements = { 'SE-1': { label: 'SE-1', actualCm: 410, updatedAt: now }, 'SE-H': { label: 'SE-H', actualCm: 260, updatedAt: now } }
    const r = calcRoom(d, d.rooms[0], DEFAULT_INPUTS)
    expect(r.perimeterM).toBeCloseTo(14.1)
    expect(r.ceilingCm).toBe(260)
  })
  it('flags missing ceiling and keeps it out of totals', () => {
    const room = mkRoom({ ceilingCm: undefined })
    const { rows, totals } = calcAll(mkDoc(room), DEFAULT_INPUTS)
    expect(rows[0].wallM2).toBeNull()
    expect(rows[0].paintL).toBeNull()
    expect(totals.missingCeiling).toBe(1)
    expect(totals.wallM2).toBe(0)
  })
  it('excludes outdoor rooms', () => {
    expect(calcAll(mkDoc(mkRoom({ outdoor: true })), DEFAULT_INPUTS).rows).toHaveLength(0)
  })
})

describe('calc: effectiveCeilingCm', () => {
  it('prefers the room height, then the apartment default, and the measured value wins', () => {
    const room = mkRoom()
    const doc = mkDoc(room)
    expect(effectiveCeilingCm(doc, room)).toBe(250)

    // No own height: the apartment default applies.
    const noOwn = mkRoom({ ceilingCm: undefined })
    const withDefault: PlanDoc = { ...mkDoc(noOwn), apartment: { defaultCeilingCm: 240 } }
    expect(effectiveCeilingCm(withDefault, noOwn)).toBe(240)

    // A measured height always wins over both.
    withDefault.measurements = { 'SE-H': { label: 'SE-H', actualCm: 262, updatedAt: now } }
    expect(effectiveCeilingCm(withDefault, noOwn)).toBe(262)
  })

  it('returns null without a room height and without an apartment default', () => {
    const room = mkRoom({ ceilingCm: undefined })
    expect(effectiveCeilingCm(mkDoc(room), room)).toBeNull()
    expect(effectiveCeilingCm({ ...mkDoc(room), apartment: {} }, room)).toBeNull()
  })

  it('uses the apartment default in takeoffs (walls, paint, volume)', () => {
    const room = mkRoom({ ceilingCm: undefined })
    const doc: PlanDoc = { ...mkDoc(room), apartment: { defaultCeilingCm: 200 } }
    const r = calcRoom(doc, room, DEFAULT_INPUTS)
    expect(r.ceilingCm).toBe(200)
    expect(r.wallM2).toBeCloseTo(14 * 2 - 0.9 * 2.1 - 1 * 1.2)
    const { totals } = calcAll(doc, DEFAULT_INPUTS)
    expect(totals.missingCeiling).toBe(0)
  })

  it('reports whether a room sets its own height', () => {
    expect(hasOwnCeiling(mkRoom())).toBe(true)
    expect(hasOwnCeiling(mkRoom({ ceilingCm: undefined }))).toBe(false)
  })
})

describe('csv', () => {
  it('escapes commas, quotes and newlines', () => {
    expect(csvEscape('a,b')).toBe('"a,b"')
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""')
    expect(csvEscape('x\ny')).toBe('"x\ny"')
    expect(csvEscape(null)).toBe('')
    expect(csvEscape(0)).toBe('0')
    expect(toCsv([['a', 1], ['b,c', 2]])).toBe('a,1\r\n"b,c",2')
  })
  it('survey csv has headers, diff and items', () => {
    const d = mkDoc()
    d.measurements = { 'SE-1': { label: 'SE-1', actualCm: 405, updatedAt: now } }
    const csv = surveyCsv(d)
    expect(csv.split('\r\n')[0]).toBe('room code,room name,id,kind,planned cm,measured cm,diff cm,status,notes')
    expect(csv).toContain('SE,Living,SE-1,wall,400,405,5,verified,')
    expect(csv).toContain('SE,Living,SE-2,wall,300,,,estimated,')
    expect(csv).toContain('SE,Living,SE-H,height,250')
    expect(csv).toContain('room,wall label,type,from start cm')
    expect(csv).toContain('SE,SE-1,Door (single),10,90,210')
  })
})

describe('svg', () => {
  it('contains legend, scale bar, title, labels and verified dims in green', () => {
    const d = mkDoc()
    d.measurements = { 'SE-1': { label: 'SE-1', actualCm: 405, updatedAt: now } }
    const { svg } = buildPlanSvg(d, { date: '2026-02-03' })
    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg).toContain('id="legend"')
    expect(svg).toContain('Bearing wall')
    expect(svg).toContain('Radiator')
    expect(svg).toContain('id="scale-bar"')
    expect(svg).toContain('1 m')
    expect(svg).toContain('2 m')
    expect(svg).toContain('Test, &quot;flat&quot;')
    expect(svg).toContain('2026-02-03')
    expect(svg).toContain('12,00 m²')
    expect(svg).toMatch(/fill="#15803d"[^>]*data-dim="SE-1"/)
    expect(svg).toContain('405')
  })
  it('handles an empty doc', () => {
    const d = mkDoc(); d.rooms = []; d.elements = []
    expect(buildPlanSvg(d).svg).toContain('id="legend"')
  })
  it('picks a standard scale', () => {
    expect(fitStandardScale(1000, 800, 277, 190)).toBe(50) // 200mm x 160mm at 1:50
    expect(fitStandardScale(100000, 100000, 277, 190)).toBeNull()
  })
})
