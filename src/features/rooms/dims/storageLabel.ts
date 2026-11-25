// Where the label of a built-in storage goes, and when it is not drawn at all (UI test report
// docs/ui-test-report-storage.md, "Look": on a storage of 100 x 60 cm the wall number badge '3'
// overlapped the end of the small "Storage" label).
//
// A storage is a small room outside its parent room: its inside ring is narrow, and the wall number
// badges of its own walls sit at the ends of the dimension lines, near its inside corners. The label
// therefore goes at the CENTRE of the inside ring, where the badges are farthest away, and it is
// dropped when the ring is smaller than the label box plus the band of a badge on every side. The
// storage then keeps its hatch and its walls: only the name goes.
//
// Pure: no store, no React. Units are cm, y points down.
import type { Vec } from '../../../model/types'
import { ringBox, type Box } from './dimBoxes'
import { DIM_STYLE, worldPx } from './dimLine'

/** Sizes of the storage label, in screen px. */
export const STORAGE_LABEL = {
  /** Height of the label line of a small room (px(10) in RoomsOverlay.tsx). */
  fontPx: 10,
  /** Width of one character at `fontPx` (approximate, like the other text boxes of the plan). */
  charPx: 6.2,
  /** Clear space kept between the label box and a wall number badge, px. */
  badgeGapPx: 4,
  /** Characters of the widest wall number badge (a storage has walls 1 to 8: at most 2 digits). */
  badgeDigits: 2,
}

/** Size of the widest badge of a storage, screen px. */
const badgeW = DIM_STYLE.badgePad + DIM_STYLE.badgeCharW * STORAGE_LABEL.badgeDigits
const badgeH = DIM_STYLE.badgeH

/** Size of the label of `text` on the plan, cm. */
export function storageLabelSize(text: string, zoom: number): { w: number; h: number } {
  return {
    w: worldPx(Math.max(text.length, 1) * STORAGE_LABEL.charPx, zoom),
    h: worldPx(STORAGE_LABEL.fontPx, zoom),
  }
}

/**
 * True when a label of w×h cm fits in the inside ring of a storage with the band of a wall number
 * badge plus a small gap on every side: the label then cannot touch a badge of its own walls.
 */
export function storageLabelFits(ring: Vec[], w: number, h: number, zoom: number): boolean {
  const box = ringBox(ring)
  const mx = worldPx(badgeW / 2 + STORAGE_LABEL.badgeGapPx, zoom)
  const my = worldPx(badgeH / 2 + STORAGE_LABEL.badgeGapPx, zoom)
  // The band is the same on every side: a badge sits near an inside corner of the ring.
  return box.x1 - box.x0 >= w + 2 * mx && box.y1 - box.y0 >= h + 2 * my
}

/** The centre of the inside ring of a storage, cm: where its label goes. */
export function storageLabelCentre(ring: Vec[]): Vec {
  const box: Box = ringBox(ring)
  return { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 }
}

/**
 * Where the label of a storage goes, and true when it is drawn: the centre of its inside ring, and
 * only when the label box fits there with the badge margin on every side.
 */
export function storageLabelPlace(
  ring: Vec[],
  text: string,
  zoom: number,
  size = storageLabelSize(text, zoom),
): { p: Vec; show: boolean } {
  return { p: storageLabelCentre(ring), show: storageLabelFits(ring, size.w, size.h, zoom) }
}
