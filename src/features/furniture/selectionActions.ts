// Selection shortcuts of the Figma-style key map: Select all (Cmd/Ctrl+A), and Enter / Shift+Enter
// to enter a group (select its top member) or to leave a member for its whole group.
// Pure resolution functions first (no store), then the store actions App.tsx calls. Units: cm.
import { useDoc } from '../../model/store'
import type { Artboard, ProjectDoc, Selection } from '../../model/types'
import { useUi, type Mode } from '../../shell/uiStore'
import { setFurnitureSelection } from './actions'
import { expandToGroups, groupMemberIds } from './groups'

/** What Select all would select: furniture of one artboard, or every room of one artboard. */
export type SelectAllTarget =
  | { kind: 'furniture'; artboardId: string; ids: string[] }
  | { kind: 'rooms'; artboardId: string; ids: string[] }
  | null

/** Artboard id of a selection, or null when the selection carries none. */
export function selectionArtboardId(sel: Selection): string | null {
  return 'artboardId' in sel ? sel.artboardId : null
}

/**
 * Select all (Cmd/Ctrl+A). Design mode: every furniture item of the artboard of the current
 * selection; with nothing selected, the first artboard that holds furniture. Plan mode: every room
 * of the artboard of a multi-room selection; any other selection does nothing.
 */
export function resolveSelectAll(doc: ProjectDoc, sel: Selection, mode: Mode): SelectAllTarget {
  if (mode === 'design') {
    const wanted = selectionArtboardId(sel)
    const artboard =
      doc.artboards.find((a) => a.id === wanted && a.furniture.length > 0) ??
      doc.artboards.find((a) => a.furniture.length > 0)
    if (!artboard) return null
    return { kind: 'furniture', artboardId: artboard.id, ids: artboard.furniture.map((f) => f.id) }
  }
  // Plan mode: only a multi-room selection has something to extend to the whole artboard.
  if (sel.kind !== 'room' || sel.roomIds.length < 2) return null
  const artboard = doc.artboards.find((a) => a.id === sel.artboardId)
  if (!artboard || artboard.rooms.length === 0) return null
  return { kind: 'rooms', artboardId: artboard.id, ids: artboard.rooms.map((r) => r.id) }
}

/** Apply Select all for the current mode. Returns false when the shortcut has no job. */
export function selectAll(): boolean {
  const ui = useUi.getState()
  const target = resolveSelectAll(useDoc.getState().doc, ui.selection, ui.mode)
  if (!target) return false
  if (target.kind === 'furniture') setFurnitureSelection(target.artboardId, target.ids)
  else useUi.getState().set({ activeArtboardId: target.artboardId, selection: { kind: 'room', artboardId: target.artboardId, roomIds: target.ids } })
  return true
}

/**
 * Enter: the single item to select when exactly one whole group is selected. `null` when the
 * selection is anything else (no selection, one ungrouped item, several groups...).
 * The "top member" is the member drawn last (highest layer position).
 */
export function resolveEnterGroup(
  artboard: Pick<Artboard, 'furniture'> | undefined,
  sel: Selection,
): string | null {
  if (!artboard || sel.kind !== 'furnitureMulti') return null
  const unique = new Set(sel.furnitureIds)
  if (unique.size < 2) return null
  const members = artboard.furniture.filter((f) => unique.has(f.id))
  if (members.length !== unique.size) return null
  const groupId = members[0].groupId
  if (!groupId || members.some((f) => f.groupId !== groupId)) return null
  const allMembers = artboard.furniture.filter((f) => f.groupId === groupId)
  if (allMembers.length !== members.length) return null
  return allMembers[allMembers.length - 1].id
}

/** Enter: select the top member of the one whole group that is selected. */
export function enterGroup(): boolean {
  const ui = useUi.getState()
  const artboard = useDoc.getState().doc.artboards.find((a) => a.id === selectionArtboardId(ui.selection))
  const id = resolveEnterGroup(artboard, ui.selection)
  if (!id || !artboard) return false
  useUi.getState().set({ activeArtboardId: artboard.id, selection: { kind: 'furniture', artboardId: artboard.id, furnitureId: id } })
  return true
}

/** Shift+Enter: with one grouped item selected, the ids of its whole group; else null. */
export function resolveShiftEnterGroup(
  artboard: Pick<Artboard, 'id' | 'furniture'> | undefined,
  sel: Selection,
): string[] | null {
  if (!artboard || sel.kind !== 'furniture' || sel.artboardId !== artboard.id) return null
  const item = artboard.furniture.find((f) => f.id === sel.furnitureId)
  if (!item?.groupId) return null
  const members = groupMemberIds(artboard, item.groupId)
  return members.length >= 2 ? expandToGroups(artboard, members) : null
}

/** Shift+Enter: select the whole group of the selected item. */
export function exitGroupToSelection(): boolean {
  const ui = useUi.getState()
  const artboard = useDoc.getState().doc.artboards.find((a) => a.id === selectionArtboardId(ui.selection))
  const ids = resolveShiftEnterGroup(artboard, ui.selection)
  if (!artboard || !ids) return false
  setFurnitureSelection(artboard.id, ids)
  return true
}

/** Esc with no other job: drop the selection. */
export function clearSelection(): void {
  useUi.getState().set({ selection: { kind: 'none' } })
}
