// Pure marquee (box) selection rules for Plan and Design mode. No store and no React, so the unit
// tests run in node. The Plan rules mix rooms, walls and openings; the Design rules keep furniture
// and only add rooms to the merge when Shift is held.
import type { Artboard, MultiTarget, Selection } from '../../model/types'
import { expandToGroups } from '../furniture/groups'
import { findFurnitureInBox } from '../furniture/geometry'
import { normalizeSelection, sameTarget, selectionToTargets } from '../selection/multiSelect'
import { findOpeningsInBox, findRoomsInBox, findWallsInBox } from './boxSelect'
import type { Box } from './boxSelect'

/** The world box moved into the artboard-local cm space of `Room.vertices` and `Opening.xCm`. */
export function localBox(world: Box, artboard: Artboard): Box {
  return {
    minX: world.minX - artboard.xCm,
    minY: world.minY - artboard.yCm,
    maxX: world.maxX - artboard.xCm,
    maxY: world.maxY - artboard.yCm,
  }
}

/**
 * Plan mode marquee result for `world`, a box in world cm:
 * - plain box that touches rooms selects those rooms (today's behaviour);
 * - plain box that touches no room selects the walls and openings inside it;
 * - Shift keeps the current selection and adds the walls, the openings and the rooms it touches.
 * Returns 'none' for a missing artboard or an empty hit.
 */
export function planMarqueeSelection(
  current: Selection,
  artboard: Artboard | undefined,
  world: Box,
  shift: boolean,
): Selection {
  if (!artboard) return { kind: 'none' }
  const rooms: MultiTarget[] = (findRoomsInBox(world, [artboard])?.roomIds ?? []).map(
    (roomId): MultiTarget => ({ kind: 'room', roomId }),
  )
  const local = localBox(world, artboard)
  const walls = findWallsInBox(local, artboard)
  const openings = findOpeningsInBox(local, artboard)

  if (!shift) {
    return rooms.length > 0
      ? normalizeSelection(artboard.id, rooms)
      : normalizeSelection(artboard.id, [...walls, ...openings])
  }

  // Shift: keep the current selection of this artboard and add every hit. Rooms are added too, so a
  // Shift box over a room does not drop the walls and the openings it also covers.
  const merged = selectionToTargets(current, artboard.id)
  for (const hit of [...walls, ...openings, ...rooms]) {
    if (!merged.some((t) => sameTarget(t, hit))) merged.push({ ...hit })
  }
  return normalizeSelection(artboard.id, merged)
}

/**
 * Design mode merge rule: with Shift held and a current selection that holds rooms of this
 * artboard, the furniture items inside `world` are added to those rooms (group members expanded).
 * Returns null when the rule does not apply, so the caller keeps the plain furniture marquee.
 */
export function designMarqueeMergedSelection(
  current: Selection,
  artboard: Artboard | undefined,
  world: Box,
  shift: boolean,
): Selection | null {
  if (!artboard || !shift) return null
  const before = selectionToTargets(current, artboard.id)
  if (!before.some((t) => t.kind === 'room')) return null
  const hits = expandToGroups(artboard, findFurnitureInBox(localBox(world, artboard), artboard))
  const merged = [...before]
  for (const furnitureId of hits) {
    const target: MultiTarget = { kind: 'furniture', furnitureId }
    if (!merged.some((t) => sameTarget(t, target))) merged.push(target)
  }
  return normalizeSelection(artboard.id, merged)
}
