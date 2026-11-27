// Align and distribute of a furniture multi-selection (Alt+A / D / W / S / H / V, Ctrl+Alt+H / V).
// The selection is cut into blocks first: one block per group (all its members) and one block per
// ungrouped item. A block moves as one unit, so a group keeps its internal layout. The bounds of a
// block are the union of its members' axis-aligned boxes. Distribute keeps the two outermost blocks
// still and gives equal gaps in between. Units: cm, y points down. No React, no store in the pure part.
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
/** An item that can be moved: its box plus its id (and its group, when it has one). */
export type MovableBox = Box & { id: string; groupId?: string }
/** New centre of one item. */
export type ItemMove = { xCm: number; yCm: number }

/**
 * One unit of an align or distribute: a whole group (all its selected members) or one ungrouped
 * item. `bounds` is the union of the members' axis-aligned boxes.
 */
export type SelectionBlock = { members: MovableBox[]; bounds: ItemBounds }

/** Round to 1 mm, to keep float noise out of the document. */
const r3 = (v: number): number => Math.round(v * 1000) / 1000

/** Axis-aligned bounds of a list of items, or null when it is empty. */
export function selectionBounds(items: readonly Box[]): ItemBounds | null {
  return groupBounds(items)
}

/**
 * Cut `items` into blocks: every `groupId` present in the list gives one block with all of its
 * members, and every ungrouped item gives its own block. Block order follows the first member seen,
 * so the result is stable. A block whose members somehow have no box is dropped.
 */
export function selectionBlocks(items: readonly MovableBox[]): SelectionBlock[] {
  const blocks: SelectionBlock[] = []
  const doneGroups = new Set<string>()
  for (const item of items) {
    const gid = item.groupId
    if (!gid) {
      blocks.push({ members: [item], bounds: furnitureAxisBounds(item) })
      continue
    }
    if (doneGroups.has(gid)) continue
    doneGroups.add(gid)
    const members = items.filter((m) => m.groupId === gid)
    const bounds = groupBounds(members)
    if (bounds) blocks.push({ members, bounds })
  }
  return blocks
}

/** Move every member of `block` by the same delta, so the block keeps its internal layout. */
function moveBlock(block: SelectionBlock, dx: number, dy: number, moves: Map<string, ItemMove>): void {
  if (dx === 0 && dy === 0) return
  for (const member of block.members) {
    moves.set(member.id, {
      xCm: dx === 0 ? member.xCm : r3(member.xCm + dx),
      yCm: dy === 0 ? member.yCm : r3(member.yCm + dy),
    })
  }
}

/** Delta that brings `b` onto the `op` side (or centre line) of `bounds`. */
function alignDelta(b: ItemBounds, bounds: ItemBounds, op: AlignOp): { dx: number; dy: number } {
  const centerX = (bounds.minX + bounds.maxX) / 2
  const centerY = (bounds.minY + bounds.maxY) / 2
  switch (op) {
    case 'left': return { dx: bounds.minX - b.minX, dy: 0 }
    case 'right': return { dx: bounds.maxX - b.maxX, dy: 0 }
    case 'center-h': return { dx: centerX - (b.minX + b.maxX) / 2, dy: 0 }
    case 'top': return { dx: 0, dy: bounds.minY - b.minY }
    case 'bottom': return { dx: 0, dy: bounds.maxY - b.maxY }
    case 'center-v': return { dx: 0, dy: centerY - (b.minY + b.maxY) / 2 }
  }
}

/**
 * New centres for an alignment of whole blocks inside `bounds`. Every member of a block moves by
 * the block's delta, so a group keeps its internal layout. Blocks already on the edge are left out
 * of the map, so an alignment that changes nothing writes nothing.
 */
export function alignBlockMoves(
  blocks: readonly SelectionBlock[],
  bounds: ItemBounds,
  op: AlignOp,
): Map<string, ItemMove> {
  const moves = new Map<string, ItemMove>()
  for (const block of blocks) {
    const { dx, dy } = alignDelta(block.bounds, bounds, op)
    moveBlock(block, dx, dy, moves)
  }
  return moves
}

/**
 * New centres for an alignment of single items inside `bounds`. Items that already sit on the edge
 * are left out of the map, so an alignment that changes nothing writes nothing. Used for one block
 * alone (a whole group, or a plain multi-selection of ungrouped items).
 */
export function alignMoves(items: readonly MovableBox[], bounds: ItemBounds, op: AlignOp): Map<string, ItemMove> {
  const moves = new Map<string, ItemMove>()
  for (const item of items) {
    const { dx, dy } = alignDelta(furnitureAxisBounds(item), bounds, op)
    if (dx === 0 && dy === 0) continue
    moves.set(item.id, { xCm: r3(item.xCm + dx), yCm: r3(item.yCm + dy) })
  }
  return moves
}

/**
 * New centres that leave equal gaps between whole blocks along `axis`. The block nearest the start
 * and the one nearest the end stay where they are. Every member of a moved block gets the same
 * delta. Returns an empty map when there are fewer than 3 blocks (nothing to distribute between).
 */
export function distributeBlockMoves(blocks: readonly SelectionBlock[], axis: DistributeAxis): Map<string, ItemMove> {
  const moves = new Map<string, ItemMove>()
  if (blocks.length < 3) return moves
  const horizontal = axis === 'horizontal'
  const sorted = [...blocks].sort((p, q) =>
    horizontal ? p.bounds.minX - q.bounds.minX : p.bounds.minY - q.bounds.minY,
  )
  const first = sorted[0].bounds
  const last = sorted[sorted.length - 1].bounds
  const span = horizontal ? last.maxX - first.minX : last.maxY - first.minY
  const used = sorted.reduce((sum, { bounds }) => sum + (horizontal ? bounds.maxX - bounds.minX : bounds.maxY - bounds.minY), 0)
  const gap = (span - used) / (sorted.length - 1)
  let cursor = horizontal ? first.maxX + gap : first.maxY + gap
  for (let i = 1; i < sorted.length - 1; i++) {
    const { bounds } = sorted[i]
    if (horizontal) {
      const dx = cursor - bounds.minX
      moveBlock(sorted[i], dx, 0, moves)
      cursor += (bounds.maxX - bounds.minX) + gap
    } else {
      const dy = cursor - bounds.minY
      moveBlock(sorted[i], 0, dy, moves)
      cursor += (bounds.maxY - bounds.minY) + gap
    }
  }
  return moves
}

/**
 * New centres that leave equal gaps between single items along `axis`. Kept for an item-by-item
 * distribution (no blocks). Returns an empty map with fewer than 3 items.
 */
export function distributeMoves(items: readonly MovableBox[], axis: DistributeAxis): Map<string, ItemMove> {
  return distributeBlockMoves(
    items.map((item) => ({ members: [item], bounds: furnitureAxisBounds(item) })),
    axis,
  )
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

/**
 * Alt+A / D / W / S / H / V: align the selection inside its own bounds. A group mixed with other
 * items moves as one block; a selection that is exactly one block (one whole group, or ungrouped
 * items only) is aligned item by item, like before.
 */
export function alignSelection(op: AlignOp): boolean {
  const target = targetItems()
  if (!target || target.items.length < 2) return false
  const bounds = selectionBounds(target.items)
  if (!bounds) return false
  const blocks = selectionBlocks(target.items)
  const moves = blocks.length >= 2 ? alignBlockMoves(blocks, bounds, op) : alignMoves(target.items, bounds, op)
  if (moves.size === 0) return false
  applyMoves(target.artboardId, moves)
  return true
}

/** Ctrl+Alt+H / V: give the selected items equal gaps. Needs 3 or more blocks. */
export function distributeSelection(axis: DistributeAxis): boolean {
  const target = targetItems()
  if (!target || target.items.length < 3) return false
  const moves = distributeBlockMoves(selectionBlocks(target.items), axis)
  if (moves.size === 0) return false
  applyMoves(target.artboardId, moves)
  return true
}
