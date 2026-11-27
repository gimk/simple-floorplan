// Flip (Shift+H horizontal, Shift+V vertical). One item: the flipX / flipY flag of the item toggles,
// nothing else changes. Two or more items: their centres mirror across the centre of the selection
// bounds and each rotation follows the mirror (see `flippedAngle`). One undo step either way.
// Units: cm and degrees. Pure math first, then the store action App.tsx calls.
import { useDoc } from '../../model/store'
import type { Artboard, FurnitureItem, Selection } from '../../model/types'
import { useUi } from '../../shell/uiStore'
import { normalizeAngle } from './geometry'
import { groupBounds } from './groupTransform'
import { expandToGroups } from './groups'
import { selectionArtboardId } from './selectionActions'

/** Axis of a flip: 'x' mirrors left/right, 'y' mirrors up/down. */
export type FlipAxis = 'x' | 'y'

/**
 * Rotation of an item after a mirror: 360 - deg for a horizontal flip, 180 - deg for a vertical one,
 * normalized to [0, 360) and rounded to 0.1 degree. A horizontal mirror of a box drawn at `deg` is the
 * same box drawn at `-deg`; a vertical one keeps the box across the horizontal axis, so 180 - deg.
 */
export function flippedAngle(deg: number, axis: FlipAxis): number {
  const r = Math.round(normalizeAngle(axis === 'x' ? 360 - deg : 180 - deg) * 10) / 10
  return r === 360 ? 0 : r
}

/** Patch of one item: the toggled flag, plus (multi-selection only) the mirrored centre and rotation. */
export type FlipPatch = { flipX?: boolean; flipY?: boolean; xCm?: number; yCm?: number; rotationDeg?: number }

/** Round to 1 mm. */
const r3 = (v: number): number => Math.round(v * 1000) / 1000

/**
 * Patch of every item of a flip. One item: only its flag toggles. Two items or more: the flags of all
 * items toggle and their centres mirror across the centre of `bounds`.
 */
export function flipPatches(
  items: readonly FurnitureItem[],
  bounds: { minX: number; minY: number; maxX: number; maxY: number } | null,
  axis: FlipAxis,
): Map<string, FlipPatch> {
  const patches = new Map<string, FlipPatch>()
  if (items.length === 0) return patches
  if (items.length === 1 || !bounds) {
    for (const f of items) patches.set(f.id, axis === 'x' ? { flipX: !f.flipX } : { flipY: !f.flipY })
    return patches
  }
  const cx = (bounds.minX + bounds.maxX) / 2
  const cy = (bounds.minY + bounds.maxY) / 2
  for (const f of items) {
    const patch: FlipPatch = {
      ...(axis === 'x' ? { flipX: !f.flipX } : { flipY: !f.flipY }),
      rotationDeg: flippedAngle(f.rotationDeg, axis),
    }
    if (axis === 'x') patch.xCm = r3(2 * cx - f.xCm)
    else patch.yCm = r3(2 * cy - f.yCm)
    patches.set(f.id, patch)
  }
  return patches
}

/** Apply `patches` to `artboard.furniture` (mutating draft). */
export function applyFlipPatches(artboard: Pick<Artboard, 'furniture'>, patches: Map<string, FlipPatch>): void {
  for (const f of artboard.furniture) {
    const p = patches.get(f.id)
    if (!p) continue
    if (p.xCm !== undefined) f.xCm = p.xCm
    if (p.yCm !== undefined) f.yCm = p.yCm
    if (p.rotationDeg !== undefined) f.rotationDeg = p.rotationDeg
    // The flag is stored only when true, so a flipped-then-unflipped item keeps a clean JSON.
    if (p.flipX !== undefined) {
      if (p.flipX) f.flipX = true
      else delete f.flipX
    }
    if (p.flipY !== undefined) {
      if (p.flipY) f.flipY = true
      else delete f.flipY
    }
  }
}

/** Ids of the current furniture selection grown to whole groups. */
function flipTargets(): { artboardId: string; items: FurnitureItem[] } | null {
  const sel: Selection = useUi.getState().selection
  const artboardId = selectionArtboardId(sel)
  if (!artboardId) return null
  const artboard = useDoc.getState().doc.artboards.find((a) => a.id === artboardId)
  if (!artboard) return null
  const raw = sel.kind === 'furniture' ? [sel.furnitureId] : sel.kind === 'furnitureMulti' ? sel.furnitureIds : []
  const ids = new Set(expandToGroups(artboard, raw))
  const items = artboard.furniture.filter((f) => ids.has(f.id))
  return items.length === 0 ? null : { artboardId, items }
}

/** Shift+H / Shift+V: flip the selected furniture. Returns false when nothing can flip. */
export function flipSelection(axis: FlipAxis): boolean {
  const target = flipTargets()
  if (!target) return false
  const bounds = groupBounds(target.items)
  const patches = flipPatches(target.items, bounds, axis)
  if (patches.size === 0) return false
  useDoc.getState().update((d) => {
    const ab = d.artboards.find((a) => a.id === target.artboardId)
    if (!ab) return
    applyFlipPatches(ab, patches)
  })
  return true
}
