// Procedural floor textures for the 3D Views mode. One canvas per (pattern, fill), drawn in cm units so the
// tile sizes match src/features/rooms/floorPatterns.ts. The caller builds floor UVs as (cm / tile size), so
// one UV unit is one tile and the texture repeats with RepeatWrapping.
import * as THREE from 'three'
import type { FloorPattern } from '../../model/types'
import { DEFAULT_PATTERN_FILL, DESIGN_FLOOR_BASE, PATTERN_DEFS, isPatterned } from '../rooms/floorPatterns'

/** Share of the room colour mixed into the dark floor base (the 2D Design mode uses 0.42; 3D needs more light). */
export const FLOOR_TINT_3D = 0.7

/** Tile size in cm of every non-solid pattern (same as the 2D patterns). */
export const FLOOR_TILE_CM: Record<Exclude<FloorPattern, 'solid'>, { w: number; h: number }> = {
  wood: { w: PATTERN_DEFS.wood.w, h: PATTERN_DEFS.wood.h },
  parquet: { w: PATTERN_DEFS.parquet.w, h: PATTERN_DEFS.parquet.h },
  tile: { w: PATTERN_DEFS.tile.w, h: PATTERN_DEFS.tile.h },
  stone: { w: PATTERN_DEFS.stone.w, h: PATTERN_DEFS.stone.h },
  carpet: { w: PATTERN_DEFS.carpet.w, h: PATTERN_DEFS.carpet.h },
  grass: { w: PATTERN_DEFS.grass.w, h: PATTERN_DEFS.grass.h },
}

const PX_PER_CM: Record<Exclude<FloorPattern, 'solid'>, number> = {
  wood: 4, parquet: 5, tile: 5, stone: 4, carpet: 10, grass: 6,
}

const INK = '#e2e8f0'
const DARK = '#000000'

/** Opaque base colour of a floor: DESIGN_FLOOR_BASE with the room colour mixed in. */
export function floorBaseColor(fill: string | undefined): THREE.Color {
  const c = new THREE.Color(DESIGN_FLOOR_BASE)
  try {
    c.lerp(new THREE.Color(fill ?? DEFAULT_PATTERN_FILL), FLOOR_TINT_3D)
  } catch {
    c.lerp(new THREE.Color(DEFAULT_PATTERN_FILL), FLOOR_TINT_3D)
  }
  return c
}

type Ctx = CanvasRenderingContext2D

const mod = (a: number, n: number) => ((a % n) + n) % n

function tintRect(ctx: Ctx, x: number, y: number, w: number, h: number, t: number) {
  if (t === 0) return
  ctx.fillStyle = t > 0 ? INK : DARK
  ctx.globalAlpha = Math.abs(t)
  ctx.fillRect(x, y, w, h)
  ctx.globalAlpha = 1
}

function seg(ctx: Ctx, x1: number, y1: number, x2: number, y2: number, lw: number, color: string, alpha: number) {
  ctx.strokeStyle = color
  ctx.globalAlpha = alpha
  ctx.lineWidth = lw
  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.lineTo(x2, y2)
  ctx.stroke()
  ctx.globalAlpha = 1
}

function rng(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), a | 1)
    t = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function drawWood(ctx: Ctx) {
  const H = 14, L = 140, offsets = [0, 47, 93]
  const tints = [0.05, -0.06, -0.03, 0.07, -0.08, 0.03]
  offsets.forEach((off, row) => {
    const y = row * H
    for (let k = -1; k < 3; k++) {
      const x = off + k * L
      const cls = mod(Math.round((x - off) / L), 2)
      tintRect(ctx, x, y, L, H, tints[row * 2 + cls])
      seg(ctx, x + 5, y + 5 + ((row * 2 + cls) % 3), x + 85, y + 5, 0.4, INK, 0.07)
      seg(ctx, x + 12, y + 9.5, x + 100, y + 9.5, 0.35, DARK, 0.09)
      seg(ctx, x, y, x, y + H, 0.45, DARK, 0.45)
    }
  })
  for (let r = 0; r <= offsets.length; r++) seg(ctx, 0, r * H, 280, r * H, 0.5, DARK, 0.45)
}

function drawParquet(ctx: Ctx) {
  const W = 8, K = 5, N = 2 * K
  for (let t = -3; t <= 3; t++) {
    for (let n = -20; n <= 20; n++) {
      const cx = n + N * t
      const cands = [
        { x: cx, y: n, w: K, h: 1, horizontal: true },
        { x: cx + K, y: n - K + 1, w: 1, h: K, horizontal: false },
      ]
      for (const b of cands) {
        if (!(b.x < N && b.x + b.w > 0 && b.y < N && b.y + b.h > 0)) continue
        const tone = (b.horizontal ? 0.05 : -0.06) + (mod(n, K) - (K - 1) / 2) * 0.012
        tintRect(ctx, b.x * W, b.y * W, b.w * W, b.h * W, tone)
        ctx.strokeStyle = DARK
        ctx.globalAlpha = 0.4
        ctx.lineWidth = 0.4
        ctx.strokeRect(b.x * W, b.y * W, b.w * W, b.h * W)
        ctx.globalAlpha = 1
      }
    }
  }
}

function drawTile(ctx: Ctx) {
  const T = 30, tints = [0.025, -0.035, -0.02, 0.04]
  for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++) tintRect(ctx, c * T, r * T, T, T, tints[r * 2 + c])
  for (let i = 0; i <= 2; i++) {
    seg(ctx, 0, i * T, 2 * T, i * T, 0.9, DARK, 0.5)
    seg(ctx, i * T, 0, i * T, 2 * T, 0.9, DARK, 0.5)
  }
}

function drawStone(ctx: Ctx) {
  const sc = 0.75
  const rows = [
    { y: 0, h: 26, cuts: [0, 40, 90, 120], tints: [0.04, -0.05, 0.02] },
    { y: 26, h: 28, cuts: [0, 25, 70, 120], tints: [-0.04, 0.05, -0.02] },
    { y: 54, h: 26, cuts: [0, 55, 90, 120], tints: [0.03, -0.045, 0.05] },
  ]
  for (const row of rows) {
    row.tints.forEach((t, i) => tintRect(ctx, row.cuts[i] * sc, row.y * sc, (row.cuts[i + 1] - row.cuts[i]) * sc, row.h * sc, t))
    for (const x of row.cuts) seg(ctx, x * sc, row.y * sc, x * sc, (row.y + row.h) * sc, 0.8, DARK, 0.45)
    seg(ctx, 0, row.y * sc, 120 * sc, row.y * sc, 0.8, DARK, 0.45)
  }
  seg(ctx, 0, 80 * sc, 120 * sc, 80 * sc, 0.8, DARK, 0.45)
}

function drawCarpet(ctx: Ctx) {
  const span = 12
  for (let i = 0; i < 8; i++) {
    const p = (i * 3 + 1.5) * 0.5
    seg(ctx, 0, p, span, p, 0.35, i % 2 ? DARK : INK, i % 2 ? 0.08 : 0.06)
    seg(ctx, p, 0, p, span, 0.35, i % 2 ? INK : DARK, i % 2 ? 0.05 : 0.07)
  }
}

function drawGrass(ctx: Ctx) {
  const W = 40, H = 40
  const r = rng(0x5eed1234)
  for (let i = 0; i < 6; i++) {
    const pw = 10 + r() * 10, ph = 10 + r() * 10
    const x0 = r() * W - pw / 2, y0 = r() * H - ph / 2
    const t = (i % 2 ? 1 : -1) * (0.035 + r() * 0.025)
    for (const dx of [-W, 0, W]) for (const dy of [-H, 0, H]) tintRect(ctx, x0 + dx, y0 + dy, pw, ph, t)
  }
  for (let i = 0; i < 150; i++) {
    const x = r() * W, y = r() * H, len = 1.5 + r() * 2.5, tilt = (r() - 0.5) * (Math.PI / 3)
    const lw = 0.3 + r() * 0.25, color = r() < 0.45 ? DARK : INK, alpha = 0.12 + r() * 0.16
    for (const dx of [-W, 0, W]) {
      for (const dy of [-H, 0, H]) {
        seg(ctx, x + dx, y + dy, x + dx + Math.sin(tilt) * len, y + dy - Math.cos(tilt) * len, lw, color, alpha)
      }
    }
  }
}

const DRAW: Record<Exclude<FloorPattern, 'solid'>, (ctx: Ctx) => void> = {
  wood: drawWood, parquet: drawParquet, tile: drawTile, stone: drawStone, carpet: drawCarpet, grass: drawGrass,
}

const cache = new Map<string, THREE.CanvasTexture>()

/**
 * Cached repeating texture of a patterned floor. One UV unit = one tile (use FLOOR_TILE_CM to build UVs).
 * Returns null for 'solid' / no pattern, or when no 2D canvas is available.
 */
export function getFloorTexture(pattern: FloorPattern | undefined, fill: string | undefined): THREE.CanvasTexture | null {
  if (!isPatterned(pattern)) return null
  const key = `${pattern}|${fill ?? ''}`
  const hit = cache.get(key)
  if (hit) return hit
  const tile = FLOOR_TILE_CM[pattern]
  const px = PX_PER_CM[pattern]
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(tile.w * px)
  canvas.height = Math.round(tile.h * px)
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.fillStyle = `#${floorBaseColor(fill).getHexString()}`
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.scale(px, px)
  ctx.lineCap = 'round'
  DRAW[pattern](ctx)
  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  cache.set(key, tex)
  return tex
}

/** Dispose every cached texture and empty the cache. */
export function disposeAll(): void {
  for (const t of cache.values()) t.dispose()
  cache.clear()
}
