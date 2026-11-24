// Boxes of the texts, badges and tags of the plan (fixes of the round 1 UI test: R1-2 badge vs
// dimension text, R1-8 small rooms). Pure: no store, no React. Units are cm, y points down.
//
// Every size is an APPROXIMATION of the browser text box, as the drawing code does it: `chars *
// charWidth` px wide and `font` px high, then divided by the zoom to get cm. A turned text gets the
// axis aligned box that holds it, so a test can compare boxes without a browser.
import { dist, norm, sub } from '../../../model/geometry'
import type { Vec } from '../../../model/types'
import { DIM_STYLE, worldPx, type DimLine } from './dimLine'

/** An axis aligned box, cm. */
export type Box = { x0: number; y0: number; x1: number; y1: number }

/** True when the two boxes have a common area (boxes that only touch do not hit). */
export const boxHit = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1

/** Box of a w×h rectangle centred on p (not turned). */
export const boxAt = (p: Vec, w: number, h: number): Box => ({
  x0: p.x - w / 2, y0: p.y - h / 2, x1: p.x + w / 2, y1: p.y + h / 2,
})

/** Box of a text of `chars * charWidth` px wide and `font` px high, turned by `angleDeg`. */
export function textBox(centre: Vec, angleDeg: number, text: string, zoom: number): Box {
  const halfW = worldPx((text.length * DIM_STYLE.charWidth) / 2, zoom)
  const halfH = worldPx(DIM_STYLE.font / 2, zoom)
  const a = (angleDeg * Math.PI) / 180
  const c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a))
  // The axis aligned box that holds the turned text: a bit larger than the text, never smaller.
  const hx = c * halfW + s * halfH
  const hy = s * halfW + c * halfH
  return { x0: centre.x - hx, y0: centre.y - hy, x1: centre.x + hx, y1: centre.y + hy }
}

/** Box of the text of a dimension line, cm. */
export const dimTextBox = (line: DimLine, text: string, zoom: number): Box =>
  textBox(line.text, line.angle, text, zoom)

/** Size of a wall number badge, screen px: its padding and its characters. */
export const badgeSizePx = (badge: string) => ({
  w: DIM_STYLE.badgePad + DIM_STYLE.badgeCharW * badge.length,
  h: DIM_STYLE.badgeH,
})

export type WallBadgeInput = {
  /** The line the dimension text is on: the dimension line, or the face when only a text is drawn. */
  lineA: Vec
  lineB: Vec
  /** Unit normal of the wall, away from the wall (the side of the text). */
  normal: Vec
  /** Text of the badge, e.g. '4'. */
  badge: string
  /**
   * Distance from the line to the MIDDLE of the dimension text, px; null when the wall shows no
   * text (the badge then stays near the wall).
   */
  textOffPx: number | null
  zoom: number
}

/**
 * Where the wall number badge goes (r1fix R1-2): near the START end of the dimension line, at the
 * same distance from the wall as the text. Before, the badge sat at the middle of the wall, one
 * pixel from the middle of the text, so it read as an overlap. A badge that still falls on a
 * dimension text is not drawn by the plan (RoomsOverlay), so the two never touch.
 */
export function wallBadge(input: WallBadgeInput): { centre: Vec; box: Box } {
  const { lineA, lineB, normal, badge, textOffPx, zoom } = input
  const size = badgeSizePx(badge)
  const w = worldPx(size.w, zoom), h = worldPx(size.h, zoom)
  const len = dist(lineA, lineB)
  const dir = len > 0 ? norm(sub(lineB, lineA)) : { x: 1, y: 0 }
  const n = norm(normal)
  // Across the line: the band of the text, so the badge stays close to the wall in a small room.
  const offPx = textOffPx ?? DIM_STYLE.badgeNear
  // Along the line: just past the start tick, and never past the middle (where the text sits).
  const along = Math.min(worldPx(DIM_STYLE.badgeStart, zoom) + w / 2, len / 2)
  const o = worldPx(offPx, zoom)
  const centre = { x: lineA.x + dir.x * along + n.x * o, y: lineA.y + dir.y * along + n.y * o }
  return { centre, box: boxAt(centre, w, h) }
}

/** Box of the outline of a ring (its bounding box), cm. */
export function ringBox(ring: Vec[]): Box {
  if (!ring.length) return { x0: 0, y0: 0, x1: 0, y1: 0 }
  const xs = ring.map((p) => p.x), ys = ring.map((p) => p.y)
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) }
}

/** True when a w×h box centred on p lies inside `room` (a shared edge counts as inside). */
export const boxInside = (room: Box, p: Vec, w: number, h: number) =>
  p.x - w / 2 >= room.x0 - 1e-6 && p.x + w / 2 <= room.x1 + 1e-6 &&
  p.y - h / 2 >= room.y0 - 1e-6 && p.y + h / 2 <= room.y1 + 1e-6

/** Box of a room tag of w×h centred on p, swapped when the placement turns it (vertical). */
export const tagBox = (p: Vec, w: number, h: number, vertical: boolean): Box =>
  vertical ? boxAt(p, h, w) : boxAt(p, w, h)

/**
 * The rows of a room tag that fit in the room (r1fix R1-8b): rows are dropped from the END while
 * the tag box does not fit the inside box of the room. With the order of the tag (area, perimeter,
 * ceiling height, survey progress) that drops the progress first, then the height, the perimeter
 * and at last the area.
 */
export function fittingRows<T>(
  rows: T[],
  opts: { p: Vec; vertical: boolean; size: (count: number) => { w: number; h: number }; room: Box },
): T[] {
  for (let n = rows.length; n > 0; n--) {
    const { w, h } = opts.size(n)
    const fits = opts.vertical ? boxInside(opts.room, opts.p, h, w) : boxInside(opts.room, opts.p, w, h)
    if (fits) return rows.slice(0, n)
  }
  return []
}
