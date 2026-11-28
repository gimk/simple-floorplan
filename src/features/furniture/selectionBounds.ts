// World bounds of the current selection, for "zoom to fit the selection" (Shift+2).
// Furniture, room, wall, opening, artboard and mixed multi-selections are supported; anything else
// gives null. A mixed multi-selection gives the union of its items' bounds.
// Units: cm, y points down. No React here.
import type { ProjectDoc, Selection } from '../../model/types'
import { useDoc } from '../../model/store'
import { useUi } from '../../shell/uiStore'
import { fitBounds } from '../../shell/zoom'
import { artboardFrame } from '../artboards/frame'
import { furnitureAxisBounds } from './geometry'
import type { ItemBounds } from './geometry'

/** World bounds (cm) of the items `sel` selects, or null when the selection has no geometry. */
export function selectionWorldBounds(doc: ProjectDoc, sel: Selection): ItemBounds | null {
  if (sel.kind === 'none' || sel.kind === 'refImage') return null
  if (sel.kind === 'artboard') {
    const a = doc.artboards.find((x) => x.id === sel.artboardId)
    if (!a) return null
    const f = artboardFrame(a)
    return { minX: f.minX, minY: f.minY, maxX: f.maxX, maxY: f.maxY }
  }
  const artboard = doc.artboards.find((a) => a.id === sel.artboardId)
  if (!artboard) return null
  // Furniture, rooms and openings are stored in artboard-local cm.
  const ox = artboard.xCm
  const oy = artboard.yCm
  if (sel.kind === 'furniture' || sel.kind === 'furnitureMulti') {
    const ids = new Set(sel.kind === 'furniture' ? [sel.furnitureId] : sel.furnitureIds)
    const items = artboard.furniture.filter((f) => ids.has(f.id))
    if (items.length === 0) return null
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const f of items) {
      const b = furnitureAxisBounds(f)
      minX = Math.min(minX, b.minX); minY = Math.min(minY, b.minY)
      maxX = Math.max(maxX, b.maxX); maxY = Math.max(maxY, b.maxY)
    }
    return { minX: minX + ox, minY: minY + oy, maxX: maxX + ox, maxY: maxY + oy }
  }
  if (sel.kind === 'opening') {
    const o = artboard.openings.find((x) => x.id === sel.openingId)
    return o ? { minX: o.xCm + ox, minY: o.yCm + oy, maxX: o.xCm + ox, maxY: o.yCm + oy } : null
  }
  if (sel.kind === 'multi') {
    // Union of the bounds of every item; each item reuses the single-selection code path above.
    let box: ItemBounds | null = null
    for (const item of sel.items) {
      const one: Selection = item.kind === 'room'
        ? { kind: 'room', artboardId: sel.artboardId, roomIds: [item.roomId] }
        : item.kind === 'wall'
          ? { kind: 'wall', artboardId: sel.artboardId, roomId: item.roomId, edgeIndex: item.edgeIndex }
          : item.kind === 'opening'
            ? { kind: 'opening', artboardId: sel.artboardId, openingId: item.openingId }
            : { kind: 'furniture', artboardId: sel.artboardId, furnitureId: item.furnitureId }
      const b = selectionWorldBounds(doc, one)
      if (!b) continue
      box = box
        ? {
            minX: Math.min(box.minX, b.minX), minY: Math.min(box.minY, b.minY),
            maxX: Math.max(box.maxX, b.maxX), maxY: Math.max(box.maxY, b.maxY),
          }
        : b
    }
    return box
  }
  const roomId = sel.kind === 'room' ? null : sel.roomId
  const roomIds = sel.kind === 'room' ? sel.roomIds : roomId ? [roomId] : []
  const rooms = artboard.rooms.filter((r) => roomIds.includes(r.id))
  if (rooms.length === 0) return null
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const r of rooms) {
    for (const v of r.vertices) {
      minX = Math.min(minX, v.x); minY = Math.min(minY, v.y)
      maxX = Math.max(maxX, v.x); maxY = Math.max(maxY, v.y)
    }
  }
  if (!Number.isFinite(minX)) return null
  return { minX: minX + ox, minY: minY + oy, maxX: maxX + ox, maxY: maxY + oy }
}

/** Shift+2: fit the view to the current selection. False when the selection has no geometry. */
export function zoomToSelection(): boolean {
  const bounds = selectionWorldBounds(useDoc.getState().doc, useUi.getState().selection)
  if (!bounds) return false
  fitBounds(bounds)
  return true
}
