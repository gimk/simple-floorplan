// Pure artboard geometry: the Figma-style frame rectangle in world cm and the areas.
// No React here, so the unit tests can import it in the node environment.
import { area } from '../../model/geometry'
import { artboardBounds } from '../../model/store'
import type { Artboard, Room } from '../../model/types'

/** Empty space kept around the rooms, doors and furniture of an artboard. */
export const ARTBOARD_PAD_CM = 40

/** Smallest frame, so an empty artboard still looks like a page. */
export const MIN_ARTBOARD_WIDTH_CM = 600
export const MIN_ARTBOARD_HEIGHT_CM = 450

/** World rectangle of an artboard frame (cm, y points down). */
export type ArtboardFrame = {
  /** World x of the left edge. */
  x: number
  /** World y of the top edge. */
  y: number
  width: number
  height: number
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/**
 * Frame of an artboard: its content bounds (`artboardBounds`) grown by `ARTBOARD_PAD_CM`
 * on every side, at least `MIN_ARTBOARD_WIDTH_CM` x `MIN_ARTBOARD_HEIGHT_CM`.
 * The top-left corner sits `ARTBOARD_PAD_CM` before the artboard origin (xCm, yCm) unless
 * the minimum size pushes the empty space to the right and bottom.
 */
export function artboardFrame(a: Artboard): ArtboardFrame {
  const b = artboardBounds(a)
  const contentW = Math.max(b.maxX - b.minX, 0)
  const contentH = Math.max(b.maxY - b.minY, 0)
  const width = Math.max(contentW + 2 * ARTBOARD_PAD_CM, MIN_ARTBOARD_WIDTH_CM)
  const height = Math.max(contentH + 2 * ARTBOARD_PAD_CM, MIN_ARTBOARD_HEIGHT_CM)
  const x = a.xCm - ARTBOARD_PAD_CM
  const y = a.yCm - ARTBOARD_PAD_CM
  return { x, y, width, height, minX: x, minY: y, maxX: x + width, maxY: y + height }
}

/** Area of one room in m² (cm² / 10 000). */
export const roomAreaM2 = (r: Room): number => area(r.vertices) / 10_000

/** Total floor area of an artboard in m²: the sum of its rooms. */
export const artboardAreaM2 = (a: Artboard): number =>
  a.rooms.reduce((sum, r) => sum + roomAreaM2(r), 0)
