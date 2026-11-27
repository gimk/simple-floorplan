// Align and distribute of a furniture multi-selection (Alt+A / D / W / S / H / V, Ctrl+Alt+H / V).
// Alignment uses the bounds of the selection; each selected item moves on its own (its axis-aligned
// box is what lands on the edge), which is also what keeps a whole group in place relative to its
// own items. Distribute keeps the two outermost items still and gives equal gaps in between.
// Units: cm, y points down. No React, no store in the pure part.
import { useDoc } from '../../model/store'
import type { FurnitureItem } from '../../model/types'
import { useUi } from '../../shell/uiStore'
import { furnitureAxisBounds } from './geometry'
import type { ItemBounds } from './geometry'
import { groupBounds } from './groupTransform'
import { expandToGroups } from './groups'
import { selectionArtboardId } from './selectionActions'

/** Alignment ops, named after the side of the selection they line the items up with. */
export type AlignOp = 'left' | 'right' | 'top' | 'bottom' | 'center-h' | 'center-v'

/** Axis of a distribution: equal horizontal gaps or equal vertical gaps. */
export type DistributeAxis = 'horizontal' | 'vertical'

type Box = Pick<FurnitureItem, 'xCm' | 'yCm' | 'widthCm' | 'depthCm' | 'rotationDeg' | 'shape'>
/** New centre of one item. */
export type ItemMove = { xCm: number; yCm: number }

/** Round to 1 mm, to keep float noise out of the document. */
const r3 = (v: number): number => Math.round(v * 1000) / 1000

/** Axis-aligned bounds of a list of items, or null when it is empty. */
export function selectionBounds(items: readonly Box[]): ItemBounds | null {
  return groupBounds(items)
}

/**
 * New centres for an alignment inside `bounds`. Items that already sit on the edge are left out of
 * the map, so an alignment that changes nothing writes nothing.
 */
export function alignMoves(items: readonly (Box & { id: string })[], bounds: ItemBounds, op: AlignOp): Map<string, ItemMove> {
  const moves = new Map<string, ItemMove>()
  const centerX = (bounds.minX + bounds.maxX) / 2
  const centerY = (bounds.minY + bounds.maxY) / 2
  for (const item of items) {
    const b = furnitureAxisBounds(item)
    let dx = 0
    let dy = 0
    switch (op) {
      case 'left': dx = bounds.minX - b.minX; break
      case 'right': dx = bounds.maxX - b.maxX; break
      case 'center-h': dx = centerX - (b.minX + b.maxX) / 2; break
      case 'top': dy = bounds.minY - b.minY; break
      case 'bottom': dy = bounds.maxY - b.maxY; break
      case 'center-v': dy = centerY - (b.minY + b.maxY) / 2; break
    }
    if (dx === 0 && dy === 0) continue
    moves.set(item.id, { xCm: r3(item.xCm + dx), yCm: r3(item.yCm + dy) })
  }
  return moves
}

/**
 * New centres that leave equal gaps between the items along `axis`. The item nearest the start and
 * the one nearest the end stay where they are. Returns an empty map when there are fewer than 3
 * items (nothing to distribute between).
 */
export function distributeMoves(items: readonly (Box & { id: string })[], axis: DistributeAxis): Map<string, ItemMove> {
  const moves = new Map<string, ItemMove>()
  if (items.length < 3) return moves
  const horizontal = axis === 'horizontal'
  const boxes = items.map((item) => ({ item, b: furnitureAxisBounds(item) }))
  boxes.sort((p, q) => (horizontal ? p.b.minX - q.b.minX : p.b.minY - q.b.minY))
  const first = boxes[0]
  const last = boxes[boxes.length - 1]
  const span = horizontal ? last.b.maxX - first.b.minX : last.b.maxY - first.b.minY
  const used = boxes.reduce((sum, { b }) => sum + (horizontal ? b.maxX - b.minX : b.maxY - b.minY), 0)
  const gap = (span - used) / (boxes.length - 1)
  let cursor = horizontal ? first.b.maxX + gap : first.b.maxY + gap
  for (let i = 1; i < boxes.length - 1; i++) {
    const { item, b } = boxes[i]
    if (horizontal) {
      const dx = cursor - b.minX
      if (dx !== 0) moves.set(item.id, { xCm: r3(item.xCm + dx), yCm: item.yCm })
      cursor += (b.maxX - b.minX) + gap
    } else {
      const dy = cursor - b.minY
      if (dy !== 0) moves.set(item.id, { xCm: item.xCm, yCm: r3(item.yCm + dy) })
      cursor += (b.maxY - b.minY) + gap
    }
  }
  return moves
}

/** Ids of the current furniture selection grown to whole groups, with the artboard that holds them. */
function targetItems(): { artboardId: string; ids: string[]; items: FurnitureItem[] } | null {
  const sel = useUi.getState().selection
  const artboardId = selectionArtboardId(sel)
  if (!artboardId) return null
  const artboard = useDoc.getState().doc.artboards.find((a) => a.id === artboardId)
  if (!artboard) return null
  const raw = sel.kind === 'furniture' ? [sel.furnitureId] : sel.kind === 'furnitureMulti' ? sel.furnitureIds : []
  const ids = expandToGroups(artboard, raw)
  const wanted = new Set(ids)
  const items = artboard.furniture.filter((f) => wanted.has(f.id))
  return items.length === 0 ? null : { artboardId, ids, items }
}

/** Write `moves` in one update: one undo step. */
function applyMoves(artboardId: string, moves: Map<string, ItemMove>): void {
  if (moves.size === 0) return
  useDoc.getState().update((d) => {
    const ab = d.artboards.find((a) => a.id === artboardId)
    if (!ab) return
    for (const f of ab.furniture) {
      const m = moves.get(f.id)
      if (!m) continue
      f.xCm = m.xCm
      f.yCm = m.yCm
    }
  })
}

/** Alt+A / D / W / S / H / V: align the selected items inside the selection bounds. */
export function alignSelection(op: AlignOp): boolean {
  const target = targetItems()
  if (!target || target.items.length < 2) return false
  const bounds = selectionBounds(target.items)
  if (!bounds) return false
  const moves = alignMoves(target.items, bounds, op)
  if (moves.size === 0) return false
  applyMoves(target.artboardId, moves)
  return true
}

/** Ctrl+Alt+H / V: give the selected items equal gaps. Needs 3 or more items. */
export function distributeSelection(axis: DistributeAxis): boolean {
  const target = targetItems()
  if (!target || target.items.length < 3) return false
  const moves = distributeMoves(target.items, axis)
  if (moves.size === 0) return false
  applyMoves(target.artboardId, moves)
  return true
}
