// Simple "middle-ground" 3D furniture shapes (pure TS: no Three.js, no React, no DOM).
// An item becomes a few basic parts (box, rounded box, cylinder) in item-local cm:
//   x along widthCm, y up from the floor (rugs include the rug lift), z along depthCm (-z is the 2D front).
// Every part is clamped inside the item bounding box, so the bounds of the item never grow.
// Colours are derived only from item.color (plus a fixed pale blue for shower glass).

import { FURNITURE_MODELS, type FurnitureItem, type FurnitureModel } from '../../model/types'

export type FurniturePartKind = 'box' | 'roundedBox' | 'cylinder'

export type FurniturePartData = {
  kind: FurniturePartKind
  /** Centre of the part, item-local cm. */
  cx: number
  cy: number
  cz: number
  /** Size along x, y, z. A cylinder has its axis along y; its footprint is sx by sz (an ellipse when they differ). */
  sx: number
  sy: number
  sz: number
  /** roundedBox only: [top-left, top-right, bottom-right, bottom-left] radii (same order as the item). */
  cornerRadiiCm?: [number, number, number, number]
  /** Turn about the x axis in radians (a cylinder lying down for a washing machine door). */
  rotationX?: number
  /**
   * Turn about the vertical axis in radians (three.js rotateY: +x turns towards -z), applied after
   * rotationX. Used by the spokes of a star base. Not used together with rotationX.
   */
  rotationY?: number
  color: string
  /** Glass: drawn see-through. */
  translucent?: boolean
}

/** The 3D model kinds. Same list as FURNITURE_MODELS of the data model. */
export type FurnitureArchetype = FurnitureModel

/** Same values as RUG_MAX_HEIGHT_CM / RUG_LIFT_CM in buildScene.ts (not imported: buildScene imports this file). */
const RUG_MAX_HEIGHT = 2
const RUG_LIFT = 0.5
const GLASS_COLOR = '#9fd3ff'
/** Thickness of a front panel (door, drawer), cm. */
const FR = 1.2

// ---------- colour shades ----------

const HEX = /^#[0-9a-fA-F]{6}$/
const FALLBACK_COLOR = '#8a8f96'

function parse(hex: string): [number, number, number] {
  const h = typeof hex === 'string' && HEX.test(hex) ? hex : FALLBACK_COLOR
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
}
function toHex(r: number, g: number, b: number): string {
  const c = (n: number) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`
}

/** Scale a colour: k < 1 darkens, k > 1 lightens towards white. */
export function shade(hex: string, k: number): string {
  const [r, g, b] = parse(hex)
  if (k <= 1) return toHex(r * k, g * k, b * k)
  const t = Math.min(1, k - 1)
  return toHex(r + (255 - r) * t, g + (255 - g) * t, b + (255 - b) * t)
}

export type Shades = { base: string; light: string; dark: string; deep: string; metal: string }

/** Five shades from one colour. `metal` is a light, mostly desaturated version. */
export function deriveShades(hex: string): Shades {
  const [r, g, b] = parse(hex)
  const base = toHex(r, g, b)
  const lum = 0.299 * r + 0.587 * g + 0.114 * b
  const m = (v: number) => (v * 0.35 + lum * 0.65) * 1.35
  return { base, light: shade(base, 1.22), dark: shade(base, 0.72), deep: shade(base, 0.55), metal: toHex(m(r), m(g), m(b)) }
}

// ---------- classification ----------

/** Archetype of each built-in preset id. An item with one of these ids keeps its 3D model after a rename. */
export const PRESET_ARCHETYPE: Readonly<Record<string, FurnitureArchetype>> = {
  bed: 'bed', 'single-bed': 'bed', 'bed-140': 'bed', 'bed-180': 'bed', 'baby-cot': 'cot', 'bedside-table': 'pedestal',
  sofa: 'sofa', armchair: 'sofa', 'sofa-2': 'sofa', 'corner-sofa': 'cornerSofa', 'dining-chair': 'chair', 'office-chair': 'officeChair',
  'dining-table': 'table', 'round-table': 'roundTable', 'coffee-table': 'table', desk: 'desk', 'dining-table-4': 'table', 'side-table': 'roundTable',
  wardrobe: 'tallStorage', bookshelf: 'bookshelf', 'chest-of-drawers': 'lowStorage', sideboard: 'lowStorage', 'tv-unit': 'tvUnit', 'shoe-cabinet': 'tallStorage',
  'kitchen-counter': 'counter', 'base-cabinet-60': 'counter', 'sink-unit': 'sink', cooker: 'cooker', dishwasher: 'appliance', fridge: 'appliance',
  'american-fridge': 'americanFridge', 'kitchen-island': 'counter', bathtub: 'bathtub', 'shower-tray': 'shower', toilet: 'toilet',
  washbasin: 'basin', 'double-washbasin': 'basin', 'washing-machine': 'drumAppliance', dryer: 'drumAppliance',
  rug: 'rug', 'rug-160': 'rug', 'round-rug': 'rug',
}

/** True when v is one of the 3D model kinds. */
export function isFurnitureModel(v: unknown): v is FurnitureModel {
  return typeof v === 'string' && (FURNITURE_MODELS as readonly string[]).includes(v)
}

/**
 * Classify by the model the user chose first, then by preset id (a built-in preset keeps its model after a rename), then by name
 * (order matters), then by simple geometry. Unknown items give 'box'.
 */
export function furnitureArchetype(
  f: Pick<FurnitureItem, 'name'> & { shape?: FurnitureItem['shape']; presetId?: string; model?: FurnitureItem['model'] },
  heightCm: number,
): FurnitureArchetype {
  if (isFurnitureModel(f.model)) return f.model
  const fromPreset = f.presetId !== undefined && Object.prototype.hasOwnProperty.call(PRESET_ARCHETYPE, f.presetId) ? PRESET_ARCHETYPE[f.presetId] : undefined
  if (fromPreset) return fromPreset === 'table' && f.shape === 'circle' ? 'roundTable' : fromPreset
  const n = (f.name ?? '').toLowerCase()
  const has = (...words: string[]) => words.some((w) => new RegExp(`\\b${w}s?\\b`).test(n))
  if (has('rug')) return 'rug'
  if (has('bedside', 'nightstand')) return 'pedestal'
  if (has('baby cot', 'cot', 'crib')) return 'cot'
  if (has('bed')) return 'bed'
  if (has('corner sofa')) return 'cornerSofa'
  if (has('sofa', 'armchair', 'couch')) return 'sofa'
  if (has('office chair')) return 'officeChair'
  if (has('chair')) return 'chair'
  if (has('round table', 'side table')) return 'roundTable'
  if (has('desk')) return 'desk'
  if (has('table')) return f.shape === 'circle' ? 'roundTable' : 'table'
  if (has('wardrobe', 'shoe cabinet')) return 'tallStorage'
  if (has('bookshelf', 'bookcase')) return 'bookshelf'
  if (has('tv unit', 'tv stand', 'tv cabinet')) return 'tvUnit'
  if (has('chest of drawers', 'sideboard')) return 'lowStorage'
  if (has('sink unit')) return 'sink'
  if (has('kitchen counter', 'base cabinet', 'kitchen island')) return 'counter'
  if (has('cooker')) return 'cooker'
  if (has('american fridge')) return 'americanFridge'
  if (has('washing machine', 'dryer')) return 'drumAppliance'
  if (has('fridge', 'dishwasher')) return 'appliance'
  if (has('bathtub')) return 'bathtub'
  if (has('shower')) return 'shower'
  if (has('toilet')) return 'toilet'
  if (has('double washbasin', 'washbasin')) return 'basin'
  if (heightCm <= RUG_MAX_HEIGHT) return 'rug'
  return 'box'
}

// ---------- part building ----------

type Radii = [number, number, number, number]
type Ctx = {
  W: number; D: number; H: number; lift: number; flipX: boolean; flipY: boolean; parts: FurniturePartData[]
  /** The item's own corner radii (rect tables use them for a rounded top). */
  radii: Radii
}
type Extra = { radii?: Radii; rotationX?: number; rotationY?: number; translucent?: boolean }

const MIN_SIZE = 0.2
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const pos = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0)

/** Add a part. cx/cz are in unflipped item-local cm, y0 is the bottom above the item floor. Mirrors, then clamps inside the box. */
function add(c: Ctx, kind: FurniturePartKind, cx: number, y0: number, cz: number, sx: number, sy: number, sz: number, color: string, extra: Extra = {}) {
  const lying = !!extra.rotationX && Math.abs(Math.sin(extra.rotationX)) > 0.5
  // Extents along the item axes (a lying cylinder swaps its y and z sizes).
  let ex = Math.min(c.W, Math.max(MIN_SIZE, sx))
  const ey = Math.min(c.H, Math.max(MIN_SIZE, lying ? sz : sy))
  let ez = Math.min(c.D, Math.max(MIN_SIZE, lying ? sy : sz))
  // A turn about y: one mirror reverses it, and the turned footprint must fit inside the box.
  const yaw = extra.rotationY ? (c.flipX !== c.flipY ? -extra.rotationY : extra.rotationY) : 0
  let fx = ex, fz = ez
  if (yaw) {
    const cs = Math.abs(Math.cos(yaw)), sn = Math.abs(Math.sin(yaw))
    fx = cs * ex + sn * ez
    fz = sn * ex + cs * ez
    const k = Math.min(1, c.W / fx, c.D / fz)
    ex *= k; ez *= k; fx *= k; fz *= k
  }
  const hw = c.W / 2, hd = c.D / 2
  const px = clamp(c.flipX ? -cx : cx, -hw + fx / 2, hw - fx / 2)
  const pz = clamp(c.flipY ? -cz : cz, -hd + fz / 2, hd - fz / 2)
  const by = clamp(y0, 0, c.H - ey)
  const part: FurniturePartData = {
    kind, cx: px, cy: c.lift + by + ey / 2, cz: pz,
    sx: ex, sy: lying ? ez : ey, sz: lying ? ey : ez, color,
  }
  if (extra.radii) {
    const max = Math.min(ex, ez) / 2
    part.cornerRadiiCm = extra.radii.map((r) => clamp(r, 0, max)) as Radii
  }
  if (extra.rotationX) part.rotationX = extra.rotationX
  if (yaw) part.rotationY = yaw
  if (extra.translucent) part.translucent = true
  c.parts.push(part)
}

const box = (c: Ctx, cx: number, y0: number, cz: number, sx: number, sy: number, sz: number, color: string, extra?: Extra) =>
  add(c, 'box', cx, y0, cz, sx, sy, sz, color, extra)
const cyl = (c: Ctx, cx: number, y0: number, cz: number, sx: number, sy: number, sz: number, color: string, extra?: Extra) =>
  add(c, 'cylinder', cx, y0, cz, sx, sy, sz, color, extra)
const rbox = (c: Ctx, cx: number, y0: number, cz: number, sx: number, sy: number, sz: number, color: string, radii: Radii, extra?: Extra) =>
  add(c, 'roundedBox', cx, y0, cz, sx, sy, sz, color, { ...extra, radii })

/** Box between two x, y, z ranges (unflipped item-local). */
const span = (c: Ctx, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, color: string) =>
  box(c, (x0 + x1) / 2, y0, (z0 + z1) / 2, x1 - x0, y1 - y0, z1 - z0, color)

function bed(c: Ctx, s: Shades) {
  const { W, D, H } = c
  const fh = H * 0.4, mh = H * 0.32, hb = 6
  span(c, -W / 2, W / 2, 0, fh, -D / 2, D / 2 - hb, s.dark)
  span(c, -W / 2 + 2, W / 2 - 2, fh, fh + mh, -D / 2 + 1, D / 2 - hb, s.light)
  box(c, 0, 0, D / 2 - hb / 2, W, H, hb, s.deep)
  const top = fh + mh, ph = Math.min(9, H - top), pz = D / 2 - hb - 1 - Math.min(35, D * 0.18) / 2
  const pillow = shade(s.base, 1.45), psz = Math.min(35, D * 0.18)
  if (W >= 110) {
    const pw = Math.min(65, (W - 8) / 2 - 2)
    box(c, -(pw / 2 + 2), top, pz, pw, ph, psz, pillow)
    box(c, pw / 2 + 2, top, pz, pw, ph, psz, pillow)
  } else {
    box(c, 0, top, pz, Math.min(60, W - 12), ph, psz, pillow)
  }
}

function cot(c: Ctx, s: Shades) {
  const { W, D, H } = c
  const t = 3
  box(c, 0, H * 0.2, 0, W - 2 * t, 8, D - 2 * t, s.light)
  box(c, -(W / 2 - t / 2), 0, 0, t, H, D, s.dark)
  box(c, W / 2 - t / 2, 0, 0, t, H, D, s.dark)
  box(c, 0, 0, -(D / 2 - t / 2), W - 2 * t, H, t, s.dark)
  box(c, 0, 0, D / 2 - t / 2, W - 2 * t, H, t, s.dark)
}

function sofa(c: Ctx, s: Shades) {
  const { W, D, H } = c
  const sh = H * 0.38, bt = Math.min(24, D * 0.26), aw = clamp(W * 0.1, 10, 18)
  span(c, -W / 2 + aw, W / 2 - aw, 0, sh, -D / 2, D / 2 - bt, s.dark)
  box(c, 0, 0, D / 2 - bt / 2, W, H, bt, s.base)
  box(c, -(W / 2 - aw / 2), 0, -bt / 2, aw, H * 0.65, D - bt, s.base)
  box(c, W / 2 - aw / 2, 0, -bt / 2, aw, H * 0.65, D - bt, s.base)
  const n = W >= 200 ? 3 : W >= 130 ? 2 : 1, iw = W - 2 * aw, cw = iw / n
  for (let i = 0; i < n; i++) {
    span(c, -iw / 2 + i * cw + 0.5, -iw / 2 + (i + 1) * cw - 0.5, sh, sh + H * 0.12, -D / 2 + 1, D / 2 - bt, s.light)
  }
}

function cornerSofa(c: Ctx, s: Shades) {
  const { W, D, H } = c
  const sh = H * 0.38, ds = clamp(D * 0.56, 40, 100), bt = Math.min(22, ds * 0.3)
  const cw = clamp(W * 0.36, 40, 100), aw = clamp(W * 0.065, 8, 18)
  const cushion = sh + H * 0.12
  // Main seat along the back, then the chaise running forward along +x.
  // Seats stop at the arms and the back so no two solids share a coplanar face.
  span(c, -W / 2 + aw, W / 2 - aw, 0, sh, D / 2 - ds, D / 2 - bt, s.dark)
  span(c, W / 2 - cw, W / 2 - aw, 0, sh, -D / 2, D / 2 - ds, s.dark)
  span(c, -W / 2, W / 2, 0, H, D / 2 - bt, D / 2, s.base)
  span(c, -W / 2, -W / 2 + aw, 0, H * 0.65, D / 2 - ds, D / 2 - bt, s.base)
  span(c, W / 2 - aw, W / 2, 0, H * 0.65, -D / 2, D / 2 - bt, s.base)
  const x0 = -W / 2 + aw, x1 = W / 2 - cw
  const n = x1 - x0 >= 110 ? 2 : 1, w = (x1 - x0) / n
  for (let i = 0; i < n; i++) span(c, x0 + i * w + 0.5, x0 + (i + 1) * w - 0.5, sh, cushion, D / 2 - ds + 1, D / 2 - bt, s.light)
  span(c, W / 2 - cw + 0.5, W / 2 - aw, sh, cushion, -D / 2 + 1, D / 2 - ds - 0.5, s.light)
}

function chair(c: Ctx, s: Shades) {
  const { W, D, H } = c
  const sy0 = H * 0.45, st = 5, leg = clamp(Math.min(W, D) * 0.08, 2.5, 5)
  box(c, 0, sy0, 0, W, st, D, s.base)
  box(c, 0, sy0 + st, D / 2 - 2, W, H - sy0 - st, 4, s.light)
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    box(c, sx * (W / 2 - leg / 2 - 1), 0, sz * (D / 2 - leg / 2 - 1), leg, sy0, leg, s.dark)
  }
}

/** Size along x and z of a part seen from above (a turned part covers more). */
export function partFootprint(p: Pick<FurniturePartData, 'sx' | 'sy' | 'sz' | 'rotationX' | 'rotationY'>): { x: number; z: number } {
  const lying = !!p.rotationX && Math.abs(Math.sin(p.rotationX)) > 0.5
  const ez = lying ? p.sy : p.sz
  if (!p.rotationY) return { x: p.sx, z: ez }
  const cs = Math.abs(Math.cos(p.rotationY)), sn = Math.abs(Math.sin(p.rotationY))
  return { x: cs * p.sx + sn * ez, z: sn * p.sx + cs * ez }
}

/**
 * Swivel desk chair: 5-spoke star base on casters, gas column, padded seat, curved-look backrest
 * on a spine, and two armrests (post + pad). The front is -z.
 */
function officeChair(c: Ctx, s: Shades) {
  const { W, D, H } = c
  const m = Math.min(W, D)
  const caster = clamp(m * 0.08, 2, 6) // caster wheel diameter and height
  const R = m / 2 - caster / 2 - 0.5 // centre of a caster, from the chair axis
  const spokeW = clamp(m * 0.06, 1.5, 5), spokeH = clamp(H * 0.03, 1.5, 4)
  const baseY = caster * 0.8
  const hub = clamp(m * 0.12, 3, 9)
  // Star base: 5 spokes, one pointing to the back (+z), so no spoke sits under the feet.
  for (let k = 0; k < 5; k++) {
    const phi = Math.PI / 2 + (k * 2 * Math.PI) / 5 // angle in the x-z plane (0 = +x, PI/2 = +z)
    const len = R
    const dx = Math.cos(phi), dz = Math.sin(phi)
    box(c, dx * len / 2, baseY, dz * len / 2, len, spokeH, spokeW, s.deep, { rotationY: -phi })
    cyl(c, dx * R, 0, dz * R, caster, caster, caster, s.deep)
  }
  cyl(c, 0, baseY, 0, hub, spokeH + 1, hub, s.deep)

  const seatY = H * 0.42, seatT = clamp(H * 0.07, 3, 9)
  const seatW = W * 0.72, seatD = D * 0.68, seatZ = -D * 0.03
  cyl(c, 0, baseY, 0, clamp(m * 0.08, 2, 6), seatY - baseY, clamp(m * 0.08, 2, 6), s.metal)
  const sr = Math.min(seatW, seatD) * 0.18
  rbox(c, 0, seatY, seatZ, seatW, seatT, seatD, s.base, [sr, sr, sr, sr])

  // Backrest on a spine at the back of the seat.
  const backT = clamp(D * 0.08, 3, 7), backZ = seatZ + seatD / 2 + backT / 2 - 1
  const backY0 = seatY + seatT + clamp(H * 0.1, 4, 14)
  box(c, 0, seatY, backZ + backT / 2, clamp(W * 0.1, 3, 7), backY0 - seatY + 4, 3, s.metal)
  const br = W * 0.08
  rbox(c, 0, backY0, backZ, W * 0.66, H - backY0, backT, s.light, [br, br, br, br])

  // Armrests: a post on each side of the seat and a pad on top.
  const armY = seatY + seatT + clamp(H * 0.2, 8, 24)
  const padW = clamp(W * 0.08, 3, 7), padD = seatD * 0.6, padT = clamp(H * 0.025, 2, 4)
  const armX = Math.min(W / 2 - padW / 2, seatW / 2 + padW / 2)
  for (const sx of [-1, 1]) {
    box(c, sx * armX, seatY + seatT / 2, seatZ + seatD * 0.1, padW * 0.6, armY - seatY - seatT / 2, padW * 0.6, s.metal)
    box(c, sx * armX, armY, seatZ + seatD * 0.05, padW, padT, padD, s.dark)
  }
}

function table(c: Ctx, s: Shades) {
  const { W, D, H } = c
  const t = Math.min(4, H * 0.2), leg = clamp(Math.min(W, D) * 0.07, 3, 7)
  const r = clamp(Math.max(...c.radii.map(pos)), 0, Math.min(W, D) / 2)
  // The leg's outer corner must stay inside the curved corner: inset by about 0.3 * r more.
  const ix = leg / 2 + 3 + (r > 0 ? r * 0.3 : 0)
  if (r > 0) rbox(c, 0, H - t, 0, W, t, D, s.base, c.radii)
  else box(c, 0, H - t, 0, W, t, D, s.base)
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    box(c, sx * (W / 2 - ix), 0, sz * (D / 2 - ix), leg, H - t, leg, s.dark)
  }
}

function desk(c: Ctx, s: Shades) {
  const { W, D, H } = c
  const t = Math.min(4, H * 0.1), p = 3
  box(c, 0, H - t, 0, W, t, D, s.base)
  box(c, -(W / 2 - p / 2 - 2), 0, 0, p, H - t, D - 6, s.dark)
  box(c, W / 2 - p / 2 - 2, 0, 0, p, H - t, D - 6, s.dark)
  box(c, 0, H - t - H * 0.3, D / 2 - 5, W - 2 * (p + 2), H * 0.3, 2, s.deep)
}

function roundTable(c: Ctx, s: Shades) {
  const { W, D, H } = c
  const t = 3.5, ft = 2.5
  cyl(c, 0, H - t, 0, W, t, D, s.base)
  const long = Math.max(W, D), short = Math.min(W, D)
  if (long > 1.35 * short) {
    // Oval: two pedestals along the long axis, each with a round foot disc.
    const alongX = W >= D
    const off = long * 0.24
    const col = Math.max(4, short * 0.12), foot = short * 0.5
    for (const k of [-1, 1]) {
      const px = alongX ? k * off : 0, pz = alongX ? 0 : k * off
      cyl(c, px, ft, pz, col, H - t - ft, col, s.dark)
      cyl(c, px, 0, pz, foot, ft, foot, s.dark)
    }
    return
  }
  cyl(c, 0, ft, 0, Math.max(4, W * 0.12), H - t - ft, Math.max(4, D * 0.12), s.dark)
  cyl(c, 0, 0, 0, W * 0.5, ft, D * 0.5, s.dark)
}

function pedestal(c: Ctx, s: Shades) {
  const { W, D, H } = c
  const t = 3
  span(c, -W / 2 + 2, W / 2 - 2, 0, H - t, -D / 2 + FR, D / 2 - 2, s.base)
  box(c, 0, H - t, 0, W, t, D, s.light)
  box(c, 0, (H - t) * 0.45, -D / 2 + FR / 2, W - 8, (H - t) * 0.4, FR, s.dark)
}

function tallStorage(c: Ctx, s: Shades) {
  const { W, D, H } = c
  const ph = Math.min(8, H * 0.06)
  box(c, 0, 0, FR / 2 + 1.5, W - 6, ph, D - FR - 3, s.dark)
  span(c, -W / 2, W / 2, ph, H, -D / 2 + FR, D / 2, s.base)
  const dh = H - ph - 3
  span(c, -W / 2 + 1.5, -0.5, ph + 1.5, ph + 1.5 + dh, -D / 2, -D / 2 + FR, s.light)
  span(c, 0.5, W / 2 - 1.5, ph + 1.5, ph + 1.5 + dh, -D / 2, -D / 2 + FR, s.light)
}

function bookshelf(c: Ctx, s: Shades) {
  const { W, D, H } = c
  box(c, 0, 0, FR / 2, W, H, D - FR, s.dark)
  const n = H >= 140 ? 4 : 3
  for (let i = 1; i <= n; i++) box(c, 0, (H * i) / (n + 1) - 1.5, -D / 2 + FR / 2, W - 6, 3, FR, s.light)
}

/** Low cabinet body of height `hs` (drawer fronts or door fronts). */
function lowStorageBody(c: Ctx, s: Shades, hs: number) {
  const { W, D } = c
  const ph = Math.min(6, hs * 0.08)
  box(c, 0, 0, FR / 2 + 1.5, W - 6, ph, D - FR - 3, s.dark)
  span(c, -W / 2, W / 2, ph, hs, -D / 2 + FR, D / 2, s.base)
  const bh = hs - ph
  if (W < 100) {
    const n = bh >= 60 ? 4 : 3, h = bh / n
    for (let i = 0; i < n; i++) span(c, -W / 2 + 2, W / 2 - 2, ph + i * h + 1, ph + (i + 1) * h - 1, -D / 2, -D / 2 + FR, s.light)
  } else {
    const n = W >= 150 ? 4 : 3, w = W / n
    for (let i = 0; i < n; i++) span(c, -W / 2 + i * w + 1.5, -W / 2 + (i + 1) * w - 1.5, ph + 2, hs - 2, -D / 2, -D / 2 + FR, s.light)
  }
}

function lowStorage(c: Ctx, s: Shades) {
  lowStorageBody(c, s, c.H)
}

/** TV unit: a low cabinet with a flat-screen TV standing on top. */
function tvUnit(c: Ctx, s: Shades) {
  const { W, D, H } = c
  // Cabinet height: a real stand is about 50 cm; a short item gives the cabinet a bit less than half.
  const sh = H >= 80 ? Math.min(50, H * 0.42) : H * 0.45
  lowStorageBody(c, s, sh)
  const gap = 8 // foot + neck under the panel
  const ph = Math.min(H - sh - gap, (W * 0.9) * 9 / 16)
  if (ph < 10) return
  const tw = ph * 16 / 9
  const frame = shade(s.base, 0.18)
  const screen = shade(s.base, 0.08)
  const y0 = sh + gap
  // Foot plate on the cabinet top, and a neck up to the panel.
  box(c, 0, sh, 0, Math.min(tw * 0.35, 40), 1.5, Math.min(D * 0.5, 22), frame)
  box(c, 0, sh + 1.5, 0, 6, gap - 1.5 + 2, 3, frame)
  // Panel (bezel), 4 cm deep, centred in depth.
  box(c, 0, y0, 0, tw, ph, 4, frame)
  // Screen face on the front (-z) side of the panel.
  box(c, 0, y0 + 1, -2.2, tw - 2, ph - 2, 0.4, screen)
}

/** Kitchen carcass: toe-kick plinth, cabinet, worktop. `hc` is the total height of the counter. */
function counterBody(c: Ctx, s: Shades, hc: number) {
  const { W, D } = c
  const ph = Math.min(8, hc * 0.1), wt = 4
  box(c, 0, 0, (FR + 1) / 2, W - 4, ph, D - FR - 5, s.dark)
  span(c, -W / 2, W / 2, ph, hc - wt, -D / 2 + FR, D / 2, s.base)
  box(c, 0, hc - wt, 0, W, wt, D, s.light)
}

function counter(c: Ctx, s: Shades) {
  counterBody(c, s, c.H)
}

function sink(c: Ctx, s: Shades) {
  const { W, D, H } = c
  const hc = H - 10
  counterBody(c, s, hc)
  rbox(c, 0, hc, -D * 0.05, W * 0.55, 1.5, D * 0.5, s.deep, [4, 4, 4, 4])
  cyl(c, 0, hc, D / 2 - 5, 3, 10, 3, s.metal)
}

function cooker(c: Ctx, s: Shades) {
  const { W, D, H } = c
  span(c, -W / 2, W / 2, 0, H - 3, -D / 2 + FR, D / 2, s.base)
  box(c, 0, H * 0.18, -D / 2 + FR / 2, W - 8, H * 0.5, FR, s.dark)
  box(c, 0, H - 3, 0, W, 2, D, s.dark)
  const bd = Math.min(W, D) * 0.26
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) cyl(c, sx * W * 0.22, H - 1, sz * D * 0.22, bd, 1, bd, s.metal)
}

function appliance(c: Ctx, s: Shades) {
  const { W, D, H } = c
  span(c, -W / 2, W / 2, 0, H, -D / 2 + FR, D / 2, s.base)
  if (H >= 140) {
    const sp = H * 0.68
    span(c, -W / 2 + 1, W / 2 - 1, 1, sp - 1, -D / 2, -D / 2 + FR, s.light)
    span(c, -W / 2 + 1, W / 2 - 1, sp + 1, H - 1, -D / 2, -D / 2 + FR, s.light)
    box(c, 0, sp - 1, -D / 2 + FR * 0.75, W - 2, 2, FR / 2, s.dark)
  } else {
    span(c, -W / 2 + 1, W / 2 - 1, 1, H * 0.84, -D / 2, -D / 2 + FR, s.light)
    span(c, -W / 2 + 1, W / 2 - 1, H * 0.86, H - 1, -D / 2, -D / 2 + FR, s.dark)
  }
}

function drumAppliance(c: Ctx, s: Shades) {
  const { W, D, H } = c
  span(c, -W / 2, W / 2, 0, H, -D / 2 + FR, D / 2, s.base)
  span(c, -W / 2 + 1, W / 2 - 1, 1, H * 0.84, -D / 2 + FR / 2, -D / 2 + FR, s.light)
  span(c, -W / 2 + 1, W / 2 - 1, H * 0.86, H - 1, -D / 2, -D / 2 + FR, s.dark)
  const dd = Math.min(W, D) * 0.6
  cyl(c, 0, H * 0.42 - dd / 2, -D / 2 + FR / 2, dd, FR, dd, s.deep, { rotationX: Math.PI / 2 })
}

function americanFridge(c: Ctx, s: Shades) {
  const { W, D, H } = c
  span(c, -W / 2, W / 2, 0, H, -D / 2 + FR, D / 2, s.base)
  span(c, -W / 2 + 1, -1, 1, H - 1, -D / 2, -D / 2 + FR, s.light)
  span(c, 1, W / 2 - 1, 1, H - 1, -D / 2, -D / 2 + FR, s.light)
  box(c, 0, 1, -D / 2 + FR * 0.75, 2, H - 2, FR / 2, s.dark)
}

function bathtub(c: Ctx, s: Shades) {
  const { W, D, H } = c
  const lowH = H * 0.62, rimTop = H - 5, t = 7
  rbox(c, 0, 0, 0, W, lowH, D, s.base, [Math.min(14, D / 2), Math.min(14, D / 2), Math.min(14, D / 2), Math.min(14, D / 2)])
  rbox(c, 0, lowH, 0, W - 2 * t, 1.5, D - 2 * t, s.light, [8, 8, 8, 8])
  box(c, 0, lowH, -(D / 2 - t / 2), W, rimTop - lowH, t, s.base)
  box(c, 0, lowH, D / 2 - t / 2, W, rimTop - lowH, t, s.base)
  box(c, -(W / 2 - t / 2), lowH, 0, t, rimTop - lowH, D - 2 * t, s.base)
  box(c, W / 2 - t / 2, lowH, 0, t, rimTop - lowH, D - 2 * t, s.base)
  cyl(c, -(W / 2 - t / 2), rimTop, 0, 4.5, 5, 4.5, s.metal)
}

function shower(c: Ctx, s: Shades) {
  const { W, D, H } = c
  const tray = 6, gh = H - tray - 8
  box(c, 0, 0, 0, W, tray, D, s.light)
  box(c, 0, tray, D / 2 - 0.5, W, gh, 1, GLASS_COLOR, { translucent: true })
  box(c, W / 2 - 0.5, tray, -0.5, 1, gh, D - 1, GLASS_COLOR, { translucent: true })
  cyl(c, W / 2 - 15, H * 0.7, D / 2 - 15, 2.5, H * 0.3 - 2, 2.5, s.metal)
  cyl(c, W / 2 - 15, H - 2, D / 2 - 15, 10, 2, 10, s.metal)
}

function toilet(c: Ctx, s: Shades) {
  const { W, D, H } = c
  const cd = D * 0.22, bh = H * 0.45, bz = D - cd + 1
  box(c, 0, 0, D / 2 - cd / 2, W, H * 0.85, cd, s.light)
  cyl(c, 0, 0, -D / 2 + bz / 2, W * 0.95, bh, bz, s.base)
  cyl(c, 0, bh, -D / 2 + bz / 2, W * 0.9, 2.5, bz * 0.92, s.light)
}

function basin(c: Ctx, s: Shades) {
  const { W, D, H } = c
  const hc = H - 10
  counterBody(c, s, hc)
  const n = W >= 100 ? 2 : 1, w = W / n
  for (let i = 0; i < n; i++) {
    const x = -W / 2 + w * (i + 0.5)
    rbox(c, x, hc, -D * 0.05, w * 0.7, 1.5, D * 0.55, s.deep, [4, 4, 4, 4])
    cyl(c, x, hc, D / 2 - 5, 3, 10, 3, s.metal)
  }
}

/** Single-solid fallback: rounded box, plain box or cylinder, with the item's own colour and corners. */
function single(c: Ctx, shape: 'rect' | 'circle', radii: Radii, color: string) {
  const { W, D, H } = c
  if (shape === 'circle') cyl(c, 0, 0, 0, W, H, D, color)
  else if (radii.some((r) => r > 0)) rbox(c, 0, 0, 0, W, H, D, color, radii)
  else box(c, 0, 0, 0, W, H, D, color)
}

const BUILDERS: Partial<Record<FurnitureArchetype, (c: Ctx, s: Shades) => void>> = {
  bed, cot, sofa, cornerSofa, chair, officeChair, table, desk, roundTable, pedestal, tallStorage, bookshelf,
  lowStorage, tvUnit, counter, sink, cooker, appliance, drumAppliance, americanFridge, bathtub, shower, toilet, basin,
}

/**
 * The parts that make one furniture item, in item-local cm (see the file header). Never empty.
 * `cornerRadiiCm` are the item's own (already flipped) radii; they are used by the single-solid shapes.
 * `simplified` (many items in the scene) returns one solid per item.
 */
export function furnitureParts(
  f: FurnitureItem,
  heightCm: number,
  cornerRadiiCm: Radii,
  opts: { simplified?: boolean } = {},
): FurniturePartData[] {
  const H = pos(heightCm)
  const c: Ctx = {
    W: pos(f.widthCm), D: pos(f.depthCm), H,
    lift: H <= RUG_MAX_HEIGHT ? RUG_LIFT : 0,
    flipX: !!f.flipX, flipY: !!f.flipY, parts: [], radii: cornerRadiiCm,
  }
  const s = deriveShades(f.color)
  const kind = opts.simplified ? 'box' : furnitureArchetype(f, H)
  const build = BUILDERS[kind]
  if (build) build(c, s)
  else single(c, f.shape, cornerRadiiCm, s.base)
  if (c.parts.length === 0) single(c, f.shape, cornerRadiiCm, s.base)
  return c.parts
}
