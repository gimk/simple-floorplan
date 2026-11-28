// Pure size editing of a MULTI-selection of furniture items, used by the right-panel Inspect card for
// several items (FurnitureMultiInspect.tsx). The single item card (FurnitureInspect.tsx) owns the
// per-item rules and this module repeats them exactly: a width or a depth is clamped to
// [MIN_FURNITURE_CM, MAX_FURNITURE_CM], a height is positive (or absent = the default height), and a
// circle item stays round (widthCm === depthCm). A "mixed" field shows nothing, so the card can ask
// for one value that then lands on every selected item. Units: cm.
import { furnitureHeightCm } from '../../model/defaults'
import type { FurnitureItem } from '../../model/types'
import { MAX_FURNITURE_CM, MIN_FURNITURE_CM } from './geometry'

/** The 3 size fields the multi card edits. */
export type SizeField = 'width' | 'depth' | 'height'

/** The size part of one item. A null patch means "this item already holds the wanted value". */
export type SizePatch = Partial<Pick<FurnitureItem, 'widthCm' | 'depthCm' | 'heightCm'>>

/** True when every item is a circle, so the card shows one Diameter field instead of Width + Depth. */
export function allCircles(items: readonly Pick<FurnitureItem, 'shape'>[]): boolean {
  return items.length > 0 && items.every((f) => f.shape === 'circle')
}

/** Size of one item in one field, cm: its width, its depth, or its effective height (default 80). */
export function sizeOf(item: FurnitureItem, field: SizeField): number {
  if (field === 'width') return item.widthCm
  if (field === 'depth') return item.depthCm
  return furnitureHeightCm(item)
}

/**
 * Value shared by every item of one field, or null when the items differ (the field then shows a
 * "Mixed" placeholder). null for an empty selection. A height with no `heightCm` counts with its
 * default, so an item that never set a height and one set to that same default are not "mixed".
 */
export function commonSizeCm(items: readonly FurnitureItem[], field: SizeField): number | null {
  if (items.length === 0) return null
  const first = sizeOf(items[0], field)
  return items.every((f) => sizeOf(f, field) === first) ? first : null
}

/** A width or a depth ready to store: clamped to the size limits of the model. */
export const clampSizeCm = (value: number): number =>
  Math.min(MAX_FURNITURE_CM, Math.max(MIN_FURNITURE_CM, value))

/**
 * True when a value from the field can be written: a width and a depth always need a number, a
 * height is positive, and an empty height means "back to the default height".
 */
export function isSizeValueValid(field: SizeField, value: number | null): boolean {
  if (value === null) return field === 'height'
  if (!Number.isFinite(value)) return false
  return field === 'height' ? value > 0 : true
}

/**
 * Patch of one item for a size edit, or null when the item already holds the wanted value (so an
 * unchanged selection records no undo step). A circle keeps widthCm === depthCm, because the shape
 * is drawn from both: a new width also sets its depth, and a new depth also sets its width.
 */
export function sizePatch(item: FurnitureItem, field: SizeField, value: number | null): SizePatch | null {
  if (!isSizeValueValid(field, value)) return null

  if (field === 'height') {
    if (value === null) return item.heightCm === undefined ? null : { heightCm: undefined }
    return furnitureHeightCm(item) === value ? null : { heightCm: value }
  }

  const next = clampSizeCm(value as number)
  const own = field === 'width' ? item.widthCm : item.depthCm
  const other = field === 'width' ? item.depthCm : item.widthCm
  const patch: SizePatch = {}
  if (own !== next) patch[field === 'width' ? 'widthCm' : 'depthCm'] = next
  // An oval circle becomes round again; a rect keeps its other side.
  if (item.shape === 'circle' && other !== next) patch[field === 'width' ? 'depthCm' : 'widthCm'] = next
  return Object.keys(patch).length === 0 ? null : patch
}

/**
 * Patch per item id for one size edit, in the order of `items`. Items with nothing to change are
 * left out, so an empty map means "no-op". Applied in one store write, the entries form one undo
 * step for the whole selection.
 */
export function sizePatches(
  items: readonly FurnitureItem[],
  field: SizeField,
  value: number | null,
): Map<string, SizePatch> {
  const patches = new Map<string, SizePatch>()
  for (const f of items) {
    const patch = sizePatch(f, field, value)
    if (patch) patches.set(f.id, patch)
  }
  return patches
}
