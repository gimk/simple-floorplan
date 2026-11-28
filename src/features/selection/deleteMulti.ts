// Pure deletion of the objects of a mixed 'multi' selection, inside ONE artboard draft. No store and
// no React, so the unit tests run in node: App.tsx wraps this call in one useDoc update, which makes
// the whole delete one undo step. Each kind follows the single-item action it mirrors:
//   - openings: removed like deleteOpening (src/features/openings/actions.ts);
//   - furniture: whole groups removed like deleteFurnitureGroup, then 1-member groups cleaned up;
//   - rooms: removed like deleteRooms, then the openings are re-synced with
//     syncOpeningsForRoomChange (an opening whose host room is gone and that is on no other wall goes
//     with it);
//   - walls: removed like the single-wall Delete (deleteWall: the neighbours are reconnected); a room
//     that would drop below 3 points keeps its wall and the target is skipped.
import type { Artboard, MultiTarget, Opening, Room } from '../../model/types'
import { cleanupSingleMemberGroups, expandToGroups } from '../furniture/groups'
import { syncOpeningsForRoomChange } from '../openings/sync'
import { deleteWall } from '../rooms/ops'

/**
 * Delete every target of `items` from `artboard` (mutated in place, meant to be a document draft).
 * Unknown ids are ignored, and so are duplicate targets. Returns the number of objects removed.
 */
export function deleteMultiItems(artboard: Artboard, items: readonly MultiTarget[]): number {
  let deleted = 0

  // Openings first, so that the room sync below never sees one that is already gone.
  const openingIds = new Set<string>()
  for (const t of items) if (t.kind === 'opening') openingIds.add(t.openingId)
  if (openingIds.size > 0) {
    const kept: Opening[] = artboard.openings.filter((o) => !openingIds.has(o.id))
    deleted += artboard.openings.length - kept.length
    artboard.openings = kept
  }

  // Furniture: one target brings its whole group, like a furniture delete in Design mode.
  const furnitureIds = expandToGroups(
    artboard,
    items.filter((t) => t.kind === 'furniture').map((t) => t.furnitureId),
  )
  if (furnitureIds.length > 0) {
    const gone = new Set(furnitureIds)
    const kept = artboard.furniture.filter((f) => !gone.has(f.id))
    deleted += artboard.furniture.length - kept.length
    artboard.furniture = kept
    cleanupSingleMemberGroups(artboard.furniture)
  }

  // Rooms and walls: a wall of a room that is deleted with the same selection needs no separate work.
  const roomIds = new Set<string>()
  const wallEdges = new Map<string, Set<number>>()
  for (const t of items) {
    if (t.kind === 'room') roomIds.add(t.roomId)
    if (t.kind === 'wall') {
      const edges = wallEdges.get(t.roomId) ?? new Set<number>()
      edges.add(t.edgeIndex)
      wallEdges.set(t.roomId, edges)
    }
  }
  if (roomIds.size === 0 && wallEdges.size === 0) return deleted

  const prevRooms = artboard.rooms
  const nextRooms: Room[] = []
  for (const room of prevRooms) {
    if (roomIds.has(room.id)) {
      deleted += 1
      continue
    }
    const edges = wallEdges.get(room.id)
    if (!edges || edges.size === 0) {
      nextRooms.push(room)
      continue
    }
    // Highest edge first: each removal shifts the higher edge indices down by one.
    let current: Room = room
    for (const edgeIndex of [...edges].sort((a, b) => b - a)) {
      const next = deleteWall(current, edgeIndex)
      if (!next) continue
      current = next
      deleted += 1
    }
    nextRooms.push(current)
  }
  artboard.rooms = nextRooms
  artboard.openings = syncOpeningsForRoomChange(artboard.openings, prevRooms, nextRooms)
  return deleted
}
