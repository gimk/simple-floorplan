// Store actions for furniture (and room floor fills). Each call is one undo step; the *Silent variants
// record nothing and are meant for drags (wrap them in beginDrag/endDrag).
import { useDoc } from '../../model/store'
import { useUi } from '../../shell/uiStore'
import type { FloorPattern, FurnitureItem, ProjectDoc } from '../../model/types'
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

/**
 * Select 0, 1 or many furniture items of one artboard and make that artboard active: 0 ids clear the
 * selection, 1 id is the usual single 'furniture' selection, 2+ ids are a 'furnitureMulti' one.
 * Duplicate ids are dropped; the order of the ids is kept.
 */
export function setFurnitureSelection(artboardId: string, ids: string[]): void {
  const unique = [...new Set(ids)]
  if (unique.length === 0) {
    useUi.getState().set({ activeArtboardId: artboardId, selection: { kind: 'none' } })
    return
  }
  if (unique.length === 1) {
    select(artboardId, unique[0])
    return
  }
  useUi.getState().set({
    activeArtboardId: artboardId,
    selection: { kind: 'furnitureMulti', artboardId, furnitureIds: unique },
  })
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
  useDoc.getState().update((d) => {
    const list = d.artboards.find((a) => a.id === artboardId)!.furniture
    const at = list.findIndex((f) => f.id === furnitureId)
    list.splice(at + 1, 0, copy)
  })
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

/** Start position of one item, in artboard-local cm. */
export type FurnitureStart = { xCm: number; yCm: number }

/**
 * Move many items by the same delta, from the positions they had when the drag started: `starts`
 * maps each id to its start position, so every move of a drag computes from the same origin.
 * `silent` (the default) records nothing and is meant inside beginDrag/endDrag; false = one undo
 * step. Ids that left the document are skipped.
 */
export function moveFurnitureGroup(
  artboardId: string,
  starts: ReadonlyMap<string, FurnitureStart>,
  dx: number,
  dy: number,
  silent = true,
): void {
  if (starts.size === 0) return
  const artboard = findArtboard(artboardId)
  if (!artboard || !artboard.furniture.some((f) => starts.has(f.id))) return
  const apply = (d: ProjectDoc) => {
    const ab = d.artboards.find((a) => a.id === artboardId)
    if (!ab) return
    for (const f of ab.furniture) {
      const start = starts.get(f.id)
      if (!start) continue
      f.xCm = start.xCm + dx
      f.yCm = start.yCm + dy
    }
  }
  if (silent) useDoc.getState().updateSilent(apply)
  else useDoc.getState().update(apply)
}

/** Patch many items of one artboard in one write (one undo step). Unknown ids are skipped. */
export function updateFurnitureMany(artboardId: string, furnitureIds: string[], patch: FurniturePatch): void {
  const artboard = findArtboard(artboardId)
  if (!artboard) return
  const ids = new Set(furnitureIds)
  if (!artboard.furniture.some((f) => ids.has(f.id))) return
  useDoc.getState().update((d) => {
    const ab = d.artboards.find((a) => a.id === artboardId)
    if (!ab) return
    for (const f of ab.furniture) {
      if (ids.has(f.id)) Object.assign(f, patch)
    }
  })
}

/**
 * Copy many items, each shifted by (+offsetCm, +offsetCm), in one undo step. The copies are selected
 * as a group. Returns the new ids, in the order of `furnitureIds`.
 */
export function duplicateFurnitureGroup(artboardId: string, furnitureIds: string[], offsetCm = 20): string[] {
  const artboard = findArtboard(artboardId)
  if (!artboard) return []
  const wanted = new Set(furnitureIds)
  const copyOf = new Map<string, FurnitureItem>()
  const copies = artboard.furniture
    .filter((f) => wanted.has(f.id))
    .map((f): FurnitureItem => {
      const copy: FurnitureItem = { ...f, id: crypto.randomUUID(), xCm: f.xCm + offsetCm, yCm: f.yCm + offsetCm }
      copyOf.set(f.id, copy)
      return copy
    })
  if (copies.length === 0) return []
  useDoc.getState().update((d) => {
    const ab = d.artboards.find((a) => a.id === artboardId)
    if (!ab) return
    ab.furniture = ab.furniture.flatMap((f) => {
      const c = copyOf.get(f.id)
      return c ? [f, { ...c }] : [f]
    })
  })
  const ids = copies.map((c) => c.id)
  setFurnitureSelection(artboardId, ids)
  return ids
}

/** Delete many items of one artboard in one undo step, then clear the selection. */
export function deleteFurnitureGroup(artboardId: string, furnitureIds: string[]): void {
  const artboard = findArtboard(artboardId)
  if (!artboard) return
  const ids = new Set(furnitureIds)
  if (!artboard.furniture.some((f) => ids.has(f.id))) return
  useDoc.getState().update((d) => {
    const ab = d.artboards.find((a) => a.id === artboardId)
    if (!ab) return
    ab.furniture = ab.furniture.filter((f) => !ids.has(f.id))
  })
  const sel = useUi.getState().selection
  const touchesSelection =
    (sel.kind === 'furnitureMulti' && sel.furnitureIds.some((id) => ids.has(id))) ||
    (sel.kind === 'furniture' && ids.has(sel.furnitureId))
  if (touchesSelection) useUi.getState().set({ selection: { kind: 'none' } })
}

/** Set (or with undefined, clear) the floor fill of many rooms: one undo step. */
export function setRoomsFill(artboardId: string, roomIds: string[], fill: string | undefined): void {
  const artboard = findArtboard(artboardId)
  if (!artboard) return
  const ids = new Set(roomIds)
  if (!artboard.rooms.some((r) => ids.has(r.id))) return
  useDoc.getState().update((d) => {
    const ab = d.artboards.find((a) => a.id === artboardId)
    if (!ab) return
    for (const r of ab.rooms) {
      if (!ids.has(r.id)) continue
      if (fill === undefined) delete r.fill
      else r.fill = fill
    }
  })
}

/** Set (or with undefined, clear) the floor fill of one room. */
export function setRoomFill(artboardId: string, roomId: string, fill: string | undefined): void {
  setRoomsFill(artboardId, [roomId], fill)
}

/** Set the floor pattern of many rooms: 'solid' and undefined store nothing. One undo step. */
export function setRoomsFloorPattern(artboardId: string, roomIds: string[], pattern: FloorPattern | undefined): void {
  const artboard = findArtboard(artboardId)
  if (!artboard) return
  const ids = new Set(roomIds)
  if (!artboard.rooms.some((r) => ids.has(r.id))) return
  useDoc.getState().update((d) => {
    const ab = d.artboards.find((a) => a.id === artboardId)
    if (!ab) return
    for (const r of ab.rooms) {
      if (!ids.has(r.id)) continue
      if (pattern === undefined || pattern === 'solid') delete r.floorPattern
      else r.floorPattern = pattern
    }
  })
}

/** Set the floor pattern of one room. 'solid' and undefined store nothing, so the JSON stays clean. */
export function setRoomFloorPattern(artboardId: string, roomId: string, pattern: FloorPattern | undefined): void {
  setRoomsFloorPattern(artboardId, [roomId], pattern)
}

/** Normalise a pattern angle to [0, 360), rounded to 0.1 degree. 0 (= none) is returned as 0. */
const normalizePatternAngle = (angleDeg: number | undefined): number => {
  if (angleDeg === undefined || !Number.isFinite(angleDeg)) return 0
  let a = Math.round((((angleDeg % 360) + 360) % 360) * 10) / 10
  if (a >= 360) a = 0
  return a
}

/** Set the floor pattern angle (degrees) of many rooms. undefined and 0 store nothing. One undo step. */
export function setRoomsFloorPatternAngle(artboardId: string, roomIds: string[], angleDeg: number | undefined): void {
  const artboard = findArtboard(artboardId)
  if (!artboard) return
  const ids = new Set(roomIds)
  if (!artboard.rooms.some((r) => ids.has(r.id))) return
  const a = normalizePatternAngle(angleDeg)
  useDoc.getState().update((d) => {
    const ab = d.artboards.find((x) => x.id === artboardId)
    if (!ab) return
    for (const r of ab.rooms) {
      if (!ids.has(r.id)) continue
      if (a === 0) delete r.floorPatternAngleDeg
      else r.floorPatternAngleDeg = a
    }
  })
}

/** Set the floor pattern angle (degrees) of one room. Normalised to [0, 360); undefined and 0 store nothing. */
export function setRoomFloorPatternAngle(artboardId: string, roomId: string, angleDeg: number | undefined): void {
  setRoomsFloorPatternAngle(artboardId, [roomId], angleDeg)
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
