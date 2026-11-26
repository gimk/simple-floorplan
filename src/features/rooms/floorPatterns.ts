// Floor texture definitions shared by the canvas (React SVG) and the SVG export (string SVG).
// Tile sizes are in cm. `inner` holds the SVG markup of one tile (no <pattern> wrapper), drawn over a
// base rect of the room fill at 0.28 opacity; texture lines are subtle (~0.18 opacity).
import type { FloorPattern } from '../../model/types'

export const DEFAULT_PATTERN_FILL = '#6b7075'
const INK = '#e2e8f0'

export type PatternDef = { w: number; h: number; inner: (stroke: number) => string }

const line = (x1: number, y1: number, x2: number, y2: number, sw: number) =>
  `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${INK}" stroke-opacity="0.18" stroke-width="${sw}" />`

export const PATTERN_DEFS: Record<Exclude<FloorPattern, 'solid'>, PatternDef> = {
  // Planks 120 x 18: a seam at the bottom and a staggered end joint.
  wood: { w: 120, h: 18, inner: (s) => line(0, 18, 120, 18, s) + line(60, 0, 60, 18, s) },
  // Square 40 x 40 with a diagonal pair, a simple parquet hint.
  parquet: { w: 40, h: 40, inner: (s) => line(0, 0, 40, 0, s) + line(0, 0, 0, 40, s) + line(0, 40, 40, 0, s) },
  tile: { w: 45, h: 45, inner: (s) => line(0, 0, 45, 0, s) + line(0, 0, 0, 45, s) },
  stone: { w: 60, h: 40, inner: (s) => line(0, 0, 60, 0, s) + line(0, 20, 60, 20, s) + line(30, 0, 30, 20, s) + line(0, 20, 0, 40, s) },
  carpet: {
    w: 12, h: 12,
    inner: () => `<circle cx="3" cy="3" r="0.8" fill="${INK}" fill-opacity="0.18" /><circle cx="9" cy="9" r="0.8" fill="${INK}" fill-opacity="0.18" />`,
  },
}

export const patternId = (roomId: string, scope = 'fp'): string => `${scope}-${roomId.replace(/[^A-Za-z0-9_-]/g, '_')}`

export const isPatterned = (p: FloorPattern | undefined): p is Exclude<FloorPattern, 'solid'> => !!p && p !== 'solid'

/** Full <pattern> element as a string (used by the export). `stroke` is the line width in cm. */
export function patternSvg(id: string, p: Exclude<FloorPattern, 'solid'>, fill: string, stroke: number): string {
  const d = PATTERN_DEFS[p]
  return `<pattern id="${id}" width="${d.w}" height="${d.h}" patternUnits="userSpaceOnUse">` +
    `<rect width="${d.w}" height="${d.h}" fill="${fill}" fill-opacity="0.28" />${d.inner(stroke)}</pattern>`
}
