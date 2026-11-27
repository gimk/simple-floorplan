// Floor texture definitions shared by the canvas (React SVG) and the SVG export (string SVG).
// Tile sizes are in cm (patternUnits="userSpaceOnUse"). `inner` holds the SVG markup of one tile (no
// <pattern> wrapper). It draws only subtle overlays (tints, seams, grain): the base fill is added by
// the caller, so the texture never distracts from furniture.
//   - Plan mode: the room colour at PLAN_FLOOR_OPACITY (translucent, to trace reference images).
//   - Design mode: DESIGN_FLOOR_BASE (opaque) plus the room colour at DESIGN_FLOOR_TINT_OPACITY.
// Every tile wraps seamlessly: blocks that cross a tile edge are drawn at their wrapped place too,
// and the pattern viewport clips them.
import type { FloorPattern } from '../../model/types'

export const DEFAULT_PATTERN_FILL = '#6b7075'
/** Opaque dark canvas base under the faded room colour in Design mode. */
export const DESIGN_FLOOR_BASE = '#161b21'
/** Opacity of the room colour over DESIGN_FLOOR_BASE: the floor is opaque but muted, so furniture pops. */
export const DESIGN_FLOOR_TINT_OPACITY = 0.42
/** Translucent floor opacity in Plan mode (and in the export). */
export const PLAN_FLOOR_OPACITY = 0.28

const INK = '#e2e8f0'
const DARK = '#000000'

export type PatternDef = { w: number; h: number; inner: (stroke: number) => string }

const f = (n: number): string => String(Math.round(n * 100) / 100)

const rect = (x: number, y: number, w: number, h: number, fill: string, op: number) =>
  `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" fill="${fill}" fill-opacity="${op}" />`

const line = (x1: number, y1: number, x2: number, y2: number, sw: number, color = DARK, op = 0.3) =>
  `<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}" stroke="${color}" stroke-opacity="${op}" stroke-width="${f(sw)}" />`

const path = (d: string, sw: number, color: string, op: number) =>
  `<path d="${d}" fill="none" stroke="${color}" stroke-opacity="${op}" stroke-width="${f(sw)}" stroke-linecap="round" />`

const dot = (cx: number, cy: number, r: number, color: string, op: number) =>
  `<circle cx="${f(cx)}" cy="${f(cy)}" r="${r}" fill="${color}" fill-opacity="${op}" />`

/** A tonal tint: positive = lighter, negative = darker. */
const tint = (x: number, y: number, w: number, h: number, t: number) =>
  t === 0 ? '' : t > 0 ? rect(x, y, w, h, INK, t) : rect(x, y, w, h, DARK, -t)

const mod = (a: number, n: number) => ((a % n) + n) % n

// ---------- wood: 280 x 42, 3 rows of 14 cm planks 140 cm long, staggered by 47 cm and 93 cm ----------
// Tile width is two plank lengths, so a plank and its wrapped copy get the same tint and grain (class mod 2).
const WOOD_W = 280
const WOOD_PLANK_H = 14
const WOOD_PLANK_L = 140
const WOOD_ROW_OFFSETS = [0, 47, 93]
const WOOD_TINTS = [0.05, -0.06, -0.03, 0.07, -0.08, 0.03] // [row * 2 + plank class]

function woodInner(s: number): string {
  const out: string[] = []
  for (let row = 0; row < WOOD_ROW_OFFSETS.length; row++) {
    const y = row * WOOD_PLANK_H
    const offset = WOOD_ROW_OFFSETS[row]
    // Planks that start from one plank before the tile to one after: the viewport clips the rest.
    for (let k = -1; k < 3; k++) {
      const x = offset + k * WOOD_PLANK_L
      const cls = mod(Math.round((x - offset) / WOOD_PLANK_L), 2)
      const idx = row * 2 + cls
      out.push(tint(x, y, WOOD_PLANK_L, WOOD_PLANK_H, WOOD_TINTS[idx]))
      // Longitudinal grain, shape set by the plank index so wrapped planks match.
      const g = idx + 1
      out.push(path(`M${f(x + 5)} ${f(y + 4 + (g % 3))} q ${28 + g * 3} -1.4 58 0 t 52 0`, 0.4, INK, 0.07))
      out.push(path(`M${f(x + 12)} ${f(y + 9.5)} q 22 1.6 46 0 t 44 0`, 0.35, DARK, 0.09))
      out.push(path(`M${f(x + 3)} ${f(y + 14 - (g % 2))} q 30 -1.2 62 0 t 48 0`, 0.4, INK, 0.05))
      // End joint: dark seam and a light bevel next to it.
      out.push(line(x, y, x, y + WOOD_PLANK_H, s, DARK, 0.4))
      out.push(line(x + s, y, x + s, y + WOOD_PLANK_H, s * 0.7, INK, 0.1))
    }
  }
  for (let row = 0; row <= WOOD_ROW_OFFSETS.length; row++) {
    const y = row * WOOD_PLANK_H
    out.push(line(0, y, WOOD_W, y, s * 1.1, DARK, 0.4))
    out.push(line(0, y + s, WOOD_W, y + s, s * 0.7, INK, 0.1))
  }
  return out.join('')
}

// ---------- parquet: seamless herringbone, 80 x 80 (10 x 10 cells of W = 8 cm, blocks 40 x 8) ----------
// Cell grid (cell size W = HB_W, block ratio k = HB_K): horizontal block H_n covers the k cells
// (n, n) .. (n + k - 1, n); vertical block V_n covers (n + k, n - k + 1) .. (n + k, n).
// The family repeats every 2k = HB_N cells in x and y, so the 10 x 10 tile wraps seamlessly.
const HB_W = 8
const HB_K = 5
const HB_N = 2 * HB_K

type HerringBlock = { x: number; y: number; w: number; h: number; horizontal: boolean; n: number }

const HERRINGBONE: HerringBlock[] = (() => {
  const blocks: HerringBlock[] = []
  for (let t = -3; t <= 3; t++) {
    for (let n = -20; n <= 20; n++) {
      const cx = n + HB_N * t
      // Horizontal block: cells (cx, n) .. (cx + k - 1, n). Vertical: (cx + k, n - k + 1) .. (cx + k, n).
      const cands: HerringBlock[] = [
        { x: cx, y: n, w: HB_K, h: 1, horizontal: true, n },
        { x: cx + HB_K, y: n - HB_K + 1, w: 1, h: HB_K, horizontal: false, n },
      ]
      for (const b of cands) {
        // Keep only blocks that touch the HB_N x HB_N cell tile (a block and its wrapped copy are both kept).
        if (b.x < HB_N && b.x + b.w > 0 && b.y < HB_N && b.y + b.h > 0) blocks.push(b)
      }
    }
  }
  return blocks
})()

function parquetInner(s: number): string {
  const out: string[] = []
  for (const b of HERRINGBONE) {
    const x = b.x * HB_W
    const y = b.y * HB_W
    const w = b.w * HB_W
    const h = b.h * HB_W
    // Tone depends on orientation and the (periodic) position class, so wrapped blocks match.
    // The tile repeats every HB_N = 2k cells, so the class must repeat every k cells.
    const t = (b.horizontal ? 0.05 : -0.06) + (mod(b.n, HB_K) - (HB_K - 1) / 2) * 0.012
    out.push(tint(x, y, w, h, t))
    // Faint grain along the long side of the block.
    if (b.horizontal) out.push(path(`M${f(x + 3)} ${f(y + 6)} l ${w - 6} 0`, 0.35, INK, 0.06))
    else out.push(path(`M${f(x + 6)} ${f(y + 3)} l 0 ${h - 6}`, 0.35, INK, 0.06))
    out.push(
      `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" fill="none" stroke="${DARK}" stroke-opacity="0.38" stroke-width="${f(s)}" />`,
    )
    // Light bevel on the top and left edges.
    out.push(line(x + s, y + s, x + w - s, y + s, s * 0.7, INK, 0.09))
    out.push(line(x + s, y + s, x + s, y + h - s, s * 0.7, INK, 0.09))
  }
  return out.join('')
}

// ---------- tile: 60 x 60 = 2 x 2 tiles of 30 cm ----------
const TILE = 30
const TILE_TINTS = [0.025, -0.035, -0.02, 0.04]

function tileInner(s: number): string {
  const out: string[] = []
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 2; c++) {
      const x = c * TILE
      const y = r * TILE
      out.push(tint(x, y, TILE, TILE, TILE_TINTS[r * 2 + c]))
      // Inner bevel: light top and left, dark bottom and right.
      out.push(line(x + s * 1.6, y + s * 1.6, x + TILE - s * 1.6, y + s * 1.6, s * 0.8, INK, 0.1))
      out.push(line(x + s * 1.6, y + s * 1.6, x + s * 1.6, y + TILE - s * 1.6, s * 0.8, INK, 0.1))
      out.push(line(x + s * 1.6, y + TILE - s * 1.6, x + TILE - s * 1.6, y + TILE - s * 1.6, s * 0.8, DARK, 0.12))
      out.push(line(x + TILE - s * 1.6, y + s * 1.6, x + TILE - s * 1.6, y + TILE - s * 1.6, s * 0.8, DARK, 0.12))
    }
  }
  // Grout lines (at 0, 30, 60: the 0 and 60 lines meet across the tile edge).
  for (let i = 0; i <= 2; i++) {
    out.push(line(0, i * TILE, 2 * TILE, i * TILE, s * 1.7, DARK, 0.45))
    out.push(line(i * TILE, 0, i * TILE, 2 * TILE, s * 1.7, DARK, 0.45))
  }
  return out.join('')
}

// ---------- stone: 90 x 60, three rows of ashlar slabs of different sizes ----------
// The layout is designed on a 120 x 80 grid and drawn at STONE_SCALE (0.75), so the tile is 90 x 60 cm.
const STONE_SCALE = 0.75
const STONE_ROWS: { y: number; h: number; cuts: number[]; tints: number[] }[] = [
  { y: 0, h: 26, cuts: [0, 40, 90, 120], tints: [0.04, -0.05, 0.02] },
  { y: 26, h: 28, cuts: [0, 25, 70, 120], tints: [-0.04, 0.05, -0.02] },
  { y: 54, h: 26, cuts: [0, 55, 90, 120], tints: [0.03, -0.045, 0.05] },
]
const STONE_SPECKS: [number, number, number, number][] = [
  [8, 6, 0.5, 0.12], [22, 17, 0.4, 0.1], [51, 9, 0.5, 0.1], [67, 20, 0.4, 0.12], [105, 7, 0.5, 0.1],
  [12, 36, 0.5, 0.1], [40, 46, 0.4, 0.12], [58, 33, 0.5, 0.1], [88, 40, 0.5, 0.12], [112, 48, 0.4, 0.1],
  [18, 66, 0.5, 0.1], [47, 73, 0.4, 0.12], [72, 62, 0.5, 0.1], [98, 70, 0.5, 0.12], [115, 60, 0.4, 0.1],
]

function stoneInner(s: number): string {
  const out: string[] = []
  const sc = (n: number) => n * STONE_SCALE
  for (const row of STONE_ROWS) {
    for (let i = 0; i < row.tints.length; i++) {
      out.push(tint(sc(row.cuts[i]), sc(row.y), sc(row.cuts[i + 1] - row.cuts[i]), sc(row.h), row.tints[i]))
    }
  }
  for (const [x, y, r, op] of STONE_SPECKS) out.push(dot(sc(x), sc(y), sc(r), x % 2 < 1 ? INK : DARK, op))
  for (const row of STONE_ROWS) {
    for (const x of row.cuts) out.push(line(sc(x), sc(row.y), sc(x), sc(row.y + row.h), s * 1.5, DARK, 0.42))
    out.push(line(0, sc(row.y), sc(120), sc(row.y), s * 1.5, DARK, 0.42))
    // Light edge under each mortar joint.
    out.push(line(0, sc(row.y) + s * 1.2, sc(120), sc(row.y) + s * 1.2, s * 0.7, INK, 0.07))
  }
  out.push(line(0, sc(80), sc(120), sc(80), s * 1.5, DARK, 0.42))
  return out.join('')
}

// ---------- carpet: 12 x 12 woven loop pile ----------
// The weave is designed on a 24 x 24 grid and drawn at CARPET_SCALE (0.5), so the tile is 12 x 12 cm.
const CARPET_SCALE = 0.5

function carpetInner(): string {
  const out: string[] = []
  const sc = (n: number) => n * CARPET_SCALE
  const span = sc(24)
  for (let i = 0; i < 8; i++) {
    const p = sc(i * 3 + 1.5)
    out.push(line(0, p, span, p, 0.7, i % 2 ? DARK : INK, i % 2 ? 0.07 : 0.05))
    out.push(line(p, 0, p, span, 0.7, i % 2 ? INK : DARK, i % 2 ? 0.04 : 0.06))
  }
  // Slub lines: short, thicker fibres.
  out.push(line(sc(2), sc(7.5), sc(9), sc(7.5), 0.5, INK, 0.1))
  out.push(line(sc(14), sc(16.5), sc(21), sc(16.5), 0.5, DARK, 0.12))
  out.push(line(sc(19.5), sc(2), sc(19.5), sc(6.5), 0.5, INK, 0.09))
  out.push(line(sc(6.5), sc(17), sc(6.5), sc(22), 0.5, DARK, 0.1))
  // Micro-stipple.
  const dots: [number, number][] = [[1, 2], [5, 11], [10, 4], [12, 13], [17, 8], [22, 20], [8, 21], [20, 12], [3, 16], [15, 1]]
  dots.forEach(([x, y], i) => out.push(dot(sc(x), sc(y), sc(0.3), i % 2 ? DARK : INK, 0.14)))
  return out.join('')
}

export const PATTERN_DEFS: Record<Exclude<FloorPattern, 'solid'>, PatternDef> = {
  wood: { w: WOOD_W, h: 3 * WOOD_PLANK_H, inner: woodInner },
  parquet: { w: HB_W * HB_N, h: HB_W * HB_N, inner: parquetInner },
  tile: { w: 2 * TILE, h: 2 * TILE, inner: tileInner },
  stone: { w: 90, h: 60, inner: stoneInner },
  carpet: { w: 12, h: 12, inner: carpetInner },
}

export const patternId = (roomId: string, scope = 'fp'): string => `${scope}-${roomId.replace(/[^A-Za-z0-9_-]/g, '_')}`

export const isPatterned = (p: FloorPattern | undefined): p is Exclude<FloorPattern, 'solid'> => !!p && p !== 'solid'

/** SVG `patternTransform` value for a rotation in degrees, or undefined when there is none. */
export function patternTransformOf(angleDeg?: number): string | undefined {
  if (!angleDeg || !Number.isFinite(angleDeg)) return undefined
  return `rotate(${angleDeg})`
}

/**
 * Full <pattern> element as a string (used by the export). `stroke` is the line width in cm.
 * With `opaqueBase` (Design mode) the floor is DESIGN_FLOOR_BASE plus the faded room colour; otherwise
 * it is the room colour at PLAN_FLOOR_OPACITY.
 */
export function patternSvg(
  id: string,
  p: Exclude<FloorPattern, 'solid'>,
  fill: string,
  stroke: number,
  angleDeg = 0,
  opts?: { opaqueBase?: boolean },
): string {
  const d = PATTERN_DEFS[p]
  const transform = patternTransformOf(angleDeg)
  const base = opts?.opaqueBase
    ? `<rect width="${d.w}" height="${d.h}" fill="${DESIGN_FLOOR_BASE}" />` +
      `<rect width="${d.w}" height="${d.h}" fill="${fill}" fill-opacity="${DESIGN_FLOOR_TINT_OPACITY}" />`
    : `<rect width="${d.w}" height="${d.h}" fill="${fill}" fill-opacity="${PLAN_FLOOR_OPACITY}" />`
  return `<pattern id="${id}" width="${d.w}" height="${d.h}" patternUnits="userSpaceOnUse"${transform ? ` patternTransform="${transform}"` : ''}>` +
    `${base}${d.inner(stroke)}</pattern>`
}
