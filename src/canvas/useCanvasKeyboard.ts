// Keyboard access to the canvas. When the canvas <svg> itself has focus:
//  - Tab / Shift+Tab walk the selection through rooms, openings and furniture of the active artboard
//    (focus leaves the canvas after the last / before the first item, so nobody gets trapped);
//  - arrow keys nudge the selected room, opening or furniture by 1 cm (10 cm with Shift), as one undo step;
//  - `announce` returns the text for an aria-live region that describes the selection.
import { useCallback, useMemo, type KeyboardEvent } from 'react'
import type { Artboard, ProjectDoc, Selection } from '../model/types'
import { area } from '../model/geometry'
import { useDoc } from '../model/store'
import { useUi } from '../shell/uiStore'
import { roomWalls, moveRoom, formatLengthCm } from '../features/rooms/ops'
import { syncOpeningsForRoomChange } from '../features/openings/sync'
import { furnitureIdsInRooms, translateFurnitureByIds } from '../features/furniture/roomSync'

export type CanvasItem =
  | { kind: 'room'; id: string }
  | { kind: 'opening'; id: string }
  | { kind: 'furniture'; id: string }

export const NUDGE_CM = 1
export const NUDGE_BIG_CM = 10

/** Tab order: rooms, then openings, then furniture. */
export function canvasItems(a: Artboard): CanvasItem[] {
  return [
    ...a.rooms.map((r): CanvasItem => ({ kind: 'room', id: r.id })),
    ...a.openings.map((o): CanvasItem => ({ kind: 'opening', id: o.id })),
    ...a.furniture.map((f): CanvasItem => ({ kind: 'furniture', id: f.id })),
  ]
}

export function itemToSelection(artboardId: string, item: CanvasItem): Selection {
  if (item.kind === 'room') return { kind: 'room', artboardId, roomIds: [item.id] }
  if (item.kind === 'opening') return { kind: 'opening', artboardId, openingId: item.id }
  return { kind: 'furniture', artboardId, furnitureId: item.id }
}

/** Index in `items` of the current selection (a wall counts as its room); -1 for none. */
export function selectedItemIndex(items: CanvasItem[], sel: Selection, artboardId: string): number {
  if (!('artboardId' in sel) || sel.artboardId !== artboardId) return -1
  switch (sel.kind) {
    case 'room': return items.findIndex((i) => i.kind === 'room' && i.id === sel.roomIds[0])
    case 'wall': case 'vertex': return items.findIndex((i) => i.kind === 'room' && i.id === sel.roomId)
    case 'opening': return items.findIndex((i) => i.kind === 'opening' && i.id === sel.openingId)
    case 'furniture': return items.findIndex((i) => i.kind === 'furniture' && i.id === sel.furnitureId)
    default: return -1
  }
}

/**
 * Where Tab goes from `index`. `null` = leave the canvas (let the browser move focus);
 * otherwise the item index to select.
 */
export function tabTarget(index: number, count: number, backwards: boolean): number | null {
  if (count === 0) return null
  if (backwards) {
    if (index === 0 || index === -1) return null
    return index - 1
  }
  if (index === -1) return 0
  return index + 1 < count ? index + 1 : null
}

export function arrowDelta(key: string, shift: boolean): { dx: number; dy: number } | null {
  const s = shift ? NUDGE_BIG_CM : NUDGE_CM
  switch (key) {
    case 'ArrowLeft': return { dx: -s, dy: 0 }
    case 'ArrowRight': return { dx: s, dy: 0 }
    case 'ArrowUp': return { dx: 0, dy: -s }
    case 'ArrowDown': return { dx: 0, dy: s }
    default: return null
  }
}

/** Move the selected room(s) (with their openings and furniture), opening or furniture item. Returns a doc mutator, or null when nothing can move. */
export function nudgeSelection(doc: ProjectDoc, sel: Selection, dx: number, dy: number): ((d: ProjectDoc) => void) | null {
  if (sel.kind === 'room' || sel.kind === 'wall' || sel.kind === 'vertex') {
    const ids = sel.kind === 'room' ? sel.roomIds : [sel.roomId]
    if (!doc.artboards.find((a) => a.id === sel.artboardId)?.rooms.some((r) => ids.includes(r.id))) return null
    return (d) => {
      const ab = d.artboards.find((a) => a.id === sel.artboardId)!
      const prev = ab.rooms
      const moved = new Set(furnitureIdsInRooms(ab, ids))
      ab.rooms = prev.map((r) => (ids.includes(r.id) ? moveRoom(r, dx, dy) : r))
      ab.openings = syncOpeningsForRoomChange(ab.openings, prev, ab.rooms)
      ab.furniture = translateFurnitureByIds(ab.furniture, moved, dx, dy)
    }
  }
  if (sel.kind === 'opening') {
    if (!doc.artboards.find((a) => a.id === sel.artboardId)?.openings.some((o) => o.id === sel.openingId)) return null
    return (d) => {
      const o = d.artboards.find((a) => a.id === sel.artboardId)!.openings.find((x) => x.id === sel.openingId)!
      o.xCm += dx; o.yCm += dy
    }
  }
  if (sel.kind === 'furniture') {
    if (!doc.artboards.find((a) => a.id === sel.artboardId)?.furniture.some((f) => f.id === sel.furnitureId)) return null
    return (d) => {
      const f = d.artboards.find((a) => a.id === sel.artboardId)!.furniture.find((x) => x.id === sel.furnitureId)!
      f.xCm += dx; f.yCm += dy
    }
  }
  return null
}

/** Screen-reader text for the current selection. */
export function describeSelection(doc: ProjectDoc, sel: Selection): string {
  if (sel.kind === 'none') return ''
  if (sel.kind === 'refImage') return 'Reference image selected'
  const ab = doc.artboards.find((a) => a.id === ('artboardId' in sel ? sel.artboardId : ''))
  if (!ab) return ''
  if (sel.kind === 'artboard') return `Artboard ${ab.name} selected`
  const precision = ab.precisionCm
  if (sel.kind === 'room') {
    const rooms = ab.rooms.filter((r) => sel.roomIds.includes(r.id))
    if (rooms.length === 0) return ''
    if (rooms.length > 1) return `${rooms.length} rooms selected`
    const r = rooms[0]
    return `Room ${r.name}, ${(area(r.vertices) / 10000).toFixed(2)} square meters`
  }
  if (sel.kind === 'wall') {
    const r = ab.rooms.find((x) => x.id === sel.roomId)
    const w = r && roomWalls(r)[sel.edgeIndex]
    if (!r || !w) return ''
    return `Wall ${sel.edgeIndex + 1} of ${r.name}, ${formatLengthCm(w.lengthCm, precision)} centimeters`
  }
  if (sel.kind === 'vertex') {
    const r = ab.rooms.find((x) => x.id === sel.roomId)
    return r ? `Corner ${sel.vertexIndex + 1} of ${r.name}` : ''
  }
  if (sel.kind === 'opening') {
    const o = ab.openings.find((x) => x.id === sel.openingId)
    return o ? `${o.kind === 'opening' ? 'Opening' : o.kind === 'door' ? 'Door' : 'Window'}, ${formatLengthCm(o.widthCm, precision)} centimeters wide` : ''
  }
  const f = ab.furniture.find((x) => x.id === sel.furnitureId)
  return f ? `${f.name}, ${formatLengthCm(f.widthCm, precision)} by ${formatLengthCm(f.depthCm, precision)} centimeters` : ''
}

/** Key handler for the focused canvas, plus the live-region text. */
export function useCanvasKeyboard() {
  const selection = useUi((s) => s.selection)
  const doc = useDoc((s) => s.doc)
  const announcement = useMemo(() => describeSelection(doc, selection), [doc, selection])

  const onKeyDown = useCallback((e: KeyboardEvent<SVGSVGElement>) => {
    // Only when the canvas itself has focus, not a control inside it.
    if (e.target !== e.currentTarget || e.altKey || e.ctrlKey || e.metaKey) return
    const ui = useUi.getState()
    if (ui.tool !== 'select') return
    const store = useDoc.getState()
    const artboard = store.doc.artboards.find((a) => a.id === ui.activeArtboardId) ?? store.doc.artboards[0]
    if (!artboard) return

    if (e.key === 'Tab') {
      const items = canvasItems(artboard)
      const target = tabTarget(selectedItemIndex(items, ui.selection, artboard.id), items.length, e.shiftKey)
      if (target === null) return
      e.preventDefault()
      ui.set({ activeArtboardId: artboard.id, selection: itemToSelection(artboard.id, items[target]) })
      return
    }

    const delta = arrowDelta(e.key, e.shiftKey)
    if (!delta) return
    const change = nudgeSelection(store.doc, ui.selection, delta.dx, delta.dy)
    if (!change) return
    e.preventDefault()
    store.update(change)
  }, [])

  return { onKeyDown, announcement }
}
