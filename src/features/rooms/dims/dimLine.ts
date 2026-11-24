// Layout of one dimension line (docs/measurements-plan.md, "COMMON DIMENSION STYLE").
// Pure: no store, no React. Units are cm, y points down. Every screen size is given in px and
// divided by the zoom here, so the caller only passes the zoom.
//
// A dimension line is parallel to the face it measures, a short distance OFF that face (into the
// room, or outside the wall band): a thin line, a 45 degree tick centred on each end, and the text
// centred on the middle of the line on the side away from the wall, always up. When the text does
// not fit between the ticks it goes past the end of the line (outside).
import { add, dist, mul, norm, sub } from '../../../model/geometry'
import type { Vec } from '../../../model/types'

/** Sizes of the common dimension style, in screen px. */
export const DIM_STYLE = {
  /** Dimension line, px. */
  lineStroke: 1,
  /** Tick, px (length and stroke). */
  tickLength: 8,
  tickStroke: 1.5,
  /** Text height, px. */
  font: 11,
  /** Distance from the line to the middle of the text, px. */
  textGap: 7,
  /** Width of one character of the text at `font`, px (approximate). */
  charWidth: 6.2,
  /** A line shorter than this on screen draws nothing, px. */
  minLine: 12,
  /** Text that does not fit in the line length minus this goes outside, px. */
  textPad: 8,
  /** Gap between the end of a line and the text that went outside it, px. */
  outsideGap: 2,
  /** Wall number badge: height, horizontal padding and character width, px. */
  badgeH: 13,
  badgePad: 5,
  badgeCharW: 5.6,
  /** Smallest gap between the text of a dimension and the wall number badge, px. */
  badgeGap: 4,
  /** Distance of the badge from the start end of the line, px. */
  badgeStart: 6,
  /** Distance of the badge from the line when the wall shows no dimension text, px. */
  badgeNear: 10,
}

export type DimTick = { x1: number; y1: number; x2: number; y2: number }

export type DimLine = {
  /** Dimension line ends, cm. */
  x1: number
  y1: number
  x2: number
  y2: number
  /** The two 45 degree ticks, centred on the ends. */
  ticks: [DimTick, DimTick]
  /** Where the text is centred, cm. */
  text: Vec
  /** Rotation of the text, degrees, -90..90 (always up). */
  angle: number
  /** True when the text went past the end of the line (the line is too short for it). */
  outside: boolean
}

export type DimLineInput = {
  /** The face the dimension measures, cm. */
  start: Vec
  end: Vec
  /** Unit normal of that face, pointing away from the wall (into the room, or outside the band). */
  normal: Vec
  /** Distance from the face to the dimension line, cm (e.g. thickness / 2 + px(10)). */
  offsetCm: number
  /** Screen px per cm. */
  zoom: number
  /** The text of the value, e.g. "412" or "✓ 412 · 410,7". */
  text: string
  /**
   * 'outside' puts the text past the end of the line even when it would fit (the small-room rule
   * of r1fix R1-8a, and the short outside segments); 'auto' (default) is the rule of the style.
   */
  textPlace?: 'auto' | 'outside'
  /** End of the line the text goes past when it is outside: the end of the line (default), or its start. */
  outsideEnd?: 'start' | 'end'
  /** Distance from the line to the middle of the text, px (default DIM_STYLE.textGap). */
  textGapPx?: number
  /**
   * Shortest line on screen that is drawn, px (default DIM_STYLE.minLine). The room wall values
   * ask for `DECLUTTER.minLinePx` (dims/declutter.ts), so a face that is too short for a value gets
   * no line and no text at all (visual review V-1).
   */
  minLinePx?: number
}

/** The world size of `n` screen px at this zoom. */
export const worldPx = (n: number, zoom: number) => n / (zoom > 0 ? zoom : 1)

/**
 * Layout of a dimension line, or null when the face is too short on screen to hold one (less than
 * `DIM_STYLE.minLine` px) or when it has no length.
 */
export function dimLine(input: DimLineInput): DimLine | null {
  const { start, end, normal, offsetCm, zoom, text } = input
  const faceCm = dist(start, end)
  const minLine = input.minLinePx ?? DIM_STYLE.minLine
  if (!(faceCm > 0) || !(faceCm * zoom >= minLine)) return null
  const dir = norm(sub(end, start))
  const n = norm(normal)
  const px = (v: number) => worldPx(v, zoom)

  // The line, moved off the face on the side the normal points to.
  const p1 = add(start, mul(n, offsetCm))
  const p2 = add(end, mul(n, offsetCm))

  // A 45 degree tick centred on each end: half of it on each side of the line.
  const tickDir = norm(add(dir, n))
  const half = mul(tickDir, px(DIM_STYLE.tickLength) / 2)
  const tickAt = (c: Vec): DimTick => {
    const a = sub(c, half), b = add(c, half)
    return { x1: a.x, y1: a.y, x2: b.x, y2: b.y }
  }

  // The text, on the side away from the wall, rotated with the line and always up.
  const textWidthPx = text.length * DIM_STYLE.charWidth
  const outside = input.textPlace === 'outside' || textWidthPx > faceCm * zoom - DIM_STYLE.textPad
  const gap = mul(n, px(input.textGapPx ?? DIM_STYLE.textGap))
  // Past the end of the line: the start end or the end of the line, plus the width of the text.
  const atStart = input.outsideEnd === 'start'
  const endPoint = atStart ? p1 : p2
  const away = atStart ? mul(dir, -1) : dir
  const centre = outside
    ? add(add(endPoint, mul(away, px(DIM_STYLE.outsideGap + textWidthPx / 2))), gap)
    : add({ x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }, gap)
  const raw = (Math.atan2(dir.y, dir.x) * 180) / Math.PI
  const angle = raw > 90 ? raw - 180 : raw < -90 ? raw + 180 : raw

  return {
    x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y,
    ticks: [tickAt(p1), tickAt(p2)], text: centre, angle, outside,
  }
}

/** The point at `along` cm from a to b, cm (clamped to the segment). */
export const alongWall = (a: Vec, b: Vec, along: number): Vec => {
  const len = dist(a, b)
  if (!(len > 0)) return { x: a.x, y: a.y }
  const t = Math.min(Math.max(along, 0), len)
  return add(a, mul(norm(sub(b, a)), t))
}

/**
 * The dimension line of one span of a wall: the span [from, to] along the centre line (cm, from
 * node a), drawn `offsetCm` off the centre line on the side the normal points to. Used for the
 * helper dimensions of the selected wall (one line per face of each side).
 */
export function dimLineOfSpan(
  a: Vec,
  b: Vec,
  normal: Vec,
  span: { from: number; to: number },
  offsetCm: number,
  zoom: number,
  text: string,
): DimLine | null {
  const start = alongWall(a, b, Math.min(span.from, span.to))
  const end = alongWall(a, b, Math.max(span.from, span.to))
  return dimLine({ start, end, normal, offsetCm, zoom, text })
}
