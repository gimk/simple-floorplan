import { describe, expect, it } from 'vitest'
import type { PlanDoc, Room, WallElement } from '../../model/types'
import { elementRows, wallElementRows, wallLabel, wallRows, WALL_TYPE_LABEL } from './roomLists'

const rect = (over: Partial<Room> = {}): Room => ({
  id: 'r1',
  code: 'SE',
  name: 'Séjour',
  holes: [],
  walls: {},
  walkOrder: 1,
  vertices: [
    { id: 'v0', x: 0, y: 0 },
    { id: 'v1', x: 400, y: 0 },
    { id: 'v2', x: 400, y: 300 },
    { id: 'v3', x: 0, y: 300 },
  ],
  ...over,
})

const el = (over: Partial<WallElement> = {}): WallElement => ({
  id: 'e1', roomId: 'r1', wallStart: 'v0', kind: 'door', offsetCm: 10, widthCm: 83,
  createdAt: '', updatedAt: '', ...over,
})

const doc = (over: Partial<PlanDoc> = {}): PlanDoc => ({
  projectId: 'local', title: 'Test', rooms: [rect()], elements: [], measurements: {}, roomNotes: {}, tapes: [], ...over,
})

describe('wallRows', () => {
  it('lists one row per wall, in polygon order, with the survey label', () => {
    const rows = wallRows(doc(), rect())
    expect(rows.map((r) => r.label)).toEqual(['SE-1', 'SE-2', 'SE-3', 'SE-4'])
    expect(rows.map((r) => r.index)).toEqual([0, 1, 2, 3])
    expect(rows.map((r) => r.wallStart)).toEqual(['v0', 'v1', 'v2', 'v3'])
    // Inside faces: each wall moved in by 5 cm (default 10 cm walls), so 390 x 290.
    expect(rows.map((r) => Math.round(r.lengthCm))).toEqual([390, 290, 390, 290])
  })

  it('defaults to a partition, and reads the stored props', () => {
    const room = rect({ walls: { v1: { type: 'bearing', thicknessCm: 25, locked: true } } })
    const rows = wallRows(doc(), room)
    expect(rows[0].type).toBe('partition')
    expect(rows[0].typeLabel).toBe(WALL_TYPE_LABEL.partition)
    expect(rows[1].type).toBe('bearing')
    expect(rows[1].locked).toBe(true)
    expect(rows[2].locked).toBe(false)
  })

  it('adds the on-site value only for measured walls', () => {
    const rows = wallRows(doc({ measurements: { 'SE-2': { label: 'SE-2', actualCm: 305, updatedAt: '' } } }), rect())
    expect(rows.map((r) => r.verifiedCm)).toEqual([null, 305, null, null])
  })
})

describe('wallLabel', () => {
  it('gives the survey label, or null when the wall is gone', () => {
    expect(wallLabel(rect(), 'v2')).toBe('SE-3')
    expect(wallLabel(rect(), 'nope')).toBeNull()
  })
})

describe('elementRows', () => {
  it('keeps the elements of the room only, sorted by wall then offset', () => {
    const room = rect()
    const d = doc({
      elements: [
        el({ id: 'a', wallStart: 'v1', offsetCm: 50 }),
        el({ id: 'b', wallStart: 'v0', offsetCm: 120 }),
        el({ id: 'c', wallStart: 'v0', offsetCm: 20 }),
        el({ id: 'd', roomId: 'other', wallStart: 'v0', offsetCm: 0 }),
      ],
    })
    expect(elementRows(d, room).map((r) => r.id)).toEqual(['c', 'b', 'a'])
  })

  it('carries the kind, the variant and the wall label', () => {
    const d = doc({ elements: [el({ kind: 'window', variant: 'french', wallStart: 'v2', widthCm: 140 })] })
    const [row] = elementRows(d, rect())
    expect(row.kindLabel).toBe('Window')
    expect(row.variantLabel).toBe('French window')
    expect(row.wallLabel).toBe('SE-3')
    expect(row.widthCm).toBe(140)
  })

  it('has no variant label when the element has none', () => {
    const [row] = elementRows(doc({ elements: [el({ kind: 'radiator' })] }), rect())
    expect(row.variantLabel).toBeNull()
  })

  it('gives a null wall label for an element whose wall is gone', () => {
    const [row] = elementRows(doc({ elements: [el({ wallStart: 'gone' })] }), rect())
    expect(row.wallLabel).toBeNull()
  })

  it('returns an empty list when the room has no element', () => {
    expect(elementRows(doc(), rect())).toEqual([])
  })
})

describe('wallElementRows', () => {
  it('keeps the elements of that wall only', () => {
    const d = doc({
      elements: [
        el({ id: 'a', wallStart: 'v1', offsetCm: 200 }),
        el({ id: 'b', wallStart: 'v1', offsetCm: 10 }),
        el({ id: 'c', wallStart: 'v2' }),
      ],
    })
    expect(wallElementRows(d, rect(), 'v1').map((r) => r.id)).toEqual(['b', 'a'])
    expect(wallElementRows(d, rect(), 'v3')).toEqual([])
  })
})
