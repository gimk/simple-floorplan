// Pure helpers of the Artboard tool: frame rectangle from a drag, and artboard creation.
// No React here, so the unit tests can import it in the node environment.
import type { Vec } from '../../model/geometry'
import { createArtboard } from '../../model/schema'
import { useDoc } from '../../model/store'
import type { Artboard } from '../../model/types'
import { ARTBOARD_PAD_CM, MIN_ARTBOARD_HEIGHT_CM, MIN_ARTBOARD_WIDTH_CM } from './frame'

/** Snap step of the drawn frame corners, in cm. */
export const ARTBOARD_SNAP_CM = 10
/** A drag shorter than this (cm on both axes) counts as a single click. */
export const ARTBOARD_CLICK_THRESHOLD_CM = 10

/** Frame rectangle in world cm (top-left corner, size). */
export type FrameRect = { x: number; y: number; w: number; h: number }
export type DrawMods = { shift: boolean; alt: boolean; cmd: boolean }

const snapTo = (v: number, step: number) => Math.round(v / step) * step

/** Next default name: "Plan A", "Plan B"... (same rule as `addArtboard`). */
export const nextArtboardName = (artboards: Artboard[]): string =>
  `Plan ${String.fromCharCode(65 + (artboards.length % 26))}`

/**
 * Frame rectangle of a drag from `start` to `end` (world cm). Corners snap to 10 cm unless Cmd/Ctrl
 * is held; Shift makes a square; Alt draws from the centre (start is the centre).
 * Sides are at least the minimum frame size, so the preview shows the real result.
 * A drag below the click threshold gives the default size centred on the point.
 */
export function artboardRectFromDrag(start: Vec, end: Vec, mods: DrawMods): FrameRect {
  const step = mods.cmd ? 1 : ARTBOARD_SNAP_CM
  const s = { x: snapTo(start.x, step), y: snapTo(start.y, step) }
  let e = { x: snapTo(end.x, step), y: snapTo(end.y, step) }
  if (Math.abs(e.x - s.x) < ARTBOARD_CLICK_THRESHOLD_CM && Math.abs(e.y - s.y) < ARTBOARD_CLICK_THRESHOLD_CM) {
    return {
      x: s.x - MIN_ARTBOARD_WIDTH_CM / 2, y: s.y - MIN_ARTBOARD_HEIGHT_CM / 2,
      w: MIN_ARTBOARD_WIDTH_CM, h: MIN_ARTBOARD_HEIGHT_CM,
    }
  }
  if (mods.shift) {
    const side = Math.max(Math.abs(e.x - s.x), Math.abs(e.y - s.y))
    e = { x: s.x + (e.x < s.x ? -side : side), y: s.y + (e.y < s.y ? -side : side) }
  }
  const a = mods.alt ? { x: 2 * s.x - e.x, y: 2 * s.y - e.y } : s
  const w = Math.max(Math.abs(e.x - a.x), MIN_ARTBOARD_WIDTH_CM)
  const h = Math.max(Math.abs(e.y - a.y), MIN_ARTBOARD_HEIGHT_CM)
  // Grow away from the start corner (or the centre) when the minimum size applies.
  const x = mods.alt ? s.x - w / 2 : e.x < s.x ? s.x - w : s.x
  const y = mods.alt ? s.y - h / 2 : e.y < s.y ? s.y - h : s.y
  return { x, y, w, h }
}

/** True when the pointer moved less than the click threshold (single click, default size). */
export const isArtboardClick = (start: Vec, end: Vec): boolean =>
  Math.abs(end.x - start.x) < ARTBOARD_CLICK_THRESHOLD_CM && Math.abs(end.y - start.y) < ARTBOARD_CLICK_THRESHOLD_CM

/**
 * Create an artboard whose frame is `rect`, as ONE undo step. The frame of an empty artboard
 * starts ARTBOARD_PAD_CM left/above its origin, so the origin goes inside the rectangle.
 * Returns the new artboard id.
 */
export function addArtboardWithFrame(rect: FrameRect): string {
  const doc = useDoc.getState()
  const a = createArtboard(nextArtboardName(doc.doc.artboards), rect.x + ARTBOARD_PAD_CM, rect.y + ARTBOARD_PAD_CM)
  a.widthCm = rect.w
  a.heightCm = rect.h
  doc.update((d) => { d.artboards.push(a) })
  return a.id
}
