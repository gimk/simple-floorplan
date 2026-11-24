// Boxes of the dimension texts, the wall number badges and the room tags (round 1 findings R1-2 and
// R1-8): the badge must not sit on the text, and a small room keeps only the tag rows that fit.
import { describe, expect, it } from 'vitest'
import { DIM_STYLE, dimLine, worldPx } from './dimLine'
import {
  badgeSizePx, boxAt, boxHit, boxInside, dimTextBox, fittingRows, ringBox, tagBox, textBox, wallBadge,
} from './dimBoxes'

/** A horizontal inside face from (5,5) to (395,5), the room below it (y points down). */
const faceStart = { x: 5, y: 5 }
const faceEnd = { x: 395, y: 5 }
const inward = { x: 0, y: 1 }

/** The dimension line of that face at zoom 1, with its value. */
const line = (text = '390', zoom = 1) =>
  dimLine({ start: faceStart, end: faceEnd, normal: inward, offsetCm: worldPx(10, zoom), zoom, text })!

describe('textBox', () => {
  it('approximates the text with chars * 6,2 px of width and 11 px of height', () => {
    const b = textBox({ x: 100, y: 50 }, 0, '390', 1)
    expect(b.x1 - b.x0).toBeCloseTo(3 * DIM_STYLE.charWidth, 6)
    expect(b.y1 - b.y0).toBeCloseTo(DIM_STYLE.font, 6)
    expect([(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2]).toEqual([100, 50])
  })

  it('grows to hold a turned text, and follows the zoom', () => {
    const flat = textBox({ x: 0, y: 0 }, 0, '390', 1)
    const turned = textBox({ x: 0, y: 0 }, 90, '390', 1)
    expect(turned.x1 - turned.x0).toBeCloseTo(flat.y1 - flat.y0, 6)
    expect(turned.y1 - turned.y0).toBeCloseTo(flat.x1 - flat.x0, 6)
    // Half the zoom: the same text covers twice as many cm.
    const zoomed = textBox({ x: 0, y: 0 }, 0, '390', 0.5)
    expect(zoomed.x1 - zoomed.x0).toBeCloseTo(2 * (flat.x1 - flat.x0), 6)
  })

  it('hits only boxes that share an area', () => {
    const a = boxAt({ x: 0, y: 0 }, 10, 10)
    expect(boxHit(a, boxAt({ x: 9, y: 0 }, 10, 10))).toBe(true)
    // Boxes that only touch do not hit.
    expect(boxHit(a, boxAt({ x: 10, y: 0 }, 10, 10))).toBe(false)
  })
})

describe('wallBadge (R1-2: the badge must not overlap the dimension text)', () => {
  /** The badge of the line `d`, at the given zoom: the line of the value, not the face. */
  const badgeOf = (d: ReturnType<typeof line>, zoom = 1, label = '1') =>
    wallBadge({
      lineA: { x: d.x1, y: d.y1 }, lineB: { x: d.x2, y: d.y2 }, normal: inward, badge: label,
      textOffPx: DIM_STYLE.textGap, zoom,
    })

  it('puts the badge in the band of the text, at the start end of the line', () => {
    const b = badgeOf(line())
    const w = badgeSizePx('1').w
    // The line of the value is 10 px inside the face: 6 px past its start, then half the badge.
    expect(b.centre.x).toBeCloseTo(5 + DIM_STYLE.badgeStart + w / 2, 6)
    // Across the line: the same distance from the wall as the text (it stays near the wall).
    expect(b.centre.y).toBeCloseTo(15 + DIM_STYLE.textGap, 6)
  })

  it('does not intersect the text, which is centred while the badge is at the start end', () => {
    for (const zoom of [4, 2, 1, 0.5]) {
      for (const text of ['86', '390', '✓ 412 · 390']) {
        const d = line(text, zoom)
        expect(boxHit(dimTextBox(d, text, zoom), badgeOf(d, zoom, '12').box)).toBe(false)
      }
    }
  })

  it('can fall on a text that fills the whole line: the plan then drops the badge', () => {
    // At a low zoom the value of a long measured wall covers nearly the whole line, so the badge
    // would hit it. RoomsOverlay does not draw a badge that hits a dimension text of the plan.
    const d = line('✓ 412 · 410,7', 0.25)
    expect(boxHit(dimTextBox(d, '✓ 412 · 410,7', 0.25), badgeOf(d, 0.25, '12').box)).toBe(true)
  })

  it('keeps clear of a text that went past the end of the line', () => {
    // A short face: the value does not fit between the ticks and sits past the end of the line.
    const d = dimLine({ start: faceStart, end: { x: 60, y: 5 }, normal: inward, offsetCm: 10, zoom: 1, text: '✓ 412 · 410,7' })!
    expect(d.outside).toBe(true)
    const b = wallBadge({ lineA: faceStart, lineB: { x: 60, y: 5 }, normal: inward, badge: '3', textOffPx: DIM_STYLE.textGap, zoom: 1 })
    expect(boxHit(dimTextBox(d, '✓ 412 · 410,7', 1), b.box)).toBe(false)
  })

  it('stays near the wall when the wall shows no dimension text', () => {
    const b = wallBadge({ lineA: faceStart, lineB: faceEnd, normal: inward, badge: '4', textOffPx: null, zoom: 1 })
    expect(b.centre.y).toBeCloseTo(5 + DIM_STYLE.badgeNear, 6)
  })
})

describe('room tag in a small room (R1-8)', () => {
  /** The size of a tag of `count` rows, as RoomsLayer labelAt computes it at zoom 1. */
  const size = (count: number) => ({ w: (Math.max(8 * 7.8, count > 0 ? 68 : 0) + 10), h: 19 + 15 * count })
  const rows = ['11,31 m²', 'P 13,60 m', 'H 2,50 m', '1/4 walls']

  it('keeps every row when the tag box fits the room', () => {
    const room = { x0: 5, y0: 5, x1: 395, y1: 295 }
    expect(fittingRows(rows, { p: { x: 200, y: 150 }, vertical: false, size, room })).toEqual(rows)
  })

  it('drops rows from the end: progress, ceiling, perimeter, then area', () => {
    // Inside box 190 x 60 cm: room for the title and two rows (19 + 30 px), not for three.
    const room = { x0: 5, y0: 5, x1: 195, y1: 65 }
    expect(fittingRows(rows, { p: { x: 100, y: 35 }, vertical: false, size, room })).toEqual(['11,31 m²', 'P 13,60 m'])
    // Inside box 190 x 28 cm: not even the title with one row fits.
    expect(fittingRows(rows, { p: { x: 100, y: 19 }, vertical: false, size, room: { x0: 5, y0: 5, x1: 195, y1: 33 } })).toEqual([])
  })

  it('swaps the box of a tag that the placement turns (vertical)', () => {
    const p = { x: 20, y: 100 }
    expect(tagBox(p, 80, 60, true)).toEqual({ x0: -10, y0: 60, x1: 50, y1: 140 })
    expect(tagBox(p, 80, 60, false)).toEqual({ x0: -20, y0: 70, x1: 60, y1: 130 })
    // The turned box fits a narrow room, the flat one does not.
    const room = { x0: -10, y0: 0, x1: 50, y1: 200 }
    expect(boxInside(room, p, 60, 80)).toBe(true)
    expect(boxInside(room, p, 80, 60)).toBe(false)
  })

  it('gives the box of a ring, and reads a box that shares an edge as inside', () => {
    expect(ringBox([{ x: 0, y: 10 }, { x: 50, y: -5 }, { x: 20, y: 30 }])).toEqual({ x0: 0, y0: -5, x1: 50, y1: 30 })
    const room = { x0: 0, y0: 0, x1: 40, y1: 40 }
    expect(boxInside(room, { x: 20, y: 20 }, 40, 40)).toBe(true)
    expect(boxInside(room, { x: 21, y: 20 }, 40, 40)).toBe(false)
  })
})
