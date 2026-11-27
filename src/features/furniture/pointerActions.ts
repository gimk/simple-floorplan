// Store helpers for Figma-style pointer interactions (direct single-item selection without group
// expansion, and group resize supporting Option/Alt from-center). Kept separate from actions.ts.
import type { Vec } from '../../model/geometry'
import { useDoc } from '../../model/store'
import type { ProjectDoc } from '../../model/types'
import { useUi } from '../../shell/uiStore'
import type { ItemBounds, ResizeHandle } from './geometry'
import { resizeGroupFromHandle } from './groupTransform'
import type { FurnitureTransformStart } from './groupTransform'

/**
 * Set furniture selection to the exact `ids` (deduplicated, preserving order) WITHOUT expanding
 * grouped items to their whole group. Used by Cmd/Ctrl+Shift+click.
 */
export function setDirectFurnitureSelection(artboardId: string, ids: string[]): void {
  const unique = [...new Set(ids)]
  if (unique.length === 0) {
    useUi.getState().set({ activeArtboardId: artboardId, selection: { kind: 'none' } })
    return
  }
  if (unique.length === 1) {
    useUi.getState().set({
      activeArtboardId: artboardId,
      selection: { kind: 'furniture', artboardId, furnitureId: unique[0] },
    })
    return
  }
  useUi.getState().set({
    activeArtboardId: artboardId,
    selection: { kind: 'furnitureMulti', artboardId, furnitureIds: unique },
  })
}

/**
 * Resize a group of items from their start state when a group handle is dragged to `p`,
 * supporting `opts.alt` (resize from center).
 */
export function resizeFurnitureGroupWithAlt(
  artboardId: string,
  starts: ReadonlyMap<string, FurnitureTransformStart>,
  startBounds: ItemBounds,
  handle: ResizeHandle,
  p: Vec,
  opts: { shift: boolean; alt?: boolean; precisionCm?: number },
  silent = true,
): void {
  if (starts.size === 0) return
  const artboard = useDoc.getState().doc.artboards.find((a) => a.id === artboardId)
  if (!artboard || !artboard.furniture.some((f) => starts.has(f.id))) return
  const next = resizeGroupFromHandle(starts, startBounds, handle, p, opts)
  const apply = (d: ProjectDoc) => {
    const ab = d.artboards.find((a) => a.id === artboardId)
    if (!ab) return
    for (const f of ab.furniture) {
      const r = next.get(f.id)
      if (!r) continue
      f.xCm = r.xCm
      f.yCm = r.yCm
      f.widthCm = r.widthCm
      f.depthCm = r.depthCm
    }
  }
  if (silent) useDoc.getState().updateSilent(apply)
  else useDoc.getState().update(apply)
}
