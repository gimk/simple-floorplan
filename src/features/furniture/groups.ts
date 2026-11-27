// Pure helpers for flat (one-level) furniture groups: expansion, click/double-click/Esc
// selection, grouping/ungrouping in layer order, and 1-member group clean-up.
// No React, no store, no DOM.
import type { Artboard, FurnitureItem, Selection } from '../../model/types'

/** All furniture ids in `artboard` that belong to `groupId`, in layer order. */
export function groupMemberIds(artboard: Pick<Artboard, 'furniture'> | undefined, groupId: string): string[] {
  if (!artboard) return []
  return artboard.furniture.filter((f) => f.groupId === groupId).map((f) => f.id)
}

/**
 * Expand `ids` so that any item with a `groupId` brings every member of its group.
 * Preserves the order of `ids` (inserting missing group members right after the first hit of
 * their group) and drops duplicates.
 */
export function expandToGroups(artboard: Pick<Artboard, 'furniture'> | undefined, ids: readonly string[]): string[] {
  const unique = [...new Set(ids)]
  if (!artboard || unique.length === 0) return unique
  const byId = new Map(artboard.furniture.map((f) => [f.id, f]))
  const out: string[] = []
  const seen = new Set<string>()
  for (const id of unique) {
    if (!seen.has(id)) {
      seen.add(id)
      out.push(id)
    }
    const gid = byId.get(id)?.groupId
    if (!gid) continue
    for (const f of artboard.furniture) {
      if (f.groupId === gid && !seen.has(f.id)) {
        seen.add(f.id)
        out.push(f.id)
      }
    }
  }
  return out
}

/** True when `ids` has 2+ items and equals every member of one single group. */
export function isSingleWholeGroup(artboard: Pick<Artboard, 'furniture'> | undefined, ids: readonly string[]): boolean {
  if (!artboard || ids.length < 2) return false
  const unique = new Set(ids)
  if (unique.size < 2) return false
  const items = artboard.furniture.filter((f) => unique.has(f.id))
  if (items.length !== unique.size) return false
  const gid = items[0].groupId
  if (!gid || items.some((f) => f.groupId !== gid)) return false
  const allMembers = artboard.furniture.filter((f) => f.groupId === gid)
  return allMembers.length === items.length
}

/** True when any item in `ids` belongs to a group. */
export function hasAnyGroupedItem(artboard: Pick<Artboard, 'furniture'> | undefined, ids: readonly string[]): boolean {
  if (!artboard || ids.length === 0) return false
  const set = new Set(ids)
  return artboard.furniture.some((f) => set.has(f.id) && !!f.groupId)
}

/** Remove `groupId` from any group that has only 1 remaining member. Mutates items in place. */
export function cleanupSingleMemberGroups(furniture: FurnitureItem[]): void {
  const counts = new Map<string, number>()
  for (const f of furniture) {
    if (f.groupId) counts.set(f.groupId, (counts.get(f.groupId) ?? 0) + 1)
  }
  for (const f of furniture) {
    if (f.groupId && (counts.get(f.groupId) ?? 0) <= 1) {
      delete f.groupId
    }
  }
}

/**
 * Group 2+ items in `artboard.furniture` under `newGroupId` (mutates `artboard.furniture`).
 * Moves selected items to be contiguous at the topmost selected item's index, keeping their
 * relative order, and cleans up any 1-member orphan groups. Returns false if < 2 valid items.
 */
export function groupFurnitureInArtboard(
  artboard: Pick<Artboard, 'furniture'>,
  furnitureIds: readonly string[],
  newGroupId: string,
): boolean {
  const wanted = new Set(furnitureIds)
  let topIndex = -1
  let matchCount = 0
  artboard.furniture.forEach((f, idx) => {
    if (wanted.has(f.id)) {
      matchCount += 1
      topIndex = idx
    }
  })
  if (matchCount < 2) return false

  const selected: FurnitureItem[] = []
  const before: FurnitureItem[] = []
  const after: FurnitureItem[] = []
  artboard.furniture.forEach((f, idx) => {
    if (wanted.has(f.id)) {
      f.groupId = newGroupId
      selected.push(f)
    } else if (idx <= topIndex) {
      before.push(f)
    } else {
      after.push(f)
    }
  })
  artboard.furniture = [...before, ...selected, ...after]
  cleanupSingleMemberGroups(artboard.furniture)
  return true
}

/**
 * Ungroup every group touched by `furnitureIds` (mutates `artboard.furniture`).
 * Removes `groupId` from every member of every touched group and cleans up any 1-member groups.
 * Returns the ids of all items whose group was removed (empty if none was grouped).
 */
export function ungroupFurnitureInArtboard(
  artboard: Pick<Artboard, 'furniture'>,
  furnitureIds: readonly string[],
): string[] {
  const wanted = new Set(furnitureIds)
  const touchedGroups = new Set<string>()
  for (const f of artboard.furniture) {
    if (wanted.has(f.id) && f.groupId) touchedGroups.add(f.groupId)
  }
  if (touchedGroups.size === 0) return []
  const ungroupedIds: string[] = []
  for (const f of artboard.furniture) {
    if (f.groupId && touchedGroups.has(f.groupId)) {
      delete f.groupId
      ungroupedIds.push(f.id)
    }
  }
  cleanupSingleMemberGroups(artboard.furniture)
  return ungroupedIds
}

/** Active furniture selection ids on `artboard`, or [] when another artboard/kind is selected. */
function activeSelectionIds(artboardId: string, selection: Selection): string[] {
  if (selection.kind === 'furniture' && selection.artboardId === artboardId) return [selection.furnitureId]
  if (selection.kind === 'furnitureMulti' && selection.artboardId === artboardId) return selection.furnitureIds
  return []
}

/**
 * Compute the next selected furniture ids when clicking `clickedItemId`.
 * - Shift+click adds or removes the whole group (or single ungrouped item).
 * - Plain click on a grouped item selects all members of its group, UNLESS a single member of the
 *   same group is already selected (entered via double-click), in which case it selects only the
 *   clicked member.
 * - Plain click on an item already in a `furnitureMulti` selection keeps that multi-selection.
 */
export function resolveFurnitureClick(
  artboard: Pick<Artboard, 'id' | 'furniture'>,
  currentSelection: Selection,
  clickedItemId: string,
  opts: { shiftKey: boolean },
): string[] {
  const clicked = artboard.furniture.find((f) => f.id === clickedItemId)
  if (!clicked) return []
  const activeIds = activeSelectionIds(artboard.id, currentSelection)

  if (opts.shiftKey) {
    const targetIds = clicked.groupId ? groupMemberIds(artboard, clicked.groupId) : [clicked.id]
    const allSelected = targetIds.every((id) => activeIds.includes(id))
    if (allSelected) {
      return activeIds.filter((id) => !targetIds.includes(id))
    }
    return [...new Set([...activeIds, ...targetIds])]
  }

  if (clicked.groupId) {
    if (currentSelection.kind === 'furniture' && currentSelection.artboardId === artboard.id) {
      const currentItem = artboard.furniture.find((f) => f.id === currentSelection.furnitureId)
      if (currentItem?.groupId === clicked.groupId) {
        return [clicked.id]
      }
    }
    return groupMemberIds(artboard, clicked.groupId)
  }

  if (currentSelection.kind === 'furnitureMulti' && currentSelection.artboardId === artboard.id && activeIds.includes(clicked.id)) {
    return activeIds
  }
  return [clicked.id]
}

/** Compute the next selected furniture ids on double-click (enters a group to select only that member). */
export function resolveFurnitureDoubleClick(
  artboard: Pick<Artboard, 'furniture'>,
  clickedItemId: string,
): string[] {
  return artboard.furniture.some((f) => f.id === clickedItemId) ? [clickedItemId] : []
}

/**
 * When a single grouped item is selected, Esc selects its whole group.
 * Returns null if Esc does not apply (no selection, multi-selection, or ungrouped item).
 */
export function resolveEscapeGroupSelection(
  artboard: Pick<Artboard, 'id' | 'furniture'> | undefined,
  currentSelection: Selection,
): string[] | null {
  if (!artboard || currentSelection.kind !== 'furniture' || currentSelection.artboardId !== artboard.id) return null
  const item = artboard.furniture.find((f) => f.id === currentSelection.furnitureId)
  if (!item?.groupId) return null
  const members = groupMemberIds(artboard, item.groupId)
  return members.length >= 2 ? members : null
}
