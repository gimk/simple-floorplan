// Pure geometry for aligning one furniture item inside the room that holds it (Design mode).
// Units: cm, y points down. No React, no store.
import { pointInPolygon, type Vec } from '../../model/geometry'
import type { FurnitureItem, Room } from '../../model/types'
import { roundToPrecision } from '../rooms/ops'
import { furnitureAxisBounds, furnitureWorldCorners } from './geometry'

export type FurnitureAlignment = 'left' | 'center-x' | 'right' | 'top' | 'center-y' | 'bottom' | 'center'

/** Room that holds the item: centre first, then any corner. Null when the item is outside every room. */
export function findFurnitureRoom(item: FurnitureItem, rooms: readonly Room[]): Room | null {
  const centre = { x: item.xCm, y: item.yCm }
  for (const room of rooms) if (pointInPolygon(centre, room.vertices)) return room
  const corners = furnitureWorldCorners(item)
  for (const room of rooms) if (corners.some((c) => pointInPolygon(c, room.vertices))) return room
  return null
}

/**
 * Interior span [lo, hi] of the polygon along one axis, on the line where the other coordinate is
 * `at`, that brackets `near`. Falls back to the overall extent of the polygon.
 * `horizontal` true: the line is y = at and the span is in x. Otherwise the line is x = at, span in y.
 */
function spanAt(vertices: readonly Vec[], at: number, near: number, horizontal: boolean): [number, number] {
  const u = (p: Vec) => (horizontal ? p.x : p.y) // along the span
  const v = (p: Vec) => (horizontal ? p.y : p.x) // fixed coordinate
  const crossings: number[] = []
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i], b = vertices[(i + 1) % vertices.length]
    const va = v(a), vb = v(b)
    // Half-open rule: an edge counts when the line is in [min, max) of its fixed coordinate.
    if ((va <= at && vb > at) || (vb <= at && va > at)) {
      const t = (at - va) / (vb - va)
      crossings.push(u(a) + t * (u(b) - u(a)))
    }
  }
  crossings.sort((p, q) => p - q)
  for (let i = 0; i + 1 < crossings.length; i += 2) {
    if (near >= crossings[i] - 1e-9 && near <= crossings[i + 1] + 1e-9) return [crossings[i], crossings[i + 1]]
  }
  const all = vertices.map(u)
  return [Math.min(...all), Math.max(...all)]
}

/**
 * New centre of the item for an alignment inside its room, or null when the item is outside all rooms.
 * The result is rounded to precisionCm.
 */
export function alignFurnitureInRoom(
  item: FurnitureItem,
  rooms: readonly Room[],
  alignment: FurnitureAlignment,
  precisionCm: number,
): { xCm: number; yCm: number } | null {
  const room = findFurnitureRoom(item, rooms)
  if (!room) return null
  const b = furnitureAxisBounds(item)
  const halfW = (b.maxX - b.minX) / 2
  const halfH = (b.maxY - b.minY) / 2
  let x = item.xCm
  let y = item.yCm

  const alignX = (kind: 'left' | 'center-x' | 'right') => {
    const [l, r] = spanAt(room.vertices, y, x, true)
    x = kind === 'left' ? l + halfW : kind === 'right' ? r - halfW : (l + r) / 2
  }
  const alignY = (kind: 'top' | 'center-y' | 'bottom') => {
    const [t, d] = spanAt(room.vertices, x, y, false)
    y = kind === 'top' ? t + halfH : kind === 'bottom' ? d - halfH : (t + d) / 2
  }

  if (alignment === 'center') {
    alignX('center-x')
    alignY('center-y')
  } else if (alignment === 'left' || alignment === 'center-x' || alignment === 'right') alignX(alignment)
  else alignY(alignment)

  return { xCm: roundToPrecision(x, precisionCm), yCm: roundToPrecision(y, precisionCm) }
}
