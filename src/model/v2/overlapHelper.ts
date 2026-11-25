// Test helper (no test inside): pairs of walls on one line that overlap by more than 1 cm.
import { cross, dist } from '../geometry'
import type { PlanDoc } from '../types'
import { endpointsOf } from './repair'

export function overlaps(doc: PlanDoc): string[] {
  const out: string[] = []
  const segs = endpointsOf(doc)
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const [ax, ay, bx, by] = segs[i]
      const [cx, cy, dx, dy] = segs[j]
      const len = dist({ x: ax, y: ay }, { x: bx, y: by })
      if (len < 1e-6) continue
      const d = { x: (bx - ax) / len, y: (by - ay) / len }
      const off = (x: number, y: number) => Math.abs(cross(d, { x: x - ax, y: y - ay }))
      if (off(cx, cy) > 1 || off(dx, dy) > 1) continue
      const t = (x: number, y: number) => (x - ax) * d.x + (y - ay) * d.y
      const lo = Math.max(0, Math.min(t(cx, cy), t(dx, dy)))
      const hi = Math.min(len, Math.max(t(cx, cy), t(dx, dy)))
      if (hi - lo > 1) out.push(`${i}/${j}`)
    }
  }
  return out
}
