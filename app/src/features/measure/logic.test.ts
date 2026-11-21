import { describe, expect, it } from 'vitest'
import { adjacentItems, discrepancy, fmtDiff, itemSpan, nextLabel, oppositeWallNotes, parseCm, squarenessCheck } from './logic'
import type { PlanDoc, Room, WallElement } from '../../model/types'

const rect = (id: string, code: string, x: number, y: number, w: number, h: number, extra: Partial<Room> = {}): Room => ({
  id, code, name: code, walkOrder: 0, holes: [], walls: {}, diagonal: [0, 2],
  vertices: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].map(([px, py], i) => ({ id: `${id}${i}`, x: px, y: py })),
  ...extra,
})
const m = (o: Record<string, number>) =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { label: k, actualCm: v, updatedAt: '' }]))
const doc = (rooms: Room[], measurements = {}, elements: WallElement[] = []): PlanDoc => ({
  projectId: 'p', title: 't', rooms, elements, measurements, roomNotes: {}, tapes: [],
})

describe('parseCm', () => {
  it('accepts comma and dot', () => { expect(parseCm('412,5')).toBe(412.5); expect(parseCm('412.5')).toBe(412.5) })
  it('empty is null', () => expect(parseCm('  ')).toBeNull())
  it('rejects bad input', () => { expect(parseCm('abc')).toBeNaN(); expect(parseCm('-3')).toBeNaN(); expect(parseCm('0')).toBeNaN(); expect(parseCm('1,2,3')).toBeNaN() })
  it('allows zero when asked', () => expect(parseCm('0', true)).toBe(0))
})

describe('discrepancy', () => {
  it('no plan or no value', () => { expect(discrepancy(undefined, 5)).toBeNull(); expect(discrepancy(5, undefined)).toBeNull() })
  it('flags only above 2 cm', () => {
    expect(discrepancy(340, 336)).toEqual({ diff: -4, flagged: true })
    expect(discrepancy(340, 342)?.flagged).toBe(false)
    expect(discrepancy(340, 342.5)?.flagged).toBe(true)
  })
  it('formats diff', () => { expect(fmtDiff(-4)).toBe('−4'); expect(fmtDiff(3.5)).toBe('+3,5'); expect(fmtDiff(0)).toBe('0') })
})

describe('squarenessCheck', () => {
  const r = rect('a', 'SE', 0, 0, 300, 400)
  it('null when something is missing', () => {
    expect(squarenessCheck(doc([r], m({ 'SE-1': 300, 'SE-2': 400, 'SE-3': 300, 'SE-D': 500 })), r)).toBeNull()
  })
  it('ok when square', () => {
    const c = squarenessCheck(doc([r], m({ 'SE-1': 300, 'SE-2': 400, 'SE-3': 300, 'SE-4': 400, 'SE-D': 500.5 })), r)
    expect(c?.ok).toBe(true); expect(c?.expected).toBeCloseTo(500)
  })
  it('warns beyond 1 cm', () => {
    const c = squarenessCheck(doc([r], m({ 'SE-1': 300, 'SE-2': 400, 'SE-3': 300, 'SE-4': 400, 'SE-D': 503 })), r)
    expect(c?.ok).toBe(false); expect(c?.diff).toBeCloseTo(3)
  })
  it('null without diagonal or for non-4-vertex rooms', () => {
    const nd = rect('b', 'NO', 0, 0, 1, 1, { diagonal: undefined })
    expect(squarenessCheck(doc([nd]), nd)).toBeNull()
    const tri = rect('c', 'TR', 0, 0, 1, 1, { vertices: r.vertices.slice(0, 3) })
    expect(squarenessCheck(doc([tri]), tri)).toBeNull()
  })
})

describe('oppositeWallNotes', () => {
  const r = rect('a', 'SE', 0, 0, 300, 400)
  it('reports pairs differing by more than 2 cm', () => {
    const notes = oppositeWallNotes(doc([r], m({ 'SE-1': 300, 'SE-3': 304, 'SE-2': 400, 'SE-4': 401 })), r)
    expect(notes).toHaveLength(1)
    expect(notes[0]).toMatchObject({ a: 'SE-1', b: 'SE-3', diff: 4 })
  })
  it('ignores unmeasured pairs', () => expect(oppositeWallNotes(doc([r], m({ 'SE-1': 300 })), r)).toEqual([]))
})

describe('nextLabel', () => {
  const labels = ['A-1', 'A-2', 'A-H', 'B-1']
  it('goes across rooms', () => expect(nextLabel(labels, 'A-H')).toBe('B-1'))
  it('null at end or unknown', () => { expect(nextLabel(labels, 'B-1')).toBeNull(); expect(nextLabel(labels, 'Z')).toBeNull() })
})

describe('items', () => {
  const a = rect('a', 'AA', 0, 0, 200, 200)
  const b = rect('b', 'BB', 200, 0, 200, 200)
  const door = (extra: Partial<WallElement> = {}): WallElement => ({
    id: 'e1', roomId: 'a', wallStart: 'a1', kind: 'door', offsetCm: 50, widthCm: 80, createdAt: '', updatedAt: '', ...extra,
  })
  it('uses planned length, then measured length', () => {
    const planned = itemSpan(doc([a, b]), a, door())
    expect(planned?.t0).toBeCloseTo(0.25)
    const measured = itemSpan(doc([a, b], m({ 'AA-2': 400 })), a, door())
    expect(measured?.t0).toBeCloseTo(0.125)
  })
  it('skips items without width', () => expect(itemSpan(doc([a, b]), a, door({ widthCm: 0 }))).toBeNull())
  it('shows a door of room A on the shared wall of room B', () => {
    const adj = adjacentItems(doc([a, b], {}, [door()]), b)
    expect(adj).toHaveLength(1)
    expect(adj[0].p0.x).toBe(200)
    // wall of B runs 200,200 -> 200,0, so p0 is the end nearest that wall's start
    expect([adj[0].p0.y, adj[0].p1.y].sort((x, y) => x - y)).toEqual([50, 130].map((n) => expect.closeTo(n)))
  })
  it('ignores windows and own room', () => {
    expect(adjacentItems(doc([a, b], {}, [door({ kind: 'window' })]), b)).toHaveLength(0)
    expect(adjacentItems(doc([a, b], {}, [door()]), a)).toHaveLength(0)
  })
})
