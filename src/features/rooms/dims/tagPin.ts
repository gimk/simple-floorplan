// Where the tag of a room goes when a note pin sits on it (visual review V-11).
//
// A note pin (features/annotations/index.tsx) is a solid orange disc of px(11) radius at its point
// on the plan, drawn AFTER the room labels, so a pin in the middle of a room hides the room name
// ("our" / "éjour" of "Séjour"). When a pin lies within the tag box plus px(8), the tag moves down
// by one pin and that gap, when it still fits in the room; when it does not, it moves up by the
// same distance; when neither fits, it stays where it was.
//
// Pure: no store, no React. Units are cm, y points down.

import { boxFits } from '../../../model/geometry'
import type { Vec } from '../../../model/types'
import { boxAt, boxHit, growBox, tagBox } from './dimBoxes'
import { worldPx } from './dimLine'

/** Sizes of the pin rule, in screen px. */
export const TAG_PIN = {
  /** Radius of the disc of a note pin on the plan (features/annotations/index.tsx). */
  pinRadiusPx: 11,
  /** Clear space kept between a pin and the tag box, px. */
  gapPx: 8,
}

/** Where a room tag goes: its centre, and true when the tag is turned (a narrow room). */
export type TagPlace = { p: Vec; vertical: boolean }

export type TagPinInput = {
  /** The place the room label found by itself (labelPlacement), cm. */
  place: TagPlace
  /** Size of the tag box on the plan, cm, before the swap of a turned tag. */
  w: number
  h: number
  /** Note pins of the plan (doc.pins), cm. */
  pins: Vec[]
  /** Screen px per cm. */
  zoom: number
  /** Rings of the room, cm: the moved tag must fit in them. */
  rings: Vec[][]
}

/** The size of the tag box on the plan, cm: a turned tag has its width and height swapped. */
const boxSize = (place: TagPlace, w: number, h: number) =>
  place.vertical ? { w: h, h: w } : { w, h }

/**
 * The centre of the room tag, moved off a note pin that would hide the name (V-11): down by one
 * pin and px(8) when the tag still fits in the room, else up by the same distance, else unchanged.
 */
export function pushTagOffPins({ place, w, h, pins, zoom, rings }: TagPinInput): Vec {
  if (!pins.length) return place.p
  const pinR = worldPx(TAG_PIN.pinRadiusPx, zoom)
  const clear = worldPx(TAG_PIN.gapPx, zoom)
  const box = tagBox(place.p, w, h, place.vertical)
  const pinBoxAt = (pin: Vec) => growBox(boxAt(pin, 2 * pinR, 2 * pinR), clear)
  if (!pins.some((pin) => boxHit(box, pinBoxAt(pin)))) return place.p
  const size = boxSize(place, w, h)
  const step = 2 * pinR + clear
  for (const dy of [step, -step]) {
    const p = { x: place.p.x, y: place.p.y + dy }
    if (boxFits(p, size.w, size.h, rings)) return p
  }
  return place.p
}
