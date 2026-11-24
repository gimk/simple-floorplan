// Where the text of a tape measure goes (round 2 suggestion 5: the label "traced 200,5" touched the
// tag of a room). Pure: no store, no React. Units are cm, y points down.
import type { Vec } from '../../model/types'

/** Distance of the text of a tape from its line, screen px. */
export const TAPE_LABEL_GAP_PX = 8

/**
 * The place and the angle of the text of a tape (round 2 suggestion 5): ABOVE the tape line,
 * `gapCm` away from it, so the text sits off the room it crosses. "Above" is the side of the screen
 * up (y points down); a line that is nearly vertical has no up side, so the text goes to the right
 * of it. The text turns with the line and always stays up (angle in -90..90), like the texts of the
 * dimension lines of the plan.
 */
export function tapeLabelPlacement(a: Vec, b: Vec, gapCm: number): { p: Vec; angle: number } {
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1
  const ux = dx / len, uy = dy / len
  // The two normals of the line: (-uy, ux) is the left of a -> b.
  const left = { x: -uy, y: ux }
  const up = left.y < -1e-9
    ? left
    : left.y > 1e-9
      ? { x: -left.x, y: -left.y }
      : left.x >= 0
        ? left
        : { x: -left.x, y: -left.y }
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2
  const raw = (Math.atan2(dy, dx) * 180) / Math.PI
  const angle = raw > 90 ? raw - 180 : raw <= -90 ? raw + 180 : raw
  return { p: { x: mx + up.x * gapCm, y: my + up.y * gapCm }, angle }
}
