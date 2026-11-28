// One style clipboard for furniture, openings (doors, windows, openings), walls and rooms
// (Option+Cmd+C / Option+Cmd+V on a Mac, Ctrl+Alt+C / V elsewhere; see App.tsx).
// The style is VISUAL ONLY: "only colour and material". A copy holds exactly these fields:
//   - furniture: color
//   - opening:   color (optional)
//   - wall:      color (optional, stored in room.wallColors[String(edgeIndex)])
//   - room:      fill, floorPattern, floorPatternAngleDeg (the floor colour and material)
// Nothing else travels: no variant, width, height, sill, hinge or swing of an opening; no wallKinds;
// no wallColors of a room; no showDirection, corner radii, size, rotation or height of furniture.
// A copy lives in a module-level variable, never in the document, so it is not an undo step and is
// not saved. One paste = one useDoc update = one undo step. Units: cm and degrees.
import { useDoc } from '../../model/store'
import type { Artboard, FloorPattern, MultiTarget, Selection } from '../../model/types'
import { useUi } from '../../shell/uiStore'
import { expandToGroups } from '../furniture/groups'
import { selectionArtboardId } from '../furniture/selectionActions'

/** One object that a copy or a paste can address: the shared multi-selection target. */
export type StyleTarget = MultiTarget

/** The whole copied style: one kind and its visual fields only. */
export type CopiedStyle =
  | { kind: 'furniture'; color: string }
  | { kind: 'opening'; color?: string }
  | { kind: 'wall'; color?: string }
  | { kind: 'room'; fill?: string; floorPattern?: FloorPattern; floorPatternAngleDeg?: number }

/** Furniture targets of `ids`, every member of their group included. */
function furnitureTargets(
  artboard: Pick<Artboard, 'furniture'> | undefined,
  ids: readonly string[],
): StyleTarget[] {
  return expandToGroups(artboard, ids).map((furnitureId) => ({ kind: 'furniture' as const, furnitureId }))
}

/** Drop duplicate targets (same kind and same ids), keeping the first. */
function uniqueTargets(targets: readonly StyleTarget[]): StyleTarget[] {
  const seen = new Set<string>()
  const out: StyleTarget[] = []
  for (const t of targets) {
    const key =
      t.kind === 'room'
        ? `room:${t.roomId}`
        : t.kind === 'wall'
          ? `wall:${t.roomId}:${t.edgeIndex}`
          : t.kind === 'opening'
            ? `opening:${t.openingId}`
            : `furniture:${t.furnitureId}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(t)
  }
  return out
}

/**
 * The targets `sel` addresses on `artboard`: 1 per selected object, furniture groups expanded.
 * Every other kind of selection ('none', 'artboard', 'vertex', 'refImage'...) gives none.
 */
export function targetsFromSelection(
  sel: Selection,
  artboard: Pick<Artboard, 'furniture'> | undefined,
): StyleTarget[] {
  switch (sel.kind) {
    case 'none':
    case 'artboard':
    case 'vertex':
    case 'refImage':
      return []
    case 'furniture':
      return furnitureTargets(artboard, [sel.furnitureId])
    case 'furnitureMulti':
      return furnitureTargets(artboard, sel.furnitureIds)
    case 'opening':
      return [{ kind: 'opening', openingId: sel.openingId }]
    case 'wall':
      return [{ kind: 'wall', roomId: sel.roomId, edgeIndex: sel.edgeIndex }]
    case 'room':
      return sel.roomIds.map((roomId) => ({ kind: 'room' as const, roomId }))
    case 'multi': {
      // Every item is already a target; furniture items bring their whole group along.
      const expanded: StyleTarget[] = []
      for (const item of sel.items) {
        if (item.kind === 'furniture') expanded.push(...furnitureTargets(artboard, [item.furnitureId]))
        else expanded.push({ ...item })
      }
      return uniqueTargets(expanded)
    }
  }
}

/**
 * The style of one target on `artboard`, or null when the object does not exist (also when a wall
 * edge index is out of range). Optional fields are omitted when the object has none.
 */
export function styleOfTarget(artboard: Artboard, target: StyleTarget): CopiedStyle | null {
  switch (target.kind) {
    case 'furniture': {
      const item = artboard.furniture.find((f) => f.id === target.furnitureId)
      return item ? { kind: 'furniture', color: item.color } : null
    }
    case 'opening': {
      const opening = artboard.openings.find((o) => o.id === target.openingId)
      if (!opening) return null
      const style: CopiedStyle = { kind: 'opening' }
      if (opening.color !== undefined) style.color = opening.color
      return style
    }
    case 'wall': {
      const room = artboard.rooms.find((r) => r.id === target.roomId)
      if (!room || target.edgeIndex < 0 || target.edgeIndex >= room.vertices.length) return null
      const style: CopiedStyle = { kind: 'wall' }
      const color = room.wallColors?.[String(target.edgeIndex)]
      if (color !== undefined) style.color = color
      return style
    }
    case 'room': {
      const room = artboard.rooms.find((r) => r.id === target.roomId)
      if (!room) return null
      const style: CopiedStyle = { kind: 'room' }
      if (room.fill !== undefined) style.fill = room.fill
      if (room.floorPattern !== undefined) style.floorPattern = room.floorPattern
      if (room.floorPatternAngleDeg !== undefined) style.floorPatternAngleDeg = room.floorPatternAngleDeg
      return style
    }
  }
}

/**
 * True when both styles hold the same fields with the same values. An omitted field equals an
 * undefined one, and an omitted floor pattern angle equals 0 degrees.
 */
export function sameCopiedStyle(a: CopiedStyle, b: CopiedStyle): boolean {
  if (a.kind === 'furniture') return b.kind === 'furniture' && a.color === b.color
  if (a.kind === 'opening') return b.kind === 'opening' && a.color === b.color
  if (a.kind === 'wall') return b.kind === 'wall' && a.color === b.color
  if (b.kind !== 'room') return false
  return (
    a.fill === b.fill &&
    a.floorPattern === b.floorPattern &&
    (a.floorPatternAngleDeg ?? 0) === (b.floorPatternAngleDeg ?? 0)
  )
}

/**
 * The targets `style` has to write: the ones of the same kind that exist and whose style differs.
 * Read-only: the same test decides a paste and counts the changes.
 */
function targetsNeedingStyle(
  artboard: Artboard,
  targets: readonly StyleTarget[],
  style: CopiedStyle,
): StyleTarget[] {
  return targets.filter((target) => {
    if (target.kind !== style.kind) return false
    const current = styleOfTarget(artboard, target)
    return current !== null && !sameCopiedStyle(current, style)
  })
}

/**
 * Write `style` to every target of the same kind whose style differs, inside a document draft.
 * Returns the number of targets written. An undefined field of the style DELETES that field on the
 * target (for a wall: the wallColors key, and the whole map when it becomes empty). Targets of
 * another kind, missing objects and out-of-range wall edges are skipped. No other field is touched.
 */
export function applyStyleToArtboard(
  artboard: Artboard,
  targets: readonly StyleTarget[],
  style: CopiedStyle,
): number {
  const misses = targetsNeedingStyle(artboard, targets, style)
  let written = 0
  switch (style.kind) {
    case 'furniture': {
      const ids = new Set(misses.filter((t) => t.kind === 'furniture').map((t) => t.furnitureId))
      for (const item of artboard.furniture) {
        if (!ids.has(item.id)) continue
        item.color = style.color
        written++
      }
      break
    }
    case 'opening': {
      const ids = new Set(misses.filter((t) => t.kind === 'opening').map((t) => t.openingId))
      for (const opening of artboard.openings) {
        if (!ids.has(opening.id)) continue
        if (style.color === undefined) delete opening.color
        else opening.color = style.color
        written++
      }
      break
    }
    case 'wall': {
      for (const target of misses) {
        if (target.kind !== 'wall') continue
        const room = artboard.rooms.find((r) => r.id === target.roomId)
        if (!room) continue
        const key = String(target.edgeIndex)
        if (style.color === undefined) {
          if (!room.wallColors) continue
          delete room.wallColors[key]
          if (Object.keys(room.wallColors).length === 0) delete room.wallColors
        } else {
          room.wallColors = { ...room.wallColors, [key]: style.color }
        }
        written++
      }
      break
    }
    case 'room': {
      const ids = new Set(misses.filter((t) => t.kind === 'room').map((t) => t.roomId))
      for (const room of artboard.rooms) {
        if (!ids.has(room.id)) continue
        if (style.fill === undefined) delete room.fill
        else room.fill = style.fill
        if (style.floorPattern === undefined) delete room.floorPattern
        else room.floorPattern = style.floorPattern
        if (style.floorPatternAngleDeg === undefined) delete room.floorPatternAngleDeg
        else room.floorPatternAngleDeg = style.floorPatternAngleDeg
        written++
      }
      break
    }
  }
  return written
}

let copiedStyle: CopiedStyle | null = null

/** Store a copy (or drop it with null). Also used by the tests to isolate one case from the next. */
export function setCopiedStyle(style: CopiedStyle | null): void {
  copiedStyle = style
}

/** Current copied style, or null when nothing was copied yet. */
export function getCopiedStyle(): CopiedStyle | null {
  return copiedStyle
}

/**
 * Option+Cmd+C: copy the style of the selection. False when nothing is selected, when the selection
 * holds more than one kind, or when the first target does not exist.
 */
export function copyStyle(): boolean {
  const sel = useUi.getState().selection
  const artboardId = selectionArtboardId(sel)
  const artboard = useDoc.getState().doc.artboards.find((a) => a.id === artboardId)
  const targets = targetsFromSelection(sel, artboard)
  if (targets.length === 0) return false
  if (new Set(targets.map((t) => t.kind)).size > 1) return false
  if (!artboard) return false
  const style = styleOfTarget(artboard, targets[0])
  if (!style) return false
  copiedStyle = style
  return true
}

/**
 * Option+Cmd+V: apply the copied style to every selected target of the same kind. False when
 * nothing was copied, when the selection holds no such target, or when every target already has the
 * style (no undo step then). Otherwise one undo step for the whole paste.
 */
export function pasteStyle(): boolean {
  const style = copiedStyle
  if (!style) return false
  const sel = useUi.getState().selection
  const artboardId = selectionArtboardId(sel)
  if (!artboardId) return false
  const artboard = useDoc.getState().doc.artboards.find((a) => a.id === artboardId)
  if (!artboard) return false
  const targets = targetsFromSelection(sel, artboard)
  // Read-only first: no change must mean no undo step.
  if (targetsNeedingStyle(artboard, targets, style).length === 0) return false
  useDoc.getState().update((d) => {
    const draft = d.artboards.find((a) => a.id === artboardId)
    if (draft) applyStyleToArtboard(draft, targets, style)
  })
  return true
}
