// Pure mixed multi-selection helpers. No store and no React, so the unit tests run in node.
import type { MultiTarget, Selection } from '../../model/types'

/**
 * True when two targets point at the same object. Walls are equal only when both the room id and
 * the edge index are equal (two edges of one room are different walls).
 */
export function sameTarget(a: MultiTarget, b: MultiTarget): boolean {
  switch (a.kind) {
    case 'room':
      return b.kind === 'room' && a.roomId === b.roomId
    case 'wall':
      return b.kind === 'wall' && a.roomId === b.roomId && a.edgeIndex === b.edgeIndex
    case 'opening':
      return b.kind === 'opening' && a.openingId === b.openingId
    case 'furniture':
      return b.kind === 'furniture' && a.furnitureId === b.furnitureId
  }
}

/**
 * Targets held by a selection, in selection order. Returns [] when the selection is on another
 * artboard, and for the 'none', 'artboard', 'vertex' and 'refImage' kinds (they have no multi form).
 */
export function selectionToTargets(sel: Selection, artboardId: string): MultiTarget[] {
  switch (sel.kind) {
    case 'none':
    case 'artboard':
    case 'vertex':
    case 'refImage':
      return []
    case 'room':
      return sel.artboardId === artboardId ? sel.roomIds.map((roomId): MultiTarget => ({ kind: 'room', roomId })) : []
    case 'wall':
      return sel.artboardId === artboardId
        ? [{ kind: 'wall', roomId: sel.roomId, edgeIndex: sel.edgeIndex }]
        : []
    case 'opening':
      return sel.artboardId === artboardId ? [{ kind: 'opening', openingId: sel.openingId }] : []
    case 'furniture':
      return sel.artboardId === artboardId ? [{ kind: 'furniture', furnitureId: sel.furnitureId }] : []
    case 'furnitureMulti':
      return sel.artboardId === artboardId
        ? sel.furnitureIds.map((furnitureId): MultiTarget => ({ kind: 'furniture', furnitureId }))
        : []
    case 'multi':
      return sel.artboardId === artboardId ? sel.items.map((t) => ({ ...t })) : []
  }
}

/**
 * Selection for a set of targets of one artboard. Duplicates (see sameTarget) are dropped first.
 * 0 targets give 'none'; 1 target gives its native single kind; 2 or more furniture items give
 * 'furnitureMulti'; 2 or more rooms give 'room'; any other mix gives 'multi' in item order.
 */
export function normalizeSelection(artboardId: string, items: MultiTarget[]): Selection {
  const unique: MultiTarget[] = []
  for (const item of items) if (!unique.some((u) => sameTarget(u, item))) unique.push({ ...item })

  if (unique.length === 0) return { kind: 'none' }
  if (unique.length === 1) {
    const [only] = unique
    switch (only.kind) {
      case 'room':
        return { kind: 'room', artboardId, roomIds: [only.roomId] }
      case 'wall':
        return { kind: 'wall', artboardId, roomId: only.roomId, edgeIndex: only.edgeIndex }
      case 'opening':
        return { kind: 'opening', artboardId, openingId: only.openingId }
      case 'furniture':
        return { kind: 'furniture', artboardId, furnitureId: only.furnitureId }
    }
  }
  if (unique.every((t) => t.kind === 'furniture')) {
    const furnitureIds = unique.filter((t) => t.kind === 'furniture').map((t) => t.furnitureId)
    return { kind: 'furnitureMulti', artboardId, furnitureIds }
  }
  if (unique.every((t) => t.kind === 'room')) {
    const roomIds = unique.filter((t) => t.kind === 'room').map((t) => t.roomId)
    return { kind: 'room', artboardId, roomIds }
  }
  return { kind: 'multi', artboardId, items: unique }
}

/**
 * Adds the target when it is absent, removes it when present. A selection that lives on another
 * artboard starts fresh, so the result never mixes artboards.
 */
export function toggleMultiTarget(sel: Selection, artboardId: string, target: MultiTarget): Selection {
  const items = selectionToTargets(sel, artboardId)
  const at = items.findIndex((t) => sameTarget(t, target))
  if (at >= 0) items.splice(at, 1)
  else items.push({ ...target })
  return normalizeSelection(artboardId, items)
}

/** Keys ('roomId:edgeIndex') of the selected walls of this artboard. */
export function selectedWallKeys(sel: Selection, artboardId: string): Set<string> {
  const keys = new Set<string>()
  for (const t of selectionToTargets(sel, artboardId)) {
    if (t.kind === 'wall') keys.add(t.roomId + ':' + t.edgeIndex)
  }
  return keys
}

/** Ids of the selected openings of this artboard. */
export function selectedOpeningIds(sel: Selection, artboardId: string): Set<string> {
  const ids = new Set<string>()
  for (const t of selectionToTargets(sel, artboardId)) {
    if (t.kind === 'opening') ids.add(t.openingId)
  }
  return ids
}

/** Ids of the selected rooms of this artboard. */
export function selectedRoomIds(sel: Selection, artboardId: string): Set<string> {
  const ids = new Set<string>()
  for (const t of selectionToTargets(sel, artboardId)) {
    if (t.kind === 'room') ids.add(t.roomId)
  }
  return ids
}

/** Ids of the selected furniture items of this artboard. */
export function selectedFurnitureIds(sel: Selection, artboardId: string): Set<string> {
  const ids = new Set<string>()
  for (const t of selectionToTargets(sel, artboardId)) {
    if (t.kind === 'furniture') ids.add(t.furnitureId)
  }
  return ids
}
