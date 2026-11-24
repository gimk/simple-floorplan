// The room tag moved off a note pin (visual review V-11).
import { describe, expect, it } from 'vitest'
import type { Vec } from '../../../model/types'
import { TAG_PIN, pushTagOffPins } from './tagPin'

/** Inner ring of a 400 x 300 cm room with 10 cm walls. */
const RING: Vec[][] = [[{ x: 5, y: 5 }, { x: 395, y: 5 }, { x: 395, y: 295 }, { x: 5, y: 295 }]]

/** The place the label found: the middle of that room. */
const PLACE = { p: { x: 200, y: 150 }, vertical: false }

/** A tag box of 80 x 34 cm (code, name and area at zoom 1). */
const W = 80
const H = 34

describe('the room tag and the note pins', () => {
  it('keeps its place when no pin is near', () => {
    const p = pushTagOffPins({ place: PLACE, w: W, h: H, pins: [{ x: 300, y: 250 }], zoom: 1, rings: RING })
    expect(p).toEqual(PLACE.p)
    expect(pushTagOffPins({ place: PLACE, w: W, h: H, pins: [], zoom: 1, rings: RING })).toEqual(PLACE.p)
  })

  it('moves down by one pin and px(8) when a pin sits on the tag', () => {
    // The pin is on the middle of the tag box: it hides the room name.
    const p = pushTagOffPins({ place: PLACE, w: W, h: H, pins: [{ x: 200, y: 150 }], zoom: 1, rings: RING })
    // The pin is px(11) of radius: 22 px of pin and 8 px of gap, so 30 cm at zoom 1.
    expect(p).toEqual({ x: 200, y: 150 + 2 * TAG_PIN.pinRadiusPx + TAG_PIN.gapPx })
    expect(p.y).toBe(180)
  })

  it('moves up when the room has no place under the tag', () => {
    // A tag near the bottom of the room: down does not fit, up does.
    const near = { p: { x: 200, y: 270 }, vertical: false }
    const p = pushTagOffPins({ place: near, w: W, h: H, pins: [{ x: 200, y: 270 }], zoom: 1, rings: RING })
    expect(p).toEqual({ x: 200, y: 270 - 30 })
  })

  it('stays where it was when neither side has room', () => {
    // A very low room: 40 cm of inner height, and a tag of 34 cm.
    const low: Vec[][] = [[{ x: 5, y: 5 }, { x: 395, y: 5 }, { x: 395, y: 45 }, { x: 5, y: 45 }]]
    const place = { p: { x: 200, y: 25 }, vertical: false }
    const p = pushTagOffPins({ place, w: W, h: H, pins: [{ x: 200, y: 25 }], zoom: 1, rings: low })
    expect(p).toEqual(place.p)
  })

  it('counts the size of a pin in screen px, so a zoomed plan moves less in cm', () => {
    // At 50 %, px(30) is 60 cm: the tag of a big room still has place for it.
    const room: Vec[][] = [[{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 3000 }, { x: 0, y: 3000 }]]
    const place = { p: { x: 2000, y: 1500 }, vertical: false }
    const p = pushTagOffPins({ place, w: W, h: H, pins: [{ x: 2000, y: 1500 }], zoom: 0.5, rings: room })
    expect(p).toEqual({ x: 2000, y: 1500 + 60 })
  })
})
