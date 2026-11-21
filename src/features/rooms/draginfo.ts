// Tracks the vertex/wall currently being dragged, so the dimension labels of the
// attached walls stay visible even when short on screen (plan.md 7.2 #22).
import { create } from 'zustand'
import type { Room } from '../../model/types'

export type DragInfo =
  | { kind: 'vertex'; roomId: string; vertexId: string }
  | { kind: 'wall'; roomId: string; wallStart: string }
  | null

export const useDragInfo = create<{ drag: DragInfo }>(() => ({ drag: null }))

export const setDragInfo = (drag: DragInfo) => useDragInfo.setState({ drag })

/**
 * Ids of the wall START vertices whose length labels must always render during a drag:
 * the two walls touching a dragged vertex, or the dragged wall plus its two neighbours.
 */
export function forcedWallStarts(drag: DragInfo, room: Room | undefined): Set<string> {
  const out = new Set<string>()
  if (!drag || !room) return out
  const n = room.vertices.length
  if (drag.kind === 'vertex') {
    const i = room.vertices.findIndex((v) => v.id === drag.vertexId)
    if (i < 0) return out
    out.add(room.vertices[i].id)
    out.add(room.vertices[(i - 1 + n) % n].id)
  } else {
    const i = room.vertices.findIndex((v) => v.id === drag.wallStart)
    if (i < 0) return out
    out.add(room.vertices[i].id)
    out.add(room.vertices[(i - 1 + n) % n].id)
    out.add(room.vertices[(i + 1) % n].id)
  }
  return out
}
