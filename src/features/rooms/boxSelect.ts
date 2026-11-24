// Drag a box on empty canvas to select. One kind only, like Shift + click:
// rooms fully inside the box, else walls with both ends inside, else corner points inside.
// In a v2 document the walls are the STORED walls (both nodes inside), not the walls of a room.
import { roomWalls } from '../../model/geometry'
import type { MultiItem } from '../../model/selection'
import type { PlanDoc, Room, Vec } from '../../model/types'

export type Box = { x0: number; y0: number; x1: number; y1: number }

export const boxOf = (a: Vec, b: Vec): Box => ({
  x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y),
})

const inBox = (p: Vec, b: Box) => p.x >= b.x0 && p.x <= b.x1 && p.y >= b.y0 && p.y <= b.y1

/**
 * Items in the box: rooms, else walls, else points. Empty when nothing is inside.
 * With `graph` (the nodes and walls of a v2 document), the walls are stored walls.
 */
export function itemsInBox(rooms: Room[], b: Box, graph?: Pick<PlanDoc, 'nodes' | 'walls'>): MultiItem[] {
  const full = rooms.filter((r) => r.vertices.length >= 3 && r.vertices.every((v) => inBox(v, b)))
  if (full.length) return full.map((r) => ({ kind: 'room', roomId: r.id }))
  const walls: MultiItem[] = graph ? storedWallsInBox(graph, b) : rooms.flatMap((r) => roomWalls(r)
    .filter((w) => inBox(w.start, b) && inBox(w.end, b))
    .map((w) => ({ kind: 'wall' as const, roomId: r.id, wallStart: w.start.id })))
  if (walls.length) return walls
  return rooms.flatMap((r) => r.vertices.filter((v) => inBox(v, b)).map((v) => ({ kind: 'vertex' as const, roomId: r.id, vertexId: v.id })))
}

/** Stored walls whose two nodes are inside the box. */
function storedWallsInBox(graph: Pick<PlanDoc, 'nodes' | 'walls'>, b: Box): MultiItem[] {
  const nodes = new Map((graph.nodes ?? []).map((n) => [n.id, n] as const))
  return (graph.walls ?? []).flatMap((w) => {
    const a = nodes.get(w.a), z = nodes.get(w.b)
    return a && z && inBox(a, b) && inBox(z, b) ? [{ kind: 'storedWall' as const, wallId: w.id }] : []
  })
}
