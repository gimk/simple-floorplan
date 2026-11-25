// A visible straight wall stored as 2+ collinear faces is ONE measure row (the total length).
import { beforeEach, describe, expect, it } from 'vitest'
import { useDoc } from '../../model/store'
import type { PlanDoc, Room } from '../../model/types'
import { setRunMeasurement } from './actions'
import { docProgress, measureRows, roomProgress, rowValue, splitRunTotal } from './logic'

/** 400 x 300 room; the right wall (x = 400) is split at y = 100 by a T junction: faces 2 and 3. */
const room: Room = {
  id: 'a', code: 'R1', name: 'Cuisine', walkOrder: 0, holes: [], walls: {}, diagonal: [0, 2],
  vertices: [[0, 0], [400, 0], [400, 100], [400, 300], [0, 300]].map(([x, y], i) => ({ id: `a${i}`, x, y })),
}
const mk = (measurements: PlanDoc['measurements'] = {}): PlanDoc =>
  ({ projectId: 'p', title: 't', rooms: [room], elements: [], measurements, roomNotes: {}, tapes: [] }) as PlanDoc
const m = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { label: k, actualCm: v, updatedAt: '' }]))

describe('grouped wall rows', () => {
  beforeEach(() => useDoc.setState({ doc: mk() }))

  it('gives one row for a wall split by a T junction', () => {
    const rows = measureRows(room).filter((r) => r.kind === 'wall')
    expect(rows.map((r) => r.text)).toEqual(['R1-1', 'R1-2+3', 'R1-4', 'R1-5'])
    const run = rows[1]
    expect(run.labels).toEqual(['R1-2', 'R1-3'])
    expect(run.plannedCm).toBeCloseTo(run.pieces[0].plannedCm + run.pieces[1].plannedCm, 1) // inner faces: ~290
    expect(roomProgress(mk(), room).total).toBe(4 + 2) // 4 walls + diagonal + height
  })

  it('splits a total in proportion and keeps the exact sum', () => {
    const p = splitRunTotal(235.5, [35, 200])
    expect(p[0] + p[1]).toBeCloseTo(235.5, 5)
    expect(p[0] / p[1]).toBeCloseTo(35 / 200, 1)
  })

  it('never gives a piece 0: 5 pieces with very short ones, total 366', () => {
    const p = splitRunTotal(366, [120, 0.02, 150, 0, 90])
    expect(p).toHaveLength(5)
    expect(p.every((v) => v > 0)).toBe(true)
    expect(p.reduce((a, b) => a + b, 0)).toBeCloseTo(366, 5)
    // Only zero bases, and a tiny total.
    expect(splitRunTotal(366, [0, 0, 0]).every((v) => v > 0)).toBe(true)
    expect(splitRunTotal(0.2, [10, 0, 5, 0, 1]).every((v) => v > 0)).toBe(true)
  })

  it('entering the total stores pieces whose sum is the total', () => {
    const row = measureRows(room).find((r) => r.labels.length === 2)!
    setRunMeasurement(row, 310)
    const doc = useDoc.getState().doc
    expect(rowValue(doc, row)).toBe(310)
    expect(doc.measurements['R1-2']!.actualCm / 310).toBeCloseTo(row.pieces[0].plannedCm / row.plannedCm!, 2)
    // Typing the same total again changes nothing (proportions are kept).
    setRunMeasurement(row, 310)
    expect(rowValue(useDoc.getState().doc, row)).toBe(310)
    // Clearing removes both pieces.
    setRunMeasurement(row, null)
    expect(rowValue(useDoc.getState().doc, row)).toBeUndefined()
  })

  it('an old doc with 2 per-piece measures shows one measured row with the sum', () => {
    const doc = mk(m({ 'R1-2': 80, 'R1-3': 215.5 }))
    const row = measureRows(room).find((r) => r.labels.length === 2)!
    expect(rowValue(doc, row)).toBe(295.5)
    expect(roomProgress(doc, room).done).toBe(1)
    expect(docProgress(doc)).toEqual({ done: 1, total: 6 })
    // Only one piece measured with a partial value: the row is not measured yet.
    expect(rowValue(mk(m({ 'R1-2': 80 })), row)).toBeUndefined()
  })

  it('groups a T-split straight wall even when the T node is slightly off-line (<= 0.5 deg or <= 1 cm)', () => {
    // Middle node off by 0.4 cm on a 35 cm piece (~0.65 deg, chord dist ~0.34 cm <= 1 cm).
    const slightlyOff: Room = {
      ...room,
      vertices: [[0, 0], [400, 0], [400.4, 200], [400, 235], [0, 235]].map(([x, y], i) => ({ id: `b${i}`, x, y })),
    }
    const rows = measureRows(slightlyOff).filter((r) => r.kind === 'wall')
    expect(rows.map((r) => r.text)).toEqual(['R1-1', 'R1-2+3', 'R1-4', 'R1-5'])

    // Real bend (15 cm off-line over 235 cm): stays two separate rows.
    const bent: Room = {
      ...room,
      vertices: [[0, 0], [400, 0], [415, 200], [400, 235], [0, 235]].map(([x, y], i) => ({ id: `c${i}`, x, y })),
    }
    const bentRows = measureRows(bent).filter((r) => r.kind === 'wall')
    expect(bentRows.map((r) => r.text)).toEqual(['R1-1', 'R1-2', 'R1-3', 'R1-4', 'R1-5'])
  })

  it('treats a single piece holding the whole run length (within 2 cm) as the run total, and splits on next edit', () => {
    const row = measureRows(room).find((r) => r.labels.length === 2)!
    // Planned run total is ~290 cm. User typed 291 into R1-2 only, leaving R1-3 unmeasured.
    const doc = mk(m({ 'R1-2': 291 }))
    expect(rowValue(doc, row)).toBe(291)
    expect(roomProgress(doc, room).done).toBe(1)

    // Next edit of the row splits the new total across all pieces using planned proportions.
    useDoc.setState({ doc })
    setRunMeasurement(row, 295)
    const after = useDoc.getState().doc
    expect(rowValue(after, row)).toBe(295)
    expect(after.measurements['R1-2']?.actualCm).toBeCloseTo((row.pieces[0].plannedCm / row.plannedCm!) * 295, 0)
    expect(after.measurements['R1-3']?.actualCm).toBeCloseTo((row.pieces[1].plannedCm / row.plannedCm!) * 295, 0)
  })
})
