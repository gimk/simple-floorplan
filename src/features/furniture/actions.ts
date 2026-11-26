// Store actions for furniture (and room floor fills). Each call is one undo step; the *Silent variants
// record nothing and are meant for drags (wrap them in beginDrag/endDrag).
import { useDoc } from '../../model/store'
import { useUi } from '../../shell/uiStore'
import type { FurnitureItem } from '../../model/types'
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

/** Add a new item, clamp its sizes and select it. Returns the new id ('' when the artboard is missing). */
export function addFurniture(artboardId: string, item: Omit<FurnitureItem, 'id'>): string {
  const artboard = findArtboard(artboardId)
  if (!artboard) return ''
  const id = crypto.randomUUID()
  const stored: FurnitureItem = {
    ...item,
    id,
    widthCm: clampSize(item.widthCm),
    depthCm: clampSize(item.depthCm),
  }
  useDoc.getState().update((d) => { d.artboards.find((a) => a.id === artboardId)!.furniture.push({ ...stored }) })
  select(artboardId, id)
  return id
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
