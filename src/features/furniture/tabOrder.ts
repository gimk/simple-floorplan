// Tab / Shift+Tab in Design mode: step through the furniture items of one artboard in layer order,
// wrapping around. Pure helper + the store action App.tsx calls. Units: cm.
import { useDoc } from '../../model/store'
import type { Selection } from '../../model/types'
import { useUi } from '../../shell/uiStore'
import { setFurnitureSelection } from './actions'
import { selectionArtboardId } from './selectionActions'

/**
 * Id of the item Tab (or Shift+Tab) selects. `ids` is the layer order (index 0 = bottom).
 * `currentIds` is the active furniture selection of the same artboard ([] when none): the last id is
 * the anchor. Wraps around. Returns null when there is no furniture at all, or no anchor.
 */
export function nextFurnitureId(
  ids: readonly string[],
  currentIds: readonly string[],
  backwards: boolean,
): string | null {
  if (ids.length === 0 || currentIds.length === 0) return null
  const anchor = currentIds[currentIds.length - 1]
  const at = ids.indexOf(anchor)
  if (at < 0) return ids[0]
  const step = backwards ? -1 : 1
  return ids[(at + step + ids.length) % ids.length]
}

/** Furniture ids of the current selection when they belong to `artboardId`, else []. */
export function furnitureSelectionIds(sel: Selection, artboardId: string): string[] {
  if (sel.kind === 'furniture' && sel.artboardId === artboardId) return [sel.furnitureId]
  if (sel.kind === 'furnitureMulti' && sel.artboardId === artboardId) return sel.furnitureIds
  return []
}

/** Tab / Shift+Tab: select the next or previous furniture item of the same artboard. */
export function selectNextFurniture(backwards: boolean): boolean {
  const ui = useUi.getState()
  const artboardId = selectionArtboardId(ui.selection)
  if (!artboardId) return false
  const artboard = useDoc.getState().doc.artboards.find((a) => a.id === artboardId)
  if (!artboard) return false
  const id = nextFurnitureId(
    artboard.furniture.map((f) => f.id),
    furnitureSelectionIds(ui.selection, artboard.id),
    backwards,
  )
  if (!id) return false
  setFurnitureSelection(artboard.id, [id])
  return true
}
