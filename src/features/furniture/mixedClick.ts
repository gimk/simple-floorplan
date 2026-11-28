// Pure helpers for Shift-click in Design mode when the selection is not furniture only: a room
// selection, or an existing mixed 'multi' selection. The clicked item and every member of its group
// are toggled as furniture targets, then the target list is normalised back to a Selection.
// No React, no store, no DOM.
import type { Artboard, MultiTarget, Selection } from '../../model/types'
import { normalizeSelection, sameTarget, selectionToTargets } from '../selection/multiSelect'
import { expandToGroups } from './groups'

/**
 * True when a Shift-click must mix furniture with the current selection instead of using the
 * furniture-only path of `resolveFurnitureClick` (kinds 'none', 'furniture', 'furnitureMulti').
 */
export function mixesFurnitureWithSelection(sel: Selection): boolean {
  return sel.kind === 'room' || sel.kind === 'multi'
}

/**
 * Next selection after a Shift-click on `clickedItemId` while `currentSelection` is a room or a
 * mixed 'multi' selection. The clicked item AND every member of its group are toggled together:
 * all of them are removed when every one is already selected, otherwise all missing ones are added.
 * The result goes through `normalizeSelection`, so it ends as 'furnitureMulti' (furniture only),
 * 'multi' (mixed with rooms), or the kept room selection. `currentSelection` is returned unchanged
 * when the item is not in `artboard`.
 */
export function toggleFurnitureWithMixed(
  artboard: Pick<Artboard, 'id' | 'furniture'>,
  currentSelection: Selection,
  clickedItemId: string,
): Selection {
  const clicked = artboard.furniture.find((f) => f.id === clickedItemId)
  if (!clicked) return currentSelection
  const targets: MultiTarget[] = expandToGroups(artboard, [clickedItemId]).map((furnitureId) => ({
    kind: 'furniture',
    furnitureId,
  }))
  const items = selectionToTargets(currentSelection, artboard.id)
  const isSelected = (target: MultiTarget): boolean => items.some((item) => sameTarget(item, target))

  if (targets.every(isSelected)) {
    for (const target of targets) {
      const at = items.findIndex((item) => sameTarget(item, target))
      if (at >= 0) items.splice(at, 1)
    }
  } else {
    for (const target of targets) if (!isSelected(target)) items.push(target)
  }
  return normalizeSelection(artboard.id, items)
}
