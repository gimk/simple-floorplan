// Copy / paste of the visual style of furniture items (Alt+Cmd+C / Alt+Cmd+V, Ctrl+Alt+C / V).
// The style fields are the visual-only fields of FurnitureItem: the colour, the direction arrow and
// the corner radius. Position, size, rotation, name, id, groupId, shape/preset and height are never
// copied. The copy lives in a module-level variable. Units: cm.
import { useDoc } from '../../model/store'
import type { FurnitureItem, ProjectDoc, Selection } from '../../model/types'
import { useUi } from '../../shell/uiStore'
import { expandToGroups } from './groups'
import { selectionArtboardId } from './selectionActions'

/** Names of the fields that Copy properties copies. */
export const STYLE_FIELDS = ['color', 'showDirection', 'cornerRadiusCm'] as const

/** The visual-only part of a furniture item. */
export type FurnitureStyle = {
  color: string
  showDirection?: boolean
  cornerRadiusCm?: number
}

/** Style of one item: only the fields listed in STYLE_FIELDS. */
export function styleOf(item: FurnitureItem): FurnitureStyle {
  const style: FurnitureStyle = { color: item.color }
  if (item.showDirection !== undefined) style.showDirection = item.showDirection
  if (item.cornerRadiusCm !== undefined) style.cornerRadiusCm = item.cornerRadiusCm
  return style
}

/** True when both styles hold the same fields with the same values. */
export function sameStyle(a: FurnitureStyle, b: FurnitureStyle): boolean {
  return a.color === b.color &&
    (a.showDirection ?? false) === (b.showDirection ?? false) &&
    (a.cornerRadiusCm ?? 4) === (b.cornerRadiusCm ?? 4)
}

let copiedStyle: FurnitureStyle | null = null

/** Store a style (or drop it with null). Also used by the tests to isolate one case from the next. */
export function setCopiedStyle(style: FurnitureStyle | null): void {
  copiedStyle = style
}

/** Current copied style, or null when nothing was copied yet. */
export function getCopiedStyle(): FurnitureStyle | null {
  return copiedStyle
}

/** Alt+Cmd+C: copy the style of the single selected item. False when the selection is not one item. */
export function copyStyle(): boolean {
  const sel = useUi.getState().selection
  if (sel.kind !== 'furniture') return false
  const artboard = useDoc.getState().doc.artboards.find((a) => a.id === sel.artboardId)
  const item = artboard?.furniture.find((f) => f.id === sel.furnitureId)
  if (!item) return false
  copiedStyle = styleOf(item)
  return true
}

/**
 * The items `sel` selects on `artboard` (whole groups included) whose style differs from `style`:
 * the ones Paste properties has to write.
 */
export function itemsMissingStyle(artboard: { furniture: FurnitureItem[] }, sel: Selection, style: FurnitureStyle): string[] {
  const raw = sel.kind === 'furniture' ? [sel.furnitureId] : sel.kind === 'furnitureMulti' ? sel.furnitureIds : []
  const ids = new Set(expandToGroups(artboard, raw))
  return artboard.furniture.filter((f) => ids.has(f.id) && !sameStyle(styleOf(f), style)).map((f) => f.id)
}

/** Alt+Cmd+V: apply the copied style to every selected item. One undo step. */
export function pasteStyle(): boolean {
  const style = copiedStyle
  if (!style) return false
  const sel = useUi.getState().selection
  const artboardId = selectionArtboardId(sel)
  if (!artboardId) return false
  const artboard = useDoc.getState().doc.artboards.find((a) => a.id === artboardId)
  if (!artboard) return false
  const targets = new Set(itemsMissingStyle(artboard, sel, style))
  if (targets.size === 0) return false
  useDoc.getState().update((d: ProjectDoc) => {
    const ab = d.artboards.find((a) => a.id === artboardId)
    if (!ab) return
    for (const f of ab.furniture) {
      if (!targets.has(f.id)) continue
      f.color = style.color
      if (style.showDirection === undefined) delete f.showDirection
      else f.showDirection = style.showDirection
      if (style.cornerRadiusCm === undefined) delete f.cornerRadiusCm
      else f.cornerRadiusCm = style.cornerRadiusCm
    }
  })
  return true
}
