import { describe, expect, it } from 'vitest'
import { adjacentItems, discrepancy, docProgress, fmtDiff, itemSpan, measureRooms, nextLabel, nextUnmeasuredLabel, oppositeWallNotes, parseCm, roomHasMissing, roomIsFlagged, squarenessCheck } from './logic'
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

describe('nextUnmeasuredLabel', () => {
  const labels = ['A-1', 'A-2', 'A-H', 'B-1', 'B-H']
  it('finds the next empty after the current one, across rooms', () => {
    expect(nextUnmeasuredLabel(doc([], m({ 'A-1': 10, 'A-2': 20, 'A-H': 30, 'B-1': 40 })), labels, 'A-2')).toBe('B-H')
  })
  it('wraps around the end', () => {
    expect(nextUnmeasuredLabel(doc([], m({ 'B-1': 40, 'B-H': 30 })), labels, 'B-H')).toBe('A-1')
  })
  it('starts from the beginning when current is null or unknown', () => {
    expect(nextUnmeasuredLabel(doc([], m({ 'A-1': 10 })), labels, null)).toBe('A-2')
    expect(nextUnmeasuredLabel(doc([], m({ 'A-1': 10 })), labels, 'ZZ')).toBe('A-2')
  })
  it('null when everything is measured', () => {
    const all = m({ 'A-1': 1, 'A-2': 2, 'A-H': 3, 'B-1': 4, 'B-H': 5 })
    expect(nextUnmeasuredLabel(doc([], all), labels, 'A-1')).toBeNull()
  })
})

describe('room filters', () => {
  const r = rect('a', 'SE', 0, 0, 300, 400)
  it('roomHasMissing', () => {
    expect(roomHasMissing(doc([r], m({ 'SE-1': 300, 'SE-2': 400, 'SE-3': 300, 'SE-4': 400, 'SE-D': 500, 'SE-H': 250 })), r)).toBe(false)
    expect(roomHasMissing(doc([r], m({ 'SE-1': 300 })), r)).toBe(true)
  })
  it('roomIsFlagged on discrepancy over 2 cm', () => {
    // Planned values are inside faces (10 cm walls): 300 - 10 = 290, 400 - 10 = 390, diagonal sqrt(290² + 390²) = 486.0.
    expect(roomIsFlagged(doc([r], m({ 'SE-1': 290, 'SE-2': 390, 'SE-3': 290, 'SE-4': 390, 'SE-D': 486, 'SE-H': 250 })), r)).toBe(false)
    expect(roomIsFlagged(doc([r], m({ 'SE-1': 310, 'SE-2': 390, 'SE-3': 290, 'SE-4': 390, 'SE-D': 486, 'SE-H': 250 })), r)).toBe(true) // 310 vs 290 planned
  })
  it('roomIsFlagged on squareness warning', () => {
    // Walls match their inside-face plan (290 / 390), so only the diagonal is off: 510 vs 486.
    const sq = m({ 'SE-1': 290, 'SE-2': 390, 'SE-3': 290, 'SE-4': 390, 'SE-D': 510, 'SE-H': 250 })
    expect(roomIsFlagged(doc([r], sq), r)).toBe(true)
  })
  it('not flagged without planned value or measurements', () => {
    expect(roomIsFlagged(doc([r]), r)).toBe(false)
    const noPlan = rect('c', 'NP', 0, 0, 100, 100, { diagonal: undefined })
    // NP-H has no planned ceiling height, so a measured value cannot be flagged
    expect(roomIsFlagged(doc([noPlan], m({ 'NP-H': 250 })), noPlan)).toBe(false)
  })
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

import { ITEM_DEFAULTS, sizesForKind } from './logic'

describe('item defaults', () => {
  it('prefills a new window', () => {
    expect(sizesForKind({}, null, 'window')).toEqual({ widthCm: 120, heightCm: 135, sillCm: 90 })
  })
  it('has the agreed defaults', () => {
    expect(ITEM_DEFAULTS.door).toEqual({ widthCm: 80, heightCm: 204 })
    expect(ITEM_DEFAULTS.opening).toEqual({ widthCm: 90, heightCm: 204 })
    expect(ITEM_DEFAULTS.radiator).toEqual({ widthCm: 80, heightCm: 60 })
  })
  it('swaps untouched defaults when the type changes and drops the unused ones', () => {
    expect(sizesForKind({ widthCm: 120, heightCm: 135, sillCm: 90 }, 'window', 'door')).toEqual({ widthCm: 80, heightCm: 204 })
  })
  it('keeps values the user typed', () => {
    expect(sizesForKind({ widthCm: 95, heightCm: 135, sillCm: 90 }, 'window', 'door')).toEqual({ widthCm: 95, heightCm: 204 })
  })
  it('never stores 0 or empty', () => {
    const out = sizesForKind({ widthCm: 0 }, 'other', 'other')
    expect('widthCm' in out).toBe(false)
  })
})

describe('measureRooms and docProgress with storage', () => {
  it('excludes storage rooms from measureRooms and docProgress', () => {
    const parent = rect('a', 'A', 0, 0, 400, 300, { walkOrder: 2 })
    const other = rect('b', 'B', 500, 0, 200, 200, { walkOrder: 1 })
    const storage = rect('s', 'S', 0, -65, 100, 65, { walkOrder: 3, storage: { parentRoomId: 'a' } })
    const d = doc([parent, other, storage], m({ 'A-1': 400 }))
    expect(measureRooms(d).map((r) => r.id)).toEqual(['b', 'a'])
    expect(docProgress(d)).toEqual({ done: 1, total: 12 })
  })
})
