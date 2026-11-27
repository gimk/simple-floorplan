// Furniture clipboard: Cmd/Ctrl+C copies the selected items, Cmd/Ctrl+X cuts them (copy + delete in
// one undo step) and Cmd/Ctrl+V pastes them. The copies live in a module-level variable and in
// localStorage (key 'sfp.furnitureClipboard'), so they survive a reload; every localStorage call is
// wrapped, because it throws in private mode and does not exist in the test environment.
// Paste target: the artboard of the current selection, else the artboard the items came from.
// Same artboard: offset +20 cm on x and y. Other artboard: same local coordinates.
// Pasted items get new ids, a new groupId per source group, go on top of the layer order and become
// the selection. Units: cm.
import { useDoc } from '../../model/store'
import type { Artboard, FurnitureItem, Selection } from '../../model/types'
import { furnitureSchema } from '../../model/schema'
import { useUi } from '../../shell/uiStore'
import { setFurnitureSelection } from './actions'
import { cleanupSingleMemberGroups, expandToGroups } from './groups'
import { selectionArtboardId } from './selectionActions'

/** localStorage key of the furniture clipboard. */
export const CLIPBOARD_STORAGE_KEY = 'sfp.furnitureClipboard'

/** Offset applied to a paste inside the artboard the items were copied from, in cm. */
export const PASTE_OFFSET_CM = 20

/** One copy: the artboard the items came from, and the items themselves (originals, ids and all). */
export type FurnitureClipboard = { artboardId: string; items: FurnitureItem[] }

let memory: FurnitureClipboard | null = null

/** Read the clipboard back from localStorage (best effort: any problem gives null). */
export function readStoredClipboard(): FurnitureClipboard | null {
  try {
    const raw = globalThis.localStorage?.getItem(CLIPBOARD_STORAGE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    const { artboardId, items } = parsed as { artboardId?: unknown; items?: unknown }
    if (typeof artboardId !== 'string' || !Array.isArray(items)) return null
    const valid = furnitureSchema.array().safeParse(items)
    return valid.success ? { artboardId, items: valid.data as FurnitureItem[] } : null
  } catch {
    return null
  }
}

function writeStored(copy: FurnitureClipboard | null): void {
  try {
    if (copy === null) globalThis.localStorage?.removeItem(CLIPBOARD_STORAGE_KEY)
    else globalThis.localStorage?.setItem(CLIPBOARD_STORAGE_KEY, JSON.stringify(copy))
  } catch {
    // No storage (private mode, quota, tests): the module-level copy still works.
  }
}

/** Store a copy (or clear the clipboard with null) in memory and in localStorage. */
export function setClipboard(copy: FurnitureClipboard | null): void {
  memory = copy
  writeStored(copy)
}

/** Current clipboard: the module-level copy, else the one saved in localStorage. */
export function getClipboard(): FurnitureClipboard | null {
  if (memory) return memory
  memory = readStoredClipboard()
  return memory
}

/** Deep copy of the items `sel` selects on `artboard` (whole groups always come along). */
export function clipboardItemsFor(artboard: Artboard, sel: Selection): FurnitureItem[] {
  const raw = sel.kind === 'furniture' ? [sel.furnitureId] : sel.kind === 'furnitureMulti' ? sel.furnitureIds : []
  const ids = new Set(expandToGroups(artboard, raw))
  return artboard.furniture.filter((f) => ids.has(f.id)).map((f) => ({ ...f }))
}

/** Cmd/Ctrl+C: copy the selected furniture. Returns the number of items copied (0 = nothing to do). */
export function copyFurniture(): number {
  const ui = useUi.getState()
  const artboardId = selectionArtboardId(ui.selection)
  if (!artboardId) return 0
  const artboard = useDoc.getState().doc.artboards.find((a) => a.id === artboardId)
  if (!artboard) return 0
  const items = clipboardItemsFor(artboard, ui.selection)
  if (items.length === 0) return 0
  setClipboard({ artboardId, items })
  return items.length
}

/**
 * Cmd/Ctrl+X: copy the selected furniture and delete it. The copy touches no document state, so the
 * delete is the one and only undo step.
 */
export function cutFurniture(): number {
  const ui = useUi.getState()
  const artboardId = selectionArtboardId(ui.selection)
  if (!artboardId) return 0
  const artboard = useDoc.getState().doc.artboards.find((a) => a.id === artboardId)
  if (!artboard) return 0
  const items = clipboardItemsFor(artboard, ui.selection)
  if (items.length === 0) return 0
  setClipboard({ artboardId, items })
  const removed = new Set(items.map((f) => f.id))
  useDoc.getState().update((d) => {
    const ab = d.artboards.find((a) => a.id === artboardId)
    if (!ab) return
    ab.furniture = ab.furniture.filter((f) => !removed.has(f.id))
    cleanupSingleMemberGroups(ab.furniture)
  })
  useUi.getState().set({ selection: { kind: 'none' } })
  return items.length
}

/** The pasted copies of `copy`: new ids, one new groupId per source group, shifted by `offsetCm`. */
export function pasteItems(copy: FurnitureClipboard, offsetCm: number): FurnitureItem[] {
  const groupMap = new Map<string, string>()
  const pasted = copy.items.map((f): FurnitureItem => {
    let groupId = f.groupId
    if (groupId) {
      const known = groupMap.get(groupId)
      if (known) groupId = known
      else {
        const next = crypto.randomUUID()
        groupMap.set(groupId, next)
        groupId = next
      }
    }
    return {
      ...f,
      id: crypto.randomUUID(),
      xCm: f.xCm + offsetCm,
      yCm: f.yCm + offsetCm,
      ...(groupId ? { groupId } : {}),
    }
  })
  cleanupSingleMemberGroups(pasted)
  return pasted
}

/** Cmd/Ctrl+V: paste the clipboard onto the target artboard and select the new items. */
export function pasteFurniture(): string[] {
  const copy = getClipboard()
  if (!copy || copy.items.length === 0) return []
  const ui = useUi.getState()
  const targetId = selectionArtboardId(ui.selection) ?? copy.artboardId
  const target = useDoc.getState().doc.artboards.find((a) => a.id === targetId)
  if (!target) return []
  const offset = target.id === copy.artboardId ? PASTE_OFFSET_CM : 0
  const pasted = pasteItems(copy, offset)
  if (pasted.length === 0) return []
  useDoc.getState().update((d) => {
    const ab = d.artboards.find((a) => a.id === target.id)
    if (!ab) return
    ab.furniture = [...ab.furniture, ...pasted.map((f) => ({ ...f }))]
  })
  const ids = pasted.map((f) => f.id)
  setFurnitureSelection(target.id, ids)
  return ids
}
