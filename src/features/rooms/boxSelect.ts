// Pure marquee (box) selection helpers. No React, so the unit tests run in node.
import { pointInPolygon, type Vec } from '../../model/geometry'
import type { Artboard, Room } from '../../model/types'
import { artboardFrame } from '../artboards/frame'

/** Axis-aligned box in cm. */
export type Box = { minX: number; minY: number; maxX: number; maxY: number }

/** Box spanned by two corner points, in any order. */
export function boxFromPoints(a: Vec, b: Vec): Box {
  return {
    minX: Math.min(a.x, b.x),
    minY: Math.min(a.y, b.y),
    maxX: Math.max(a.x, b.x),
    maxY: Math.max(a.y, b.y),
  }
}

const inBox = (p: Vec, b: Box) => p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY

/** Orientation of the triple (a, b, c): >0, <0 or 0. */
const orient = (a: Vec, b: Vec, c: Vec) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)

const onSegment = (a: Vec, b: Vec, p: Vec) =>
  p.x >= Math.min(a.x, b.x) && p.x <= Math.max(a.x, b.x) && p.y >= Math.min(a.y, b.y) && p.y <= Math.max(a.y, b.y)

/** True when segment ab touches or crosses segment cd. */
function segmentsIntersect(a: Vec, b: Vec, c: Vec, d: Vec): boolean {
  const o1 = orient(a, b, c)
  const o2 = orient(a, b, d)
  const o3 = orient(c, d, a)
  const o4 = orient(c, d, b)
  if (((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) && ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0))) return true
  if (o1 === 0 && onSegment(a, b, c)) return true
  if (o2 === 0 && onSegment(a, b, d)) return true
  if (o3 === 0 && onSegment(c, d, a)) return true
  if (o4 === 0 && onSegment(c, d, b)) return true
  return false
}

/**
 * True when the world box touches the room: a room vertex lies inside the box, a room edge crosses
 * a box edge, or the box centre lies inside the room (box wholly inside a large room).
 */
export function boxIntersectsRoom(boxWorld: Box, room: Room, artboard: Artboard): boolean {
  const pts = room.vertices.map((v) => ({ x: v.x + artboard.xCm, y: v.y + artboard.yCm }))
  if (pts.length === 0) return false
  if (pts.some((p) => inBox(p, boxWorld))) return true
  const corners: Vec[] = [
    { x: boxWorld.minX, y: boxWorld.minY },
    { x: boxWorld.maxX, y: boxWorld.minY },
    { x: boxWorld.maxX, y: boxWorld.maxY },
    { x: boxWorld.minX, y: boxWorld.maxY },
  ]
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]
    const q = pts[(i + 1) % pts.length]
    for (let k = 0; k < 4; k++) {
      if (segmentsIntersect(p, q, corners[k], corners[(k + 1) % 4])) return true
    }
  }
  const centre = { x: (boxWorld.minX + boxWorld.maxX) / 2, y: (boxWorld.minY + boxWorld.maxY) / 2 }
  return pts.length >= 3 && pointInPolygon(centre, pts)
}

/**
 * Rooms touched by the box, grouped by artboard. Returns the preferred artboard when it has
 * matches, else the first artboard with matches, else null.
 */
export function findRoomsInBox(
  boxWorld: Box,
  artboards: Artboard[],
  preferredArtboardId?: string | null,
): { artboardId: string; roomIds: string[] } | null {
  const matches = artboards
    .map((a) => ({
      artboardId: a.id,
      roomIds: a.rooms.filter((r) => boxIntersectsRoom(boxWorld, r, a)).map((r) => r.id),
    }))
    .filter((m) => m.roomIds.length > 0)
  if (matches.length === 0) return null
  return matches.find((m) => m.artboardId === preferredArtboardId) ?? matches[0]
}

/** Artboard whose frame contains the world point. The last drawn (top) one wins. */
export function findArtboardAtPoint(pt: Vec, artboards: Artboard[]): Artboard | null {
  for (let i = artboards.length - 1; i >= 0; i--) {
    const f = artboardFrame(artboards[i])
    if (pt.x >= f.minX && pt.x <= f.maxX && pt.y >= f.minY && pt.y <= f.maxY) return artboards[i]
  }
  return null
}
