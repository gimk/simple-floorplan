// Pure selection results of the wall and room clicks of RoomsLayer. No store and no React, so the
// unit tests run in node. A plain click (no Shift) keeps the old single-select behavior; a Shift
// click toggles the object in or out of a mixed multi-selection.
import type { Selection } from '../../model/types'
import { selectedRoomIds, toggleMultiTarget } from '../selection/multiSelect'

/** Selection after a click on the wall `edgeIndex` of `roomId`. Shift toggles the wall. */
export function wallClickSelection(
  sel: Selection,
  artboardId: string,
  roomId: string,
  edgeIndex: number,
  shift: boolean,
): Selection {
  if (shift) return toggleMultiTarget(sel, artboardId, { kind: 'wall', roomId, edgeIndex })
  return { kind: 'wall', artboardId, roomId, edgeIndex }
}

/** Selection after a click on a room floor (Design mode). Shift toggles the room. */
export function roomClickSelection(
  sel: Selection,
  artboardId: string,
  roomId: string,
  shift: boolean,
): Selection {
  if (shift) return toggleMultiTarget(sel, artboardId, { kind: 'room', roomId })
  return { kind: 'room', artboardId, roomIds: [roomId] }
}

export type RoomDownResult = {
  /** Selection to write, or null to keep the current one untouched. */
  selection: Selection | null
  /** Ids of the rooms that the drag moves (in selection order). */
  ids: string[]
  /** False when the press removed the room from the selection: no drag must start. */
  startDrag: boolean
}

/**
 * Result of a Plan-mode pointer-down on the floor of `roomId`.
 * Shift toggles the room in the mixed selection and drags the rooms that stay selected.
 * A plain press on a room that a 'room' selection already holds keeps that whole selection (today's
 * behavior); any other plain press replaces the selection with that one room.
 */
export function roomDownSelection(
  sel: Selection,
  artboardId: string,
  roomId: string,
  shift: boolean,
): RoomDownResult {
  if (shift) {
    const selection = toggleMultiTarget(sel, artboardId, { kind: 'room', roomId })
    const ids = [...selectedRoomIds(selection, artboardId)]
    return { selection, ids, startDrag: ids.includes(roomId) }
  }
  if (sel.kind === 'room' && sel.artboardId === artboardId && sel.roomIds.includes(roomId)) {
    return { selection: null, ids: [...sel.roomIds], startDrag: true }
  }
  return { selection: { kind: 'room', artboardId, roomIds: [roomId] }, ids: [roomId], startDrag: true }
}
