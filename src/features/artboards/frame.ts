// Pure artboard geometry: the Figma-style frame rectangle in world cm and the areas.
// No React here, so the unit tests can import it in the node environment.
import { area } from '../../model/geometry'
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

/** Content extent of an artboard in artboard-local cm. Always includes the origin; negatives count. */
function contentExtent(a: Artboard) {
  let minX = 0, minY = 0, maxX = 0, maxY = 0
  const grow = (x0: number, y0: number, x1: number, y1: number) => {
    minX = Math.min(minX, x0); minY = Math.min(minY, y0); maxX = Math.max(maxX, x1); maxY = Math.max(maxY, y1)
  }
  for (const r of a.rooms) for (const v of r.vertices) grow(v.x, v.y, v.x, v.y)
  for (const o of a.openings) grow(o.xCm, o.yCm, o.xCm, o.yCm)
  for (const f of a.furniture) grow(f.xCm - f.widthCm / 2, f.yCm - f.depthCm / 2, f.xCm + f.widthCm / 2, f.yCm + f.depthCm / 2)
  return { minX, minY, maxX, maxY }
}

/**
 * Frame of an artboard: its content (rooms, openings, furniture, negative local coords too) grown
 * by `ARTBOARD_PAD_CM` on every side, at least `MIN_ARTBOARD_WIDTH_CM` x `MIN_ARTBOARD_HEIGHT_CM`.
 * With the minimum size the extra space goes to the right and bottom.
 */
export function artboardFrame(a: Artboard): ArtboardFrame {
  const c = contentExtent(a)
  const width = Math.max(c.maxX - c.minX + 2 * ARTBOARD_PAD_CM, MIN_ARTBOARD_WIDTH_CM)
  const height = Math.max(c.maxY - c.minY + 2 * ARTBOARD_PAD_CM, MIN_ARTBOARD_HEIGHT_CM)
  const x = a.xCm + c.minX - ARTBOARD_PAD_CM
  const y = a.yCm + c.minY - ARTBOARD_PAD_CM
  return { x, y, width, height, minX: x, minY: y, maxX: x + width, maxY: y + height }
}

/** Artboard under the world point (frame contains it); else the active one; else the first. */
export function pickArtboard(artboards: Artboard[], world: { x: number; y: number }, activeId: string | null): Artboard {
  const hit = artboards.find((a) => {
    const f = artboardFrame(a)
    return world.x >= f.minX && world.x <= f.maxX && world.y >= f.minY && world.y <= f.maxY
  })
  return hit ?? artboards.find((a) => a.id === activeId) ?? artboards[0]
}

/** Area of one room in m² (cm² / 10 000). */
export const roomAreaM2 = (r: Room): number => area(r.vertices) / 10_000

/** Total floor area of an artboard in m²: the sum of its rooms. */
export const artboardAreaM2 = (a: Artboard): number =>
  a.rooms.reduce((sum, r) => sum + roomAreaM2(r), 0)
