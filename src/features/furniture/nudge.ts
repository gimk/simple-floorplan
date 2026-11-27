// Arrow-key nudge of the selected furniture (1 cm, 10 cm with Shift). One undo step per press.
// Group members always move together, even when a single member of a group is selected
// (entered with Enter or a double-click). Units: cm.
import { useDoc } from '../../model/store'
import type { ProjectDoc, Selection } from '../../model/types'
import { useUi } from '../../shell/uiStore'
import { expandToGroups } from './groups'
import { selectionArtboardId } from './selectionActions'

/** Default nudge distances of the arrow keys, in cm. */
export const NUDGE_STEP_CM = 1
export const NUDGE_STEP_BIG_CM = 10

/** Nudge distance of one arrow key press. */
export const nudgeStep = (shift: boolean): number => (shift ? NUDGE_STEP_BIG_CM : NUDGE_STEP_CM)

/** True when the selection holds furniture (single item or multi-selection). */
export function hasFurnitureSelection(sel: Selection): boolean {
  return sel.kind === 'furniture' || sel.kind === 'furnitureMulti'
}

/**
 * Move items by (dx, dy): the ids of the selection, grown to whole groups. `doc` is untouched;
 * the caller applies the returned mutator when it is not null.
 */
export function nudgeFurniture(
  doc: ProjectDoc,
  sel: Selection,
  dx: number,
  dy: number,
): ((d: ProjectDoc) => void) | null {
  const artboardId = selectionArtboardId(sel)
  if (!artboardId) return null
  const artboard = doc.artboards.find((a) => a.id === artboardId)
  if (!artboard) return null
  const raw = sel.kind === 'furniture' ? [sel.furnitureId] : sel.kind === 'furnitureMulti' ? sel.furnitureIds : []
  const ids = new Set(expandToGroups(artboard, raw))
  if (ids.size === 0) return null
  if (!artboard.furniture.some((f) => ids.has(f.id))) return null
  return (d) => {
    const ab = d.artboards.find((a) => a.id === artboardId)
    if (!ab) return
    for (const f of ab.furniture) {
      if (!ids.has(f.id)) continue
      f.xCm += dx
      f.yCm += dy
    }
  }
}

/** Arrow-key nudge of the selected furniture. Returns false when nothing can move. */
export function nudgeFurnitureSelection(dx: number, dy: number): boolean {
  const sel = useUi.getState().selection
  if (!hasFurnitureSelection(sel)) return false
  const change = nudgeFurniture(useDoc.getState().doc, sel, dx, dy)
  if (!change) return false
  useDoc.getState().update(change)
  return true
}
