// Layer order of a furniture selection: Cmd/Ctrl+[ sends it to the back, Cmd/Ctrl+] brings it to
// the front (one undo step). The relative order of the moved items is kept, and the members of a
// group stay contiguous. Pure stack builder first, then the store actions App.tsx calls. Units: cm.
import { useDoc } from '../../model/store'
import type { FurnitureItem } from '../../model/types'
import { useUi } from '../../shell/uiStore'
import { setFurnitureSelection } from './actions'
import { expandToGroups } from './groups'
import { selectionArtboardId } from './selectionActions'

/** End of the stack to send the selection to. */
export type LayerEnd = 'front' | 'back'

/**
 * Groups of the selection, in the order their first member appears. One entry per *block*: items of
 * the same furniture group that are separated by other items are gathered, so the block stays
 * contiguous once moved.
 */
function selectedBlocks(furniture: readonly FurnitureItem[], ids: ReadonlySet<string>): FurnitureItem[][] {
  const blocks: FurnitureItem[][] = []
  const blockOfGroup = new Map<string, FurnitureItem[]>()
  for (const f of furniture) {
    if (!ids.has(f.id)) continue
    if (!f.groupId) {
      blocks.push([f])
      continue
    }
    const known = blockOfGroup.get(f.groupId)
    if (known) known.push(f)
    else {
      const block = [f]
      blockOfGroup.set(f.groupId, block)
      blocks.push(block)
    }
  }
  return blocks
}

/**
 * New furniture stack with `ids` moved to the back (before every other item) or to the front
 * (after every other item). `null` when nothing would change (unknown ids, or already at that end).
 */
export function stackWithSelectionAtEnd(
  furniture: readonly FurnitureItem[],
  ids: readonly string[],
  end: LayerEnd,
): FurnitureItem[] | null {
  const wanted = new Set(ids)
  const moved = selectedBlocks(furniture, wanted).flat()
  if (moved.length === 0) return null
  const rest = furniture.filter((f) => !wanted.has(f.id))
  const next = end === 'back' ? [...moved, ...rest] : [...rest, ...moved]
  const same = next.length === furniture.length && next.every((f, i) => f.id === furniture[i].id)
  return same ? null : next
}

/** Cmd/Ctrl+[ or Cmd/Ctrl+]: send the whole selected set (groups included) to an end of the stack. */
export function moveSelectionToEnd(end: LayerEnd): boolean {
  const ui = useUi.getState()
  const artboardId = selectionArtboardId(ui.selection)
  if (!artboardId) return false
  const artboard = useDoc.getState().doc.artboards.find((a) => a.id === artboardId)
  if (!artboard) return false
  const raw = ui.selection.kind === 'furniture' ? [ui.selection.furnitureId] : ui.selection.kind === 'furnitureMulti' ? ui.selection.furnitureIds : []
  const ids = expandToGroups(artboard, raw)
  const next = stackWithSelectionAtEnd(artboard.furniture, ids, end)
  if (!next) return false
  useDoc.getState().update((d) => {
    const ab = d.artboards.find((a) => a.id === artboardId)
    if (!ab) return
    const byId = new Map(ab.furniture.map((f) => [f.id, f]))
    ab.furniture = next.map((f) => byId.get(f.id)).filter((f): f is FurnitureItem => !!f)
  })
  setFurnitureSelection(artboardId, ids)
  return true
}
