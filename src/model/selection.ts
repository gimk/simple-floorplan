// Multi-selection (Shift + click). `selection` stays the primary item (the last one clicked):
// panels and single-item code read it as before. `multi` holds every selected item, the
// primary included, when more than one is selected. All items have the same kind.
import type { Selection } from './types'

export type SelItem = NonNullable<Selection>
/** Kinds that Shift + click can add to a group. */
export type MultiItem = Extract<SelItem, { kind: 'room' | 'wall' | 'vertex' }>
export type SelState = { selection: Selection; multi: SelItem[] }

export const isMultiKind = (s: SelItem): s is MultiItem => s.kind === 'room' || s.kind === 'wall' || s.kind === 'vertex'

/** Stable key of one item. */
export function selKey(s: SelItem): string {
  switch (s.kind) {
    case 'room': return `room:${s.roomId}`
    case 'wall': return `wall:${s.roomId}:${s.wallStart}`
    case 'vertex': return `vertex:${s.roomId}:${s.vertexId}`
    case 'element': return `element:${s.elementId}`
  }
}

export const sameSel = (a: Selection, b: Selection): boolean => !!a && !!b && selKey(a) === selKey(b)

/**
 * Every selected item. `multi` counts only while it holds the primary item, so code that
 * sets `selection` alone (and leaves an old `multi`) still gives a single selection.
 */
export function selectedItems(s: SelState): SelItem[] {
  if (!s.selection) return []
  if (s.multi.length > 1 && s.multi.some((m) => sameSel(m, s.selection))) return s.multi
  return [s.selection]
}

/**
 * Shift + click on `item`: add it, or remove it when it is already selected.
 * A different kind (or an element) starts a new selection with this item only.
 */
export function toggleItem(s: SelState, item: SelItem): SelState {
  const cur = selectedItems(s)
  if (!isMultiKind(item) || !cur.length || cur[0].kind !== item.kind) return { selection: item, multi: [] }
  if (cur.some((c) => sameSel(c, item))) {
    const next = cur.filter((c) => !sameSel(c, item))
    return { selection: next[next.length - 1] ?? null, multi: next.length > 1 ? next : [] }
  }
  const next = [...cur, item]
  return { selection: item, multi: next }
}

/** Is `item` part of a group of two or more? */
export const inGroup = (s: SelState, item: SelItem): boolean => {
  const cur = selectedItems(s)
  return cur.length > 1 && cur.some((c) => sameSel(c, item))
}

/**
 * Select a set of items (box selection). With `add` (Shift), they join the current selection
 * when it has the same kind; otherwise they replace it.
 */
export function selectItems(s: SelState, found: MultiItem[], add: boolean): SelState {
  if (!found.length) return add ? s : { selection: null, multi: [] }
  const cur = add ? selectedItems(s) : []
  const base = cur.length && cur[0].kind === found[0].kind ? cur : []
  const next = [...base, ...found.filter((f) => !base.some((c) => sameSel(c, f)))]
  return { selection: next[next.length - 1], multi: next.length > 1 ? next : [] }
}
