// Tests of the style logic behind the mixed multi-selection Inspect card: what several selected
// objects share (multiStyleSummary, sharedValue) and how one patch writes them (applyStylePatch).
// Pure logic: a plain artboard object stands in for the document draft.
//   ab1 holds r1 (painted walls, floor), r2 (plain), o1 = door, o2 = window, and two furniture items.
import { describe, expect, it } from 'vitest'
import { createArtboard } from '../../model/schema'
import type { Artboard, FurnitureItem, MultiTarget, Opening, Room } from '../../model/types'
import { applyStylePatch, multiStyleSummary, sharedValue } from './multiStyle'

const room = (id: string, p: Partial<Room> = {}): Room => ({
  id,
  name: id.toUpperCase(),
  vertices: [
    { x: 0, y: 0 },
    { x: 400, y: 0 },
    { x: 400, y: 300 },
    { x: 0, y: 300 },
  ],
  ...p,
})

const opening = (id: string, p: Partial<Opening> = {}): Opening => ({
  id,
  kind: 'door',
  xCm: 100,
  yCm: 0,
  angleDeg: 0,
  widthCm: 80,
  ...p,
})

const item = (id: string, p: Partial<FurnitureItem> = {}): FurnitureItem => ({
  id,
  name: 'Sofa',
  shape: 'rect',
  xCm: 100,
  yCm: 200,
  widthCm: 100,
  depthCm: 50,
  rotationDeg: 0,
  color: '#4b5563',
  ...p,
})

const board = (p: Partial<Artboard> = {}): Artboard => ({ ...createArtboard('Plan A'), id: 'ab1', precisionCm: 1, ...p })

const wall = (roomId: string, edgeIndex: number): MultiTarget => ({ kind: 'wall', roomId, edgeIndex })
const open = (openingId: string): MultiTarget => ({ kind: 'opening', openingId })
const rm = (roomId: string): MultiTarget => ({ kind: 'room', roomId })
const furn = (furnitureId: string): MultiTarget => ({ kind: 'furniture', furnitureId })

describe('sharedValue', () => {
  it('gives the common value when every entry is the same', () => {
    expect(sharedValue(['#fff', '#fff'])).toEqual({ mixed: false, value: '#fff' })
    expect(sharedValue([0])).toEqual({ mixed: false, value: 0 })
    expect(sharedValue([undefined, undefined])).toEqual({ mixed: false, value: undefined })
  })

  it('marks the values as mixed as soon as two entries differ, and drops the value', () => {
    expect(sharedValue(['#fff', '#000'])).toEqual({ mixed: true, value: undefined })
    // An absent value and a real one differ too.
    expect(sharedValue(['#fff', undefined])).toEqual({ mixed: true, value: undefined })
    expect(sharedValue([0, false as unknown as number])).toEqual({ mixed: true, value: undefined })
  })

  it('is not mixed for an empty list, and has no value', () => {
    expect(sharedValue([])).toEqual({ mixed: false, value: undefined })
  })
})

describe('multiStyleSummary', () => {
  it('gives one entry per kind present, with counts and shared values', () => {
    const ab = board({
      rooms: [room('r1', { wallColors: { '0': '#aa0000', '2': '#aa0000' }, fill: '#111111' }), room('r2')],
      openings: [opening('o1', { color: '#333333' }), opening('o2', { kind: 'window', color: '#333333' })],
      furniture: [item('a', { color: '#444444' }), item('b', { color: '#444444' })],
    })
    const summary = multiStyleSummary(ab, [wall('r1', 0), wall('r1', 2), open('o1'), open('o2'), furn('a'), furn('b')])

    expect(summary.walls).toEqual({ count: 2, color: { mixed: false, value: '#aa0000' } })
    expect(summary.openings).toEqual({
      count: 2,
      color: { mixed: false, value: '#333333' },
      kinds: { door: 1, window: 1 },
    })
    expect(summary.furniture).toEqual({ count: 2, color: { mixed: false, value: '#444444' } })
    // No room target: the kind is left out entirely.
    expect(summary.rooms).toBeUndefined()
  })

  it('flags the values that differ, kind by kind', () => {
    const ab = board({
      rooms: [
        room('r1', { wallColors: { '0': '#aa0000', '1': '#00aa00' }, fill: '#111111', floorPattern: 'wood', floorPatternAngleDeg: 45 }),
        room('r2', { fill: '#222222', floorPattern: 'wood', floorPatternAngleDeg: 45 }),
      ],
      openings: [opening('o1'), opening('o2', { kind: 'window', color: '#ffffff' })],
      furniture: [item('a', { color: '#444444' }), item('b', { color: '#555555' })],
    })
    const summary = multiStyleSummary(ab, [wall('r1', 0), wall('r1', 1), open('o1'), open('o2'), rm('r1'), rm('r2'), furn('a'), furn('b')])

    // One painted wall and one unpainted: the colours differ.
    expect(summary.walls?.color).toEqual({ mixed: true, value: undefined })
    expect(summary.openings?.color).toEqual({ mixed: true, value: undefined })
    expect(summary.furniture?.color).toEqual({ mixed: true, value: undefined })
    // The two rooms share the floor pattern and its angle, but not the floor colour.
    expect(summary.rooms?.count).toBe(2)
    expect(summary.rooms?.fill).toEqual({ mixed: true, value: undefined })
    expect(summary.rooms?.floorPattern).toEqual({ mixed: false, value: 'wood' })
    expect(summary.rooms?.floorPatternAngleDeg).toEqual({ mixed: false, value: 45 })
  })

  it('counts a room without a floor pattern as solid and 0 degrees', () => {
    const ab = board({ rooms: [room('r1'), room('r2', { floorPattern: 'solid', floorPatternAngleDeg: 0 })] })
    const summary = multiStyleSummary(ab, [rm('r1'), rm('r2')])
    expect(summary.rooms?.floorPattern).toEqual({ mixed: false, value: 'solid' })
    expect(summary.rooms?.floorPatternAngleDeg).toEqual({ mixed: false, value: 0 })
    expect(summary.rooms?.fill).toEqual({ mixed: false, value: undefined })
  })

  it('skips objects that no longer exist', () => {
    const ab = board({ rooms: [room('r1')], openings: [opening('o1')], furniture: [item('a')] })
    const summary = multiStyleSummary(ab, [
      rm('r1'),
      rm('gone'),
      wall('r1', 9),
      wall('gone', 0),
      open('gone'),
      furn('gone'),
    ])
    expect(summary.rooms?.count).toBe(1)
    // Out-of-range wall edges and missing rooms give no wall entry at all.
    expect(summary.walls).toBeUndefined()
    expect(summary.openings).toBeUndefined()
    expect(summary.furniture).toBeUndefined()
  })

  it('counts a furniture group member only when it is in the items', () => {
    const ab = board({ furniture: [item('a', { groupId: 'g1' }), item('b', { groupId: 'g1' })] })
    // 'a' brings the whole group along for a style copy, but the card counts the items it holds.
    expect(multiStyleSummary(ab, [furn('a')]).furniture?.count).toBe(1)
    expect(multiStyleSummary(ab, [furn('a'), furn('b')]).furniture?.count).toBe(2)
  })
})

describe('applyStylePatch', () => {
  it('writes one wall colour and keeps the other walls and fields', () => {
    const ab = board({ rooms: [room('r1', { wallColors: { '0': '#aa0000', '2': '#00aa00' }, wallKinds: { '0': 'fence' } })] })
    const written = applyStylePatch(ab, [wall('r1', 1), rm('r1'), open('o1')], 'wall', { color: '#0000aa' })
    expect(written).toBe(1)
    expect(ab.rooms[0].wallColors).toEqual({ '0': '#aa0000', '2': '#00aa00', '1': '#0000aa' })
    // The room floor and the wall kinds are untouched.
    expect(ab.rooms[0].wallKinds).toEqual({ '0': 'fence' })
    expect(ab.rooms[0].fill).toBeUndefined()
  })

  it('deletes a wall colour with undefined, and the map when its last key goes', () => {
    const ab = board({ rooms: [room('r1', { wallColors: { '1': '#aa0000', '2': '#00aa00' } }), room('r2', { wallColors: { '0': '#123456' } })] })
    expect(applyStylePatch(ab, [wall('r1', 1)], 'wall', { color: undefined })).toBe(1)
    expect(ab.rooms[0].wallColors).toEqual({ '2': '#00aa00' })
    expect(applyStylePatch(ab, [wall('r2', 0)], 'wall', { color: undefined })).toBe(1)
    expect(ab.rooms[1].wallColors).toBeUndefined()
    // Nothing left to delete: no write.
    expect(applyStylePatch(ab, [wall('r2', 0)], 'wall', { color: undefined })).toBe(0)
  })

  it('skips a missing room, an out-of-range edge and a patch with no field', () => {
    const ab = board({ rooms: [room('r1')] })
    expect(applyStylePatch(ab, [wall('gone', 0), wall('r1', 4), wall('r1', -1)], 'wall', { color: '#000000' })).toBe(0)
    expect(applyStylePatch(ab, [wall('r1', 0)], 'wall', {})).toBe(0)
    expect(ab.rooms[0].wallColors).toBeUndefined()
  })

  it('writes an opening colour and keeps its variant and size', () => {
    const ab = board({
      openings: [opening('o1', { color: '#333333' }), opening('o2', { kind: 'window', variant: 'sliding', widthCm: 120, heightCm: 140 })],
    })
    expect(applyStylePatch(ab, [open('o1'), open('o2')], 'opening', { color: '#abcdef' })).toBe(2)
    expect(ab.openings.map((o) => o.color)).toEqual(['#abcdef', '#abcdef'])
    expect(ab.openings[1]).toMatchObject({ kind: 'window', variant: 'sliding', widthCm: 120, heightCm: 140 })
    // Already that colour: no write.
    expect(applyStylePatch(ab, [open('o1')], 'opening', { color: '#abcdef' })).toBe(0)
    // undefined goes back to the default colours.
    expect(applyStylePatch(ab, [open('o1')], 'opening', { color: undefined })).toBe(1)
    expect(ab.openings[0].color).toBeUndefined()
  })

  it('writes only the room fields the patch names', () => {
    const ab = board({ rooms: [room('r1', { fill: '#111111', floorPattern: 'wood', floorPatternAngleDeg: 45 }), room('r2')] })
    expect(applyStylePatch(ab, [rm('r1')], 'room', { fill: '#222222' })).toBe(1)
    expect(ab.rooms[0]).toMatchObject({ fill: '#222222', floorPattern: 'wood', floorPatternAngleDeg: 45 })
    expect(applyStylePatch(ab, [rm('r2')], 'room', { floorPattern: 'tile', floorPatternAngleDeg: 30 })).toBe(1)
    expect(ab.rooms[1]).toMatchObject({ floorPattern: 'tile', floorPatternAngleDeg: 30 })
    expect(ab.rooms[1].fill).toBeUndefined()
    // undefined deletes the field, and a field the patch does not name stays.
    expect(applyStylePatch(ab, [rm('r1')], 'room', { fill: undefined, floorPattern: undefined })).toBe(1)
    expect(ab.rooms[0].fill).toBeUndefined()
    expect(ab.rooms[0].floorPattern).toBeUndefined()
    expect(ab.rooms[0].floorPatternAngleDeg).toBe(45)
    // Nothing changes: no write.
    expect(applyStylePatch(ab, [rm('r1')], 'room', {})).toBe(0)
  })

  it('writes furniture colours and never another kind of item', () => {
    const ab = board({
      rooms: [room('r1', { fill: '#111111' })],
      furniture: [item('a', { color: '#000000', showDirection: true, widthCm: 40 }), item('b')],
    })
    expect(applyStylePatch(ab, [furn('a'), rm('r1'), wall('r1', 0)], 'furniture', { color: '#abcdef' })).toBe(1)
    expect(ab.furniture[0]).toMatchObject({ color: '#abcdef', showDirection: true, widthCm: 40 })
    expect(ab.furniture[1].color).toBe('#4b5563')
    expect(ab.rooms[0].fill).toBe('#111111')
    // Already that colour: no write, and a missing item is ignored.
    expect(applyStylePatch(ab, [furn('a'), furn('gone')], 'furniture', { color: '#abcdef' })).toBe(0)
  })
})
