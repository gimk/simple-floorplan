// The declutter pass of the room wall dimension texts (visual review V-1, V-2, V-3, V-6, V-7).
import { describe, expect, it } from 'vitest'
import type { Vec } from '../../../model/types'
import { DECLUTTER, keepDimTexts, ringCrossDepth, smallRoomDims, textInRoom, type DimTextCandidate } from './declutter'
import { textBox, textQuad, type Box } from './dimBoxes'
import { dimLine } from './dimLine'

/** The inner ring of a 400 x 300 cm room with 10 cm walls. */
const RING: Vec[] = [{ x: 5, y: 5 }, { x: 395, y: 5 }, { x: 395, y: 295 }, { x: 5, y: 295 }]

/** One text of the plan, with its real boxes: the helpers build them like the drawing code. */
const cand = (
  key: string,
  centre: Vec,
  over: Partial<DimTextCandidate> = {},
  text = '390',
  angle = 0,
): DimTextCandidate => ({
  key,
  box: textBox(centre, angle, text, 1),
  quad: textQuad(centre, angle, text, 1),
  measured: false,
  wallCm: 400,
  ring: RING,
  ...over,
})

describe('room wall dimension texts', () => {
  it('asks for a line of px(24) before a value is written (V-1)', () => {
    expect(DECLUTTER.minLinePx).toBe(24)
    // A face of 23 screen px draws nothing; the same face at the old px(12) minimum still drew.
    const face = { start: { x: 0, y: 0 }, end: { x: 23, y: 0 }, normal: { x: 0, y: 1 }, offsetCm: 10, zoom: 1, text: '23' }
    expect(dimLine({ ...face, minLinePx: DECLUTTER.minLinePx })).toBeNull()
    expect(dimLine(face)).not.toBeNull()
  })

  it('a face that is too short for its value keeps its line and loses its text (V-1)', () => {
    // 60 px of face, 13 characters of text: the value does not fit between the ticks.
    const line = dimLine({
      start: { x: 0, y: 0 }, end: { x: 60, y: 0 }, normal: { x: 0, y: 1 }, offsetCm: 10, zoom: 1,
      text: '✓ 412 · 410,7', minLinePx: DECLUTTER.minLinePx,
    })!
    expect(line.outside).toBe(true)
    // The caller then asks for the same line without a text: nothing goes past the end any more.
    const bare = dimLine({
      start: { x: 0, y: 0 }, end: { x: 60, y: 0 }, normal: { x: 0, y: 1 }, offsetCm: 10, zoom: 1,
      text: '', minLinePx: DECLUTTER.minLinePx,
    })!
    expect(bare.outside).toBe(false)
    expect([bare.x1, bare.x2]).toEqual([0, 60])
  })
})

describe('small rooms (V-2)', () => {
  it('drops every wall dimension of a room under px(60) in both directions', () => {
    const box = (w: number, h: number): Box => ({ x0: 0, y0: 0, x1: w, y1: h })
    // 1200 x 1200 cm at 5 % is 60 x 60 px: not under the limit.
    expect(smallRoomDims(box(1200, 1200), 0.05)).toBe(false)
    // A wet room of 100 x 80 cm at 50 % is 50 x 40 px: no wall dimensions at all.
    expect(smallRoomDims(box(100, 80), 0.5)).toBe(true)
    // Long and thin keeps its dimensions: only one direction is small.
    expect(smallRoomDims(box(2000, 80), 0.5)).toBe(false)
  })
})

describe('text against the wall bands (V-3, V-6)', () => {
  it('measures how deep a text crosses the edge of the ring', () => {
    expect(ringCrossDepth([{ x: 100, y: 100 }], RING)).toBe(0)
    // 6 cm above the top edge of the ring (y = 5).
    expect(ringCrossDepth([{ x: 100, y: -1 }], RING)).toBeCloseTo(6, 6)
    expect(ringCrossDepth([{ x: 100, y: -1 }, { x: 100, y: 100 }], RING)).toBeCloseTo(6, 6)
  })

  it('keeps a text inside its room, and drops one that crosses the wall', () => {
    const inside = cand('in', { x: 200, y: 22 })
    expect(textInRoom(inside.box, inside.quad, RING, 1)).toBe(true)
    // px(2) of slack: a text 1 cm over the edge stays, 5 cm over goes. The text is 11 px high,
    // so its top edge is 5,5 cm above its centre.
    const close = cand('close', { x: 200, y: 9.5 })
    expect(textInRoom(close.box, close.quad, RING, 1)).toBe(true)
    const crossing = cand('cross', { x: 200, y: 5.5 })
    expect(textInRoom(crossing.box, crossing.quad, RING, 1)).toBe(false)
  })

  it('drops a text whose centre is outside the room, even when the box is close', () => {
    const out = cand('out', { x: 450, y: 150 })
    expect(textInRoom(out.box, out.quad, RING, 1)).toBe(false)
    expect(keepDimTexts({ candidates: [out], blockers: [], zoom: 1 }).kept.size).toBe(0)
  })
})

describe('greedy keep of the texts (V-1, V-7)', () => {
  it('keeps a measured value before a calculated one, and then the longer walls', () => {
    // Three texts at the same place: only the first of the order is kept.
    const measured = cand('m', { x: 200, y: 22 }, { measured: true, wallCm: 100 })
    const long = cand('long', { x: 200, y: 22 }, { wallCm: 400 })
    const short = cand('short', { x: 200, y: 22 }, { wallCm: 200 })
    const kept = keepDimTexts({ candidates: [short, long, measured], blockers: [], zoom: 1 })
    expect([...kept.kept]).toEqual(['m'])
    expect(kept.boxes).toHaveLength(1)
    // Without a measured value, the longer wall wins.
    const kept2 = keepDimTexts({ candidates: [short, long], blockers: [], zoom: 1 })
    expect([...kept2.kept]).toEqual(['long'])
  })

  it('keeps one text of two parallel walls whose values touch, and drops the other', () => {
    // Two walls of the same length, values 6 cm apart: their boxes overlap.
    const a = cand('a', { x: 200, y: 22 }, { wallCm: 400 })
    const b = cand('b', { x: 200, y: 28 }, { wallCm: 400 })
    const kept = keepDimTexts({ candidates: [a, b], blockers: [], zoom: 1 })
    expect(kept.kept.size).toBe(1)
    expect([...kept.kept]).toEqual(['a'])
    // Far enough apart, both stay.
    const far = cand('far', { x: 200, y: 60 }, { wallCm: 400 })
    expect(keepDimTexts({ candidates: [a, far], blockers: [], zoom: 1 }).kept.size).toBe(2)
  })

  it('drops a text that hits a room tag or an outside row text', () => {
    const tag: Box = { x0: 150, y0: 10, x1: 250, y1: 40 }
    const a = cand('a', { x: 200, y: 22 })
    const b = cand('b', { x: 300, y: 22 })
    const kept = keepDimTexts({ candidates: [a, b], blockers: [tag], zoom: 1 })
    expect([...kept.kept]).toEqual(['b'])
  })

  it('always keeps the text of a wall being dragged', () => {
    const dragged = cand('drag', { x: 200, y: 22 }, { forced: true, wallCm: 100 })
    const other = cand('other', { x: 200, y: 22 }, { wallCm: 400 })
    const kept = keepDimTexts({ candidates: [other, dragged], blockers: [], zoom: 1 })
    expect([...kept.kept]).toEqual(['drag'])
  })
})
