// Keep furniture with its room when whole rooms are dragged in Plan mode. Pure functions: no store,
// no React. A furniture item belongs to a room when its centre (xCm, yCm) is inside the room polygon.
// Only whole-room translation uses this: wall resize, vertex drag and room delete leave furniture.
import { pointInPolygon } from '../../model/geometry'
import type { Artboard, FurnitureItem } from '../../model/types'

/**
 * IDs of the furniture items of `artboard` whose centre is inside at least one of the rooms whose
 * id is in `roomIds`. An item in two rooms of `roomIds` is listed once.
 */
export function furnitureIdsInRooms(artboard: Artboard, roomIds: readonly string[]): Set<string> {
  const byId = new Map(artboard.rooms.map((r) => [r.id, r] as const))
  const polygons = roomIds
    .map((id) => byId.get(id))
    .filter((r): r is NonNullable<typeof r> => !!r)
    .map((r) => r.vertices)
    .filter((v) => v.length >= 3)
  const out = new Set<string>()
  if (polygons.length === 0) return out
  for (const f of artboard.furniture) {
    const p = { x: f.xCm, y: f.yCm }
    if (polygons.some((poly) => pointInPolygon(p, poly))) out.add(f.id)
  }
  return out
}

/**
 * New array in which the items whose id is in `ids` are moved by (dx, dy); the other items are
 * returned as they are. Called from a drag with the start-of-drag items, so no drift builds up.
 */
export function translateFurnitureByIds(
  furniture: readonly FurnitureItem[],
  ids: ReadonlySet<string>,
  dx: number,
  dy: number,
): FurnitureItem[] {
  if (ids.size === 0 || (dx === 0 && dy === 0)) return furniture.slice()
  return furniture.map((f) => (ids.has(f.id) ? { ...f, xCm: f.xCm + dx, yCm: f.yCm + dy } : f))
}
