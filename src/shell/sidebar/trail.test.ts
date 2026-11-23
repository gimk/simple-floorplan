// Pure breadcrumb trail and Esc-up rule of the Inspect tab (docs/sidebar-plan-3.md step 6).
import { describe, expect, it } from 'vitest'
import type { PlanDoc, Room } from '../../model/types'
import { buildTrail, parentSelection, roomIdOfSelection } from './trail'

const rect = (): Room => ({
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
})

const doc = (over: Partial<PlanDoc> = {}): PlanDoc => ({
  projectId: 'local',
  title: 'Test',
  rooms: [rect()],
  elements: [
    { id: 'e1', roomId: 'r1', wallStart: 'v1', kind: 'door', offsetCm: 10, widthCm: 83, createdAt: '', updatedAt: '' },
  ],
  measurements: {},
  roomNotes: {},
  tapes: [{ id: 't1', a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, roomId: 'r1' }],
  pins: [{ id: 'p1', roomId: 'r1', at: { x: 10, y: 10 }, photoKeys: [], createdAt: '', updatedAt: '' }],
  ...over,
})

const texts = (d: PlanDoc, selection: Parameters<typeof buildTrail>[1], annot: Parameters<typeof buildTrail>[2] = null) =>
  buildTrail(d, selection, annot).map((c) => c.text)

describe('buildTrail', () => {
  it('shows the apartment alone when nothing is selected', () => {
    expect(texts(doc(), null)).toEqual(['Apartment'])
  })

  it('shows the room name and code for a room selection', () => {
    expect(texts(doc(), { kind: 'room', roomId: 'r1' })).toEqual(['Apartment', 'Séjour (SE)'])
  })

  it('shows the survey wall label', () => {
    expect(texts(doc(), { kind: 'wall', roomId: 'r1', wallStart: 'v1' })).toEqual(['Apartment', 'Séjour (SE)', 'Wall SE-2'])
  })

  it('shows a vertex', () => {
    expect(texts(doc(), { kind: 'vertex', roomId: 'r1', vertexId: 'v1' })).toEqual(['Apartment', 'Séjour (SE)', 'Vertex'])
  })

  it('shows the element kind through its room', () => {
    expect(texts(doc(), { kind: 'element', elementId: 'e1' })).toEqual(['Apartment', 'Séjour (SE)', 'Element Door'])
  })

  it('shows tape and pin through their room', () => {
    expect(texts(doc(), null, { kind: 'tape', id: 't1' })).toEqual(['Apartment', 'Séjour (SE)', 'Tape'])
    expect(texts(doc(), null, { kind: 'pin', id: 'p1' })).toEqual(['Apartment', 'Séjour (SE)', 'Pin'])
  })

  it('falls back to the bare level when the item is gone', () => {
    expect(texts(doc({ elements: [], rooms: [] }), { kind: 'element', elementId: 'nope' })).toEqual(['Apartment', 'Element'])
    expect(texts(doc({ rooms: [] }), { kind: 'wall', roomId: 'r1', wallStart: 'v0' })).toEqual(['Apartment', 'Wall'])
  })

  it('gives every crumb the selection that restores it', () => {
    const crumbs = buildTrail(doc(), { kind: 'wall', roomId: 'r1', wallStart: 'v1' }, null)
    expect(crumbs.map((c) => c.select)).toEqual([
      { kind: 'apartment' },
      { kind: 'room', roomId: 'r1' },
      { kind: 'wall', roomId: 'r1', wallStart: 'v1' },
    ])
  })
})

describe('roomIdOfSelection', () => {
  it('finds the room of an element, a tape and a pin', () => {
    expect(roomIdOfSelection(doc(), { kind: 'element', elementId: 'e1' }, null)).toBe('r1')
    expect(roomIdOfSelection(doc(), null, { kind: 'tape', id: 't1' })).toBe('r1')
    expect(roomIdOfSelection(doc(), null, { kind: 'pin', id: 'p1' })).toBe('r1')
  })

  it('returns undefined when there is no room', () => {
    expect(roomIdOfSelection(doc(), null, null)).toBeUndefined()
    expect(roomIdOfSelection(doc({ tapes: [] }), null, { kind: 'tape', id: 't1' })).toBeUndefined()
  })
})

describe('parentSelection (Esc goes up one level)', () => {
  it('goes from a wall to its room', () => {
    expect(parentSelection(doc(), { kind: 'wall', roomId: 'r1', wallStart: 'v1' }, null))
      .toEqual({ kind: 'select', selection: { kind: 'room', roomId: 'r1' } })
  })

  it('goes from a vertex, outline or hole, to its room', () => {
    expect(parentSelection(doc(), { kind: 'vertex', roomId: 'r1', vertexId: 'v1' }, null))
      .toEqual({ kind: 'select', selection: { kind: 'room', roomId: 'r1' } })
  })

  it('goes from an element to its room', () => {
    expect(parentSelection(doc(), { kind: 'element', elementId: 'e1' }, null))
      .toEqual({ kind: 'select', selection: { kind: 'room', roomId: 'r1' } })
  })

  it('clears the selection for an element with no room', () => {
    expect(parentSelection(doc({ elements: [] }), { kind: 'element', elementId: 'e1' }, null))
      .toEqual({ kind: 'select', selection: null })
  })

  it('clears the selection for a room', () => {
    expect(parentSelection(doc(), { kind: 'room', roomId: 'r1' }, null)).toEqual({ kind: 'select', selection: null })
  })

  it('clears the selection for a wall whose room is gone', () => {
    expect(parentSelection(doc({ rooms: [] }), { kind: 'wall', roomId: 'r1', wallStart: 'v0' }, null))
      .toEqual({ kind: 'select', selection: null })
  })

  it('drops a tape or a pin selection and goes to its room', () => {
    expect(parentSelection(doc(), null, { kind: 'tape', id: 't1' }))
      .toEqual({ kind: 'select', selection: { kind: 'room', roomId: 'r1' }, clearAnnot: true })
    expect(parentSelection(doc(), null, { kind: 'pin', id: 'p1' }))
      .toEqual({ kind: 'select', selection: { kind: 'room', roomId: 'r1' }, clearAnnot: true })
  })

  it('clears a tape with no room', () => {
    expect(parentSelection(doc({ tapes: [] }), null, { kind: 'tape', id: 't1' }))
      .toEqual({ kind: 'select', selection: null, clearAnnot: true })
  })

  it('does nothing when nothing is selected', () => {
    expect(parentSelection(doc(), null, null)).toEqual({ kind: 'none' })
  })

  it('clears the group with the selection (one step per press)', () => {
    const step = parentSelection(doc(), { kind: 'room', roomId: 'r1' }, null)
    expect(step).toEqual({ kind: 'select', selection: null })
  })
})
