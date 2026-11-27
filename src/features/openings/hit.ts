// Hit geometry of the invisible opening pick target (no React, no store). Units: cm.
// A thick wall draws the opening (gap, jambs, symbol) across `0..thicknessCm` outward from the room
// edge, so an opening point on that edge sits on the inner wall face. The pick line and the resize
// handles sit on the wall centreline instead, so a click anywhere across the opening picks it.
import type { Vec } from '../../model/geometry'
import type { OpeningWall } from '../rooms/walls'

/**
 * Endpoints of the invisible hit line and of the resize handles of one opening: the plain opening
 * endpoints shifted by half the wall thickness along the wall outward normal (the middle of the
 * jambs). A thin wall, a 0 cm wall or an opening with no host wall keeps the exact endpoints.
 */
export function openingHitEndpoints(start: Vec, end: Vec, wall: OpeningWall | null): { start: Vec; end: Vec } {
  if (!wall || !(wall.thicknessCm > 0)) return { start, end }
  const h = wall.thicknessCm / 2
  const dx = wall.out.x * h, dy = wall.out.y * h
  return { start: { x: start.x + dx, y: start.y + dy }, end: { x: end.x + dx, y: end.y + dy } }
}

/**
 * Stroke width (cm, world units) of the invisible hit band of one opening. A thin wall keeps the
 * usual 14 screen px. A thick wall takes the whole wall thickness plus a small screen margin on both
 * faces, so a click on either face of the opening still picks and drags it at any zoom level.
 */
export function openingHitWidth(wall: OpeningWall | null, px: (n: number) => number): number {
  const plain = px(14)
  if (!wall || !(wall.thicknessCm > 0)) return plain
  return Math.max(plain, wall.thicknessCm + px(6))
}
