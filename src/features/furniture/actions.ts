// Store actions for furniture (and room floor fills). Each call is one undo step; the *Silent variants
// record nothing and are meant for drags (wrap them in beginDrag/endDrag).
import { useDoc } from '../../model/store'
import { useUi } from '../../shell/uiStore'
import type { FloorPattern, FurnitureItem } from '../../model/types'
import { MAX_FURNITURE_CM, MIN_FURNITURE_CM } from './geometry'

type FurniturePatch = Partial<Omit<FurnitureItem, 'id'>>

const clampSize = (v: number): number => Math.min(MAX_FURNITURE_CM, Math.max(MIN_FURNITURE_CM, v))

const findArtboard = (artboardId: string) => useDoc.getState().doc.artboards.find((a) => a.id === artboardId)

const findFurniture = (artboardId: string, furnitureId: string) =>
  findArtboard(artboardId)?.furniture.find((f) => f.id === furnitureId)

/** Select the item and make its artboard active. */
const select = (artboardId: string, furnitureId: string): void => {
  useUi.getState().set({ selection: { kind: 'furniture', artboardId, furnitureId }, activeArtboardId: artboardId })
}

/** Where a new item lands in the stack: 'top' appends (draws last, over the others), 'bottom' prepends. */
export type AddPosition = 'top' | 'bottom'

/** One stack move: send to back, one step backward, one step forward, or bring to front. */
export type StackOp = 'front' | 'forward' | 'backward' | 'back'

/**
 * Add a new item, clamp its sizes and select it. Returns the new id ('' when the artboard is
 * missing). `opts.position` defaults to 'top' (append); 'bottom' inserts at index 0, so a Rug goes
 * under the items that are already in the room.
 */
export function addFurniture(
  artboardId: string,
  item: Omit<FurnitureItem, 'id'>,
  opts?: { position?: AddPosition },
): string {
  const artboard = findArtboard(artboardId)
  if (!artboard) return ''
  const id = crypto.randomUUID()
  const stored: FurnitureItem = {
    ...item,
    id,
    widthCm: clampSize(item.widthCm),
    depthCm: clampSize(item.depthCm),
  }
  const bottom = opts?.position === 'bottom'
  useDoc.getState().update((d) => {
    const list = d.artboards.find((a) => a.id === artboardId)!.furniture
    if (bottom) list.unshift({ ...stored })
    else list.push({ ...stored })
  })
  select(artboardId, id)
  return id
}

/**
 * Move one item inside the stack of its artboard (index 0 = bottom, last index = top). One undo
 * step. Returns false, and records nothing, when the item is unknown or already at that end.
 */
export function reorderFurniture(artboardId: string, furnitureId: string, op: StackOp): boolean {
  const items = findArtboard(artboardId)?.furniture
  if (!items) return false
  const from = items.findIndex((f) => f.id === furnitureId)
  if (from < 0) return false
  const last = items.length - 1
  const wanted = op === 'back' ? 0 : op === 'backward' ? from - 1 : op === 'forward' ? from + 1 : last
  const to = Math.max(0, Math.min(wanted, last))
  if (to === from) return false
  useDoc.getState().update((d) => {
    const list = d.artboards.find((a) => a.id === artboardId)!.furniture
    const index = list.findIndex((f) => f.id === furnitureId)
    if (index < 0) return
    const [moved] = list.splice(index, 1)
    list.splice(to, 0, moved)
  })
  return true
}

export function updateFurniture(artboardId: string, furnitureId: string, patch: FurniturePatch): void {
  if (!findFurniture(artboardId, furnitureId)) return
  useDoc.getState().update((d) => {
    const f = d.artboards.find((a) => a.id === artboardId)!.furniture.find((x) => x.id === furnitureId)
    if (f) Object.assign(f, patch)
  })
}

/** Same as updateFurniture, but not recorded in history (use inside a drag). */
export function updateFurnitureSilent(artboardId: string, furnitureId: string, patch: FurniturePatch): void {
  if (!findFurniture(artboardId, furnitureId)) return
  useDoc.getState().updateSilent((d) => {
    const f = d.artboards.find((a) => a.id === artboardId)!.furniture.find((x) => x.id === furnitureId)
    if (f) Object.assign(f, patch)
  })
}

/** Copy an item shifted by (+offsetCm, +offsetCm), select the copy and return its id. */
export function duplicateFurniture(artboardId: string, furnitureId: string, offsetCm = 20): string | null {
  const src = findFurniture(artboardId, furnitureId)
  if (!src) return null
  const id = crypto.randomUUID()
  const copy: FurnitureItem = { ...src, id, xCm: src.xCm + offsetCm, yCm: src.yCm + offsetCm }
  useDoc.getState().update((d) => { d.artboards.find((a) => a.id === artboardId)!.furniture.push(copy) })
  select(artboardId, id)
  return id
}

export function deleteFurniture(artboardId: string, furnitureId: string): void {
  if (!findFurniture(artboardId, furnitureId)) return
  useDoc.getState().update((d) => {
    const a = d.artboards.find((x) => x.id === artboardId)!
    a.furniture = a.furniture.filter((f) => f.id !== furnitureId)
  })
  const sel = useUi.getState().selection
  if (sel.kind === 'furniture' && sel.furnitureId === furnitureId) useUi.getState().set({ selection: { kind: 'none' } })
}

/** Set (or with undefined, clear) the floor fill of one room. */
export function setRoomFill(artboardId: string, roomId: string, fill: string | undefined): void {
  const room = findArtboard(artboardId)?.rooms.find((r) => r.id === roomId)
  if (!room) return
  useDoc.getState().update((d) => {
    const r = d.artboards.find((a) => a.id === artboardId)!.rooms.find((x) => x.id === roomId)
    if (!r) return
    if (fill === undefined) delete r.fill
    else r.fill = fill
  })
}

/** Set the floor pattern of one room. 'solid' and undefined store nothing, so the JSON stays clean. */
export function setRoomFloorPattern(artboardId: string, roomId: string, pattern: FloorPattern | undefined): void {
  if (!findArtboard(artboardId)?.rooms.some((r) => r.id === roomId)) return
  useDoc.getState().update((d) => {
    const r = d.artboards.find((a) => a.id === artboardId)!.rooms.find((x) => x.id === roomId)
    if (!r) return
    if (pattern === undefined || pattern === 'solid') delete r.floorPattern
    else r.floorPattern = pattern
  })
}

/** Paint (or with undefined, clear) one wall of a room. The map is removed when it becomes empty. */
export function setRoomWallColor(artboardId: string, roomId: string, edgeIndex: number, color: string | undefined): void {
  if (!findArtboard(artboardId)?.rooms.some((r) => r.id === roomId)) return
  useDoc.getState().update((d) => {
    const r = d.artboards.find((a) => a.id === artboardId)!.rooms.find((x) => x.id === roomId)
    if (!r) return
    const key = String(edgeIndex)
    if (color === undefined) {
      const { [key]: _removed, ...rest } = r.wallColors ?? {}
      if (Object.keys(rest).length === 0) delete r.wallColors
      else r.wallColors = rest
    } else {
      r.wallColors = { ...(r.wallColors ?? {}), [key]: color }
    }
  })
}
